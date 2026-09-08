"""Bind the Solomon source kit, offline Cargo sources and fixed host code."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile

PLAN = 'experiments/research-step-38/EXECUTION-PLAN.json'
BODY = 'scripts/aws/solomon38-user-data.sh'
SOURCES = [PLAN, BODY, 'scripts/solomon_cloud_collect.py', 'scripts/solomon_cloud_runtime.py',
           'scripts/package_solomon_cloud.py']
MAX_BYTES = 128 * 1024 * 1024
KIT_SHA = 'f16285c151f4cc72b76f7a1ad4070c4814c708b59aab56b535718d8389fda4e0'
KIT_MANIFEST = '133d09a9e415ca57bf23ec7227c601cb5b507503f9a0e2d0d67f8627df596ecd'

def encode(v): return (json.dumps(v, indent=2, sort_keys=True) + '\n').encode()
def sha(b): return hashlib.sha256(b).hexdigest()
def require(ok, message):
    if not ok: raise ValueError(message)

def read_archive(raw):
    require(len(raw) <= MAX_BYTES, 'archive byte ceiling')
    files = {}; total = 0
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:*') as archive:
        for m in archive:
            p = PurePosixPath(m.name); total += m.size
            require(m.isfile() and not p.is_absolute() and '..' not in p.parts and str(p) == m.name
                    and m.name not in files and len(m.name.encode()) <= 240, 'archive member differs')
            require(total <= MAX_BYTES and len(files) < 10000, 'archive expansion ceiling')
            files[m.name] = archive.extractfile(m).read()
    return files

def manifest_check(files, name):
    m = json.loads(files[name]); require(set(m) == set(files) - {name}, 'manifest roster differs')
    for n, v in m.items(): require(v == {'bytes': len(files[n]), 'sha256': sha(files[n])}, 'member digest differs: ' + n)
    return m

def archive(files, output, compressed=False):
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode='w', format=tarfile.USTAR_FORMAT) as t:
        for n, b in sorted(files.items()):
            m = tarfile.TarInfo(n); m.size = len(b); m.mode = 0o644; t.addfile(m, io.BytesIO(b))
    b = raw.getvalue()
    if compressed:
        packed = io.BytesIO()
        with gzip.GzipFile(fileobj=packed, mode='wb', filename='', mtime=0) as stream: stream.write(b)
        b = packed.getvalue()
    require(len(b) <= MAX_BYTES, 'package byte ceiling')
    with output.open('xb') as f: f.write(b)
    return {'sha256': sha(b), 'bytes': len(b)}

def kit_files(raw):
    require(sha(raw) == KIT_SHA, 'frozen controller archive differs')
    files = read_archive(raw); require(sha(files['FILES.json']) == KIT_MANIFEST, 'controller manifest differs')
    manifest_check(files, 'FILES.json'); return files

def vendor_files(root, lock):
    files = {}
    for p in sorted(root.rglob('*')):
        require(not p.is_symlink(), 'vendor symlink differs')
        if p.is_file(): files[str(p.relative_to(root))] = p.read_bytes()
    # Cargo.lock registry checksum binds each package; Cargo's file inventory binds its sources.
    packages = {}
    for block in lock.decode().split('[[package]]')[1:]:
        fields = dict(re.findall(r'^(name|version|checksum) = "([^"]+)"$', block, re.M))
        if 'checksum' in fields: packages[(fields['name'], fields['version'])] = fields['checksum']
    seen = set()
    for directory in sorted({n.split('/')[0] for n in files}):
        cargo = files[directory + '/Cargo.toml'].decode()
        package_block = cargo.split('[package]', 1)[1].split('\n[', 1)[0]
        fields = dict(re.findall(r'^(name|version) = "([^"]+)"$', package_block, re.M)); key = (fields['name'], fields['version'])
        require(key in packages and key not in seen, 'vendor package roster differs'); seen.add(key)
        m = json.loads(files[directory + '/.cargo-checksum.json'])
        require(m['package'] == packages[key], 'vendor registry checksum differs')
        actual = {n[len(directory) + 1:]: sha(b) for n, b in files.items() if n.startswith(directory + '/') and n != directory + '/.cargo-checksum.json'}
        require(actual == m['files'], 'vendor source file checksum differs')
        files[directory + '/.cargo-checksum.json'] = encode({'package': m['package'], 'files': m['files']})
    require(seen == set(packages), 'vendor dependency coverage differs')
    return {'vendor/' + n: b for n, b in files.items()}

def dependencies(root, lock, output):
    files = vendor_files(root, lock.read_bytes()); files['Cargo.lock'] = lock.read_bytes()
    files['FILES.json'] = encode({n: {'bytes': len(b), 'sha256': sha(b)} for n, b in files.items()})
    return archive(files, output, True)

def inspect(package, expected):
    require(package.stat().st_size <= MAX_BYTES, 'host package byte ceiling')
    raw = package.read_bytes(); require(sha(raw) == expected, 'host package digest differs')
    f = read_archive(raw); m = json.loads(f['HOST.json'])
    require(set(f) == set(SOURCES) | {'controller.tar.gz', 'dependencies.tar.gz', 'HOST.json'}, 'host roster differs')
    manifest_check({**{n: b for n, b in f.items() if n != 'HOST.json'}, 'FILES.json': encode(m['files'])}, 'FILES.json')
    p = json.loads(f[PLAN]); require(m['plan_sha256'] == sha(f[PLAN]), 'plan digest differs')
    k = kit_files(f['controller.tar.gz']); require(p['controller_sha256'] == KIT_SHA and p['controller_bytes'] == len(f['controller.tar.gz']), 'plan controller differs')
    require(sha(f['dependencies.tar.gz']) == p['dependencies']['sha256'] and len(f['dependencies.tar.gz']) == p['dependencies']['bytes'], 'dependencies binding differs')
    d = read_archive(f['dependencies.tar.gz']); manifest_check(d, 'FILES.json')
    require(d['Cargo.lock'] == k['prepared/source/Cargo.lock'], 'dependency lock differs')
    return f, m, p

def build(repo, revision, controller, deps, output):
    commit = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', revision + '^{commit}'], text=True).strip()
    f = {n: subprocess.check_output(['git', '-C', str(repo), 'show', commit + ':' + n]) for n in SOURCES}
    f.update({'controller.tar.gz': controller.read_bytes(), 'dependencies.tar.gz': deps.read_bytes()})
    f['HOST.json'] = encode({'schema': 'ilxyr.solomon_host_package.v1', 'source_commit': commit,
        'plan_sha256': sha(f[PLAN]), 'files': {n: {'bytes': len(b), 'sha256': sha(b)} for n, b in f.items()}})
    result = archive(f, output); inspect(output, result['sha256'])
    return {**result, 'source_commit': commit, 'plan_sha256': sha(f[PLAN])}

def write_files(files, root):
    root.mkdir(parents=True, exist_ok=False)
    for n, b in files.items():
        p = root / n; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(b)

def unpack(package, expected, output):
    f, m, _ = inspect(package, expected); write_files(f, output)
    write_files(kit_files(f['controller.tar.gz']), output / 'controller')
    write_files(read_archive(f['dependencies.tar.gz']), output / 'deps'); return m

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('mode', choices=['dependencies', 'build', 'verify', 'unpack'])
    for n in ['repo', 'controller', 'deps', 'vendor', 'lock', 'package', 'output']: p.add_argument('--' + n, type=Path)
    p.add_argument('--revision'); p.add_argument('--expected-sha256'); a = p.parse_args()
    if a.mode == 'dependencies': result = dependencies(a.vendor, a.lock, a.output)
    elif a.mode == 'build': result = build(a.repo, a.revision, a.controller, a.deps, a.output)
    elif a.mode == 'unpack': result = unpack(a.package, a.expected_sha256, a.output)
    else: result = inspect(a.package, a.expected_sha256)[1]
    print(json.dumps(result, sort_keys=True))
