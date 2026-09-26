"""Stage, check, and dispatch one cost-capped Reasoner role audit."""
import argparse
import base64
from decimal import Decimal
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import time

from feral_cloud_package import launch_request
from reasoner4_representation_audit import ROOT, digest, encoded
from reasoner4_package import verify

BUCKET = 'ilxyr-feral-7b-calibration-022118847419-us-east-1'
ACCOUNT = '022118847419'
SUBNET = 'subnet-6d16a437'
GROUP = 'sg-02b40b678ab46e5f4'
ROLE = 'ilxyr-feral-7b-calibration-ec2'
PACKAGE_PREFIX = 'packages/reasoner4-role-audit/'
RESULT_PREFIX = 'runs/reasoner4-role-audit-'
RECORD = ROOT / 'experiments/reasoner4-representation-audit/PACKAGE.json'
PROFILE = ROOT / 'experiments/reasoner4-representation-audit/EXECUTION-PROFILE.json'
BODY = ROOT / 'scripts/aws/reasoner4-role-user-data.sh'


def require(ok, message):
    if not ok:
        raise ValueError(message)


def aws(args, profile='default', region='us-east-1', check=True):
    process = subprocess.run(['aws', *args, '--profile', profile, '--region', region,
                              '--no-cli-pager', '--output', 'json'],
                             capture_output=True, text=True, timeout=60,
                             env={**os.environ, 'AWS_MAX_ATTEMPTS': '1'})
    if check and process.returncode:
        raise RuntimeError(f"AWS {args[0]} {args[1]}: {process.stderr[:800]}")
    return process


def frozen(archive):
    record, profile = json.loads(RECORD.read_bytes()), json.loads(PROFILE.read_bytes())
    require(digest(archive.read_bytes()) == record['archive_sha256'], 'package digest differs')
    require(archive.stat().st_size == record['archive_bytes'], 'package bytes differ')
    require(digest(PROFILE.read_bytes()) == record['profile_sha256'], 'profile digest differs')
    verify(archive)
    require(profile['maximum_before_tax_usd'] == '0.150000' and
            profile['max_instance_seconds'] == 900, 'budget differs')
    return record, profile


def retention_rules():
    rules = []
    for kind, prefix in (('packages', PACKAGE_PREFIX), ('results', RESULT_PREFIX)):
        base = {'Status': 'Enabled', 'Filter': {'Prefix': prefix}}
        rules.append({'ID': 'reasoner4-role-' + kind, **base,
                      'Expiration': {'Days': 30},
                      'NoncurrentVersionExpiration': {'NoncurrentDays': 1},
                      'AbortIncompleteMultipartUpload': {'DaysAfterInitiation': 1}})
        rules.append({'ID': 'reasoner4-role-markers-' + kind, **base,
                      'Expiration': {'ExpiredObjectDeleteMarker': True}})
    return rules


def ensure_retention(profile):
    data = json.loads(aws(['s3api', 'get-bucket-lifecycle-configuration', '--bucket', BUCKET], profile).stdout)
    rules = data['Rules']
    original_count = len(rules)
    expected = retention_rules()
    existing = {item['ID']: item for item in rules}
    for item in expected:
        if item['ID'] in existing:
            require(existing[item['ID']] == item, 'retention rule differs')
        else:
            rules.append(item)
    if len(rules) != original_count:
        aws(['s3api', 'put-bucket-lifecycle-configuration', '--bucket', BUCKET,
             '--lifecycle-configuration', json.dumps({'Rules': rules})], profile)
    return {'status': 'ready', 'rules': [item['ID'] for item in expected]}


def stage(archive, binding_path, profile):
    record, _ = frozen(archive)
    require(not binding_path.exists(), 'binding already exists')
    identity = json.loads(aws(['sts', 'get-caller-identity'], profile).stdout)
    require(identity['Account'] == ACCOUNT, 'AWS account differs')
    key = PACKAGE_PREFIX + record['archive_sha256'] + '.tar'
    checksum = base64.b64encode(bytes.fromhex(record['archive_sha256'])).decode()
    response = json.loads(aws(['s3api', 'put-object', '--bucket', BUCKET, '--key', key,
                              '--body', str(archive), '--server-side-encryption', 'AES256',
                              '--checksum-algorithm', 'SHA256', '--checksum-sha256', checksum,
                              '--if-none-match', '*'], profile).stdout)
    require(response.get('VersionId') and response.get('ChecksumSHA256') == checksum,
            'staged object receipt differs')
    binding = {'schema': 'ilxyr.reasoner4_role_stage.v1', 'archive_sha256': record['archive_sha256'],
               'bucket': BUCKET, 'key': key, 'version_id': response['VersionId'],
               'bytes': record['archive_bytes']}
    binding_path.write_bytes(encoded(binding))
    return binding


