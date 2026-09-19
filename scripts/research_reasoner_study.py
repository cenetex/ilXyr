"""Prepare and run the fixed Reasoner comparison with retained process receipts."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import signal
import subprocess
import sys
import time

from feral_process import run_process, save, digest

ROOT = Path(__file__).resolve().parents[1]
PLAN_SHA = '177e6053242b03db6767c6ce2bcd73436013153633605d46425c8c157ee93c95'
FRESH_SHA = '037caefb37b9656e5681dc3dd145a2cf20d4517582c5faf373b42265782da42e'
OPENED_SHA = '5fb9c0f241d06df59b98ff3a8ecd4631f2ec496577aa8df44cb2382900277bfc'
SOURCE_SHA = '0c5253604593acb3b9294fcc00c90f59b7dbbd3c'
ARMS = ['semantic_frequency', 'task_guide', 'raw_lexical_task_guide', 'task_without_prior_feature']
SCRIPTS = ['research_reasoner_study.py', 'reasoner_study_worker.c', 'replay_reasoner_study.mjs',
           'check_reasoner_study.py', 'feral_process.py']
FLAGS = ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-DR55FAST_HASH=0', '-DR55FAST_SORT=0']
OPENED_LIMITS = {'total_seconds': 240, 'build_seconds': 60, 'job_seconds': 20,
                 'check_seconds': 60, 'grace_seconds': 2, 'max_log_bytes': 4 * 1024 * 1024}


def require(ok, message):
    if not ok:
        raise ValueError(message)


def load(path):
    return json.loads(path.read_bytes())


def bindings():
    return {n: digest(ROOT / 'scripts' / n) for n in SCRIPTS}


def inventory(root):
    files = {}
    for path in sorted(root.rglob('*')):
        require(not path.is_symlink(), 'symbolic link in evidence')
        if path.is_file() and path != root / 'COLLECTION.json':
            files[str(path.relative_to(root))] = {'bytes': path.stat().st_size, 'sha256': digest(path)}
    return files


def prepare(source, output, git=False):
    output.mkdir(parents=True, exist_ok=False)
    status = {'status': 'failed', 'phase': 'source', 'fresh_episode_visits': 0}
    try:
        source_files = load(ROOT / 'experiments/research-step-39/SOURCE-FILES.json')
        for name, sha in source_files.items():
            raw = subprocess.check_output(['git', '-C', str(source), 'show', SOURCE_SHA + ':' + name], timeout=30) if git else (source / name).read_bytes()
            require(hashlib.sha256(raw).hexdigest() == sha, 'source differs: ' + name)
            dest = output / 'source' / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(raw)
        for src, dest in [('experiments/research-step-40/PLAN.json', 'PLAN.json'),
                          ('experiments/research-step-40/OPENED.jsonl', 'OPENED.jsonl'),
                          ('experiments/research-step-39/ROSTER.json', 'ROSTER.json')]:
            shutil.copyfile(ROOT / src, output / dest)
        save(output / 'BINDINGS.json', {'source': source_files, 'implementation': bindings(),
             'plan_sha256': PLAN_SHA, 'roster_sha256': FRESH_SHA, 'opened_sha256': OPENED_SHA})
        validate_prepared(output)
        for mode in ['opened', 'cloud']:
            save(output / (mode + '-SCHEDULE.json'), workload(output, mode))
        status.update(status='complete', source_files=len(source_files))
    except BaseException as error:
        status['error'] = str(error)
        raise
    finally:
        save(output / 'PREPARE.json', status)
    return status


def validate_prepared(prepared):
    record = load(prepared / 'BINDINGS.json')
    require(record['source'] == load(ROOT / 'experiments/research-step-39/SOURCE-FILES.json'), 'source inventory differs')
    require(record['implementation'] == bindings(), 'controller implementation differs')
    require([record['plan_sha256'], record['roster_sha256'], record['opened_sha256']] == [PLAN_SHA, FRESH_SHA, OPENED_SHA], 'binding identities differ')
    for name, expected in [('PLAN.json', PLAN_SHA), ('ROSTER.json', FRESH_SHA), ('OPENED.jsonl', OPENED_SHA)]:
        require(digest(prepared / name) == expected, 'fixed input differs: ' + name)
    for name, expected in record['source'].items():
        require(digest(prepared / 'source' / name) == expected, 'prepared source differs: ' + name)
    return record


def families(prepared, mode):
    require(mode in ['opened', 'cloud'], 'workload mode differs')
    return load(prepared / 'ROSTER.json') if mode == 'cloud' else [json.loads(s) for s in (prepared / 'OPENED.jsonl').read_text().splitlines()]


def workload(prepared, mode):
    rows = families(prepared, mode)
    plan = load(prepared / 'PLAN.json')
    passes = plan['passes'] if mode == 'cloud' else plan['opened_passes']
    episodes = [r['ordinal'] * 4 + v for r in rows for v in range(4)]
    orders = [sorted(episodes, key=lambda e: (hashlib.sha256(f"{plan['order_seed']}:{p}:{e}".encode()).hexdigest(), e)) for p in range(passes)]
    jobs = [{'index': p * 4 + i, 'pass': p, 'arm': arm} for p in range(passes)
            for i, arm in enumerate(ARMS[p % 4:] + ARMS[:p % 4])]
    return {'mode': mode, 'families': len(rows), 'views': 4, 'orders': orders, 'jobs': jobs,
            'roster_sha256': FRESH_SHA if mode == 'cloud' else OPENED_SHA}


def header(prepared, mode):
    rows, selected = families(prepared, mode), workload(prepared, mode)
    array = lambda values: '{' + ','.join(str(v) for v in values) + '}'
    affine = lambda m: '{' + array(m['matrix']) + ',' + array(m['bias']) + '}'
    records = []
    for f in rows:
        inverse = [f['surface_to_role'].index(i) for i in range(8)]
        fields = {'primitive_by_role': '{' + ','.join(affine(m) for m in f['primitive_by_role']) + '}',
                  'surface_to_role': array(f['surface_to_role']), 'role_to_surface': array(inverse),
                  'surface_id': array(f['surface_ids']), 'target_roles': array(f['target_roles']),
                  'target_surface': array([inverse[i] for i in f['target_roles']]), 'target': affine(f['target']),
                  'example_input': array(f['example_input']), 'example_output': array(f['example_output']),
                  'generator_id': '0', 'ordinal': str(f['ordinal']), 'family_seed': 'UINT64_C(0x' + f['family_seed'] + ')'}
        records.append('{' + ','.join('.' + k + '=' + v for k, v in fields.items()) + '}')
    indices = {f['ordinal']: i for i, f in enumerate(rows)}
    orders = [array([indices[e // 4] * 4 + e % 4 for e in order]) for order in selected['orders']]
    return (f'#define R40_MODE "{mode}"\n#define R40_ROSTER_SHA "{selected["roster_sha256"]}"\n'
            f'#define R40_PASSES {len(orders)}\n#define R40_EPISODES {len(rows) * 4}\n'
            'static const r55_family r40_families[] = {\n' + ',\n'.join(records) + '\n};\n'
            'static const uint32_t r40_order[R40_PASSES][R40_EPISODES] = {\n' + ',\n'.join(orders) + '\n};\n')


def limits(mode, execution, prepared, check_host=True):
    if mode == 'opened':
        require(execution is None, 'opened check uses fixed local limits')
        return dict(OPENED_LIMITS)
    require(mode == 'cloud' and isinstance(execution, dict), 'full comparison requires a cloud execution record')
    require(execution.get('schema') == 'ilxyr.reasoner_study_execution.v1' and execution.get('venue') == 'cloud', 'cloud execution schema differs')
    require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,79}', execution.get('run_id', '')), 'run identity differs')
    require(re.fullmatch(r'[a-f0-9]{64}', execution.get('package_sha256', '')), 'package identity differs')
    require(execution.get('prepared_bindings_sha256') == digest(prepared / 'BINDINGS.json'), 'cloud prepared inputs differ')
    require(execution.get('implementation') == bindings(), 'cloud implementation differs')
    machine = execution.get('machine', {})
    require(all(isinstance(machine.get(k), str) and machine[k] for k in ['provider', 'region', 'instance_type', 'image_id', 'architecture', 'runtime_image']), 'machine identity incomplete')
    if check_host:
        require(machine['architecture'] == platform.machine(), 'machine architecture differs')
    require(all(isinstance(execution.get(k), str) and execution[k] for k in ['compiler_identity', 'node_identity']), 'runtime identities incomplete')
    require(execution.get('compiler_flags') == FLAGS and execution.get('worker_count') == 1, 'build or worker shape differs')
    value = execution.get('limits', {})
    bounds = {'total_seconds': (1, 3000), 'build_seconds': (1, 300), 'job_seconds': (1, 120),
              'check_seconds': (1, 600), 'grace_seconds': (1, 3), 'max_log_bytes': (4*1024*1024, 4*1024*1024)}
    require(set(value) == set(bounds), 'cloud limit names differ')
    for k, (lo, hi) in bounds.items():
        require(type(value[k]) is int and lo <= value[k] <= hi, 'cloud limit differs: ' + k)
    return value


def run(prepared, output, work, mode, execution=None):
    output.mkdir(parents=True, exist_ok=False)
    state = {'status': 'failed', 'phase': 'inputs', 'mode': mode, 'started_jobs': 0, 'completed_jobs': 0}
    start, cpu = time.monotonic_ns(), time.process_time_ns()
    stopped, handlers = [None], {}
    try:
        for n in [signal.SIGINT, signal.SIGTERM]:
            handlers[n] = signal.signal(n, lambda s, _f: stopped.__setitem__(0, s))
        for a, b in [(prepared, output), (prepared, work), (output, work)]:
            require(a != b and a not in b.parents and b not in a.parents, 'input, result and build roots must be separate')
        record = validate_prepared(prepared)
        bound = limits(mode, execution, prepared)
        deadline = start / 1e9 + bound['total_seconds']
        selected = workload(prepared, mode)
        require(load(prepared / (mode + '-SCHEDULE.json')) == selected, 'prepared schedule differs')
        work.mkdir(parents=True, exist_ok=False)
        source = work / 'source'
        for name in record['source']:
            target = source / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(prepared / 'source' / name, target)
        (output / 'bin').mkdir()
        (output / 'inputs').mkdir()
        raw = (source / 'reasoner55_eligible.c').read_text()
        require(raw.count('int main(int argc, char **argv)') == 1, 'frozen entry point differs')
        (output / 'inputs/eligible_source.h').write_text(raw.replace('int main(int argc, char **argv)', 'int r40_opened_reference_main(int argc, char **argv)'))
        (output / 'inputs/study_inputs.h').write_text(header(prepared, mode))
        save(output / 'WORKLOAD.json', selected)
        save(output / 'RUN.json', {'schema': 'ilxyr.reasoner_study_run.v1', 'mode': mode, 'execution': execution,
             'implementation': bindings(), 'prepared_bindings_sha256': digest(prepared / 'BINDINGS.json'),
             'plan_sha256': PLAN_SHA, 'limits': bound, 'compiler_flags': FLAGS, 'python': platform.python_version(),
             'platform': platform.platform(), 'prepared_root': str(prepared), 'output_root': str(output), 'build_root': str(work),
             'script': str(Path(__file__).resolve()), 'python_executable': sys.executable})
        def child(name, command, seconds):
            state['phase'] = name
            save(output / 'ATTEMPT.json', state)
            receipt = run_process(command, source, output / name, min(deadline, time.monotonic() + seconds),
                                  bound['grace_seconds'], cancelled=lambda: stopped[0], max_log_bytes=bound['max_log_bytes'])
            require(receipt['status'] == 'complete', 'process failed; retained ' + name)
        cc = os.environ.get('CC', 'clang')
        child('setup/compiler', [cc, '--version'], 15)
        child('setup/node', ['node', '--version'], 15)
        if mode == 'cloud':
            require((output / 'setup/compiler/stdout.log').read_text().strip() == execution['compiler_identity'], 'compiler identity differs')
            require((output / 'setup/node/stdout.log').read_text().strip() == execution['node_identity'], 'node identity differs')
        child('setup/embed', ['make', '-f', 'Makefile.reasoner55-eligible', 'build/reasoner55_eligible_matched.h'], 30)
        binary = output / 'bin/reasoner-study'
        command = [cc, *FLAGS, '-I' + str(source), '-I' + str(output / 'inputs'), str(ROOT / 'scripts/reasoner_study_worker.c'), '-lm', '-o', str(binary)]
        child('setup/build', command, bound['build_seconds'])
        save(output / 'BINARY.json', {'sha256': digest(binary), 'bytes': binary.stat().st_size,
             'header_sha256': digest(output / 'inputs/study_inputs.h'), 'eligible_source_sha256': digest(output / 'inputs/eligible_source.h')})
        for job in selected['jobs']:
            require(stopped[0] is None and time.monotonic() < deadline, 'controller deadline reached')
            state['started_jobs'] += 1
            name = f"jobs/{job['index']:04d}"
            child(name, [str(binary), job['arm'], str(job['pass'])], bound['job_seconds'])
            state['completed_jobs'] += 1
        child('replay', ['node', str(ROOT / 'scripts/replay_reasoner_study.mjs'), str(source), str(output), str(prepared), str(output / 'REPLAY.json')], bound['check_seconds'])
        require(stopped[0] is None and time.monotonic() < deadline, 'controller deadline reached during replay')
        state.update(status='complete', phase='complete', expected_jobs=len(selected['jobs']),
                     confirmed_episode_visits=len(selected['jobs']) * len(selected['orders'][0]) * 2,
                     fresh_episode_visits=len(selected['jobs']) * len(selected['orders'][0]) * 2 if mode == 'cloud' else 0)
        return state
    except BaseException as error:
        state['error'] = str(error)
        raise
    finally:
        state.update(preseal_wall_ns=time.monotonic_ns()-start, preseal_cpu_ns=time.process_time_ns()-cpu, stop_signal=stopped[0])
        for n, handler in handlers.items():
            signal.signal(n, handler)
        save(output / 'ATTEMPT.json', state)
        save(output / 'COLLECTION.json', {'files': inventory(output)})


def supervise(prepared, output, work, mode, execution_path=None):
    output.mkdir(parents=True, exist_ok=False)
    terminal = {'status': 'failed', 'mode': mode}
    stopped, handlers = [None], {}
    try:
        for n in [signal.SIGINT, signal.SIGTERM]:
            handlers[n] = signal.signal(n, lambda s, _f: stopped.__setitem__(0, s))
        execution = load(execution_path) if execution_path else None
        bound = limits(mode, execution, prepared)
        command = [sys.executable, str(Path(__file__).resolve()), mode, '--worker', '--prepared', str(prepared),
                   '--out', str(output / 'study'), '--work', str(work)]
        if execution_path:
            command += ['--execution', str(execution_path)]
        r = run_process(command, ROOT, output / 'controller-process', time.monotonic() + bound['total_seconds'],
                        bound['grace_seconds'] + 2, cancelled=lambda: stopped[0], max_log_bytes=bound['max_log_bytes'])
        terminal['controller_receipt_sha256'] = digest(output / 'controller-process/process.json')
        collection = output / 'study/COLLECTION.json'
        if collection.is_file():
            terminal['collection_sha256'] = digest(collection)
        require(r['status'] == 'complete' and collection.is_file(), 'controller failed; retained its process and partial results')
        terminal['status'] = 'complete'
        return terminal
    except BaseException as error:
        terminal['error'] = str(error)
        raise
    finally:
        terminal['stop_signal'] = stopped[0]
        for n, handler in handlers.items():
            signal.signal(n, handler)
        save(output / 'SUPERVISOR.json', terminal)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('mode', choices=['prepare', 'opened', 'cloud'])
    p.add_argument('--source', type=Path); p.add_argument('--git', action='store_true')
    p.add_argument('--prepared', type=Path); p.add_argument('--work', type=Path)
    p.add_argument('--out', type=Path, required=True); p.add_argument('--execution', type=Path)
    p.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    a = p.parse_args()
    if a.mode == 'prepare':
        result = prepare(a.source.resolve(), a.out.resolve(), a.git)
    elif a.worker:
        result = run(a.prepared.resolve(), a.out.resolve(), a.work.resolve(), a.mode, load(a.execution) if a.execution else None)
    else:
        result = supervise(a.prepared.resolve(), a.out.resolve(), a.work.resolve(), a.mode, a.execution.resolve() if a.execution else None)
    print(json.dumps(result, sort_keys=True))
