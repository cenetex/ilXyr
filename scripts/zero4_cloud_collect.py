"""Preserve bounded zero4 outputs and collect exact object versions after termination."""
import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import tarfile
import time


def encode(value): return (json.dumps(value, indent=2, sort_keys=True) + '\n').encode()
def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as source:
        for raw in iter(lambda: source.read(1024 * 1024), b''): h.update(raw)
    return h.hexdigest()
def save(path, value): path.write_bytes(encode(value))


def archive_outputs(root, output, max_bytes, max_members, deadline):
    """Keep a bounded prefix and record every omitted or shortened file."""
    records = []; complete = True; stop_reason = None
    # Reserve archive headers, padding and a bounded inventory before adding data.
    available = max_bytes - max_members * 2048 - 8 * 1024 * 1024
    if available < 0: raise ValueError('archive ceiling is too small')
    with tarfile.open(output, 'x', format=tarfile.PAX_FORMAT) as archive:
        for path in sorted(root.rglob('*')):
            if time.time() >= deadline:
                complete = False; stop_reason = 'archive_deadline'; break
            name = str(path.relative_to(root)); mode = path.lstat().st_mode
            if stat.S_ISDIR(mode): continue
            if len(records) >= max_members:
                complete = False; stop_reason = 'member_ceiling'; break
            if not stat.S_ISREG(mode) or len(name.encode()) > 240:
                records.append({'path': name, 'status': 'omitted_type_or_name'}); complete = False; continue
            size = path.stat().st_size; kept = min(size, max(0, available)); available -= kept
            if kept == 0 and size:
                records.append({'path': name, 'status': 'omitted_byte_ceiling', 'original_bytes': size}); complete = False; continue
            member = tarfile.TarInfo(name); member.size = kept; member.mode = 0o755 if mode & 0o111 else 0o644
            with path.open('rb') as source: archive.addfile(member, source)
            record = {'path': name, 'bytes': kept, 'original_bytes': size, 'status': 'complete' if kept == size else 'truncated_byte_ceiling'}
            records.append(record); complete = complete and kept == size
        inventory = encode({'schema': 'ilxyr.zero4_result_archive.v1', 'complete': complete, 'stop_reason': stop_reason, 'files': records})
        if len(inventory) > 4 * 1024 * 1024: raise ValueError('archive inventory exceeds ceiling')
        member = tarfile.TarInfo('COLLECTION-INVENTORY.json'); member.size = len(inventory); member.mode = 0o644
        archive.addfile(member, io.BytesIO(inventory))
    if output.stat().st_size > max_bytes: raise ValueError('archive exceeds ceiling')
    return {'complete': complete, 'bytes': output.stat().st_size, 'sha256': digest(output), 'members': len(records)}


def aws(args, deadline, profile=None):
    remaining = deadline - time.time()
    if remaining <= 0: raise TimeoutError('collection deadline reached')
    command = ['aws', *args, '--region', 'us-east-1', '--cli-connect-timeout', '3', '--cli-read-timeout', '15', '--no-cli-pager']
    if profile: command += ['--profile', profile]
    result = subprocess.run(command, capture_output=True, text=True, timeout=remaining,
                            env={**os.environ, 'AWS_MAX_ATTEMPTS': '1'})
    if result.returncode: raise RuntimeError(result.stderr[:4000])
    return json.loads(result.stdout)


def put(path, bucket, key, deadline):
    sha = digest(path); checksum = base64.b64encode(bytes.fromhex(sha)).decode()
    result = aws(['s3api', 'put-object', '--bucket', bucket, '--key', key, '--body', str(path),
        '--server-side-encryption', 'AES256', '--if-none-match', '*', '--checksum-algorithm', 'SHA256', '--checksum-sha256', checksum], deadline)
    if not result.get('VersionId') or result.get('ChecksumSHA256') != checksum:
        raise ValueError('uploaded object receipt differs')
    return {'key': key, 'version_id': result['VersionId'], 'sha256': sha, 'bytes': path.stat().st_size}


def upload_parts(bundle, storage, prefix, deadline, receipt, progress):
    size = storage['archive_chunk_bytes']
    if not 0 < size <= 4 * 1024**3 or bundle.stat().st_size > storage['max_archive_bytes']:
        raise ValueError('archive chunk limits differ')
    receipt['parts'] = []
    temporary = bundle.with_suffix('.part')
    with bundle.open('rb') as source:
        index = 0
        while source.tell() < bundle.stat().st_size:
            if index >= storage['max_archive_chunks']: raise ValueError('archive part count differs')
            with temporary.open('xb') as target:
                remaining = size
                while remaining and (raw := source.read(min(1024 * 1024, remaining))):
                    if time.time() >= deadline: raise TimeoutError('archive chunk deadline reached')
                    target.write(raw); remaining -= len(raw)
            part = put(temporary, storage['bucket'], prefix + f'results-{index:02d}.part', deadline)
            receipt['parts'].append(part); save(progress, receipt)
            temporary.unlink(); index += 1
    if sum(p['bytes'] for p in receipt['parts']) != receipt['bytes']:
        raise ValueError('uploaded archive coverage differs')