def request(binding, run_id, launch_epoch, archive):
    record, profile = json.loads(RECORD.read_bytes()), json.loads(PROFILE.read_bytes())
    require(re.fullmatch(r'reasoner4-role-audit-[0-9]{8}T[0-9]{6}Z', run_id), 'run ID differs')
    require(binding['archive_sha256'] == record['archive_sha256'] and binding['bucket'] == BUCKET,
            'stage binding differs')
    packaged = verify(archive)
    require(packaged['scripts/aws/reasoner4-role-user-data.sh'] == BODY.read_bytes(),
            'live bootstrap differs from frozen package')
    image = profile['runtime_image']
    values = {'W_LAUNCH': str(launch_epoch), 'W_RUN': run_id, 'W_BUCKET': BUCKET,
              'W_PACKAGE_KEY': binding['key'], 'W_PACKAGE_VERSION': binding['version_id'],
              'W_PACKAGE_SHA': record['archive_sha256'], 'W_IMAGE': image}
    script = ('#!/bin/bash\n' + ''.join(f'{key}={shlex.quote(value)}\n'
                                    for key, value in values.items()) + '\n').encode() + BODY.read_bytes()
    require(len(script) < 16384, 'user-data size exceeds EC2 bound')
    result = launch_request(script, {'run_id': run_id, 'host_package_sha256': record['archive_sha256']},
                            {'subnet_id': SUBNET, 'security_group_id': GROUP})
    result['InstanceType'] = profile['instance_type']
    result['ImageId'] = profile['ami_id']
    result['BlockDeviceMappings'][0]['Ebs'].update(VolumeSize=80, Iops=3000, Throughput=125)
    for group in result['TagSpecifications']:
        for tag in group['Tags']:
            if tag['Key'] == 'Project':
                tag['Value'] = 'reasoner4-role-audit'
    return result


