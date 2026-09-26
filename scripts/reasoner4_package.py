"""Create and verify a fixed Reasoner role-audit cloud input archive."""
import argparse
import hashlib
import io
import json
import os
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path, PurePosixPath

from reasoner4_representation_audit import (ROOT, ROLES, SOURCE_FILES, build_capture,
                                            capture, exact_source, digest, encoded,
                                            parse_demo, verify_firewall)

DATA = ROOT / 'experiments/reasoner4-representation-audit'
FILES = (
    'scripts/reasoner4_representation_audit.py',
    'scripts/reasoner4_role_probe.py',
    'scripts/reasoner4_role_capture.c',
    'scripts/test_reasoner4_representation_audit.py',
    'scripts/reasoner4_package.py',
    'examples/diagnostics/reasoner-4-representation-audit.json',
    'experiments/reasoner4-representation-audit/EXECUTION-PROFILE.json',
    'experiments/reasoner4-representation-audit/v1/fit.json',
    'experiments/reasoner4-representation-audit/v1/held.json',
    'experiments/reasoner4-representation-audit/v1/scrambled.json',
    'experiments/reasoner4-representation-audit/v1/states.json',
    'experiments/reasoner4-representation-audit/v1/bindings.json',
)


def members(wheel):
    entries = {name: (ROOT / name).read_bytes() for name in FILES}
    entries.update({'source/' + name: raw for name, raw in exact_source().items()})
    entries['wheels/' + wheel.name] = wheel.read_bytes()
    profile = json.loads(entries['experiments/reasoner4-representation-audit/EXECUTION-PROFILE.json'])
    if wheel.name != profile['numpy_wheel'] or digest(entries['wheels/' + wheel.name]) != profile['numpy_wheel_sha256']:
        raise ValueError('NumPy wheel differs from execution profile')
    bindings = json.loads(entries['experiments/reasoner4-representation-audit/v1/bindings.json'])
    if {name: digest(entries['source/' + name]) for name in SOURCE_FILES} != bindings['source_files']:
        raise ValueError('source file binding differs')
    return entries


def build(wheel, archive):
    if archive.exists():
        raise ValueError('archive already exists')
    entries = members(wheel)
    manifest = {'schema': 'ilxyr.reasoner4_role_audit_package.v1',
                'files': {name: {'bytes': len(raw), 'sha256': digest(raw)}
                          for name, raw in sorted(entries.items())}}
    entries['MANIFEST.json'] = encoded(manifest)
    with tarfile.open(archive, 'w') as tar:
        for name, raw in sorted(entries.items()):
            info = tarfile.TarInfo(name)
            info.size = len(raw)
            info.mtime = 0
            info.mode = 0o644
            tar.addfile(info, io.BytesIO(raw))
    print(json.dumps({'archive_sha256': digest(archive.read_bytes()),
                      'archive_bytes': archive.stat().st_size,
                      'manifest_sha256': digest(entries['MANIFEST.json'])}))


def verify(archive):
    data = archive.read_bytes()
    if len(data) > 32 * 1024 * 1024:
        raise ValueError('package too large')
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:') as tar:
        objects = {}
        for item in tar:
            path = PurePosixPath(item.name)
            if not item.isfile() or path.is_absolute() or '..' in path.parts or item.name in objects:
                raise ValueError('unsafe package member')
            objects[item.name] = tar.extractfile(item).read()
    manifest = json.loads(objects.pop('MANIFEST.json'))
    expected = {name: {'bytes': len(raw), 'sha256': digest(raw)}
                for name, raw in sorted(objects.items())}
    if manifest['files'] != expected:
        raise ValueError('package manifest differs')
    return objects


def verify_package_capture(root, output):
    data = root / 'experiments/reasoner4-representation-audit/v1'
    fit, held, scrambled = [json.loads((data / name).read_bytes())
                            for name in ('fit.json', 'held.json', 'scrambled.json')]
    verify_firewall(fit, held, scrambled)
    bindings = json.loads((data / 'bindings.json').read_bytes())
    source = {name: (root / 'source' / name).read_bytes() for name in SOURCE_FILES}
    if {name: digest(raw) for name, raw in source.items()} != bindings['source_files']:
        raise ValueError('pinned source binding differs')
    if digest((root / 'scripts/reasoner4_representation_audit.py').read_bytes()) != bindings['generator_sha256']:
        raise ValueError('capture generator binding differs')
    if digest((root / 'scripts/reasoner4_role_capture.c').read_bytes()) != bindings['capture_sha256']:
        raise ValueError('capture helper binding differs')
    all_rows = fit['rows'] + held['rows'] + scrambled['rows']
    queries, expected = [], []
    for row in all_rows:
        for line in row['demonstrations']:
            symbol, x, y, value = parse_demo(line)
            if symbol != row['symbol']:
                raise ValueError('demonstration symbol differs')
            queries.append(f"{ROLES.index(row['label']) + 1} {x} {y}")
            expected.append(value)
    binary, _ = build_capture(root / 'capture-build', source)
    observed = subprocess.run([str(binary)], input='\n'.join(queries) + '\n',
                              text=True, capture_output=True, check=True).stdout.splitlines()
    observed = [int(item) for item in observed]
    faithful = (len(fit['rows']) + len(held['rows'])) * 16
    if observed[:faithful] != expected[:faithful]:
        raise ValueError('fit or held demonstration differs from pinned evaluator')
    scrambled_differences = sum(a != b for a, b in zip(observed[faithful:], expected[faithful:]))
    if scrambled_differences < len(scrambled['rows']):
        raise ValueError('scrambled control has too few changed observations')
    states = json.loads((data / 'states.json').read_bytes())['splits']
    for name, rows in (('fit', fit['rows']), ('held', held['rows']), ('scrambled', scrambled['rows'])):
        if states[name] != [capture(row) for row in rows]:
            raise ValueError('captured state differs from demonstration')
    receipt = {'source_revision': bindings['source_revision'],
               'verifier_evaluations': len(queries), 'captured_rows': len(all_rows),
               'scrambled_differences': scrambled_differences,
               'states_sha256': digest((data / 'states.json').read_bytes())}
    (output / 'capture-verification.json').write_bytes(encoded(receipt))
    return receipt


