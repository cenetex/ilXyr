"""Run the frozen controller inside the fixed, offline Linux image."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import signal
import subprocess
import sys
from package_solomon_cloud import encode, require, sha


def run(package, output, work, mode, execution):
    plan = json.loads((package / 'experiments/research-step-38/EXECUTION-PLAN.json').read_bytes())
    output.mkdir(parents=True, exist_ok=False)
    record = {'schema': 'ilxyr.solomon_runtime.v1', 'status': 'failed', 'mode': mode, 'phase': 'identity'}
    child = [None]
    def forward(number, _frame):
        if child[0] is None: raise InterruptedError('runtime interrupted before worker')
        child[0].send_signal(number)
    previous = {n: signal.signal(n, forward) for n in (signal.SIGTERM, signal.SIGINT)}
    def call(command):
        child[0] = subprocess.Popen(command)
        try: return child[0].wait()
        finally: child[0] = None
    try:
        require(platform.machine() == 'x86_64', 'runtime architecture differs')
        for name, value in plan['environment'].items(): require(os.environ.get(name) == value, 'runtime environment differs: ' + name)
        kit = package / 'controller'; prepared = kit / 'prepared'
        require(sha((prepared / 'BINDINGS.json').read_bytes()) == plan['prepared_bindings_sha256'], 'runtime prepared binding differs')
        for name, expected in plan['implementation'].items(): require(sha((kit / 'controller' / name).read_bytes()) == expected, 'runtime controller differs')
        record['rustc_identity'] = subprocess.check_output(['rustc', '-Vv'], text=True, timeout=10).strip()
        record['python'] = platform.python_version(); record['platform'] = platform.platform()
        record['environment'] = {k: os.environ.get(k) for k in plan['environment']}
        if mode == 'cloud':
            require(record['rustc_identity'] == plan['rustc_identity'], 'runtime compiler differs')
            require(execution is not None, 'runtime execution record required')
            e = json.loads(execution.read_bytes())
            require(e['rustc_identity'] == plan['rustc_identity'] and e['limits'] == plan['study_limits'], 'runtime limits differ')
            require(e['machine'] == {'provider':'AWS', 'region':plan['provider']['region'], 'instance_type':plan['provider']['instance_type'],
                'image_id':plan['provider']['ami_id'], 'architecture':'x86_64', 'runtime_image':plan['runtime_image']}, 'runtime machine binding differs')
        cargo = Path(os.environ['CARGO_HOME']); cargo.mkdir(parents=True, exist_ok=False)
        (cargo / 'config.toml').write_text('[source.crates-io]\nreplace-with = "vendored-sources"\n[source.vendored-sources]\ndirectory = "' + str(package / 'deps/vendor') + '"\n[net]\noffline = true\n')
        record['phase'] = 'controller'
        command = [sys.executable, str(kit / 'controller/research_solomon_study.py'), mode,
            '--prepared', str(prepared), '--out', str(output / 'controller'), '--work', str(work)]
        if execution: command += ['--execution', str(execution)]
        record['controller_command'] = command
        # The controller owns child cancellation and complete process receipts. The host owns the outer deadline.
        record['controller_exit_code'] = call(command)
        supervisor = output / 'controller/SUPERVISOR.json'
        if supervisor.is_file(): record['supervisor_sha256'] = sha(supervisor.read_bytes())
        require(record['controller_exit_code'] == 0, 'controller failed; partial output retained')
        record['phase'] = 'check'
        command = [sys.executable, str(kit / 'controller/check_solomon_study.py'), '--prepared', str(prepared),
            '--collected', str(output / 'controller'), '--supervisor-sha256', record['supervisor_sha256'], '--out', str(output / 'CHECK.json')]
        if mode == 'opened': command += ['--opened-reference', str(package / 'experiments/research-step-32/SMOKE.json')]
        record['check_exit_code'] = call(command)
        require(record['check_exit_code'] == 0, 'independent check failed')
        record.update(status='complete', phase='complete')
    except BaseException as error:
        record['error'] = str(error); raise
    finally:
        for number, handler in previous.items(): signal.signal(number, handler)
        (output / 'RUNTIME.json').write_bytes(encode(record))
    return record

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('mode', choices=['opened', 'cloud'])
    for n in ['package', 'output', 'work']: p.add_argument('--' + n, type=Path, required=True)
    p.add_argument('--execution', type=Path); a = p.parse_args()
    print(json.dumps(run(a.package.resolve(), a.output.resolve(), a.work.resolve(), a.mode, a.execution)))