def validate_parts(receipt, storage, prefix):
    if (type(receipt.get('bytes')) is not int or not 0 < receipt['bytes'] <= storage['max_archive_bytes']
        or not 1 <= len(receipt['parts']) <= storage['max_archive_chunks']):
        raise ValueError('archive coverage limits differ')
    for i, part in enumerate(receipt['parts']):
        if part['key'] != prefix + f'results-{i:02d}.part' or type(part['bytes']) is not int or not 0 < part['bytes'] <= storage['archive_chunk_bytes']:
            raise ValueError('archive part scope differs')
        if i < len(receipt['parts']) - 1 and part['bytes'] != storage['archive_chunk_bytes']:
            raise ValueError('archive part order or length differs')
    if sum(p['bytes'] for p in receipt['parts']) != receipt['bytes']:
        raise ValueError('archive part coverage differs')


def collect_host(root, plan, identity):
    storage = plan['storage']; prefix = 'runs/' + identity['run_id'] + '/'
    deadline = identity['launch_epoch_seconds'] + plan['limits']['collection_deadline_seconds']
    terminal = {**identity, 'schema': 'ilxyr.zero4_host_terminal.v1', 'status': 'failed',
        'collection_complete': False, 'instance_termination_verified': False, 'actual_billed_usd': None}
    receipt = {'complete': False, 'parts': [], 'transport_complete': False}
    try:
        terminal['bootstrap_receipt'] = put(root / 'output/bootstrap.log', storage['bucket'], prefix + 'bootstrap.log', deadline - 120)
        bundle = root / 'results.tar'
        receipt.update(archive_outputs(root / 'output', bundle, storage['max_archive_bytes'], storage['max_archive_members'], deadline - 120))
        upload_parts(bundle, storage, prefix, deadline - 90, receipt, root / 'collection.json')
        receipt['transport_complete'] = True
        terminal['collection_complete'] = receipt['complete']
        terminal['status'] = 'complete' if receipt['complete'] and identity['exit_code'] == 0 else 'failed'
    except Exception as error:
        terminal['collection_error'] = str(error); receipt['transport_error'] = str(error)
    save(root / 'collection.json', receipt)
    try:
        terminal['collection_receipt'] = put(root / 'collection.json', storage['bucket'], prefix + 'collection.json', deadline - 30)
    except Exception as error:
        terminal.update(status='failed', collection_complete=False, collection_receipt_error=str(error))
    terminal['elapsed_instance_seconds'] = time.time() - identity['launch_epoch_seconds']
    save(root / 'host-terminal.json', terminal)
    put(root / 'host-terminal.json', storage['bucket'], prefix + 'host-terminal.json', deadline)
    return terminal


def get_bound(binding, bucket, path, deadline, profile):
    if type(binding.get('bytes')) is not int or binding['bytes'] < 0:
        raise ValueError('object length differs')
    head = aws(['s3api', 'head-object', '--bucket', bucket, '--key', binding['key'], '--version-id', binding['version_id'], '--checksum-mode', 'ENABLED'], deadline, profile)
    expected = base64.b64encode(bytes.fromhex(binding['sha256'])).decode()
    if head['ContentLength'] != binding['bytes'] or head.get('ChecksumSHA256') != expected:
        raise ValueError('object metadata differs')
    result = aws(['s3api', 'get-object', '--bucket', bucket, '--key', binding['key'], '--version-id', binding['version_id'], '--checksum-mode', 'ENABLED', str(path)], deadline, profile)
    if result.get('VersionId') != binding['version_id'] or path.stat().st_size != binding['bytes'] or digest(path) != binding['sha256']:
        raise ValueError('downloaded object differs')


