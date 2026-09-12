"""Prepare and supervise the fixed three-control FERAL coverage comparison."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import signal
import sys
import time

from feral_process import digest, run_process, save
from feral_fresh_sources import encode, require
from prepare_feral_fresh import build

ROOT = Path(__file__).resolve().parents[1]
RECORDS = ROOT / 'experiments/research-step-48'
FRESH = ROOT / 'experiments/research-step-47'
PLAN47 = 'e504594e547a6aee894e16b290d958df58cf2d595ffe787db41a9abd8995e91c'
PREPARE47 = 'e62e9344e7d5113487b0ae13467cae61e7fb78885a1f034733e6b9138fbd2e2f'
ARMS = ['calculator_v1', 'calculator_v2', 'v2_operand_only']
SCRIPTS = ['research_feral_coverage.py', 'feral_coverage_worker.py', 'check_feral_coverage.py',
           'feral_process.py', 'feral_fresh_sources.py', 'prepare_feral_fresh.py', 'check_feral_fresh.mjs']
LIMITS = {'total_seconds': 300, 'job_seconds': 15, 'grace_seconds': 2,
          'max_log_bytes': 4194304, 'max_output_bytes': 67108864}


def load(path):
    return json.loads(path.read_bytes())


def bindings():
    return {name: digest(ROOT / 'scripts' / name) for name in SCRIPTS}


def inventory(root, excluded=()):
    files = {}
    for path in sorted(root.rglob('*')):
        require(not path.is_symlink(), 'symbolic link in evidence')
        if path.is_file() and str(path.relative_to(root)) not in excluded:
            files[str(path.relative_to(root))] = {'bytes': path.stat().st_size, 'sha256': digest(path)}
    return files


def write_bundle(bundle, families, output):
    output.mkdir(parents=True, exist_ok=False)
    (output / 'predictor').mkdir(); (output / 'grader').mkdir()
    for key, name in [('inputs', 'predictor/INPUTS.jsonl'), ('targets', 'grader/TARGETS.jsonl')]:
        (output / name).write_bytes(b''.join((json.dumps(v, sort_keys=True, separators=(',', ':')) + '\n').encode() for v in bundle[key]))
    save(output / 'ROSTER.json', bundle['roster']); save(output / 'FAMILIES.json', families)


def schedule(mode, ids):
    require(mode in ['opened', 'cloud'], 'comparison mode differs')
    passes = 3 if mode == 'opened' else 12
    return {'mode': mode, 'ids': sorted(ids), 'jobs': [
        {'index': p * 3 + i, 'pass': p, 'arm': arm}
        for p in range(passes) for i, arm in enumerate(ARMS[p % 3:] + ARMS[:p % 3])]}


def prepare(output, raw_sources=None):
    output.mkdir(parents=True, exist_ok=False)
    require(digest(FRESH / 'PLAN.json') == PLAN47 and digest(FRESH / 'data/PREPARE.json') == PREPARE47, 'published fresh preparation differs')
    shutil.copytree(FRESH / 'data', output / 'fresh')
    for name in ['PLAN.json', 'FIXTURES.json']:
        shutil.copyfile(RECORDS / name, output / name)
    plan = load(FRESH / 'PLAN.json')
    (output / 'predictors').mkdir()
    for name, expected in plan['frozen_predictor_sources'].items():
        require(digest(ROOT / name) == expected, 'frozen predictor differs')
        shutil.copyfile(ROOT / name, output / 'predictors' / Path(name).name)
    families = load(RECORDS / 'FIXTURES.json')
    opened = build(families, {'fingerprints': [], 'document_keys': []})
    require(len(opened['inputs']) == 58, 'opened coverage differs')
    write_bundle(opened, families, output / 'opened')
    if raw_sources is not None:
        (output / 'raw').mkdir()
        for source in load(FRESH / 'SOURCES.json')['sources']:
            raw = (raw_sources / (source['id'] + '.html')).read_bytes()
            require(hashlib.sha256(raw).hexdigest() == source['sha256'] and len(raw) == source['bytes'], 'raw report differs')
            (output / 'raw' / (source['id'] + '.html')).write_bytes(raw)
    for mode in ['opened', 'cloud']:
        data = output / ('opened' if mode == 'opened' else 'fresh')
        ids = [json.loads(s)['id'] for s in (data / 'predictor/INPUTS.jsonl').read_text().splitlines()]
        save(output / (mode + '-SCHEDULE.json'), schedule(mode, ids))
    record = {'schema': 'ilxyr.feral_coverage_prepared.v1', 'implementation': bindings(),
              'plan_sha256': digest(RECORDS / 'PLAN.json'), 'fixtures_sha256': digest(RECORDS / 'FIXTURES.json'),
              'fresh_prepare_sha256': PREPARE47, 'fresh_plan_sha256': PLAN47,
              'raw_sources_present': raw_sources is not None, 'files': inventory(output)}
    save(output / 'BINDINGS.json', record); validate_prepared(output)
    return {'status': 'verified', 'bindings_sha256': digest(output / 'BINDINGS.json'), 'fresh_predictor_calls': 0}


def validate_prepared(prepared):
    record = load(prepared / 'BINDINGS.json')
    require(record['schema'] == 'ilxyr.feral_coverage_prepared.v1', 'prepared schema differs')
    require(record['implementation'] == bindings(), 'controller source differs')
    require(record['files'] == inventory(prepared, ['BINDINGS.json']), 'prepared file roster or digest differs')
    require(record['plan_sha256'] == digest(RECORDS / 'PLAN.json') == digest(prepared / 'PLAN.json'), 'controller plan differs')
    require(record['fixtures_sha256'] == digest(RECORDS / 'FIXTURES.json') == digest(prepared / 'FIXTURES.json'), 'fixture source differs')
    require(record['fresh_plan_sha256'] == digest(FRESH / 'PLAN.json') == PLAN47, 'fresh analysis plan differs')
    require(record['fresh_prepare_sha256'] == digest(prepared / 'fresh/PREPARE.json') == PREPARE47, 'fresh data identity differs')
    for name, value in load(prepared / 'fresh/PREPARE.json')['files'].items():
        path = prepared / 'fresh' / name
        require(value == {'bytes': path.stat().st_size, 'sha256': digest(path)}, 'fresh data file differs')
    for name, expected in load(FRESH / 'PLAN.json')['frozen_predictor_sources'].items():
        require(digest(prepared / 'predictors' / Path(name).name) == expected, 'control source identity differs')
    # Rebuild the invented questions too, so changing their inventory cannot change the local workload.
    family = load(prepared / 'FIXTURES.json'); bundle = build(family, {'fingerprints': [], 'document_keys': []})
    for key, name in [('inputs', 'predictor/INPUTS.jsonl'), ('targets', 'grader/TARGETS.jsonl')]:
        require([json.loads(s) for s in (prepared / 'opened' / name).read_text().splitlines()] == bundle[key], 'opened input or target differs')
    require(load(prepared / 'opened/ROSTER.json') == bundle['roster'] and load(prepared / 'opened/FAMILIES.json') == family, 'opened source mapping differs')
    require(record['raw_sources_present'] == (prepared / 'raw').is_dir(), 'raw source status differs')
    if record['raw_sources_present']:
        for source in load(FRESH / 'SOURCES.json')['sources']:
            path = prepared / 'raw' / (source['id'] + '.html')
            require(digest(path) == source['sha256'] and path.stat().st_size == source['bytes'], 'raw source identity differs')
    for mode, directory in [('opened', 'opened'), ('cloud', 'fresh')]:
        ids = [json.loads(s)['id'] for s in (prepared / directory / 'predictor/INPUTS.jsonl').read_text().splitlines()]
        require(load(prepared / (mode + '-SCHEDULE.json')) == schedule(mode, ids), 'process schedule differs')
    return record


def limits(mode, execution, prepared, check_host=True):
    if mode == 'opened':
        require(execution is None, 'opened run uses fixed engineering limits')
        return dict(LIMITS)
    require(mode == 'cloud' and isinstance(execution, dict), 'full comparison requires a cloud execution record')
    require(execution.get('schema') == 'ilxyr.feral_coverage_execution.v1' and execution.get('venue') == 'cloud', 'cloud execution schema differs')
    require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,79}', execution.get('run_id', '')), 'cloud run identity differs')
    require(re.fullmatch(r'[a-f0-9]{64}', execution.get('package_sha256', '')), 'cloud package identity differs')
    require(execution.get('prepared_bindings_sha256') == digest(prepared / 'BINDINGS.json') and execution.get('implementation') == bindings(), 'cloud source bindings differ')
    require(execution.get('worker_count') == 1 and execution.get('limits') == LIMITS, 'cloud process bounds differ')
    require(load(prepared / 'BINDINGS.json')['raw_sources_present'], 'cloud run requires the fixed report bytes')
    machine = execution.get('machine', {})
    require(all(isinstance(machine.get(k), str) and machine[k] for k in ['provider', 'region', 'instance_type', 'image_id', 'architecture', 'runtime_image']), 'cloud machine identity incomplete')
    require(all(isinstance(execution.get(k), str) and execution[k] for k in ['python_identity', 'node_identity']), 'cloud runtime identities incomplete')
    if check_host:
        require(platform.system() == 'Linux' and machine['architecture'] == platform.machine(), 'cloud architecture differs')
        require(execution['python_identity'] == platform.python_version(), 'cloud Python identity differs')
    return dict(LIMITS)


def run(prepared, output, work, mode, execution=None):
    prepared, output, work = prepared.resolve(), output.resolve(), work.resolve()
    output.mkdir(parents=True, exist_ok=False)
    state = {'status': 'failed', 'phase': 'inputs', 'mode': mode, 'started_jobs': 0, 'completed_jobs': 0}
    stopped, handlers = [None], {}
    start = time.monotonic()
    try:
        for n in [signal.SIGINT, signal.SIGTERM]:
            handlers[n] = signal.signal(n, lambda s, _f: stopped.__setitem__(0, s))
        for a, b in [(prepared, output), (prepared, work), (output, work)]:
            require(a != b and a not in b.parents and b not in a.parents, 'input, output and worker roots must be separate')
        validate_prepared(prepared); bound = limits(mode, execution, prepared)
        deadline = start + bound['total_seconds']
        work.mkdir(parents=True, exist_ok=False)
        for name in ['feral_evidence_calculator.py', 'feral_evidence_calculator_v2.py']:
            shutil.copyfile(prepared / 'predictors' / name, work / name)
        shutil.copyfile(ROOT / 'scripts/feral_coverage_worker.py', work / 'feral_coverage_worker.py')
        selected = load(prepared / (mode + '-SCHEDULE.json'))
        save(output / 'SCHEDULE.json', selected)
        save(output / 'RUN.json', {'schema': 'ilxyr.feral_coverage_run.v1', 'mode': mode, 'execution': execution,
             'implementation': bindings(), 'prepared_sha256': digest(prepared / 'BINDINGS.json'),
             'limits': bound, 'python_identity': platform.python_version(), 'platform': platform.platform(),
             'python_executable': sys.executable, 'script_root': str(ROOT), 'prepared_root': str(prepared),
             'output_root': str(output), 'worker_root': str(work)})
        def child(name, command):
            state['phase'] = name; save(output / 'ATTEMPT.json', state)
            receipt = run_process(command, work, output / name, min(deadline, time.monotonic() + bound['job_seconds']),
                                  bound['grace_seconds'], cancelled=lambda: stopped[0], max_log_bytes=bound['max_log_bytes'])
            require(receipt['status'] == 'complete', 'process failed; retained ' + name)
            require(sum(v['bytes'] for v in inventory(output).values()) <= bound['max_output_bytes'], 'collection byte ceiling exceeded')
        child('setup/python', [sys.executable, '--version'])
        child('setup/node', ['node', '--version'])
        if mode == 'cloud':
            require((output / 'setup/node/stdout.log').read_text().strip() == execution['node_identity'], 'cloud Node identity differs')
            child('setup/source', [sys.executable, '-B', str(ROOT / 'scripts/prepare_feral_fresh.py'), '--source-dir', str(prepared / 'raw'), '--output', str(output / 'data')])
            require(inventory(output / 'data') == inventory(prepared / 'fresh'), 'source rebuild differs from the frozen data')
            child('setup/arithmetic', ['node', str(ROOT / 'scripts/check_feral_fresh.mjs'), str(output / 'data'), PREPARE47])
        else:
            shutil.copytree(prepared / 'opened', output / 'data')
        shutil.copyfile(output / 'data/predictor/INPUTS.jsonl', work / 'INPUTS.jsonl')
        save(output / 'WORKER-FILES.json', inventory(work))
        input_sha = digest(work / 'INPUTS.jsonl')
        for job in selected['jobs']:
            require(stopped[0] is None and time.monotonic() < deadline, 'controller deadline reached')
            state['started_jobs'] += 1
            name = f"jobs/{job['index']:04d}"
            child(name, [sys.executable, '-I', '-B', str(work / 'feral_coverage_worker.py'), '--input', str(work / 'INPUTS.jsonl'),
                         '--input-sha256', input_sha, '--arm', job['arm'], '--pass-index', str(job['pass']),
                         '--output', str(output / name / 'PREDICTIONS.jsonl'), '--byte-limit', str(bound['max_log_bytes'])])
            state['completed_jobs'] += 1
        require(inventory(work) == load(output / 'WORKER-FILES.json'), 'worker changed its fixed inputs')
        state.update(status='complete', phase='complete', expected_jobs=len(selected['jobs']),
                     predictor_calls=len(selected['ids']) * len(selected['jobs']),
                     fresh_predictor_calls=len(selected['ids']) * len(selected['jobs']) if mode == 'cloud' else 0)
        return state
    except BaseException as error:
        state['error'] = str(error)
        raise
    finally:
        for n, handler in handlers.items(): signal.signal(n, handler)
        state['stop_signal'] = stopped[0]; save(output / 'ATTEMPT.json', state)
        save(output / 'COLLECTION.json', {'files': inventory(output, ['COLLECTION.json'])})


def supervise(prepared, output, work, mode, execution_path=None):
    prepared, output, work = prepared.resolve(), output.resolve(), work.resolve()
    execution_path = execution_path.resolve() if execution_path else None
    output.mkdir(parents=True, exist_ok=False)
    terminal = {'status': 'failed', 'mode': mode}; stopped, handlers = [None], {}
    try:
        for n in [signal.SIGINT, signal.SIGTERM]: handlers[n] = signal.signal(n, lambda s, _f: stopped.__setitem__(0, s))
        execution = load(execution_path) if execution_path else None
        bound = limits(mode, execution, prepared)
        command = [sys.executable, '-B', str(Path(__file__).resolve()), mode, '--worker', '--prepared', str(prepared),
                   '--out', str(output / 'study'), '--work', str(work)]
        if execution_path: command += ['--execution', str(execution_path)]
        receipt = run_process(command, ROOT, output / 'controller-process', time.monotonic() + bound['total_seconds'],
                              bound['grace_seconds'] + 2, cancelled=lambda: stopped[0], max_log_bytes=bound['max_log_bytes'])
        terminal['controller_receipt_sha256'] = digest(output / 'controller-process/process.json')
        if (output / 'study/COLLECTION.json').is_file(): terminal['collection_sha256'] = digest(output / 'study/COLLECTION.json')
        require(receipt['status'] == 'complete' and 'collection_sha256' in terminal, 'controller failed; retained process and partial output')
        terminal['status'] = 'complete'
        return terminal
    except BaseException as error:
        terminal['error'] = str(error)
        raise
    finally:
        terminal['stop_signal'] = stopped[0]
        for n, handler in handlers.items(): signal.signal(n, handler)
        save(output / 'SUPERVISOR.json', terminal)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('mode', choices=['prepare', 'opened', 'cloud'])
    for name in ['prepared', 'out', 'work', 'raw', 'execution']: p.add_argument('--' + name, type=Path)
    p.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    a = p.parse_args()
    if a.mode == 'prepare': result = prepare(a.out.resolve(), a.raw.resolve() if a.raw else None)
    elif a.worker: result = run(a.prepared.resolve(), a.out.resolve(), a.work.resolve(), a.mode, load(a.execution) if a.execution else None)
    else: result = supervise(a.prepared.resolve(), a.out.resolve(), a.work.resolve(), a.mode, a.execution.resolve() if a.execution else None)
    print(json.dumps(result, sort_keys=True))
