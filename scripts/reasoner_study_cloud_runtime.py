"""Run the fixed Reasoner study and its independent checker in the offline image."""
import argparse
import json
import os
from pathlib import Path
import platform
import re
import signal
import subprocess
import sys
import time
from package_reasoner_study_cloud import PLAN, encode, require, sha
from feral_process import run_process


def memory():
    root = Path('/sys/fs/cgroup')
    result = {'scope': 'whole_container_cgroup_v2', 'peak_bytes': None}
    for name, key in [('memory.peak', 'peak_bytes'), ('memory.max', 'limit_bytes'), ('memory.events', 'events'), ('cpu.stat', 'cpu')]:
        try:
            raw = (root / name).read_text().strip()
            result[key] = dict((k, int(v)) for k, v in (line.split() for line in raw.splitlines())) if key in ['events', 'cpu'] else int(raw)
        except (OSError, ValueError) as error: result[key + '_error'] = str(error)
    return result


def run(package, output, mode, execution):
    package, output = package.resolve(), output.resolve()
    plan = json.loads((package / PLAN).read_bytes())
    output.mkdir(parents=True, exist_ok=False)
    record = {'schema': 'ilxyr.reasoner_runtime.v1', 'status': 'failed', 'mode': mode, 'phase': 'identity'}
    child, stopped = [None], [None]
    def forward(number, _frame):
        stopped[0] = number
        if child[0] is None: raise InterruptedError('runtime interrupted')
        child[0].send_signal(number)
    previous = {n: signal.signal(n, forward) for n in [signal.SIGTERM, signal.SIGINT]}
    try:
        require(platform.machine() == 'x86_64', 'runtime architecture differs')
        for name, value in plan['environment'].items(): require(os.environ.get(name) == value, 'runtime environment differs: ' + name)
        kit, prepared = package / 'controller', package / 'prepared'
        require(sha((prepared / 'BINDINGS.json').read_bytes()) == plan['prepared']['bindings_sha256'], 'runtime input bindings differ')
        for name, expected in plan['implementation'].items(): require(sha((kit / 'scripts' / name).read_bytes()) == expected, 'runtime source differs: ' + name)
        for key, command in [('compiler_identity', [plan['environment']['CC'], '--version']), ('python_identity', [sys.executable, '--version']), ('node_identity', ['node', '--version'])]:
            record[key] = subprocess.check_output(command, text=True, timeout=10).strip()
        for key in ['compiler_identity', 'python_identity', 'node_identity']:
            require(record[key] == plan[key], 'runtime toolchain differs: ' + key)
        require(sha((package / 'runtime/bin/node').read_bytes()) == plan['node_binary']['binary_sha256'], 'runtime Node bytes differ')
        record['environment'] = {k: os.environ.get(k) for k in plan['environment']}
        record['memory_before'] = memory()
        require(mode in ['cloud', 'opened'], 'runtime mode differs')
        if mode == 'cloud':
            require(execution is not None, 'runtime execution binding required')
            e = json.loads(execution.read_bytes()); p = plan['provider']
            require(e['schema'] == 'ilxyr.reasoner_study_execution.v1' and e['venue'] == 'cloud' and
                    e['plan_sha256'] == sha((package / PLAN).read_bytes()) and
                    e['prepared_bindings_sha256'] == plan['prepared']['bindings_sha256'], 'runtime execution identity differs')
            require(e['machine'] == {'provider': 'AWS', **{k: p[k] for k in ['region', 'instance_type', 'architecture']},
                    'image_id': p['ami_id'], 'runtime_image': plan['runtime_image']}, 'runtime machine differs')
            require(e['host_limits'] == plan['limits'] and record['memory_before'].get('limit_bytes') == plan['limits']['container_memory_gib'] * 1024**3, 'runtime memory limit differs')
            require(e['limits'] == plan['study_limits'] and e['implementation'] == plan['implementation'] and
                    e['compiler_flags'] == plan['compiler_flags'] and e['worker_count'] == 1 and
                    all(e[k] == plan[k] for k in ['compiler_identity', 'node_identity']), 'runtime study settings differ')
            require(re.fullmatch(r'[a-f0-9]{64}', e['package_sha256']) and re.fullmatch(r'reasoner-46-[0-9]{8}T[0-9]{6}Z', e['run_id']), 'runtime package binding differs')
            record['execution_sha256'] = sha(execution.read_bytes())
        else:
            require(execution is None, 'opened check uses its fixed inputs')
        command = [sys.executable, str(kit / 'scripts/research_reasoner_study.py'), mode,
                   '--prepared', str(prepared), '--out', str(output / 'study'), '--work', str(output / 'build')]
        if execution: command += ['--execution', str(execution.resolve())]
        record.update(phase='controller', controller_command=command)
        child[0] = subprocess.Popen(command)
        try: record['controller_exit_code'] = child[0].wait()
        finally: child[0] = None
        require(record['controller_exit_code'] == 0, 'controller failed; partial output retained')
        supervisor = output / 'study/SUPERVISOR.json'
        record['supervisor_sha256'] = sha(supervisor.read_bytes())
        command = [sys.executable, str(kit / 'scripts/check_reasoner_study.py'), '--prepared', str(prepared),
                   '--collected', str(output / 'study'), '--supervisor-sha256', record['supervisor_sha256'], '--out', str(output / 'verified')]
        record.update(phase='independent_checker', checker_command=command)
        # The checker includes its own replay. Keep this process cost separate from the supervised study.
        for number in previous: signal.signal(number, lambda n, _f: stopped.__setitem__(0, n))
        receipt = run_process(command, kit, output / 'checker-process', time.monotonic() + (plan['checker_seconds'] if mode == 'cloud' else 90),
                              2, cancelled=lambda: stopped[0], max_log_bytes=4194304)
        record['checker_receipt_sha256'] = sha((output / 'checker-process/process.json').read_bytes())
        require(receipt['status'] == 'complete', 'independent checker failed; partial output retained')
        check = json.loads((output / 'verified/CHECK.json').read_bytes())
        require(check['status'] == 'verified_complete' and check['mode'] == mode, 'study coverage differs')
        record.update(status='complete', phase='complete', check_sha256=sha((output / 'verified/CHECK.json').read_bytes()),
                      fresh_episode_visits=check['fresh_episode_visits'], independent_measured_replays=check['independent_measured_replays'],
                      stable_rows_sha256=check['stable_rows_sha256'], decision=check['summary']['primary_decision'])
    except BaseException as error:
        record['error'] = str(error); raise
    finally:
        record['memory_after'] = memory()
        record['stop_signal'] = stopped[0]
        for number, handler in previous.items(): signal.signal(number, handler)
        (output / 'RUNTIME.json').write_bytes(encode(record))
    return record


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('mode', choices=['opened', 'cloud'])
    for n in ['package', 'output']: p.add_argument('--' + n, type=Path, required=True)
    p.add_argument('--execution', type=Path); a = p.parse_args()
    result = run(a.package, a.output, a.mode, a.execution)
    print(json.dumps(result, sort_keys=True))
