"""Run ZERO.4 in the fixed offline image and retain the container memory peak."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import signal
import subprocess
import sys
from package_zero4_cloud import PLAN, encode, require, sha


def memory():
    root = Path('/sys/fs/cgroup')
    result = {'scope': 'whole_container_cgroup_v2', 'peak_bytes': None}
    for name, key in [('memory.peak', 'peak_bytes'), ('memory.max', 'limit_bytes'), ('memory.events', 'events')]:
        try:
            raw = (root / name).read_text().strip()
            result[key] = dict((k, int(v)) for k, v in (line.split() for line in raw.splitlines())) if key == 'events' else int(raw)
        except (OSError, ValueError) as error: result[key + '_error'] = str(error)
    try:
        result['cpu'] = dict((k, int(v)) for k, v in (line.split() for line in (root / 'cpu.stat').read_text().splitlines()))
    except (OSError, ValueError) as error: result['cpu_error'] = str(error)
    return result


def run(package, output, mode, execution):
    package, output = package.resolve(), output.resolve()
    plan = json.loads((package / PLAN).read_bytes())
    output.mkdir(parents=True, exist_ok=False)
    record = {'schema': 'ilxyr.zero4_runtime.v1', 'status': 'failed', 'mode': mode, 'phase': 'identity'}
    child = [None]
    def forward(number, _frame):
        if child[0] is None: raise InterruptedError('runtime interrupted before controller')
        child[0].send_signal(number)
    previous = {n: signal.signal(n, forward) for n in [signal.SIGTERM, signal.SIGINT]}
    def call(command):
        child[0] = subprocess.Popen(command)
        try: return child[0].wait()
        finally: child[0] = None
    try:
        require(platform.machine() == 'x86_64', 'runtime architecture differs')
        for name, value in plan['environment'].items(): require(os.environ.get(name) == value, 'runtime environment differs: ' + name)
        kit, prepared = package / 'controller', package / 'prepared'
        require(sha((prepared / 'MANIFEST.json').read_bytes()) == plan['prepared']['manifest_sha256'], 'runtime input manifest differs')
        for name, expected in plan['implementation'].items(): require(sha((kit / 'scripts' / name).read_bytes()) == expected, 'runtime source differs: ' + name)
        record['compiler_identity'] = subprocess.check_output(['cc', '--version'], text=True, timeout=10)
        record['python_identity'] = subprocess.check_output([sys.executable, '--version'], text=True, timeout=10).strip()
        require(record['compiler_identity'] == plan['compiler_identity'] and record['python_identity'] == plan['python_identity'], 'runtime toolchain differs')
        record['environment'] = {k: os.environ.get(k) for k in plan['environment']}
        record['memory_before'] = memory()
        require(mode in ['cloud', 'opened'], 'runtime mode differs')
        if mode == 'cloud':
            require(execution is not None, 'runtime execution binding required')
            e = json.loads(execution.read_bytes()); p = plan['provider']
            require(e['schema'] == 'ilxyr.zero4_study_execution.v1' and e['plan_sha256'] == sha((package / PLAN).read_bytes()) and
                    e['prepared_manifest_sha256'] == plan['prepared']['manifest_sha256'], 'runtime execution identity differs')
            require(e['machine'] == {'provider': 'AWS', **{k: p[k] for k in ['region', 'instance_type', 'ami_id', 'architecture']},
                    'runtime_image': plan['runtime_image']}, 'runtime machine differs')
            require(e['limits'] == plan['limits'] and record['memory_before'].get('limit_bytes') == plan['limits']['container_memory_gib'] * 1024**3, 'runtime memory limit differs')
            require(len(e['package_sha256']) == 64 and e['run_id'].startswith('zero4-45-'), 'runtime package binding differs')
            record['execution_sha256'] = sha(execution.read_bytes())
            command = [sys.executable, str(Path(__file__)), 'controller', '--package', str(package), '--output', str(output / 'study')]
        else:
            command = [sys.executable, str(kit / 'scripts/check_zero4_study.py'), '--source', str(kit / 'source'), '--out', str(output / 'opened')]
        record['phase'] = 'controller'; record['controller_command'] = command
        record['controller_exit_code'] = call(command)
        require(record['controller_exit_code'] == 0, 'controller failed; partial output retained')
        if mode == 'cloud':
            check = json.loads((output / 'study/CHECK.json').read_bytes())
            require(check['status'] == 'complete', 'study coverage is incomplete')
            record['check_sha256'] = sha((output / 'study/CHECK.json').read_bytes())
        record.update(status='complete', phase='complete')
    except BaseException as error:
        record['error'] = str(error); raise
    finally:
        record['memory_after'] = memory()
        for number, handler in previous.items(): signal.signal(number, handler)
        (output / 'RUNTIME.json').write_bytes(encode(record))
    return record


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('mode', choices=['opened', 'cloud', 'controller'])
    for n in ['package', 'output']: p.add_argument('--' + n, type=Path, required=True)
    p.add_argument('--execution', type=Path); a = p.parse_args()
    if a.mode == 'controller':
        sys.path.insert(0, str(a.package.resolve() / 'controller/scripts'))
        from zero4_study import run_study
        result = run_study(a.package.resolve() / 'prepared', a.output.resolve())
    else: result = run(a.package, a.output, a.mode, a.execution)
    print(json.dumps({'status': result['status']}))
