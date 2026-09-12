"""Render and dispatch one fixed zero4 corpus cloud request."""

import argparse
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import time

from feral_cloud_package import launch_request
from package_zero4_cloud import encode, sha, inspect, BODY


def render(package, expected, binding, network):
    files, manifest, plan = inspect(package, expected)
    provider = plan['provider']
    if network != {k: provider[k] for k in ['subnet_id', 'security_group_id']}:
        raise ValueError('frozen network differs')
    if provider['instance_type'] != 'c6i.4xlarge' or provider['ami_id'] != 'ami-0d3378afe7683c867':
        raise ValueError('machine differs')
    if plan['limits']['max_instance_seconds'] != 48600 or plan['budget']['maximum_before_tax_usd'] != '12.00':
        raise ValueError('budget differs')
    patterns = {'run_id': r'zero4-45-[0-9]{8}T[0-9]{6}Z',
                'package_version': r'[A-Za-z0-9._+/=-]{1,256}',
                'approval_reference': r'[A-Za-z0-9._-]{1,100}'}
    for key, pattern in patterns.items():
        if not isinstance(binding[key], str) or not re.fullmatch(pattern, binding[key]):
            raise ValueError('binding differs: ' + key)
    if type(binding['launch_epoch_seconds']) is not int or binding['launch_epoch_seconds'] <= 0:
        raise ValueError('launch time differs')
    values = {'W_RUN': binding['run_id'], 'W_LAUNCH': str(binding['launch_epoch_seconds']),
              'W_BUCKET': 'ilxyr-feral-7b-calibration-022118847419-us-east-1',
              'W_PACKAGE_KEY': 'packages/zero4-45/' + expected + '.tar',
              'W_PACKAGE_SHA': expected, 'W_PACKAGE_VERSION': binding['package_version'],
              'W_PLAN_SHA': manifest['plan_sha256'], 'W_APPROVAL': binding['approval_reference']}
    prefix = '#!/bin/bash\n' + ''.join(k + '=' + shlex.quote(v) + '\n' for k, v in values.items())
    body = files[BODY]
    script = (prefix + '\n# ZERO4_45_BODY\n').encode() + body
    if len(script) > 16384:
        raise ValueError('user data exceeds bound')
    request = launch_request(script, {**binding, 'host_package_sha256': expected}, network)
    request['InstanceType'] = 'c6i.4xlarge'
    request['BlockDeviceMappings'][0]['Ebs'].update(VolumeSize=80, Iops=3000, Throughput=125)
    for group in request['TagSpecifications']:
        for tag in group['Tags']:
            if tag['Key'] == 'Project': tag['Value'] = 'zero4-45'
            if tag['Key'] == 'HostPackageSha256': tag['Key'] = 'PackageSha256'
    for group in request['TagSpecifications']:
        group['Tags'] += [{'Key': 'DeadlineEpoch', 'Value': str(binding['launch_epoch_seconds'] + 48600)}]
    return script, request, manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['render', 'dry-run', 'launch'])
    for key in ['package', 'binding', 'network', 'out']:
        parser.add_argument('--' + key, type=Path, required=True)
    parser.add_argument('--package-sha256', required=True)
    parser.add_argument('--approval', type=Path)
    parser.add_argument('--preflight', type=Path)
    parser.add_argument('--profile', default='default')
    args = parser.parse_args()
    binding = json.loads(args.binding.read_bytes())
    script, request, manifest = render(args.package, args.package_sha256, binding, json.loads(args.network.read_bytes()))
    if args.mode == 'launch':
        approval = json.loads(args.approval.read_bytes()) if args.approval else None
        expected = {'package_sha256': args.package_sha256, 'plan_sha256': manifest['plan_sha256'],
                    'maximum_instance_seconds': 48600, 'maximum_before_tax_usd': '12.00',
                    'approval_reference': binding['approval_reference']}
        if approval != expected or binding['approval_reference'] == 'pending-user':
            raise ValueError('approval differs')
        if not 0 <= time.time() - binding['launch_epoch_seconds'] <= 60:
            raise ValueError('fresh launch time required')
        preflight = json.loads(args.preflight.read_bytes()) if args.preflight else {}
        if (preflight.get('status') != 'passed' or preflight.get('package_sha256') != args.package_sha256
            or preflight.get('package_version') != binding['package_version']
            or preflight.get('plan_sha256') != manifest['plan_sha256']
            or not 0 <= time.time() - preflight.get('checked_epoch', 0) <= 3600):
            raise ValueError('fresh successful preflight required')
        request['DryRun'] = False
    args.out.mkdir(exist_ok=False)
    (args.out / 'user-data.sh').write_bytes(script)
    (args.out / 'request.json').write_bytes(encode(request))
    receipt = {'status': 'rendered', 'run_id': binding['run_id'], 'package_sha256': args.package_sha256,
               'plan_sha256': manifest['plan_sha256'], 'user_data_sha256': sha(script),
               'launch_epoch_seconds': binding['launch_epoch_seconds'], 'package_version': binding['package_version']}
    submitted = False
    try:
        if args.mode != 'render':
            identity = subprocess.run(['aws', 'sts', 'get-caller-identity', '--profile', args.profile,
                '--query', 'Account', '--output', 'text', '--no-cli-pager'], capture_output=True, text=True, timeout=20)
            if identity.returncode != 0 or identity.stdout.strip() != '022118847419':
                raise RuntimeError('AWS account check failed')
            (args.out / 'submitted-request.json').write_bytes(encode(request)); submitted = True
            result = subprocess.run(['aws', 'ec2', 'run-instances', '--profile', args.profile,
                '--region', 'us-east-1', '--cli-input-json', json.dumps(request), '--no-cli-pager'],
                capture_output=True, text=True, timeout=45, env={**os.environ, 'AWS_MAX_ATTEMPTS': '1'})
            if args.mode == 'dry-run':
                if result.returncode == 0 or 'DryRunOperation' not in result.stderr:
                    raise RuntimeError(result.stderr)
                receipt.update(status='dry_run_passed', instances_created=0)
            else:
                if result.returncode != 0: raise RuntimeError(result.stderr)
                instances = json.loads(result.stdout)['Instances']
                if len(instances) != 1 or not re.fullmatch(r'i-[0-9a-f]+', instances[0]['InstanceId']):
                    raise ValueError('instance identity differs')
                receipt.update(status='launched', instance_id=instances[0]['InstanceId'])
    except BaseException as error:
        receipt.update(status='launch_outcome_unknown' if submitted and args.mode == 'launch' else 'failed', error=str(error))
        raise
    finally:
        receipt['request_sha256'] = sha(encode(request))
        (args.out / 'receipt.json').write_bytes(encode(receipt))
    print(json.dumps(receipt))


if __name__ == '__main__':
    main()
