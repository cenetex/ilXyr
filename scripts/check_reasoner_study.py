"""Check Reasoner collection identity, complete costs, and independently replay answers."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import time

import research_reasoner_study as study
from feral_process import digest, save, run_process

require, load = study.require, study.load


def process_at(path, command, seconds, log_limit):
    r = load(path / 'process.json')
    require(r['schema'] == 'ilxyr.feral_process.v1' and r['command'] == command, 'process command differs')
    require(r['status'] == 'complete' and r['exit_code'] == 0 and r['stop_reason'] is None
            and r['signals'] == [] and r['descendant_cleanup'] is False, 'process completion differs')
    require(r['max_log_bytes'] == log_limit and set(r['outputs']) == {'stdout.log', 'stderr.log'}, 'process log coverage differs')
    for name, value in r['outputs'].items():
        p = path / name
        require(value == {'bytes': p.stat().st_size, 'sha256': digest(p)}, 'process log identity differs')
    require(sum(x['bytes'] for x in r['outputs'].values()) <= log_limit, 'process log size exceeded')
    u = r['resource_usage']
    require(u['scope'] == 'wait4_direct_child_and_waited_descendants', 'resource scope differs')
    for name in ['user_cpu_seconds', 'system_cpu_seconds']:
        require(type(u[name]) in (int, float) and math.isfinite(u[name]) and u[name] >= 0, 'CPU value differs')
    require(type(u['max_rss_bytes']) is int and u['max_rss_bytes'] > 0, 'peak memory differs')
    require(type(r['total_wall_ns']) is int and 0 < r['total_wall_ns'] <= (seconds + 6) * 1e9, 'wall time differs')
    return {'cpu_seconds': u['user_cpu_seconds'] + u['system_cpu_seconds'], 'wall_ns': r['total_wall_ns'],
            'peak_rss_bytes': u['max_rss_bytes']}


def random_indices(seed):
    state = seed
    def index(bound):
        nonlocal state
        limit = 2**32 - 2**32 % bound
        while True:
            state ^= (state << 13) & 0xffffffff
            state ^= state >> 17
            state ^= (state << 5) & 0xffffffff
            if state < limit:
                return state % bound
    return index


def interval(logs, groups, seed=553540, draws=20000):
    require(all(math.isfinite(v) for v in logs) and bool(logs), 'ratio inputs differ')
    random = random_indices(seed)
    values = []
    for _ in range(draws):
        sample = [group[random(len(group))] for group in groups for _ in group]
        values.append(math.exp(sum(logs[i] for i in sample) / len(sample)))
    values.sort()
    return {'ratio': math.exp(sum(logs) / len(logs)), 'upper_one_sided_9875': values[math.ceil(draws * .9875) - 1]}


def summary(prepared, mode, jobs, rows):
    families = study.families(prepared, mode)
    arms = {}
    for arm in study.ARMS:
        costs = [r['cost'] for r in jobs if r['arm'] == arm]
        measured = rows[arm]
        cells = {}
        for cell in range(4):
            selected = [r for r in measured if r['episode'] // 128 == cell]
            cells[str(cell)] = {'views': len(selected), 'verifier_checks': sum(r['verifier_checks'] for r in selected),
                                'fallback_checks': sum(r['fallback_checks'] for r in selected)}
        arms[arm] = {'cells': cells, 'verifier_checks': sum(r['verifier_checks'] for r in measured),
                     'fallback_checks': sum(r['fallback_checks'] for r in measured),
                     'processes': len(costs), 'whole_worker_cpu_seconds': sum(c['cpu_seconds'] for c in costs),
                     'whole_worker_wall_ns': sum(c['wall_ns'] for c in costs),
                     'maximum_peak_rss_bytes': max(c['peak_rss_bytes'] for c in costs)}
    comparisons = {}
    for reference in ['raw_lexical_task_guide', 'semantic_frequency']:
        ratios = []
        for f in families:
            sums = [sum(r['verifier_checks'] for r in rows[a] if r['episode'] // 4 == f['ordinal']) for a in ['task_guide', reference]]
            require(min(sums) > 0, 'family cost denominator differs')
            ratios.append(math.log(sums[0] / sums[1]))
        cpu = []
        for p in range(12 if mode == 'cloud' else 2):
            sums = [next(j['cost']['cpu_seconds'] for j in jobs if j['pass'] == p and j['arm'] == a) for a in ['task_guide', reference]]
            cpu.append(math.log(sums[0] / sums[1]) if min(sums) > 0 else None)
        if mode == 'cloud' and all(c is not None for c in cpu):
            cells = [[i for i, f in enumerate(families) if f['cell'] == cell] for cell in range(4)]
            c, v = interval(cpu, [list(range(12))]), interval(ratios, cells)
            passed = c['ratio'] <= .95 and c['upper_one_sided_9875'] < 1 and v['upper_one_sided_9875'] < 1
            comparisons[reference] = {'cpu': c, 'checks': v, 'gate_passed': passed}
        else:
            comparisons[reference] = {'checks_ratio': math.exp(sum(ratios)/len(ratios)),
                                      'gate_passed': None, 'status': 'opened_engineering' if mode == 'opened' else 'CPU_resolution_failure'}
    decision = 'opened_engineering' if mode == 'opened' else ('pass' if all(v['gate_passed'] is True for v in comparisons.values()) else 'no_go')
    return {'arms': arms, 'comparisons': comparisons, 'primary_decision': decision, 'performance_evidence': mode == 'cloud'}


def check(prepared, collected, expected_sha, verification):
    verification.mkdir(parents=True, exist_ok=False)
    status = {'status': 'failed', 'phase': 'bindings'}
    start, cpu = time.monotonic_ns(), time.process_time_ns()
    try:
        study.validate_prepared(prepared)
        require(digest(collected / 'SUPERVISOR.json') == expected_sha, 'supervisor identity differs')
        supervisor = load(collected / 'SUPERVISOR.json')
        require(supervisor['status'] == 'complete' and supervisor['stop_signal'] is None, 'supervisor incomplete')
        root = collected / 'study'
        require(digest(root / 'COLLECTION.json') == supervisor['collection_sha256'], 'collection identity differs')
        require(load(root / 'COLLECTION.json')['files'] == study.inventory(root), 'collection file coverage or identity differs')
        run, attempt = load(root / 'RUN.json'), load(root / 'ATTEMPT.json')
        mode = run['mode']
        require(run['schema'] == 'ilxyr.reasoner_study_run.v1', 'run schema differs')
        require(mode == attempt['mode'] == supervisor['mode'], 'mode binding differs')
        require(run['implementation'] == study.bindings() and run['plan_sha256'] == study.PLAN_SHA, 'run implementation differs')
        require(run['prepared_bindings_sha256'] == digest(prepared / 'BINDINGS.json'), 'prepared identity differs')
        bound = study.limits(mode, run['execution'], prepared, check_host=False)
        require(run['limits'] == bound and run['compiler_flags'] == study.FLAGS, 'limits or compiler flags differ')
        selected = study.workload(prepared, mode)
        require(load(root / 'WORKLOAD.json') == selected, 'workload differs')
        require(attempt['status'] == attempt['phase'] == 'complete' and attempt['stop_signal'] is None, 'attempt incomplete')
        count = len(selected['jobs']) * len(selected['orders'][0]) * 2
        require(attempt['completed_jobs'] == attempt['started_jobs'] == attempt['expected_jobs'] == len(selected['jobs']), 'process coverage differs')
        require(attempt['confirmed_episode_visits'] == count and attempt['fresh_episode_visits'] == (count if mode == 'cloud' else 0), 'visit counts differ')
        require((root / 'inputs/study_inputs.h').read_text() == study.header(prepared, mode), 'native roster header differs')
        native = (prepared / 'source/reasoner55_eligible.c').read_text().replace('int main(int argc, char **argv)', 'int r40_opened_reference_main(int argc, char **argv)')
        require((root / 'inputs/eligible_source.h').read_text() == native, 'native source wrapper differs')
        binary = root / 'bin/reasoner-study'
        require(load(root / 'BINARY.json') == {'sha256': digest(binary), 'bytes': binary.stat().st_size,
                 'header_sha256': digest(root / 'inputs/study_inputs.h'), 'eligible_source_sha256': digest(root / 'inputs/eligible_source.h')}, 'native binary bindings differ')
        original = Path(run['output_root'])
        compiler = load(root / 'setup/compiler/process.json')['command'][0]
        commands = {'compiler': [compiler, '--version'], 'node': ['node', '--version'],
                    'embed': ['make', '-f', 'Makefile.reasoner55-eligible', 'build/reasoner55_eligible_matched.h'],
                    'build': [compiler, *study.FLAGS, '-I' + str(Path(run['build_root']) / 'source'), '-I' + str(original / 'inputs'),
                              str(Path(run['script']).with_name('reasoner_study_worker.c')), '-lm', '-o', str(original / 'bin/reasoner-study')]}
        setup = {name: process_at(root / 'setup' / name, cmd, bound['build_seconds'] if name == 'build' else 30, bound['max_log_bytes']) for name, cmd in commands.items()}
        if mode == 'cloud':
            require((root / 'setup/compiler/stdout.log').read_text().strip() == run['execution']['compiler_identity'], 'collected compiler differs')
            require((root / 'setup/node/stdout.log').read_text().strip() == run['execution']['node_identity'], 'collected node differs')
        jobs, rows = [], {}
        for job in selected['jobs']:
            path = root / 'jobs' / f"{job['index']:04d}"
            command = [str(original / 'bin/reasoner-study'), job['arm'], str(job['pass'])]
            cost = process_at(path, command, bound['job_seconds'], bound['max_log_bytes'])
            records = [json.loads(s) for s in (path / 'stdout.log').read_text().splitlines()]
            require(records[-1]['process_cpu_ns'] <= cost['cpu_seconds'] * 1e9 + 2_000_000, 'native CPU exceeds complete process receipt')
            require(records[-1]['process_wall_ns'] <= cost['wall_ns'], 'native wall exceeds complete process receipt')
            if job['pass'] == 0:
                rows[job['arm']] = [r for r in records if r.get('phase') == 'measured']
            timer_names = ['adapter_ns', 'enumerate_ns', 'group_ns', 'score_ns', 'sort_ns', 'receipt_ns', 'search_ns', 'wall_ns', 'cpu_ns']
            jobs.append({**job, 'cost': cost, 'native': {
                'model_load_ns': records[0]['model_load_ns'],
                'preparation_ns': records[0]['preparation_ns'],
                'preparation_cpu_ns': records[0]['preparation_cpu_ns'],
                'warmup_and_measured_stage_ns': {k: sum(r[k] for r in records if r['kind'] == 'row') for k in timer_names}}})
        command = ['node', str(Path(run['script']).with_name('replay_reasoner_study.mjs')),
                   str(Path(run['build_root']) / 'source'), str(original), run['prepared_root'], str(original / 'REPLAY.json')]
        replay_cost = process_at(root / 'replay', command, bound['check_seconds'], bound['max_log_bytes'])
        require(digest(collected / 'controller-process/process.json') == supervisor['controller_receipt_sha256'], 'controller receipt identity differs')
        command = [run['python_executable'], run['script'], mode, '--worker', '--prepared', run['prepared_root'], '--out', run['output_root'], '--work', run['build_root']]
        actual = load(collected / 'controller-process/process.json')['command']
        if mode == 'cloud':
            require(len(actual) == len(command)+2 and actual[-2] == '--execution', 'execution path differs')
            command += actual[-2:]
        total = process_at(collected / 'controller-process', command, bound['total_seconds'], bound['max_log_bytes'])
        children = [*setup.values(), *(j['cost'] for j in jobs), replay_cost]
        require(total['cpu_seconds'] + .00001 >= sum(c['cpu_seconds'] for c in children), 'controller CPU excludes child work')
        require(total['wall_ns'] >= sum(c['wall_ns'] for c in children), 'controller wall excludes child work')
        status['phase'] = 'independent_replay'
        command = ['node', str(study.ROOT / 'scripts/replay_reasoner_study.mjs'), str(prepared / 'source'), str(root), str(prepared), str(verification / 'REPLAY.json')]
        receipt = run_process(command, prepared, verification / 'replay-process', time.monotonic() + bound['check_seconds'], 2, max_log_bytes=bound['max_log_bytes'])
        require(receipt['status'] == 'complete', 'independent replay failed; raw output retained')
        require(load(verification / 'REPLAY.json') == load(root / 'REPLAY.json'), 'independent replay summary differs')
        replay = load(verification / 'REPLAY.json')
        status.update(status='verified_complete', phase='complete', mode=mode, supervisor_sha256=expected_sha,
                      collection_sha256=supervisor['collection_sha256'], setup=setup, jobs=jobs,
                      complete_controller_cost=total, controller_replay_cost=replay_cost,
                      fresh_episode_visits=replay['fresh_episode_visits'], independent_measured_replays=replay['independent_measured_replays'],
                      stable_rows_sha256=replay['stable_rows_sha256'], summary=summary(prepared, mode, jobs, rows))
        return status
    except BaseException as error:
        status['error'] = str(error)
        raise
    finally:
        status.update(checker_wall_ns=time.monotonic_ns()-start, checker_own_cpu_ns=time.process_time_ns()-cpu)
        save(verification / 'CHECK.json', status)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--prepared', type=Path, required=True); p.add_argument('--collected', type=Path, required=True)
    p.add_argument('--supervisor-sha256', required=True); p.add_argument('--out', type=Path, required=True)
    a = p.parse_args()
    result = check(a.prepared.resolve(), a.collected.resolve(), a.supervisor_sha256, a.out.resolve())
    print(json.dumps({k: result[k] for k in ['status', 'mode', 'fresh_episode_visits', 'independent_measured_replays']}))