def receive(launch, plan, output, profile):
    if launch.get('plan_sha256') != hashlib.sha256(encode(plan)).hexdigest(): raise ValueError('collection plan binding differs')
    if launch['status'] != 'launched': raise ValueError('confirmed launch identity required')
    output.mkdir(parents=True, exist_ok=False)
    deadline = time.time() + 3600; instance = launch['instance_id']
    description = aws(['ec2', 'describe-instances', '--instance-ids', instance], deadline, profile)
    instances = [v for r in description['Reservations'] for v in r['Instances']]
    if len(instances) != 1 or instances[0]['InstanceId'] != instance or instances[0]['State']['Name'] != 'terminated':
        raise ValueError('instance termination required before collection')
    tags = {v['Key']: v['Value'] for v in instances[0].get('Tags', [])}
    if tags.get('RunId') != launch['run_id'] or tags.get('PackageSha256') != launch['package_sha256']:
        raise ValueError('terminated instance binding differs')
    provider = plan['provider']
    if any(instances[0].get(k) != provider[v] for k, v in [('ImageId', 'ami_id'), ('InstanceType', 'instance_type'), ('Architecture', 'architecture')]):
        raise ValueError('terminated machine identity differs')
    save(output / 'termination.json', description)
    volumes = aws(['ec2', 'describe-volumes', '--filters', 'Name=tag:RunId,Values=' + launch['run_id']], deadline, profile)
    addresses = aws(['ec2', 'describe-network-interfaces', '--filters', 'Name=attachment.instance-id,Values=' + instance], deadline, profile)
    save(output / 'volumes.json', volumes); save(output / 'interfaces.json', addresses)
    if volumes['Volumes'] or addresses['NetworkInterfaces']:
        raise ValueError('resource cleanup still pending')
    bucket = plan['storage']['bucket']; prefix = 'runs/' + launch['run_id'] + '/'
    head = aws(['s3api', 'head-object', '--bucket', bucket, '--key', prefix + 'host-terminal.json', '--checksum-mode', 'ENABLED'], deadline, profile)
    if head['ContentLength'] > 65536 or not head.get('VersionId') or not head.get('ChecksumSHA256'):
        raise ValueError('terminal object binding differs')
    binding = {'key': prefix + 'host-terminal.json', 'version_id': head['VersionId'], 'bytes': head['ContentLength'],
               'sha256': base64.b64decode(head['ChecksumSHA256']).hex()}
    get_bound(binding, bucket, output / 'host-terminal.json', deadline, profile)
    terminal = json.loads((output / 'host-terminal.json').read_bytes())
    for key in ['run_id', 'package_sha256', 'plan_sha256', 'instance_id', 'user_data_sha256']:
        if terminal[key] != launch[key]: raise ValueError('terminal identity differs: ' + key)
    bootstrap = terminal.get('bootstrap_receipt')
    if bootstrap:
        if bootstrap['key'] != prefix + 'bootstrap.log' or bootstrap['bytes'] > plan['storage']['max_host_log_bytes']:
            raise ValueError('bootstrap object scope differs')
        get_bound(bootstrap, bucket, output / 'bootstrap.log', deadline, profile)
    receipt = terminal.get('collection_receipt')
    if receipt:
        if receipt['key'] != prefix + 'collection.json' or receipt['bytes'] > 2 * 1024 * 1024:
            raise ValueError('collection receipt scope differs')
        get_bound(receipt, bucket, output / 'collection.json', deadline, profile)
        receipt = json.loads((output / 'collection.json').read_bytes())
        if receipt.get('transport_complete'):
            validate_parts(receipt, plan['storage'], prefix)
            bundle = output / 'results.tar'
            with bundle.open('xb') as target:
                for i, part in enumerate(receipt['parts']):
                    temporary = output / f'results-{i:02d}.part'
                    get_bound(part, bucket, temporary, deadline, profile)
                    with temporary.open('rb') as source:
                        while raw := source.read(1024 * 1024): target.write(raw)
                    temporary.unlink()
            if bundle.stat().st_size != receipt['bytes'] or digest(bundle) != receipt['sha256']:
                raise ValueError('joined archive digest differs')
            unpack_results(bundle, output / 'results', plan['storage']['max_archive_bytes'], plan['storage']['max_archive_members'] + 1)
        else:
            # Keep the successful part bindings for a later bounded failure investigation.
            save(output / 'PARTIAL-COLLECTION.json', receipt)
    result = {'status': 'collected', 'instance_termination_verified': True,
              'host_collection_complete': terminal['collection_complete'], 'terminal_object': binding,
              'scientific_acceptance': 'pending_offline_controller_check'}
    save(output / 'RECEIPT.json', result); return result


def unpack_results(archive, output, max_bytes, max_members):
    output.mkdir(exist_ok=False); total = 0; names = set()
    with tarfile.open(archive, 'r:') as source:
        for member in source:
            name = PurePosixPath(member.name); total += member.size
            if not member.isfile() or name.is_absolute() or '..' in name.parts or str(name) != member.name or member.name in names:
                raise ValueError('result archive path differs')
            names.add(member.name)
            if total > max_bytes or len(names) > max_members: raise ValueError('result archive ceiling reached')
            path = output / member.name; path.parent.mkdir(parents=True, exist_ok=True)
            with source.extractfile(member) as f, path.open('xb') as out:
                while raw := f.read(1024 * 1024): out.write(raw)
            path.chmod(0o755 if member.mode & 0o111 else 0o644)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['host', 'receive'])
    parser.add_argument('--root', type=Path); parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--identity', type=Path, required=True); parser.add_argument('--output', type=Path)
    parser.add_argument('--profile', default='default'); a = parser.parse_args()
    plan = json.loads(a.plan.read_bytes()); identity = json.loads(a.identity.read_bytes())
    result = collect_host(a.root, plan, identity) if a.mode == 'host' else receive(identity, plan, a.output, a.profile)
    print(json.dumps(result, sort_keys=True))
    if a.mode == 'host' and result['status'] != 'complete': raise SystemExit(1)
