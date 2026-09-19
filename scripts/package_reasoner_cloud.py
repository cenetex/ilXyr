"""Build and check the frozen Reasoner cloud bundle."""

import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import subprocess
import tarfile

PLAN = 'experiments/research-step-23/EXECUTION-PLAN.json'
SOURCES = ['scripts/run_reasoner_cloud.mjs', 'scripts/aws/reasoner55-user-data.sh']


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encode(value):
    return (json.dumps(value, indent=2, sort_keys=True) + '\n').encode()


def members(raw):
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:') as archive:
        records = archive.getmembers()
        if len({r.name for r in records}) != len(records):
            raise ValueError('duplicate archive member')
        result = {}
        for item in records:
            name = PurePosixPath(item.name)
            if not item.isfile() or name.is_absolute() or '..' in name.parts or str(name) != item.name:
                raise ValueError('archive member path or type differs')
            if item.size > 8 * 1024 * 1024:
                raise ValueError('archive member exceeds bound')
            result[item.name] = archive.extractfile(item).read()
        return result


def build(repo, revision, source, output):
    def committed(path):
        return subprocess.check_output(['git', '-C', str(repo), 'show', revision + ':' + path])
    plan_raw = committed(PLAN)
    plan = json.loads(plan_raw)
    raw = source.read_bytes()
    if len(raw) != plan['source_archive_bytes'] or sha(raw) != plan['source_archive_sha256']:
        raise ValueError('source archive differs')
    files = members(raw)
    identity = json.loads(files['SOURCE-IDENTITY.json'])
    if identity['source_commit'] != plan['source_commit']:
        raise ValueError('source commit differs')
    if set(files) != set(identity['files']) | {'SOURCE-IDENTITY.json'}:
        raise ValueError('source roster differs')
    for name, expected in identity['files'].items():
        if sha(files[name]) != expected:
            raise ValueError('source binding differs: ' + name)
    payload = {'EXECUTION-PLAN.json': plan_raw, 'source.tar': raw}
    payload.update({name: committed(name) for name in SOURCES})
    manifest = {'schema': 'ilxyr.reasoner55_cloud_package.v1', 'source_commit': revision,
        'plan_sha256': sha(plan_raw), 'files': {name: {'sha256': sha(data), 'bytes': len(data)}
                                            for name, data in payload.items()}}
    payload['PACKAGE.json'] = encode(manifest)
    with tarfile.open(output, 'x', format=tarfile.USTAR_FORMAT) as archive:
        for name, data in sorted(payload.items()):
            entry = tarfile.TarInfo(name); entry.size = len(data); entry.mode = 0o644; entry.mtime = 0
            archive.addfile(entry, io.BytesIO(data))
    return {'sha256': sha(output.read_bytes()), 'bytes': output.stat().st_size,
            'plan_sha256': sha(plan_raw), 'source_commit': revision}


def unpack(path, output):
    raw = path.read_bytes()
    if len(raw) > 8 * 1024 * 1024:
        raise ValueError('package exceeds bound')
    files = members(raw); manifest = json.loads(files['PACKAGE.json'])
    if set(files) != set(manifest['files']) | {'PACKAGE.json'}:
        raise ValueError('package roster differs')
    for name, binding in manifest['files'].items():
        if sha(files[name]) != binding['sha256'] or len(files[name]) != binding['bytes']:
            raise ValueError('package binding differs: ' + name)
    output.mkdir(exist_ok=False)
    expanded = {**files, **{'source/' + name: data for name, data in members(files['source.tar']).items()}}
    for name, data in expanded.items():
        target = output / name; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(data)
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='mode', required=True)
    build_parser = sub.add_parser('build')
    for name in ['repo', 'source', 'output']:
        build_parser.add_argument('--' + name, type=Path, required=True)
    build_parser.add_argument('--revision', required=True)
    unpack_parser = sub.add_parser('unpack')
    unpack_parser.add_argument('--package', type=Path, required=True)
    unpack_parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = build(args.repo, args.revision, args.source, args.output) if args.mode == 'build' else unpack(args.package, args.output)
    print(json.dumps(result))