def preflight(archive, binding_path, receipt_path, run_id, profile):
    record, frozen_profile = frozen(archive)
    binding = json.loads(binding_path.read_bytes())
    require(not receipt_path.exists(), 'preflight receipt already exists')
    evidence = {'schema': 'ilxyr.reasoner4_role_preflight.v1', 'status': 'failed',
                'archive_sha256': record['archive_sha256'], 'run_id': run_id,
                'instances_created': 0, 'checked_epoch': time.time()}
    try:
        identity = json.loads(aws(['sts', 'get-caller-identity'], profile).stdout)
        require(identity['Account'] == ACCOUNT, 'AWS account differs')
        image = json.loads(aws(['ec2', 'describe-images', '--image-ids', frozen_profile['ami_id']], profile).stdout)['Images']
        require(len(image) == 1 and image[0]['State'] == 'available' and
                image[0]['Architecture'] == 'x86_64', 'AMI differs')
        root_device = next(item['Ebs'] for item in image[0]['BlockDeviceMappings']
                           if item['DeviceName'] == '/dev/xvda')
        require(root_device['SnapshotId'] == 'snap-00fc8bf70edbceb6c' and
                root_device['VolumeSize'] <= 80, 'AMI root snapshot differs')
        machine = json.loads(aws(['ec2', 'describe-instance-types', '--instance-types', 'c6i.large'], profile).stdout)['InstanceTypes'][0]
        require(machine['VCpuInfo']['DefaultVCpus'] == 2 and
                machine['MemoryInfo']['SizeInMiB'] == 4096, 'machine shape differs')
        subnet = json.loads(aws(['ec2', 'describe-subnets', '--subnet-ids', SUBNET], profile).stdout)['Subnets'][0]
        require(subnet['State'] == 'available' and subnet['AvailableIpAddressCount'] > 0, 'subnet differs')
        offering = json.loads(aws(['ec2', 'describe-instance-type-offerings', '--location-type',
                                   'availability-zone', '--filters',
                                   'Name=instance-type,Values=c6i.large',
                                   'Name=location,Values=' + subnet['AvailabilityZone']], profile).stdout)
        require(any(item['InstanceType'] == 'c6i.large' for item in offering['InstanceTypeOfferings']),
                'instance offering differs')
        security = json.loads(aws(['ec2', 'describe-security-groups', '--group-ids', GROUP], profile).stdout)['SecurityGroups'][0]
        require(security['VpcId'] == subnet['VpcId'] and security['IpPermissions'] == [], 'network differs')
        require(any(item.get('IpProtocol') == 'tcp' and item.get('FromPort') == 443
                    for item in security['IpPermissionsEgress']), 'HTTPS egress missing')
        worker = json.loads(aws(['iam', 'get-instance-profile', '--instance-profile-name', ROLE], profile).stdout)['InstanceProfile']
        require(worker['InstanceProfileName'] == ROLE and
                [item['RoleName'] for item in worker['Roles']] == [ROLE], 'worker role differs')
        policy = json.loads(aws(['iam', 'get-role-policy', '--role-name', ROLE,
                                 '--policy-name', 'ExactFERALCorpusAndResults'], profile).stdout)['PolicyDocument']['Statement']
        def permits(action, resource):
            return any(item['Effect'] == 'Allow' and action in item['Action'] and
                       item['Resource'] == resource for item in policy)
        require(permits('s3:GetObjectVersion', f'arn:aws:s3:::{BUCKET}/packages/*') and
                permits('s3:PutObject', f'arn:aws:s3:::{BUCKET}/runs/*'),
                'worker object permissions differ')
        versioning = json.loads(aws(['s3api', 'get-bucket-versioning', '--bucket', BUCKET], profile).stdout)
        require(versioning.get('Status') == 'Enabled', 'bucket versioning differs')
        public = json.loads(aws(['s3api', 'get-public-access-block', '--bucket', BUCKET], profile).stdout)['PublicAccessBlockConfiguration']
        require(all(public.get(key) is True for key in ('BlockPublicAcls', 'IgnorePublicAcls',
                  'BlockPublicPolicy', 'RestrictPublicBuckets')), 'bucket public access differs')
        encryption = json.loads(aws(['s3api', 'get-bucket-encryption', '--bucket', BUCKET], profile).stdout)
        require(any(item['ApplyServerSideEncryptionByDefault']['SSEAlgorithm'] == 'AES256'
                    for item in encryption['ServerSideEncryptionConfiguration']['Rules']),
                'bucket encryption differs')
        bucket_policy = json.loads(aws(['s3api', 'get-bucket-policy', '--bucket', BUCKET], profile).stdout)
        statements = json.loads(bucket_policy['Policy'])['Statement']
        require(any(item['Effect'] == 'Deny' and item.get('Condition', {}).get('Bool', {}).get('aws:SecureTransport') == 'false'
                    for item in statements), 'bucket TLS policy differs')
        lifecycle = json.loads(aws(['s3api', 'get-bucket-lifecycle-configuration', '--bucket', BUCKET], profile).stdout)
        require(all(rule in lifecycle['Rules'] for rule in retention_rules()), 'retention differs')
        head = json.loads(aws(['s3api', 'head-object', '--bucket', BUCKET, '--key', binding['key'],
                              '--version-id', binding['version_id'], '--checksum-mode', 'ENABLED'], profile).stdout)
        checksum = base64.b64encode(bytes.fromhex(record['archive_sha256'])).decode()
        require(head['VersionId'] == binding['version_id'] and
                head['ContentLength'] == record['archive_bytes'] and
                head['ChecksumSHA256'] == checksum and
                head['ServerSideEncryption'] == 'AES256', 'staged object differs')
        filters = {'instanceType': 'c6i.large', 'location': 'US East (N. Virginia)',
                   'operatingSystem': 'Linux', 'tenancy': 'Shared', 'preInstalledSw': 'NA',
                   'capacitystatus': 'Used'}
        products = json.loads(aws(['pricing', 'get-products', '--service-code', 'AmazonEC2',
                                   '--filters', json.dumps([{'Type': 'TERM_MATCH', 'Field': k,
                                                              'Value': v} for k, v in filters.items()])], profile).stdout)
        rates = [Decimal(item['pricePerUnit']['USD']) for raw in products['PriceList']
                 for term in json.loads(raw)['terms']['OnDemand'].values()
                 for item in term['priceDimensions'].values() if item['unit'] == 'Hrs']
        require(len(rates) == 1 and rates[0] <= Decimal(frozen_profile['price_ceiling_usd_per_hour']),
                'live compute price exceeds ceiling')
        prefix = 'runs/' + run_id + '/'
        existing = json.loads(aws(['s3api', 'list-objects-v2', '--bucket', BUCKET,
                                   '--prefix', prefix, '--max-keys', '1'], profile).stdout)
        require(existing.get('KeyCount', 0) == 0, 'output prefix already used')
        dry = request(binding, run_id, int(time.time()), archive)
        result = aws(['ec2', 'run-instances', '--cli-input-json', json.dumps(dry)], profile, check=False)
        require(result.returncode != 0 and 'DryRunOperation' in result.stderr, 'EC2 dry run failed')
        evidence.update(status='passed', package_version=binding['version_id'],
                        live_compute_usd_per_hour=str(rates[0]),
                        checks=['account', 'AMI', 'machine', 'offering', 'network', 'role',
                                'bucket_privacy_encryption', 'versioned_package', 'retention',
                                'price', 'fresh_output', 'ec2_dry_run'])
    except Exception as error:
        evidence['error'] = str(error)
        raise
    finally:
        receipt_path.write_bytes(encoded(evidence))
    return evidence


