"""Check saved FERAL outputs against source cells, exact arithmetic and the fixed plan."""
import argparse
from collections import Counter, defaultdict
from fractions import Fraction
import hashlib
import json
import math
from pathlib import Path
import re
import sys
import time

import research_feral_coverage as study
from feral_process import digest, run_process, save

require, load = study.require, study.load


def fraction(text):
    require(isinstance(text, str) and len(text) < 100 and re.fullmatch(r'-?\d+(?:/[1-9]\d*)?', text), 'exact value syntax differs')
    return Fraction(text)


def rounded(value):
    sign = '-' if value < 0 else ''
    numerator = abs(value.numerator) * 100; denominator = value.denominator
    cents, remainder = divmod(numerator, denominator)
    cents += int(2 * remainder >= denominator)
    tail = str(cents % 100).zfill(2).rstrip('0')
    return (sign if cents else '') + str(cents // 100) + ('.' + tail if tail else '')


def process_at(path, command, seconds, log_limit):
    receipt = load(path / 'process.json')
    require(receipt['schema'] == 'ilxyr.feral_process.v1' and receipt['command'] == command, 'process command differs')
    require(receipt['status'] == 'complete' and receipt['exit_code'] == 0 and receipt['stop_reason'] is None
            and receipt['signals'] == [] and receipt['descendant_cleanup'] is False, 'process completion differs')
    require(receipt['max_log_bytes'] == log_limit and set(receipt['outputs']) == {'stdout.log', 'stderr.log'}, 'process log roster differs')
    for name, value in receipt['outputs'].items():
        p = path / name
        require(value == {'bytes': p.stat().st_size, 'sha256': digest(p)}, 'process log identity differs')
    require(sum(v['bytes'] for v in receipt['outputs'].values()) <= log_limit, 'process logs exceed ceiling')
    usage = receipt['resource_usage']
    require(usage['scope'] == 'wait4_direct_child_and_waited_descendants', 'process cost scope differs')
    for name in ['user_cpu_seconds', 'system_cpu_seconds']:
        require(type(usage[name]) in [float, int] and math.isfinite(usage[name]) and usage[name] >= 0, 'CPU cost differs')
    require(type(usage['max_rss_bytes']) is int and usage['max_rss_bytes'] > 0, 'peak RSS differs')
    require(type(receipt['total_wall_ns']) is int and 0 < receipt['total_wall_ns'] <= (seconds + 6) * 1e9, 'wall duration differs')
    return {'cpu_seconds': usage['user_cpu_seconds'] + usage['system_cpu_seconds'],
            'wall_ns': receipt['total_wall_ns'], 'peak_rss_bytes': usage['max_rss_bytes']}


def trace(result, row, roster, family, arm):
    require(isinstance(result, dict), 'predictor result differs')
    base = {'schema', 'arm', 'prediction', 'reason', 'operation', 'operands', 'exact_result', 'unit', 'work'}
    allowed = base | {'selected_series'} | ({'route'} if arm != 'calculator_v1' else set())
    require(base <= set(result) <= allowed, 'predictor result fields differ')
    if arm != 'calculator_v1': require(result.get('route') in ['legacy', 'single_year'], 'predictor route differs')
    schema = 'ilxyr.feral_evidence_calculator.v1' if arm == 'calculator_v1' else 'ilxyr.feral_evidence_calculator.v2'
    require(result['schema'] == schema and result['arm'] == ('operand_only' if arm == 'v2_operand_only' else 'calculator'), 'predictor identity differs')
    require(isinstance(result['reason'], str) and 0 < len(result['reason']) < 100, 'answer reason differs')
    require(isinstance(result['operands'], list) and len(result['operands']) <= 2, 'operand roster differs')
    evidence = dict(row['retrieved_evidence']); mappings = {v['evidence_id']: v for v in roster['source_mapping']}
    facts = {v['id']: v for v in family['facts']}; selected = []
    for cell in result['operands']:
        require(set(cell) == {'evidence_id', 'label', 'year', 'value', 'unit', 'span', 'text'}, 'operand fields differ')
        require(cell['evidence_id'] in evidence and cell['evidence_id'] in mappings, 'operand evidence identity differs')
        mapping = mappings[cell['evidence_id']]; fact = facts[mapping['fact_id']]; text = evidence[cell['evidence_id']]
        # The sealed preparation normalizes one fact into one sentence. Its amount is the final span.
        span = [text.index('$'), len(text)]
        require(cell['span'] == span and cell['text'] == text[span[0]:span[1]], 'operand source span differs')
        require(cell['label'] == fact['label'] and cell['year'] == mapping['presented_year'], 'operand source label or period differs')
        require(fraction(cell['value']) == fraction(fact['value']) and cell['unit'] == fact['unit'], 'operand source value or unit differs')
        selected.append(fact['id'])
    work = result['work']
    require(set(work) == {'evidence_rows', 'parsed_cells', 'series_scored', 'arithmetic_operations'}, 'work fields differ')
    require(all(type(v) is int and v >= 0 for v in work.values()), 'work count differs')
    require(work['evidence_rows'] == len(evidence), 'evidence row count differs')
    early = result['reason'] in ['question_needs_distinct_years', 'unsupported_question_shape']
    require(work['parsed_cells'] == (0 if early else len(evidence)), 'parsed cell count differs')
    labels = {' '.join(facts[v['fact_id']]['label'].lower().split()) for v in mappings.values()}
    single = result.get('route') == 'single_year'
    operand_labels = [' '.join(c['label'].lower().split()) for c in result['operands']]
    if single:
        chosen = result['selected_series']; require(isinstance(chosen, list) and len(chosen) <= 2, 'selected series differ')
        require(len(set(chosen)) == len(chosen) and all(v in labels for v in chosen), 'selected series source differs')
        require(chosen[:len(operand_labels)] == operand_labels, 'selected series differs from source operands')
        require(len(chosen) == len(operand_labels) + int(result['reason'] in ['missing_requested_year', 'conflicting_values']), 'selected series completion differs')
        attempts = len(chosen) + int(result['reason'] in ['missing_matching_series', 'ambiguous_series', 'same_series'])
        require(work['series_scored'] == len(labels) * attempts, 'series scoring count differs')
    else:
        if 'selected_series' in result:
            require(isinstance(result['selected_series'], str) and result['selected_series'] in labels, 'selected series source differs')
            require(all(label == result['selected_series'] for label in operand_labels), 'selected series differs from source operands')
        require(work['series_scored'] == (0 if early else len(labels)), 'series scoring count differs')
    answered = result['prediction'] is not None
    if not answered:
        require(result['exact_result'] is None and result['unit'] is None and result['reason'] != 'answered', 'abstention output differs')
        require(work['arithmetic_operations'] == 0, 'abstention arithmetic work differs')
        return {'numeric': False, 'selected_source_fact_ids': selected}
    require(result['reason'] == 'answered' and result['operands'], 'numeric answer needs operands')
    values = [fraction(v['value']) for v in result['operands']]
    units = {v['unit'] for v in result['operands']}; require(len(units) == 1, 'operand units differ')
    unit = next(iter(units)); operation = result['operation']; operations = 0
    if arm == 'v2_operand_only':
        exact = values[-1]
    elif operation == 'lookup':
        require(len(values) == 1, 'lookup operand count differs'); exact = values[0]
    elif operation in ['ratio', 'percent_of']:
        require(len(values) == 2 and values[1] != 0, 'ratio operands differ')
        exact = values[0] / values[1]; unit = 'ratio'; operations = 1
        if operation == 'percent_of': exact *= 100; unit = 'percent'; operations = 2
    elif operation in ['change', 'difference', 'percent_change']:
        require(len(values) == 2, 'difference operand count differs')
        exact = values[1] - values[0] if operation != 'difference' else values[0] - values[1]; operations = 1
        if operation == 'percent_change':
            require(values[0] != 0, 'percentage denominator differs'); exact = exact / values[0] * 100; unit = 'percent'; operations = 3
        if operation == 'difference' and 'difference in percentage cumulative total shareholder return' in row['question'].lower(): unit = 'percentage_points'
    else:
        require(operation in ['sum', 'average'], 'arithmetic operation differs')
        exact = sum(values); operations = len(values) - 1
        if operation == 'average': exact /= len(values); operations += 1
    require(fraction(result['exact_result']) == exact and result['unit'] == unit, 'reported arithmetic differs')
    require(work['arithmetic_operations'] == operations, 'arithmetic work count differs')
    printed = rounded(exact) + ('%' if unit == 'percent' else '')
    require(result['prediction'] == printed, 'printed answer differs from exact result')
    return {'numeric': True, 'rounded_value': rounded(exact), 'unit': unit, 'selected_source_fact_ids': selected}


def score(result, checked, target):
    if checked['numeric']:
        correct = target['kind'] == 'numeric' and checked['rounded_value'] == target['rounded_value'] and checked['unit'] == target['unit']
        return 'correct_numeric' if correct else 'wrong_numeric'
    return 'correct_abstention' if target['kind'] == 'abstention' else 'incorrect_abstention'


def counts(rows):
    outcomes = Counter(r['outcome'] for r in rows)
    value = {k: outcomes[k] for k in ['correct_numeric', 'wrong_numeric', 'correct_abstention', 'incorrect_abstention']}
    value['cases'] = len(rows); value['answerable_cases'] = sum(r['target_kind'] == 'numeric' for r in rows)
    numeric = value['correct_numeric'] + value['wrong_numeric']
    value['numeric_answer_coverage'] = str(Fraction(numeric, len(rows))) if rows else None
    value['correct_numeric_coverage'] = str(Fraction(value['correct_numeric'], value['answerable_cases'])) if value['answerable_cases'] else None
    value['numeric_precision'] = str(Fraction(value['correct_numeric'], numeric)) if numeric else None
    return value


def summary(rows, jobs, mode):
    arms = {}
    for arm in study.ARMS:
        selected = [r for r in rows if r['arm'] == arm]; breakdowns = {}
        for key in ['company', 'family', 'form', 'style', 'mutation']:
            breakdowns[key] = {v: counts([r for r in selected if r[key] == v]) for v in sorted({r[key] for r in selected})}
        costs = [j['cost'] for j in jobs if j['arm'] == arm]
        arms[arm] = {'counts': counts(selected), 'breakdowns': breakdowns,
            'processes': len(costs), 'whole_worker_cpu_seconds': sum(c['cpu_seconds'] for c in costs),
            'whole_worker_wall_ns': sum(c['wall_ns'] for c in costs), 'maximum_worker_peak_rss_bytes': max(c['peak_rss_bytes'] for c in costs)}
    comparisons = {}; benefit = True
    for style in ['canonical', 'paraphrase']:
        macro = {}
        for arm in study.ARMS:
            selected = [r for r in rows if r['arm'] == arm and r['style'] == style]
            companies = sorted({r['company'] for r in selected}); rates = []
            for company in companies:
                c = counts([r for r in selected if r['company'] == company]); rates.append(Fraction(c['correct_numeric'], c['answerable_cases']))
            macro[arm] = sum(rates) / len(rates)
        for reference in ['calculator_v1', 'v2_operand_only']:
            candidate = {r['id']: r for r in rows if r['arm'] == 'calculator_v2' and r['style'] == style}
            ref = {r['id']: r for r in rows if r['arm'] == reference and r['style'] == style}
            transition = Counter(('correct' if candidate[k]['outcome'].startswith('correct_') else 'wrong') + '/' +
                                 ('correct' if ref[k]['outcome'].startswith('correct_') else 'wrong') for k in candidate)
            delta = macro['calculator_v2'] - macro[reference]
            wrong_ok = counts(list(candidate.values()))['wrong_numeric'] <= counts(list(ref.values()))['wrong_numeric']
            passed = delta >= Fraction(1, 10) and wrong_ok; benefit &= passed
            comparisons[style + '/' + reference] = {'candidate_company_macro_coverage': str(macro['calculator_v2']),
                'reference_company_macro_coverage': str(macro[reference]), 'coverage_delta': str(delta),
                'wrong_numeric_count_rule': wrong_ok, 'coverage_rule': delta >= Fraction(1, 10),
                'paired_correctness': dict(sorted(transition.items()))}
    candidate = [r for r in rows if r['arm'] == 'calculator_v2']; required = [r for r in candidate if r['target_kind'] == 'abstention']
    abstention_ok = all(r['outcome'] == 'correct_abstention' for r in required); benefit &= abstention_ok
    pairs = defaultdict(dict)
    for r in candidate: pairs[(r['family'], r['form'])][r['style']] = r
    style_changes = Counter(('correct' if p['canonical']['outcome'].startswith('correct_') else 'wrong') + '/' +
                            ('correct' if p['paraphrase']['outcome'].startswith('correct_') else 'wrong') for p in pairs.values())
    return {'arms': arms, 'comparisons': comparisons, 'required_abstentions': len(required),
            'all_required_abstentions_correct': abstention_ok, 'v2_canonical_paraphrase_pairs': dict(sorted(style_changes.items())),
            'primary_decision': 'opened_engineering' if mode == 'opened' else ('pass' if benefit else 'no_go'),
            'scope': 'invented engineering fixtures' if mode == 'opened' else 'fixed 228-case source-grounded coverage roster'}


def check(prepared, collected, expected_sha, verification):
    verification.mkdir(parents=True, exist_ok=False)
    status = {'status': 'failed', 'phase': 'bindings'}
    try:
        study.validate_prepared(prepared)
        require(digest(collected / 'SUPERVISOR.json') == expected_sha, 'supervisor identity differs')
        supervisor = load(collected / 'SUPERVISOR.json')
        require(supervisor['status'] == 'complete' and supervisor['stop_signal'] is None, 'supervisor incomplete')
        root = collected / 'study'; record = load(root / 'RUN.json'); mode = record['mode']
        require(record['schema'] == 'ilxyr.feral_coverage_run.v1', 'run schema differs')
        bound = study.limits(mode, record['execution'], prepared, check_host=False)
        require(record['implementation'] == study.bindings() and record['prepared_sha256'] == digest(prepared / 'BINDINGS.json'), 'run inputs or implementation differ')
        require(record['limits'] == bound, 'run limits differ')
        require(digest(root / 'COLLECTION.json') == supervisor['collection_sha256'], 'collection identity differs')
        require(load(root / 'COLLECTION.json')['files'] == study.inventory(root, ['COLLECTION.json']), 'collection inventory differs')
        require(sum(v['bytes'] for v in study.inventory(root).values()) <= bound['max_output_bytes'], 'collection byte ceiling exceeded')
        original = Path(record['output_root']); worker = Path(record['worker_root']); script = Path(record['script_root'])
        python = record['python_executable']; prior = Path(record['prepared_root'])
        command = [python, '-B', str(script / 'scripts/research_feral_coverage.py'), mode, '--worker', '--prepared', str(prior),
                   '--out', str(original), '--work', str(worker)]
        receipt = load(collected / 'controller-process/process.json')
        if mode == 'cloud':
            require(len(receipt['command']) == len(command) + 2 and receipt['command'][-2] == '--execution', 'cloud invocation differs')
            command += receipt['command'][-2:]
        require(digest(collected / 'controller-process/process.json') == supervisor['controller_receipt_sha256'], 'controller receipt differs')
        total = process_at(collected / 'controller-process', command, bound['total_seconds'], bound['max_log_bytes'])
        data = prepared / ('opened' if mode == 'opened' else 'fresh')
        require(study.inventory(root / 'data') == study.inventory(data), 'executed data differs')
        schedule = load(prepared / (mode + '-SCHEDULE.json')); require(load(root / 'SCHEDULE.json') == schedule, 'executed schedule differs')
        names = {'feral_coverage_worker.py': study.ROOT / 'scripts/feral_coverage_worker.py',
                 'feral_evidence_calculator.py': prepared / 'predictors/feral_evidence_calculator.py',
                 'feral_evidence_calculator_v2.py': prepared / 'predictors/feral_evidence_calculator_v2.py',
                 'INPUTS.jsonl': data / 'predictor/INPUTS.jsonl'}
        require(load(root / 'WORKER-FILES.json') == {n: {'bytes': p.stat().st_size, 'sha256': digest(p)} for n, p in names.items()}, 'worker files or target isolation differ')
        setup_commands = {'python': [python, '--version'], 'node': ['node', '--version']}
        if mode == 'cloud':
            setup_commands.update(source=[python, '-B', str(script / 'scripts/prepare_feral_fresh.py'), '--source-dir', str(prior / 'raw'), '--output', str(original / 'data')],
                                  arithmetic=['node', str(script / 'scripts/check_feral_fresh.mjs'), str(original / 'data'), study.PREPARE47])
        setup = {n: process_at(root / 'setup' / n, cmd, bound['job_seconds'], bound['max_log_bytes']) for n, cmd in setup_commands.items()}
        if mode == 'cloud':
            require((root / 'setup/node/stdout.log').read_text().strip() == record['execution']['node_identity'], 'saved Node identity differs')
            require(record['python_identity'] == record['execution']['python_identity'], 'saved cloud Python identity differs')
            require(load(root / 'setup/arithmetic/stdout.log')['status'] == 'verified', 'independent source arithmetic check differs')
        require((root / 'setup/python/stdout.log').read_text().strip() == 'Python ' + record['python_identity'], 'saved Python identity differs')
        inputs = [json.loads(s) for s in (data / 'predictor/INPUTS.jsonl').read_text().splitlines()]
        targets = {r['id']: r for r in (json.loads(s) for s in (data / 'grader/TARGETS.jsonl').read_text().splitlines())}
        roster = {r['id']: r for r in load(data / 'ROSTER.json')}; families = {f['id']: f for f in load(data / 'FAMILIES.json')}
        input_sha = digest(data / 'predictor/INPUTS.jsonl'); stable = {}; scored = []; jobs = []
        status['phase'] = 'predictions'
        for job in schedule['jobs']:
            name = f"jobs/{job['index']:04d}"; path = root / name
            command = [python, '-I', '-B', str(worker / 'feral_coverage_worker.py'), '--input', str(worker / 'INPUTS.jsonl'),
                       '--input-sha256', input_sha, '--arm', job['arm'], '--pass-index', str(job['pass']),
                       '--output', str(original / name / 'PREDICTIONS.jsonl'), '--byte-limit', str(bound['max_log_bytes'])]
            cost = process_at(path, command, bound['job_seconds'], bound['max_log_bytes']); jobs.append({**job, 'cost': cost})
            result_file = path / 'PREDICTIONS.jsonl'
            require(result_file.stat().st_size <= bound['max_log_bytes'], 'worker prediction ceiling exceeded')
            footer = load(path / 'stdout.log')
            require(footer == {'status': 'complete', 'arm': job['arm'], 'pass': job['pass'], 'cases': len(inputs),
                    'input_sha256': input_sha, 'output_sha256': digest(result_file), 'output_bytes': result_file.stat().st_size}, 'worker completion record differs')
            predictions = [json.loads(s) for s in result_file.read_text().splitlines()]
            require(len(predictions) == len(inputs), 'prediction count differs')
            for row, prediction in zip(inputs, predictions):
                require(set(prediction) == {'id', 'arm', 'pass', 'result'} and prediction['id'] == row['id']
                        and prediction['arm'] == job['arm'] and prediction['pass'] == job['pass'], 'prediction identity or order differs')
                r = roster[row['id']]; t = targets[row['id']]; result = prediction['result']
                checked = trace(result, row, r, families[r['family']], job['arm'])
                key = (job['arm'], row['id'])
                if key in stable:
                    require(stable[key] == result, 'repeated prediction, source trace or work differs')
                else:
                    stable[key] = result
                    scored.append({'arm': job['arm'], 'id': row['id'], **{k: r[k] for k in ['company', 'family', 'form', 'style', 'mutation']},
                         'target_kind': t['kind'], 'outcome': score(result, checked, t), 'reason': result['reason'],
                         'prediction': result['prediction'], 'expected': t, 'selected_source_fact_ids': checked['selected_source_fact_ids']})
        attempt = load(root / 'ATTEMPT.json'); calls = len(inputs) * len(jobs)
        expected_files = {'RUN.json', 'ATTEMPT.json', 'SCHEDULE.json', 'WORKER-FILES.json'}
        expected_files |= {'data/' + n for n in study.inventory(data)}
        expected_files |= {'setup/' + n + '/' + f for n in setup_commands for f in ['process.json', 'stdout.log', 'stderr.log']}
        expected_files |= {f"jobs/{j['index']:04d}/" + f for j in schedule['jobs'] for f in ['process.json', 'stdout.log', 'stderr.log', 'PREDICTIONS.jsonl']}
        require(set(study.inventory(root, ['COLLECTION.json'])) == expected_files, 'collection contains extra or missing files')
        require(attempt == {'status': 'complete', 'phase': 'complete', 'mode': mode, 'started_jobs': len(jobs), 'completed_jobs': len(jobs),
                'expected_jobs': len(jobs), 'predictor_calls': calls, 'fresh_predictor_calls': calls if mode == 'cloud' else 0, 'stop_signal': None}, 'controller completion counts differ')
        costs = list(setup.values()) + [j['cost'] for j in jobs]
        require(total['cpu_seconds'] + .0001 >= sum(c['cpu_seconds'] for c in costs), 'controller CPU excludes child work')
        require(total['wall_ns'] >= sum(c['wall_ns'] for c in costs), 'controller wall time excludes child work')
        encoded = '\n'.join(json.dumps({'arm': arm, 'id': identity, 'result': result}, sort_keys=True, separators=(',', ':'))
                            for (arm, identity), result in sorted(stable.items())) + '\n'
        (verification / 'SCORED.jsonl').write_text(''.join(json.dumps(v, sort_keys=True, separators=(',', ':')) + '\n' for v in scored))
        report = summary(scored, jobs, mode); save(verification / 'SUMMARY.json', report)
        status.update(status='verified_complete', phase='complete', mode=mode, cases=len(inputs), jobs=len(jobs),
            predictor_calls=calls, fresh_predictor_calls=calls if mode == 'cloud' else 0, distinct_results=len(stable),
            stable_rows_sha256=hashlib.sha256(encoded.encode()).hexdigest(), whole_controller_cost=total,
            setup_costs=setup, job_costs=jobs, summary=report)
        return status
    except BaseException as error:
        status['error'] = str(error)
        raise
    finally:
        save(verification / 'CHECK.json', status)


def supervise(prepared, collected, expected_sha, output):
    output.mkdir(parents=True, exist_ok=False); status = {'status': 'failed'}
    try:
        command = [sys.executable, '-B', str(Path(__file__).resolve()), '--worker', '--prepared', str(prepared),
                   '--collected', str(collected), '--supervisor-sha256', expected_sha, '--out', str(output / 'verified')]
        receipt = run_process(command, study.ROOT, output / 'checker-process', time.monotonic() + 15, 2, max_log_bytes=study.LIMITS['max_log_bytes'])
        status['checker_receipt_sha256'] = digest(output / 'checker-process/process.json')
        if (output / 'verified/CHECK.json').is_file(): status['check_sha256'] = digest(output / 'verified/CHECK.json')
        require(receipt['status'] == 'complete' and load(output / 'verified/CHECK.json')['status'] == 'verified_complete', 'collection checking failed; retained its process and verification record')
        status['status'] = 'verified_complete'; return status
    except BaseException as error:
        status['error'] = str(error)
        raise
    finally:
        save(output / 'VERIFICATION.json', status)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['prepared', 'collected', 'out']: p.add_argument('--' + name, type=Path, required=True)
    p.add_argument('--supervisor-sha256', required=True); p.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    a = p.parse_args(); fn = check if a.worker else supervise
    result = fn(a.prepared.resolve(), a.collected.resolve(), a.supervisor_sha256, a.out.resolve())
    print(json.dumps({'status': result['status']}, sort_keys=True))
