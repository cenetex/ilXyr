"""Observe and collect one immutable Reasoner role-audit cloud result."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess

BUCKET = 'ilxyr-feral-7b-calibration-022118847419-us-east-1'
ACCOUNT = '022118847419'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def call(args, profile):
    value = subprocess.run(['aws', *args, '--profile', profile, '--region', 'us-east-1',
                            '--no-cli-pager', '--output', 'json'],
                           capture_output=True, text=True, timeout=45)
    if value.returncode:
        raise RuntimeError(value.stderr[:800])
    return json.loads(value.stdout)


def identity(profile):
    if call(['sts', 'get-caller-identity'], profile)['Account'] != ACCOUNT:
        raise ValueError('AWS account differs')


def head(key, profile):
    return call(['s3api', 'head-object', '--bucket', BUCKET, '--key', key,
                 '--checksum-mode', 'ENABLED'], profile)


def download(key, version, path, profile):
    receipt = call(['s3api', 'get-object', '--bucket', BUCKET, '--key', key,
                    '--version-id', version, str(path)], profile)
    if receipt.get('VersionId') != version:
        raise ValueError('download version differs: ' + key)
    return receipt


def observe(run_id, profile):
    identity(profile)
    key = f'runs/{run_id}/terminal.json'
    try:
        metadata = head(key, profile)
        return {'state': 'terminal_object_present', 'key': key,
                'version_id': metadata['VersionId'], 'bytes': metadata['ContentLength']}
    except RuntimeError as error:
        if '404' not in str(error) and 'Not Found' not in str(error):
            raise
    instances = call(['ec2', 'describe-instances', '--filters',
                      'Name=tag:RunId,Values=' + run_id], profile)
    values = [{'id': value['InstanceId'], 'state': value['State']['Name']}
              for group in instances['Reservations'] for value in group['Instances']]
    return {'state': 'running_or_pending', 'instances': values}


def collect(run_id, archive_sha, launch_receipt_path, output, profile):
    identity(profile)
    launch = json.loads(launch_receipt_path.read_bytes())
    if (launch['status'] != 'launched' or launch['run_id'] != run_id or
            launch['archive_sha256'] != archive_sha or not launch.get('instance_id')):
        raise ValueError('trusted launch receipt differs')
    if output.exists():
        raise ValueError('collection output already exists')
    output.mkdir(parents=True)
    prefix = f'runs/{run_id}/'
    terminal_key = prefix + 'terminal.json'
    terminal_head = head(terminal_key, profile)
    terminal_path = output / 'terminal.json'
    download(terminal_key, terminal_head['VersionId'], terminal_path, profile)
    terminal = json.loads(terminal_path.read_bytes())
    if terminal['run_id'] != run_id or terminal['package_sha256'] != archive_sha:
        raise ValueError('terminal package identity differs')
    receipts = {'terminal.json': {'key': terminal_key, 'version_id': terminal_head['VersionId'],
                                  'sha256': sha(terminal_path.read_bytes())}}
    for name, expected in terminal['files'].items():
        path = PurePosixPath(name)
        if path.is_absolute() or '..' in path.parts or str(path) != name:
            raise ValueError('unsafe result path')
        key = prefix + name
        metadata = head(key, profile)
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        download(key, metadata['VersionId'], target, profile)
        raw = target.read_bytes()
        if len(raw) != expected['bytes'] or sha(raw) != expected['sha256']:
            raise ValueError('result hash differs: ' + name)
        receipts[name] = {'key': key, 'version_id': metadata['VersionId'], 'sha256': sha(raw)}
    instance_id = terminal.get('instance_id')
    if instance_id != launch['instance_id']:
        raise ValueError('terminal instance ID differs from launch')
    instances = call(['ec2', 'describe-instances', '--instance-ids', instance_id], profile)
    hosts = [item for group in instances['Reservations'] for item in group['Instances']
             if item['InstanceId'] == instance_id]
    if len(hosts) != 1 or hosts[0]['State']['Name'] != 'terminated':
        raise ValueError('instance has not terminated')
    tags = {item['Key']: item['Value'] for item in hosts[0]['Tags']}
    if (tags.get('RunId') != run_id or tags.get('HostPackageSha256') != archive_sha or
            tags.get('Project') != 'reasoner4-role-audit'):
        raise ValueError('provider instance tags differ')
    volumes = call(['ec2', 'describe-volumes', '--filters',
                    'Name=tag:RunId,Values=' + run_id], profile)
    interfaces = call(['ec2', 'describe-network-interfaces', '--filters',
                       'Name=attachment.instance-id,Values=' + instance_id], profile)
    if volumes['Volumes'] or interfaces['NetworkInterfaces']:
        raise ValueError('provider resources remain attached')
    cleanup = {'tagged_volumes': 0, 'attached_network_interfaces': 0}
    if terminal['status'] != 'complete':
        manifest = {'schema': 'ilxyr.reasoner4_role_collection.v1',
                    'status': 'verified_host_failure', 'run_id': run_id,
                    'archive_sha256': archive_sha, 'instance_id': instance_id,
                    'instance_state': 'terminated', 'host_exit_code': terminal['exit_code'],
                    'host_phase': terminal['phase'], 'provider_cleanup': cleanup,
                    'objects': receipts}
        (output / 'COLLECTION.json').write_text(json.dumps(manifest, indent=2, sort_keys=True) + '\n')
        return manifest
    result_path = output / 'diagnostic/result.json'
    run_receipt_path = output / 'diagnostic/receipt.json'
    capture_path = output / 'diagnostic/capture-verification.json'
    if not all(path.is_file() for path in (result_path, run_receipt_path, capture_path)):
        raise ValueError('diagnostic result or verifier receipt missing')
    run_receipt = json.loads(run_receipt_path.read_bytes())
    capture = json.loads(capture_path.read_bytes())
    if (run_receipt['archive_sha256'] != archive_sha or
            run_receipt['result_sha256'] != sha(result_path.read_bytes()) or
            run_receipt['capture_verification_sha256'] != sha(capture_path.read_bytes()) or
            capture['verifier_evaluations'] != 2880 or
            capture['source_revision'] != '3b917b6f54d151a43dd65e45f094606272d166c5'):
        raise ValueError('diagnostic receipt differs')
    result = json.loads(result_path.read_bytes())
    if (result['smoke'] or result['shuffle_null']['runs'] != 60 or
            [item['seed'] for item in result['selection']] != [3, 9, 39] or
            len(result['predictions']) != 180):
        raise ValueError('full three-seed result missing')
    manifest = {'schema': 'ilxyr.reasoner4_role_collection.v1', 'status': 'verified',
                'run_id': run_id, 'archive_sha256': archive_sha,
                'instance_id': instance_id, 'instance_state': 'terminated',
                'provider_cleanup': cleanup,
                'objects': receipts, 'measurements': result['measurements']}
    (output / 'COLLECTION.json').write_text(json.dumps(manifest, indent=2, sort_keys=True) + '\n')
    return manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=('observe', 'collect'))
    parser.add_argument('--run-id', required=True)
    parser.add_argument('--archive-sha256')
    parser.add_argument('--launch-receipt', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--profile', default='default')
    args = parser.parse_args()
    if args.mode == 'observe':
        result = observe(args.run_id, args.profile)
    else:
        if not args.archive_sha256 or not args.launch_receipt or not args.output:
            parser.error('collect requires archive SHA, launch receipt, and output')
        result = collect(args.run_id, args.archive_sha256, args.launch_receipt,
                         args.output, args.profile)
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    main()