def launch(archive, binding_path, receipt_path, launch_receipt_path,
           run_id, budget_cap, profile):
    record, frozen_profile = frozen(archive)
    require(budget_cap == frozen_profile['maximum_before_tax_usd'], 'budget cap differs')
    preflight_receipt = json.loads(receipt_path.read_bytes())
    require(preflight_receipt['status'] == 'passed' and
            preflight_receipt['archive_sha256'] == record['archive_sha256'] and
            preflight_receipt['run_id'] == run_id and
            0 <= time.time() - preflight_receipt['checked_epoch'] <= 3600,
            'fresh preflight differs')
    binding = json.loads(binding_path.read_bytes())
    require(preflight_receipt['package_version'] == binding['version_id'],
            'preflight package version differs')
    require(not launch_receipt_path.exists(), 'launch receipt already exists')
    launch_epoch = int(time.time())
    actual = request(binding, run_id, launch_epoch, archive)
    actual['DryRun'] = False
    request_bytes = encoded(actual)
    request_path = launch_receipt_path.with_name(launch_receipt_path.stem + '-request.json')
    require(not request_path.exists(), 'submitted request already exists')
    request_path.write_bytes(request_bytes)
    receipt = {'schema': 'ilxyr.reasoner4_role_launch.v1', 'status': 'prepared',
               'run_id': run_id, 'client_token': run_id,
               'archive_sha256': record['archive_sha256'],
               'package_version': binding['version_id'],
               'request_sha256': digest(request_bytes),
               'user_data_sha256': digest(actual['UserData'].encode('utf-8')),
               'launch_epoch_seconds': launch_epoch,
               'deadline_epoch_seconds': launch_epoch + frozen_profile['max_instance_seconds'],
               'maximum_before_tax_usd': budget_cap,
               'instance_id': None}
    launch_receipt_path.write_bytes(encoded(receipt))
    submitted = False
    try:
        submitted = True
        result = aws(['ec2', 'run-instances', '--cli-input-json', json.dumps(actual)], profile)
        instances = json.loads(result.stdout)['Instances']
        require(len(instances) == 1, 'launch returned unexpected instance count')
        receipt.update(status='launched', instance_id=instances[0]['InstanceId'])
    except Exception as error:
        receipt.update(status='launch_outcome_unknown' if submitted else 'failed',
                       error=str(error))
        raise
    finally:
        launch_receipt_path.write_bytes(encoded(receipt))
    return receipt


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=('retention', 'stage', 'preflight', 'launch'))
    parser.add_argument('--archive', type=Path)
    parser.add_argument('--binding', type=Path)
    parser.add_argument('--receipt', type=Path)
    parser.add_argument('--launch-receipt', type=Path)
    parser.add_argument('--run-id')
    parser.add_argument('--budget-cap')
    parser.add_argument('--profile', default='default')
    args = parser.parse_args()
    if args.mode == 'retention':
        result = ensure_retention(args.profile)
    elif args.mode == 'stage':
        result = stage(args.archive, args.binding, args.profile)
    elif args.mode == 'preflight':
        result = preflight(args.archive, args.binding, args.receipt, args.run_id, args.profile)
    else:
        result = launch(args.archive, args.binding, args.receipt, args.launch_receipt,
                        args.run_id, args.budget_cap, args.profile)
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    main()
