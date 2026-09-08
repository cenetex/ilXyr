"""Package the weight controller together with its immutable scientific source kit."""
import argparse
import io
import json
from pathlib import Path
import subprocess
import tarfile

from weight_source_kit import encode, read_archive, sha, verify as verify_source

PLAN = 'experiments/research-step-34/CONTROLLER-PLAN.json'
SOURCES = [PLAN, 'scripts/weight_corpus_controller.py', 'scripts/weight_corpus_result.py',
           'scripts/weight_source_kit.py', 'scripts/feral_process.py', 'scripts/weight_process_tree.py']
MAX_BYTES = 32 * 1024 * 1024


def validate(files):
    manifest = json.loads(files['PACKAGE.json'])
    if manifest['schema'] != 'ilxyr.weight_corpus_controller_package.v1':
        raise ValueError('controller package schema differs')
    if set(files) != set(SOURCES) | {'source-kit.tar', 'PACKAGE.json'}:
        raise ValueError('controller package roster differs')
    if set(manifest['files']) != set(files) - {'PACKAGE.json'}:
        raise ValueError('controller manifest roster differs')
    for name, value in manifest['files'].items():
        if len(files[name]) != value['bytes'] or sha(files[name]) != value['sha256']:
            raise ValueError('controller member binding differs: ' + name)
    plan = json.loads(files[PLAN])
    if len(files['source-kit.tar']) != plan['source_kit_bytes'] or sha(files['source-kit.tar']) != plan['source_kit_sha256']:
        raise ValueError('scientific source kit differs')
    return manifest


def build(repo, revision, source_kit, output):
    commit = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', revision + '^{commit}'], text=True).strip()
    files = {name: subprocess.check_output(['git', '-C', str(repo), 'show', commit + ':' + name]) for name in SOURCES}
    plan = json.loads(files[PLAN])
    verify_source(source_kit, plan['source_kit_sha256'])
    files['source-kit.tar'] = source_kit.read_bytes()
    files['PACKAGE.json'] = encode({'schema': 'ilxyr.weight_corpus_controller_package.v1', 'source_commit': commit,
        'scope': 'controller_and_scientific_source_kit', 'pending_launch_package': plan['pending_launch_package'],
        'files': {name: {'bytes': len(raw), 'sha256': sha(raw)} for name, raw in files.items()}})
    validate(files)
    with tarfile.open(output, 'x', format=tarfile.USTAR_FORMAT) as archive:
        for name, raw in sorted(files.items()):
            member = tarfile.TarInfo(name); member.size = len(raw); member.mode = 0o644; member.mtime = 0
            archive.addfile(member, io.BytesIO(raw))
    if output.stat().st_size > MAX_BYTES:
        raise ValueError('controller package exceeds bound')
    expected = sha(output.read_bytes()); verify(output, expected)
    return {'sha256': expected, 'bytes': output.stat().st_size, 'source_commit': commit,
            'source_kit_sha256': plan['source_kit_sha256'], 'files': len(files)}


def verify(package, expected_sha256):
    if package.stat().st_size > MAX_BYTES:
        raise ValueError('controller package exceeds bound')
    raw = package.read_bytes()
    if sha(raw) != expected_sha256:
        raise ValueError('controller package digest differs')
    files = read_archive(raw)
    return files, validate(files)


def unpack(package, expected_sha256, output):
    files, manifest = verify(package, expected_sha256)
    output.mkdir(parents=True, exist_ok=False)
    for name, raw in files.items():
        path = output / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(raw)
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='mode', required=True)
    child = sub.add_parser('build')
    for name in ['repo', 'source-kit', 'output']: child.add_argument('--' + name, type=Path, required=True)
    child.add_argument('--revision', required=True)
    for name in ['verify', 'unpack']:
        child = sub.add_parser(name)
        child.add_argument('--package', type=Path, required=True); child.add_argument('--expected-sha256', required=True)
        if name == 'unpack': child.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.mode == 'build': result = build(args.repo, args.revision, args.source_kit, args.output)
    elif args.mode == 'unpack': result = unpack(args.package, args.expected_sha256, args.output)
    else: result = verify(args.package, args.expected_sha256)[1]
    print(json.dumps(result, sort_keys=True))