def run(archive, output, expected_sha256):
    if digest(archive.read_bytes()) != expected_sha256:
        raise ValueError('archive digest differs')
    if output.exists():
        raise ValueError('output already exists')
    output.mkdir(parents=True)
    entries = verify(archive)
    profile = json.loads(entries['experiments/reasoner4-representation-audit/EXECUTION-PROFILE.json'])
    audit = json.loads(entries['examples/diagnostics/reasoner-4-representation-audit.json'])
    data_prefix = 'experiments/reasoner4-representation-audit/v1/'
    if audit['execution_profile_sha256'] != digest(entries['experiments/reasoner4-representation-audit/EXECUTION-PROFILE.json']):
        raise ValueError('execution profile binding differs')
    if audit['capture']['implementation_sha256'] != digest(entries[data_prefix + 'bindings.json']):
        raise ValueError('capture binding differs')
    if audit['probe']['implementation_sha256'] != digest(entries['scripts/reasoner4_role_probe.py']):
        raise ValueError('probe binding differs')
    for split, name in ((audit['inputs']['fit_split'], 'fit'),
                        (audit['inputs']['evaluation_splits'][0], 'held'),
                        (audit['inputs']['evaluation_splits'][1], 'scrambled')):
        if split['sha256'] != digest(entries[data_prefix + name + '.json']):
            raise ValueError('input binding differs: ' + name)
    if audit['representations'][0]['artifact_sha256'] != digest(entries[data_prefix + 'states.json']):
        raise ValueError('state binding differs')
    with tempfile.TemporaryDirectory(prefix='reasoner4-package-') as directory:
        root = Path(directory)
        for name, raw in entries.items():
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(raw)
        runtime = root / 'runtime'
        verification = verify_package_capture(root, output)
        wheel = root / 'wheels' / profile['numpy_wheel']
        subprocess.run([sys.executable, '-m', 'pip', 'install', '--no-index', '--no-deps',
                        '--target', str(runtime), str(wheel)], check=True)
        environment = dict(os.environ, PYTHONPATH=str(runtime), PYTHONDONTWRITEBYTECODE='1',
                           OPENBLAS_NUM_THREADS='1', OMP_NUM_THREADS='1', MKL_NUM_THREADS='1')
        command = [sys.executable, str(root / 'scripts/reasoner4_role_probe.py'),
                   str(root / 'experiments/reasoner4-representation-audit/v1'),
                   '--output', str(output / 'result.json')]
        subprocess.run(command, check=True, env=environment,
                       stdout=(output / 'stdout.log').open('wb'),
                       stderr=(output / 'stderr.log').open('wb'),
                       timeout=profile['max_instance_seconds'] - 180)
    receipt = {'schema': 'ilxyr.reasoner4_role_audit_execution_receipt.v1',
               'archive_sha256': digest(archive.read_bytes()),
               'result_sha256': digest((output / 'result.json').read_bytes()),
               'profile_sha256': digest(entries['experiments/reasoner4-representation-audit/EXECUTION-PROFILE.json']),
               'capture_verification_sha256': digest((output / 'capture-verification.json').read_bytes()),
               'verifier_evaluations': verification['verifier_evaluations']}
    (output / 'receipt.json').write_bytes(encoded(receipt))
    print(json.dumps(receipt))


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='command', required=True)
    package = sub.add_parser('build')
    package.add_argument('wheel', type=Path)
    package.add_argument('archive', type=Path)
    check = sub.add_parser('verify')
    check.add_argument('archive', type=Path)
    execute = sub.add_parser('run')
    execute.add_argument('archive', type=Path)
    execute.add_argument('output', type=Path)
    execute.add_argument('--expected-sha256', required=True)
    args = parser.parse_args()
    if args.command == 'build':
        build(args.wheel, args.archive)
    elif args.command == 'verify':
        print(json.dumps({'files': len(verify(args.archive)), 'archive_sha256': digest(args.archive.read_bytes())}))
    else:
        run(args.archive, args.output, args.expected_sha256)


if __name__ == '__main__':
    main()
