"""Freeze the weight corpus sources, resource policy, and saved calibration trace."""

import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import subprocess
import tarfile

PLAN = 'experiments/research-step-33/SOURCE-PLAN.json'
EXTRA = [PLAN, 'scripts/weight_source_kit.py', 'scripts/weight_oracle_smoke.py',
         'scripts/weight_oracle_smoke.mjs', 'scripts/feral_process.py',
         'scripts/verify-weight-multiplicity-calibration-trace.mjs']
INPUT_NAMES = {'lie': 'inputs/lie-2.2.2.tar.gz', 'bison': 'inputs/bison.deb',
               'trace': 'inputs/calibration-trace.jsonl', 'tail': 'inputs/calibration-tail.json'}
MAX_PACKAGE = 32 * 1024 * 1024


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encode(value):
    return (json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + '\n').encode()


def check_binding(raw, binding, label):
    if len(raw) != binding['bytes'] or sha(raw) != binding['sha256']:
        raise ValueError('input binding differs: ' + label)


def check_path(name):
    path = PurePosixPath(name)
    if not name or path.is_absolute() or '..' in path.parts or '\\' in name or str(path) != name:
        raise ValueError('archive path differs: ' + name)
    return path


def read_archive(raw, *, selected=None, expanded_limit=64 * 1024 * 1024):
    files, seen, expanded = {}, set(), 0
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:*') as archive:
        for item in archive:
            name = item.name.rstrip('/') if item.isdir() else item.name
            check_path(name)
            if name in seen or len(seen) >= 4096:
                raise ValueError('archive roster differs')
            seen.add(name)
            if item.isdir():
                continue
            if not item.isfile() or item.size < 0 or item.size > MAX_PACKAGE:
                raise ValueError('archive member type or size differs')
            expanded += item.size
            if expanded > expanded_limit:
                raise ValueError('expanded archive exceeds bound')
            if selected is None or name in selected:
                files[name] = archive.extractfile(item).read()
    if selected is not None and set(files) != set(selected):
        raise ValueError('selected source roster differs')
    return files


def verify_payload(files):
    manifest = json.loads(files['KIT.json'])
    if manifest['schema'] != 'ilxyr.weight_source_kit.v1':
        raise ValueError('kit schema differs')
    if set(files) != set(manifest['files']) | {'KIT.json'}:
        raise ValueError('kit roster differs')
    for name, binding in manifest['files'].items():
        check_binding(files[name], binding, name)
    plan = json.loads(files[PLAN])
    policy_raw = files[plan['resource_policy_path']]
    if sha(policy_raw) != plan['resource_policy_sha256']:
        raise ValueError('resource policy differs')
    policy = json.loads(policy_raw)
    for name, expected in policy['source_bindings'].items():
        if sha(files[name]) != expected:
            raise ValueError('policy source differs: ' + name)
    expected_roster = set(EXTRA) | {plan['resource_policy_path']} | set(policy['source_bindings'])
    expected_roster |= set(INPUT_NAMES.values()) | {'zero/' + n for n in plan['zero_files']}
    if set(manifest['files']) != expected_roster:
        raise ValueError('scientific input roster differs')
    for key, name in INPUT_NAMES.items():
        check_binding(files[name], plan['inputs'][key], key)
    for name, expected in plan['zero_files'].items():
        if sha(files['zero/' + name]) != expected:
            raise ValueError('Zero source differs: ' + name)
    read_archive(files[INPUT_NAMES['lie']], expanded_limit=2 * 1024 * 1024)
    return manifest


def build(repo, revision, inputs, output):
    commit = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', revision + '^{commit}'], text=True).strip()
    def committed(name):
        check_path(name)
        return subprocess.check_output(['git', '-C', str(repo), 'show', commit + ':' + name])
    plan_raw = committed(PLAN)
    plan = json.loads(plan_raw)
    policy_raw = committed(plan['resource_policy_path'])
    if sha(policy_raw) != plan['resource_policy_sha256']:
        raise ValueError('frozen resource policy differs')
    policy = json.loads(policy_raw)
    payload = {name: committed(name) for name in set(EXTRA) | set(policy['source_bindings']) | {plan['resource_policy_path']}}
    for key, path in inputs.items():
        if path.stat().st_size != plan['inputs'][key]['bytes']:
            raise ValueError('input size differs: ' + key)
        raw = path.read_bytes()
        check_binding(raw, plan['inputs'][key], key)
        if key == 'zero':
            selected = read_archive(raw, selected=plan['zero_files'], expanded_limit=256 * 1024 * 1024)
            payload.update({'zero/' + name: data for name, data in selected.items()})
        else:
            payload[INPUT_NAMES[key]] = raw
    manifest = {'schema': 'ilxyr.weight_source_kit.v1', 'source_commit': commit,
                'scope': 'prepared_scientific_sources_and_saved_calibration',
                'original_zero_archive': plan['inputs']['zero'],
                'pending': plan['pending'],
                'files': {n: {'sha256': sha(b), 'bytes': len(b)} for n, b in sorted(payload.items())}}
    payload['KIT.json'] = encode(manifest)
    verify_payload(payload)
    with tarfile.open(output, mode='x', format=tarfile.USTAR_FORMAT) as archive:
        for name, raw in sorted(payload.items()):
            entry = tarfile.TarInfo(name)
            entry.size, entry.mode, entry.mtime = len(raw), 0o644, 0
            archive.addfile(entry, io.BytesIO(raw))
    digest = sha(output.read_bytes())
    verify(output, digest)
    return {'sha256': digest, 'bytes': output.stat().st_size, 'source_commit': commit,
            'resource_policy_sha256': plan['resource_policy_sha256'], 'files': len(payload)}


def verify(package, expected_sha256):
    if package.stat().st_size > MAX_PACKAGE:
        raise ValueError('package exceeds bound')
    raw = package.read_bytes()
    if sha(raw) != expected_sha256:
        raise ValueError('package digest differs')
    files = read_archive(raw)
    return files, verify_payload(files)


def unpack(package, expected_sha256, output):
    files, manifest = verify(package, expected_sha256)
    output.mkdir(parents=True, exist_ok=False)
    for name, raw in files.items():
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='mode', required=True)
    builder = sub.add_parser('build')
    for name in ['repo', 'lie', 'zero', 'bison', 'trace', 'tail', 'output']:
        builder.add_argument('--' + name, type=Path, required=True)
    builder.add_argument('--revision', required=True)
    for name in ['verify', 'unpack']:
        child = sub.add_parser(name)
        child.add_argument('--package', type=Path, required=True)
        child.add_argument('--expected-sha256', required=True)
        if name == 'unpack':
            child.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.mode == 'build':
        result = build(args.repo, args.revision, {key: getattr(args, key) for key in ['lie', 'zero', 'bison', 'trace', 'tail']}, args.output)
    elif args.mode == 'unpack':
        result = unpack(args.package, args.expected_sha256, args.output)
    else:
        result = verify(args.package, args.expected_sha256)[1]
    print(json.dumps(result, sort_keys=True))
