"""Read the frozen zero4 launch dependencies and prove EC2 dry-run permission."""
import argparse
import base64
import json
from pathlib import Path
import subprocess
import time
from package_zero4_cloud import inspect, encode
from zero4_cloud_launch import render


def require(ok, message):
    if not ok: raise ValueError(message)


def lifecycle_rules(plan):
    s = plan['storage']
    return [{'ID': 'zero4-45-' + kind, 'Status': 'Enabled', 'Filter': {'Prefix': s[key]},
             'Expiration': {'Days': s['current_expiry_days']},
             'NoncurrentVersionExpiration': {'NoncurrentDays': s['noncurrent_expiry_days']},
             'AbortIncompleteMultipartUpload': {'DaysAfterInitiation': 1}}
            for kind, key in [('packages', 'package_prefix'), ('results', 'result_prefix')]] + [
            {'ID': 'zero4-45-markers-' + kind, 'Status': 'Enabled', 'Filter': {'Prefix': s[key]},
             'Expiration': {'ExpiredObjectDeleteMarker': True}}
            for kind, key in [('packages', 'package_prefix'), ('results', 'result_prefix')]]


def validate(data, plan, package_sha, package_bytes):
    p = plan['provider']; s = plan['storage']
    require(data['identity']['Account'] == p['account'], 'account differs')
    image = data['image']['Images']; require(len(image) == 1, 'one image required'); image = image[0]
    require(image['ImageId'] == p['ami_id'] and image['State'] == 'available' and image['Architecture'] == p['architecture'], 'image differs')
    root = next(v['Ebs'] for v in image['BlockDeviceMappings'] if v['DeviceName'] == p['root_device'])
    require(root['SnapshotId'] == p['root_snapshot_id'] and root['VolumeSize'] <= p['disk_gib'], 'image disk differs')
    machine = data['machine']['InstanceTypes'][0]
    require(machine['InstanceType'] == p['instance_type'] and machine['VCpuInfo']['DefaultVCpus'] == p['vcpus']
            and machine['MemoryInfo']['SizeInMiB'] == p['memory_mib'] and p['architecture'] in machine['ProcessorInfo']['SupportedArchitectures'], 'machine differs')
    subnet = data['subnet']['Subnets'][0]; group = data['security']['SecurityGroups'][0]
    require(subnet['SubnetId'] == p['subnet_id'] and subnet['State'] == 'available' and subnet['AvailableIpAddressCount'] > 0, 'subnet differs')
    require(group['GroupId'] == p['security_group_id'] and group['VpcId'] == subnet['VpcId'] and group['IpPermissions'] == [], 'security group differs')
    require(any(v.get('FromPort') == 443 and v.get('ToPort') == 443 and v['IpProtocol'] == 'tcp' for v in group['IpPermissionsEgress']), 'HTTPS egress required')
    require(any(v['InstanceType'] == p['instance_type'] and v['Location'] == subnet['AvailabilityZone'] for v in data['offering']['InstanceTypeOfferings']), 'zone offering differs')
    profile = data['profile']['InstanceProfile']
    require(profile['InstanceProfileName'] == p['instance_profile'] and len(profile['Roles']) == 1 and profile['Roles'][0]['RoleName'] == p['instance_profile'], 'instance role differs')
    policy = data['role']['PolicyDocument']['Statement']
    expected = [('s3:GetObjectVersion', 'packages/*'), ('s3:PutObject', 'runs/*')]
    for action, key in expected:
        require(any(v['Effect'] == 'Allow' and action in v['Action'] and v['Resource'] == 'arn:aws:s3:::' + s['bucket'] + '/' + key for v in policy), 'object permission differs')
    require(data['versioning'].get('Status') == 'Enabled', 'versioning required')
    require(data['location'].get('LocationConstraint') in [None, 'us-east-1'], 'bucket region differs')
    require(all(data['public']['PublicAccessBlockConfiguration'].get(k) is True for k in ['BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets']), 'public access block required')
    require(any(v['ApplyServerSideEncryptionByDefault']['SSEAlgorithm'] == 'AES256' for v in data['encryption']['ServerSideEncryptionConfiguration']['Rules']), 'bucket encryption differs')
    bucket_policy = json.loads(data['bucket-policy']['Policy'])['Statement']
    require(any(v['Effect'] == 'Deny' and v.get('Condition', {}).get('Bool', {}).get('aws:SecureTransport') == 'false' for v in bucket_policy), 'TLS policy required')
    for rule in lifecycle_rules(plan): require(rule in data['lifecycle']['Rules'], 'bounded retention rule differs')
    package = data['package']
    require(package['ContentLength'] == package_bytes and package.get('ChecksumSHA256') == base64.b64encode(bytes.fromhex(package_sha)).decode()
            and package.get('VersionId') not in [None, 'null'] and package.get('ServerSideEncryption') == 'AES256', 'staged package differs')
    routes = data['routes']['RouteTables']
    effective = [v for v in routes if any(a.get('SubnetId') == p['subnet_id'] for a in v['Associations'])]
    if not effective: effective = [v for v in routes if any(a.get('Main') for a in v['Associations'])]
    require(len(effective) == 1 and effective[0]['VpcId'] == subnet['VpcId'], 'effective route table differs')
    routes = effective[0]['Routes']
    require(any(v.get('DestinationCidrBlock') == '0.0.0.0/0' and v.get('GatewayId', '').startswith('igw-') and v['State'] == 'active' for v in routes), 'public image route required')
    endpoints = data['endpoints']['VpcEndpoints']
    require(any(v['State'] == 'available' and v['VpcEndpointType'] == 'Gateway' and v['ServiceName'] == 'com.amazonaws.us-east-1.s3'
                and effective[0]['RouteTableId'] in v['RouteTableIds'] and any(r.get('GatewayId') == v['VpcEndpointId'] and r['State'] == 'active' for r in routes) for v in endpoints), 'S3 gateway route required')


