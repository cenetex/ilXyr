"""Build and verify the fixed weight cloud host package."""
import argparse
import io
import json
from pathlib import Path
import subprocess
import tarfile
from weight_source_kit import encode, sha, read_archive
from package_weight_corpus import verify as verify_controller, unpack as unpack_controller

PLAN = 'experiments/research-step-35/EXECUTION-PLAN.json'
BODY = 'scripts/aws/weight35-user-data.sh'
SOURCES = [PLAN, BODY, 'scripts/weight_cloud_collect.py']
MAX_BYTES = 32 * 1024 * 1024


def inspect(package, expected):
    if package.stat().st_size > MAX_BYTES:
        raise ValueError('host package size differs')
    raw = package.read_bytes()
    if sha(raw) != expected:
        raise ValueError('host package digest differs')
    files = read_archive(raw)
    manifest = json.loads(files['HOST.json'])
    if set(files) != set(SOURCES) | {'controller.tar', 'HOST.json'} or set(manifest['files']) != set(files) - {'HOST.json'}:
        raise ValueError('host package roster differs')
    for name, value in manifest['files'].items():
        if value != {'bytes': len(files[name]), 'sha256': sha(files[name])}:
            raise ValueError('host member differs: ' + name)
    plan = json.loads(files[PLAN])
    if manifest['plan_sha256'] != sha(files[PLAN]):
        raise ValueError('host plan differs')
    if sha(files['controller.tar']) != plan['controller_sha256'] or len(files['controller.tar']) != plan['controller_bytes']:
        raise ValueError('controller binding differs')
    return files, manifest, plan


def build(repo, revision, controller, output):
    commit = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', revision + '^{commit}'], text=True).strip()
    files = {name: subprocess.check_output(['git', '-C', str(repo), 'show', commit + ':' + name]) for name in SOURCES}
    plan = json.loads(files[PLAN]); verify_controller(controller, plan['controller_sha256'])
    files['controller.tar'] = controller.read_bytes()
    files['HOST.json'] = encode({'schema': 'ilxyr.weight_host_package.v1', 'source_commit': commit,
        'plan_sha256': sha(files[PLAN]), 'files': {n: {'bytes': len(b), 'sha256': sha(b)} for n, b in files.items()}})
    with tarfile.open(output, 'x', format=tarfile.USTAR_FORMAT) as archive:
        for name, raw in sorted(files.items()):
            member = tarfile.TarInfo(name); member.size = len(raw); member.mode = 0o644; member.mtime = 0
            archive.addfile(member, io.BytesIO(raw))
    digest = sha(output.read_bytes()); inspect(output, digest)
    return {'sha256': digest, 'bytes': output.stat().st_size, 'source_commit': commit,
            'plan_sha256': sha(files[PLAN]), 'controller_sha256': plan['controller_sha256']}


def unpack(package, expected, output):
    files, manifest, _ = inspect(package, expected)
    output.mkdir(parents=True, exist_ok=False)
    for name, raw in files.items():
        path = output / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(raw)
    unpack_controller(output / 'controller.tar', sha(files['controller.tar']), output / 'controller')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['build', 'verify', 'unpack'])
    parser.add_argument('--repo', type=Path); parser.add_argument('--revision')
    parser.add_argument('--controller', type=Path); parser.add_argument('--output', type=Path)
    parser.add_argument('--package', type=Path); parser.add_argument('--expected-sha256')
    a = parser.parse_args()
    if a.mode == 'build': result = build(a.repo, a.revision, a.controller, a.output)
    elif a.mode == 'unpack': result = unpack(a.package, a.expected_sha256, a.output)
    else: result = inspect(a.package, a.expected_sha256)[1]
    print(json.dumps(result, sort_keys=True))
