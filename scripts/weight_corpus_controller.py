"""Run the fixed weight corpus command under one original cloud deadline."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import sys
import time

from feral_process import run_process, save
from weight_source_kit import unpack, verify, sha
from weight_corpus_result import check_result, digest, read_json, require
from weight_process_tree import run_tree

CONTROLLER_PLAN = 'experiments/research-step-34/CONTROLLER-PLAN.json'
REPO = Path(__file__).resolve().parent.parent


def plan_at(repo=REPO):
    return read_json(repo / CONTROLLER_PLAN)


def corpus_command(kit, build, output, plan):
    return ['node', str(kit / 'scripts/run-weight-multiplicity-phase1-corpus.mjs'),
        '--resource-policy', str(kit / plan['resource_policy_path']),
        '--plan', str(kit / plan['corpus_plan_path']),
        '--manifest', str(kit / plan['reduced_manifest_path']),
        '--systems', str(kit / plan['root_systems_path']),
        '--lie', str(build / 'lie-2/LiE/Lie.exe'),
        '--lie-source', str(kit / 'inputs/lie-2.2.2.tar.gz'), '--stdbuf', '/usr/bin/stdbuf',
        '--zero', str(build / 'zero/weight_multiplicity'),
        '--zero-commit', '7be2367458acc8b004bfb3646322048a233d1b09', '--out', str(output)]


def verify_build(build, plan):
    smoke = read_json(build / 'RESULT.json')
    require(smoke['status'] == 'pass' and smoke['lie_executable_sha256'] == [plan['expected_lie_sha256']] * 2
            and smoke['zero_executable_sha256'] == plan['expected_zero_sha256'], 'native executable identity differs')
    for name, expected in [('lie-1/LiE/Lie.exe', plan['expected_lie_sha256']),
                           ('lie-2/LiE/Lie.exe', plan['expected_lie_sha256']),
                           ('zero/weight_multiplicity', plan['expected_zero_sha256'])]:
        require(digest(build / name) == expected, 'native executable bytes differ')


def verify_process_command(receipt, plan):
    command = receipt['command']
    require(isinstance(command, list) and command.count('--out') == 1, 'corpus process command differs')
    output = PurePosixPath(command[command.index('--out') + 1])
    require(output.is_absolute() and output.name == 'corpus-run' and '..' not in output.parts, 'corpus output path differs')
    base = Path(str(output.parent))
    require(command == corpus_command(base / 'source-kit', base / 'native-build', base / 'corpus-run', plan), 'executed corpus arguments differ')


def execution_deadline(execution, plan, now=None):
    now = time.time() if now is None else now
    for key in ['launch_epoch', 'deadline_epoch']:
        require(type(execution.get(key)) in [int, float] and math.isfinite(execution[key]), 'launch clock differs')
    require(execution['source_kit_sha256'] == plan['source_kit_sha256'], 'launch source kit differs')
    require(execution['controller_plan_sha256'] == sha((REPO / CONTROLLER_PLAN).read_bytes()), 'launch controller plan differs')
    duration = execution['deadline_epoch'] - execution['launch_epoch']
    require(0 < duration <= plan['maximum_launch_seconds'], 'launch window exceeds bound')
    require(execution['launch_epoch'] <= now < execution['deadline_epoch'], 'launch window is stale or in the future')
    require(execution['deadline_epoch'] - now > plan['build_seconds'] + plan['verification_reserve_seconds'] + plan['collection_reserve_seconds'], 'launch deadline leaves insufficient preparation time')
    return time.monotonic() + execution['deadline_epoch'] - now


def inventory(root, deadline):
    result = {}
    for path in sorted(root.rglob('*')):
        require(not path.is_symlink(), 'output inventory contains a link')
        if path.is_file() and path.name not in ['FILES.json', 'TERMINAL.json', 'STATUS.json']:
            value = hashlib.sha256()
            with path.open('rb') as source:
                for raw in iter(lambda: source.read(1024 * 1024), b''):
                    require(time.monotonic() < deadline, 'inventory deadline reached')
                    value.update(raw)
            result[str(path.relative_to(root))] = {'bytes': path.stat().st_size, 'sha256': value.hexdigest()}
    return result


def prepare(package, output, plan):
    require(package.stat().st_size == plan['source_kit_bytes'], 'source kit size differs')
    unpack(package, plan['source_kit_sha256'], output / 'source-kit')
    kit = output / 'source-kit'
    native_inputs = output / 'native-inputs'; native_inputs.mkdir()
    for source, name in [(kit / 'inputs/lie-2.2.2.tar.gz', 'lie-2.2.2.tar.gz'), (kit / 'inputs/bison.deb', 'bison.deb')]:
        shutil.copyfile(source, native_inputs / name)
    shutil.copytree(kit / 'zero', native_inputs / 'zero')
    return kit, native_inputs


def run(package, output, execution_path=None, mode='prepare'):
    plan = plan_at(); package = package.resolve(); output = output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    terminal = {'schema': 'ilxyr.weight_corpus_controller_terminal.v1', 'status': 'failed',
        'mode': mode, 'phase': 'prepare', 'source_kit_sha256': plan['source_kit_sha256'],
        'controller_plan_sha256': sha((REPO / CONTROLLER_PLAN).read_bytes()), 'corpus_accepted': False}
    deadline = time.monotonic() + 120
    try:
        if mode == 'run':
            require(execution_path is not None, 'cloud execution record is required')
            execution = read_json(execution_path)
            deadline = execution_deadline(execution, plan)
            require(platform.system() == 'Linux' and platform.machine() == 'x86_64', 'fixed Linux architecture is required')
            save(output / 'EXECUTION.json', execution)
            terminal['deadline_epoch'] = execution['deadline_epoch']
        elif mode != 'prepare':
            raise ValueError('controller mode differs')
        def phase(label):
            terminal['phase'] = label
            save(output / 'STATUS.json', {**terminal, 'status': 'running'})
        def execute(label, command, end, cwd=output):
            phase(label)
            runner = run_tree if mode == 'run' else run_process
            return runner(command, cwd, output / 'processes' / label, min(end, deadline), 2,
                               max_log_bytes=plan['maximum_log_bytes'])
        kit, native_inputs = prepare(package, output, plan)
        receipt = execute('policy-check', ['node', str(kit / 'scripts/run-weight-multiplicity-phase1-corpus.mjs'),
            '--check-resource-policy', str(kit / plan['resource_policy_path'])], time.monotonic() + 30)
        require(receipt['status'] == 'complete', 'unpacked policy check failed')
        receipt = execute('saved-trace-check', ['node', str(kit / 'scripts/verify-weight-multiplicity-calibration-trace.mjs'),
            str(kit / 'inputs/calibration-trace.jsonl'), str(kit / 'inputs/calibration-tail.json'), str(output / 'CALIBRATION-CHECK.json')], time.monotonic() + 30)
        require(receipt['status'] == 'complete', 'saved calibration trace check failed')
        build = output / 'native-build'; corpus = output / 'corpus-run'
        command = corpus_command(kit, build, corpus, plan)
        save(output / 'COMMAND.json', {'command': command, 'scope': 'full_frozen_workload', 'policy_sha256': plan['resource_policy_sha256']})
        if mode == 'prepare':
            terminal.update(status='prepared', phase='complete', oracle_processes_started=0)
            return terminal
        reserve = plan['verification_reserve_seconds'] + plan['collection_reserve_seconds']
        require(time.monotonic() + plan['build_seconds'] + reserve < deadline, 'deadline leaves insufficient build time')
        receipt = execute('native-build', ['python3', str(kit / 'scripts/weight_oracle_smoke.py'),
            '--repo', str(kit), '--inputs', str(native_inputs), '--output', str(build)], time.monotonic() + plan['build_seconds'])
        require(receipt['status'] == 'complete', 'native build or correctness check failed')
        verify_build(build, plan)
        workload_end = min(time.monotonic() + plan['maximum_workload_process_seconds'], deadline - reserve)
        require(workload_end > time.monotonic(), 'workload deadline expired')
        receipt = execute('corpus', command, workload_end)
        phase('result-check')
        # Read durable JSON records. The producer's stdout remains a log.
        check_command = ['python3', str(REPO / 'scripts/weight_corpus_controller.py'), 'check',
            '--source-kit', str(package), '--run-output', str(corpus),
            '--process-receipt', str(output / 'processes/corpus/process.json'), '--native-build', str(build),
            '--output', str(output / 'RESULT-CHECK.json')]
        checked = execute('result-check', check_command, deadline - plan['collection_reserve_seconds'])
        require(checked['status'] == 'complete', 'result checker was interrupted or failed')
        result = read_json(output / 'RESULT-CHECK.json')
        terminal.update(status=result['status'], corpus_accepted=result['corpus_accepted'], phase='complete')
        return terminal
    except Exception as error:
        terminal['error'] = str(error)
        return terminal
    finally:
        try:
            # Collection uses a closed file roster after every producer exits.
            save(output / 'FILES.json', inventory(output, deadline))
        except Exception as error:
            terminal['inventory_error'] = str(error)
            terminal['status'] = 'failed'; terminal['corpus_accepted'] = False
        save(output / 'TERMINAL.json', terminal)
        save(output / 'STATUS.json', terminal)


def check(package, run_output, receipt, build, output):
    plan = plan_at()
    files, _ = verify(package, plan['source_kit_sha256'])
    require(len(package.read_bytes()) == plan['source_kit_bytes'], 'source kit size differs')
    source = json.loads(files['experiments/research-step-33/SOURCE-PLAN.json'])
    policy_raw = files[source['resource_policy_path']]
    context = {'policy_raw': policy_raw, 'policy': json.loads(policy_raw),
        'plan': json.loads(files[plan['corpus_plan_path']]),
        'systems': json.loads(files[plan['root_systems_path']])['systems']}
    process = read_json(receipt)
    verify_build(build, plan)
    verify_process_command(process, plan)
    result = check_result(run_output, context, process)
    result['source_kit_sha256'] = plan['source_kit_sha256']
    require(not output.exists(), 'result-check output already exists')
    save(output, result)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='mode', required=True)
    for name in ['prepare', 'run']:
        child = sub.add_parser(name)
        child.add_argument('--source-kit', required=True, type=Path)
        child.add_argument('--output', required=True, type=Path)
        if name == 'run': child.add_argument('--execution', required=True, type=Path)
    child = sub.add_parser('check')
    for name in ['source-kit', 'run-output', 'process-receipt', 'native-build', 'output']:
        child.add_argument('--' + name, required=True, type=Path)
    args = parser.parse_args()
    result = check(args.source_kit, args.run_output, args.process_receipt, args.native_build, args.output) if args.mode == 'check' else run(args.source_kit, args.output, getattr(args, 'execution', None), args.mode)
    print(json.dumps(result, sort_keys=True))
    if args.mode != 'check' and result['status'] in ['failed', 'incomplete_or_invalid']:
        sys.exit(1)