def preflight(package, expected, binding, output, profile):
    _, manifest, plan = inspect(package, expected); p = plan['provider']; s = plan['storage']
    output.mkdir(parents=True, exist_ok=False); data = {}
    def call(name, args):
        result = subprocess.run(['aws', *args, '--profile', profile, '--region', p['region'], '--no-cli-pager', '--output', 'json'], capture_output=True, text=True, timeout=30)
        (output / (name + '.stderr.txt')).write_text(result.stderr)
        if result.returncode: raise RuntimeError(name + ': ' + result.stderr[:2000])
        data[name] = json.loads(result.stdout); (output / (name + '.json')).write_bytes(encode(data[name])); return data[name]
    receipt = {'status': 'failed', 'run_id': binding['run_id'], 'package_sha256': expected, 'package_version': binding['package_version'], 'plan_sha256': manifest['plan_sha256'], 'instances_created': 0}
    try:
        call('identity', ['sts', 'get-caller-identity'])
        call('image', ['ec2', 'describe-images', '--image-ids', p['ami_id']])
        call('machine', ['ec2', 'describe-instance-types', '--instance-types', p['instance_type']])
        subnet = call('subnet', ['ec2', 'describe-subnets', '--subnet-ids', p['subnet_id']])['Subnets'][0]
        call('security', ['ec2', 'describe-security-groups', '--group-ids', p['security_group_id']])
        call('offering', ['ec2', 'describe-instance-type-offerings', '--location-type', 'availability-zone', '--filters', 'Name=instance-type,Values=' + p['instance_type'], 'Name=location,Values=' + subnet['AvailabilityZone']])
        call('profile', ['iam', 'get-instance-profile', '--instance-profile-name', p['instance_profile']])
        call('role', ['iam', 'get-role-policy', '--role-name', p['instance_profile'], '--policy-name', 'ExactFERALCorpusAndResults'])
        for name, operation in [('versioning', 'versioning'), ('location', 'location'), ('encryption', 'encryption'), ('lifecycle', 'lifecycle-configuration'), ('bucket-policy', 'policy')]:
            call(name, ['s3api', 'get-bucket-' + operation, '--bucket', s['bucket']])
        call('public', ['s3api', 'get-public-access-block', '--bucket', s['bucket']])
        call('package', ['s3api', 'head-object', '--bucket', s['bucket'], '--key', s['package_prefix'] + expected + '.tar', '--version-id', binding['package_version'], '--checksum-mode', 'ENABLED'])
        call('routes', ['ec2', 'describe-route-tables', '--filters', 'Name=vpc-id,Values=' + subnet['VpcId']])
        call('endpoints', ['ec2', 'describe-vpc-endpoints', '--filters', 'Name=vpc-id,Values=' + subnet['VpcId']])
        validate(data, plan, expected, package.stat().st_size)
        require(data['package']['VersionId'] == binding['package_version'], 'package version differs')
        # Query the actual shared Linux on-demand price again at launch preflight.
        filters = {'instanceType': p['instance_type'], 'location': 'US East (N. Virginia)', 'operatingSystem': 'Linux', 'tenancy': 'Shared', 'preInstalledSw': 'NA', 'capacitystatus': 'Used'}
        price = call('price', ['pricing', 'get-products', '--service-code', 'AmazonEC2', '--filters', json.dumps([{'Type': 'TERM_MATCH', 'Field': k, 'Value': v} for k, v in filters.items()])])
        from decimal import Decimal
        rates = [Decimal(d['pricePerUnit']['USD']) for raw in price['PriceList'] for term in json.loads(raw)['terms']['OnDemand'].values() for d in term['priceDimensions'].values() if d['unit'] == 'Hrs']
        require(len(rates) == 1 and rates[0] <= Decimal(plan['budget']['compute_usd_per_hour']), 'compute price exceeds frozen ceiling')
        for budget_key, (service, sku, unit) in plan['price_products'].items():
            source = call('price-' + budget_key, ['pricing', 'get-products', '--service-code', service,
                '--filters', json.dumps([{'Type': 'TERM_MATCH', 'Field': 'sku', 'Value': sku}])])
            rates = [Decimal(d['pricePerUnit']['USD']) for raw in source['PriceList'] for term in json.loads(raw)['terms']['OnDemand'].values()
                     for d in term['priceDimensions'].values() if d['unit'] == unit and d.get('beginRange') == '0']
            require(len(rates) == 1 and rates[0] <= Decimal(plan['budget'][budget_key]), 'price exceeds frozen ceiling: ' + budget_key)
        objects = call('output-prefix', ['s3api', 'list-objects-v2', '--bucket', s['bucket'], '--prefix', 'runs/' + binding['run_id'] + '/', '--max-keys', '1'])
        require(objects.get('KeyCount', 0) == 0, 'fresh output prefix required')
        _, request, _ = render(package, expected, binding, {k: p[k] for k in ['subnet_id', 'security_group_id']})
        (output / 'dry-run-request.json').write_bytes(encode(request))
        result = subprocess.run(['aws', 'ec2', 'run-instances', '--profile', profile, '--region', p['region'], '--cli-input-json', json.dumps(request), '--no-cli-pager'], capture_output=True, text=True, timeout=45)
        (output / 'dry-run.txt').write_text(result.stderr)
        require(result.returncode != 0 and 'DryRunOperation' in result.stderr, 'EC2 dry run failed')
        receipt.update(status='passed', checks=['identity', 'machine', 'image_snapshot', 'volume_floor', 'network', 'role', 'bucket_privacy_encryption', 'versioned_package', 'bounded_retention', 'price', 'ec2_dry_run'])
    except Exception as error:
        receipt['error'] = str(error); raise
    finally:
        receipt['checked_epoch'] = time.time(); (output / 'receipt.json').write_bytes(encode(receipt))
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['package', 'binding', 'output']: parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--package-sha256', required=True); parser.add_argument('--profile', default='default'); a = parser.parse_args()
    print(json.dumps(preflight(a.package, a.package_sha256, json.loads(a.binding.read_bytes()), a.output, a.profile), sort_keys=True))
