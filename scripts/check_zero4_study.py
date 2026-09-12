"""Replay ZERO.4 selection, coverage and costs; exercise a tiny native study."""
import argparse
import copy
import json
import math
import os
from pathlib import Path
import shutil
import statistics
import time
import traceback

from feral_process import digest, run_process, save
import zero4_study as study
import zero4_study_scores as scores
import zero4_window_data as windows

require = scores.require
load = scores.load


def cpu(receipt):
    usage = receipt.get('resource_usage')
    if usage is None:
        return 0
    require(all(scores.finite(usage[k]) for k in ['user_cpu_seconds', 'system_cpu_seconds', 'max_rss_bytes']), 'invalid process resources')
    return round(1000000 * (usage['user_cpu_seconds'] + usage['system_cpu_seconds']))


def guard_log(folder, state, cfg):
    if state['arm'] not in study.MODES:
        return
    rows = scores.jsonl(folder / 'attempts.jsonl')
    require([r['attempt'] for r in rows] == list(range(1, state['attempts'] + 1)), 'guard attempt coverage differs')
    committed, rejected = 0, 0
    for r in rows:
        require(r['mode'] == study.MODES[state['arm']] and r['phase'] == 'acquisition' and
                math.isclose(r['guard_budget'], cfg['training']['guard_budget'], rel_tol=1e-6), 'guard mode or limit differs')
        trials = r['backtrack_trials']
        require(1 <= len(trials) == r['backtrack_trial_count'] <= 8, 'guard trial count differs')
        baseline = r['cumulative_probe_baseline']
        require(scores.finite(baseline, 1e-12), 'invalid guard baseline')
        for i, trial in enumerate(trials):
            require(trial['index'] == i and trial['scale'] == 2 ** -i and
                    [s['replay_range'] for s in trial['ranges']] == list(range(6)), 'guard trial roster differs')
            values = [s['candidate'] for s in trial['ranges']]
            require(all(scores.finite(v, 1e-12) for v in values), 'nonfinite guard trial')
            mean = statistics.mean(values)
            require(math.isclose(mean, trial['candidate_mean'], rel_tol=2e-6) and
                    math.isclose(mean / baseline - 1, trial['relative_change'], abs_tol=2e-6), 'guard trial arithmetic differs')
            accepted = trial['decision'] == 'accept'
            require(accepted == (trial['relative_change'] <= cfg['training']['guard_budget'] + 1e-8), 'guard trial decision differs')
            require(not accepted or i == len(trials) - 1, 'guard continued after acceptance')
        accepted = r['decision'] == 'accept'
        require(accepted == (trials[-1]['decision'] == 'accept'), 'guard outer decision differs')
        committed += accepted
        rejected = 0 if accepted else rejected + 1
        require(r['committed_update'] == committed, 'guard committed count differs')
    if state['candidates'][-1]['attempts']:
        progress = state['candidates'][-1]['checkpoint']
        require(progress['committed'] == committed and progress['rejections'] == rejected, 'guard checkpoint state differs')


def read_endpoint(prepared, folder, cfg):
    packs = [windows.unpack((prepared / f'data/endpoint/{name}.z4w').read_bytes(), cfg['context'],
                             'foundation' if i == 0 else 'channel' if i == 5 else 'text')
             for i, name in enumerate(study.plan()['source_order'])]
    result = {'retention_rows': scores.jsonl(folder / 'retention.json.windows.jsonl')}
    result['retention'] = scores.retention(load(folder / 'retention.json'), result['retention_rows'], packs, cfg['context'])
    for name in ['task', 'blimp', 'tinystories']:
        rows = scores.jsonl(folder / (name + '.jsonl'))
        inputs = scores.tsv(prepared / ('data/' + name + '.tsv'))
        result[name + '_rows'] = rows
        result[name] = scores.task(rows, inputs) if name == 'task' else scores.language(rows, inputs, name)
    return result


def check(prepared, output, write=True):
    started = time.process_time_ns()
    verification = {'schema': 'ilxyr.zero4_study_check.v1', 'status': 'failed'}
    try:
        manifest = load(prepared / 'MANIFEST.json')
        cfg = study.validate(manifest, prepared)
        result, seal = load(output / 'RESULT.json'), load(output / 'SELECTION.json')
        states, processes = load(output / 'TRAINING.json'), load(output / 'PROCESSES.json')
        require(seal['manifest_sha256'] == digest(prepared / 'MANIFEST.json') and seal['training_sha256'] == digest(output / 'TRAINING.json'),
                'sealed input or training record differs')
        require(seal['training_cpu_us'] == cfg['training_cpu_us'], 'sealed CPU allowance differs')
        expected_owners = [(seed, arm) for index, seed in enumerate(cfg['seeds']) for arm in study.ARMS[index % 5:] + study.ARMS[:index % 5]]
        require([(s['seed'], s['arm']) for s in states] == expected_owners, 'training arm roster differs')
        require(seal['choices'] == [{k: s[k] for k in ['arm', 'seed', 'owner', 'status', 'selected']} for s in states], 'sealed choices differ')
        require([p['ordinal'] for p in processes] == list(range(len(processes))), 'process order differs')
        require([(p['owner'], p['stage']) for p in processes[:5]] == [('setup', 'compile-' + name) for name in ['lm', 'export', 'task', 'language', 'gold']],
                'setup process roster differs')
        require(all(p['owner'] != 'setup' and not p['stage'].startswith('compile-') for p in processes[5:]), 'unexpected setup process')
        seal_sha, receipts = digest(output / 'SELECTION.json'), []
        owner_costs = {s['owner']: {'training_cpu_us': 0, 'endpoint_cpu_us': 0, 'peak_child_rss_bytes': 0} for s in states}
        for p in processes:
            folder = output / p['path']
            require(folder.resolve().is_relative_to(output.resolve()), 'process folder leaves result root')
            receipt = load(folder / 'process.json')
            require(digest(folder / 'process.json') == p['receipt_sha256'], 'process receipt binding differs')
            require(p['status'] == receipt['status'], 'process status differs')
            for name, meta in receipt['outputs'].items():
                require(digest(folder / name) == meta['sha256'] and (folder / name).stat().st_size == meta['bytes'], 'process log differs')
            if p['ordinal'] < seal['processes_before_seal']:
                require(p['selection_sha256'] is None and (p['stage'] == 'training' or p['stage'].startswith('compile-')),
                        'endpoint executed before selection seal')
            else:
                require(p['selection_sha256'] == seal_sha and p['stage'] in ['export', 'retention', 'task', 'blimp', 'tinystories', 'exact-parser'],
                        'post-seal process or selection binding differs')
            require(receipt['command'][:1 + len(study.THREAD_ENV)] == ['env', *[k + '=' + v for k, v in study.THREAD_ENV.items()]], 'thread environment differs')
            receipts.append(receipt)
            value = cpu(receipt)
            if p['owner'] in owner_costs:
                costs = owner_costs[p['owner']]
                costs['training_cpu_us' if p['stage'] == 'training' else 'endpoint_cpu_us'] += value
                usage = receipt.get('resource_usage')
                if usage:
                    costs['peak_child_rss_bytes'] = max(costs['peak_child_rss_bytes'], usage['max_rss_bytes'])
        binary_record = load(output / 'BINARIES.json')
        require(set(binary_record) == {'lm', 'export', 'task', 'language', 'gold'}, 'binary roster differs')
        binaries = {k: study.bound(v, output) for k, v in binary_record.items()}
        endpoints, incomplete = {}, result['status'] != 'complete'
        for state in states:
            folder = output / state['owner']
            own = [p for p in processes if p['owner'] == state['owner']]
            training = [p for p in own if p['stage'] == 'training']
            offset = 0
            for p in training:
                expected_state = {**state, 'attempts': offset}
                command = ['env', *[k + '=' + v for k, v in study.THREAD_ENV.items()],
                           *map(str, study.training_args(prepared, binaries['lm'], cfg, expected_state, folder))]
                require(receipts[p['ordinal']]['command'] == command, 'training command differs')
                candidates = [c for c in state['candidates'] if c.get('process_ordinal') == p['ordinal']]
                if p['status'] == 'complete':
                    require(len(candidates) == 1, 'complete training process lacks its checkpoint')
                    offset = candidates[0]['attempts']
            require(state['candidates'][0] == {'attempts': 0, 'initial': True, 'training_cpu_us': 0,
                                               'model': study.binding(prepared / 'data/zero3.teacher', prepared)}, 'initial candidate differs')
            previous_cpu, previous_attempts = 0, 0
            for candidate in state['candidates'][1:]:
                progress = study.checkpoint(study.bound(candidate['model'], output))
                require(progress == candidate['checkpoint'] and candidate['attempts'] == progress['attempts'], 'candidate checkpoint differs')
                require(previous_attempts < candidate['attempts'] <= previous_attempts + cfg['training']['chunk_attempts'], 'candidate attempt progression differs')
                require(candidate['controller_cpu_us'] >= previous_cpu and candidate['controller_cpu_us'] <= state['controller_cpu_us'], 'candidate controller cost differs')
                child = sum(cpu(receipts[p['ordinal']]) for p in training if p['ordinal'] <= candidate['process_ordinal'])
                require(candidate['training_child_cpu_us'] == child and candidate['training_cpu_us'] == child + candidate['controller_cpu_us'],
                        'candidate CPU accounting differs')
                previous_cpu, previous_attempts = candidate['controller_cpu_us'], candidate['attempts']
            chosen = max((c for c in state['candidates'] if c['training_cpu_us'] <= cfg['training_cpu_us']), key=lambda c: c['attempts'])
            require(state['selected'] == chosen, 'selected checkpoint differs from fixed CPU rule')
            owner_costs[state['owner']].update(training_controller_cpu_us=state['controller_cpu_us'],
                                              selected_attempts=chosen['attempts'], selected_training_cpu_us=chosen['training_cpu_us'])
            if state['attempts']:
                study.verify_samples(folder, state, cfg, prepared)
                guard_log(folder, state, cfg)
            end = [p for p in own if p['stage'] != 'training']
            if any(p['status'] != 'complete' for p in training) or state['status'] == 'failed':
                incomplete = True
            if len(end) != 5 or any(p['status'] != 'complete' for p in end):
                incomplete = True
                continue
            require([p['stage'] for p in end] == ['export', 'retention', 'task', 'blimp', 'tinystories'], 'endpoint process roster differs')
            info = load(folder / 'ENDPOINT.json')
            require(info['model_sha256'] == chosen['model']['sha256'] and info['selection_sha256'] == seal_sha and
                    scores.finite(info['controller_cpu_us']), 'endpoint selected model differs')
            study.bound(info['quantized'], output)
            model = study.bound(chosen['model'], prepared if chosen['initial'] else output)
            expected = [
                [binaries['export'], model, folder / 'selected.litq8'],
                [binaries['lm'], '--init' if chosen['initial'] else '--resume', model, '--eval-only', '--tokens', '0',
                 '--tokenizer', prepared / 'data/literary.bpe', '--validation', '6', '--evaluation-json', folder / 'retention.json', *study.data_args(prepared, 'endpoint', cfg)],
                [binaries['task'], folder / 'selected.litq8', prepared / 'data/task.tsv', folder / 'task.jsonl'],
                *[[binaries['language'], folder / 'selected.litq8', prepared / ('data/' + name + '.tsv'), '--jsonl', folder / (name + '.jsonl')]
                  for name in ['blimp', 'tinystories']]]
            for p, command in zip(end, expected):
                require(receipts[p['ordinal']]['command'][1 + len(study.THREAD_ENV):] == list(map(str, command)), 'endpoint invocation differs')
            endpoints[state['seed'], state['arm']] = read_endpoint(prepared, folder, cfg)
            owner_costs[state['owner']].update(training_controller_cpu_us=state['controller_cpu_us'], endpoint_controller_cpu_us=info['controller_cpu_us'],
                                              selected_attempts=chosen['attempts'], selected_training_cpu_us=chosen['training_cpu_us'])
        for seed in cfg['seeds']:
            logs = [scores.jsonl(output / f'seed-{seed}-{arm}' / 'samples.jsonl') for arm in study.ARMS[2:]
                    if (output / f'seed-{seed}-{arm}' / 'samples.jsonl').exists()]
            common = min(map(len, logs), default=0)
            require(all(rows[:common] == logs[0][:common] for rows in logs), 'paired replay samples differ')
        gold = [p for p in processes if p['stage'] == 'exact-parser']
        gold_cases = None
        if len(gold) == 1 and gold[0]['status'] == 'complete':
            require(load(output / gold[0]['path'] / 'stdout.log') == {'native_gold_rows': cfg['counts']['task']}, 'exact parser coverage differs')
            require(receipts[gold[0]['ordinal']]['command'][1 + len(study.THREAD_ENV):] ==
                    [str(binaries['gold']), str(prepared / 'data/task.tsv')], 'exact parser invocation differs')
            gold_cases = cfg['counts']['task']
        else:
            incomplete = True
        child_cpu = sum(cpu(r) for r in receipts)
        require(sum(p.stat().st_size for p in output.rglob('*') if p.is_file()) <= cfg['limits']['max_output_bytes'], 'result output allowance exceeded')
        owner_controller = sum(s['controller_cpu_us'] + owner_costs[s['owner']].get('endpoint_controller_cpu_us', 0) for s in states)
        require(result['controller_cpu_us'] >= result['setup_controller_cpu_us'] + owner_controller, 'controller CPU split differs')
        verification.update(status='complete' if not incomplete else 'incomplete',
                            plan_sha256=study.PLAN_SHA, manifest_sha256=digest(prepared / 'MANIFEST.json'), selection_sha256=seal_sha,
                            endpoint_models=len(endpoints), exact_parser_cases=gold_cases,
                            decisions=scores.decisions(endpoints, cfg['seeds'], study.plan()['primary']) if not incomplete else None,
                            owners=owner_costs, total_child_cpu_us=child_cpu, controller_cpu_us=result['controller_cpu_us'],
                            setup_child_cpu_us=sum(cpu(r) for r in receipts[:5]), setup_controller_cpu_us=result['setup_controller_cpu_us'],
                            reference_child_cpu_us=sum(cpu(receipts[p['ordinal']]) for p in gold),
                            unassigned_controller_cpu_us=result['controller_cpu_us'] - result['setup_controller_cpu_us'] - owner_controller,
                            actual_cpu_us_before_replay=child_cpu + result['controller_cpu_us'],
                            child_wall_ns=sum(r['total_wall_ns'] for r in receipts), controller_wall_ns=result['controller_wall_ns'],
                            peak_child_rss_bytes=max((r['resource_usage']['max_rss_bytes'] for r in receipts if r.get('resource_usage')), default=None),
                            memory_scope='maximum wait4 peak of one child and waited descendants; controller peak and whole process-tree peak are separate cloud-host measurements',
                            summaries=[{'seed': seed, 'arm': arm, **{k: e[k] for k in ['retention', 'task', 'blimp', 'tinystories']}} for (seed, arm), e in endpoints.items()])
        require(result['process_count'] == len(processes), 'result process count differs')
        if result['status'] == 'complete':
            require(not incomplete, 'complete controller result has incomplete evidence')
        return verification
    except BaseException as error:
        verification['error'] = str(error)
        raise
    finally:
        verification['verification_cpu_us'] = round((time.process_time_ns() - started) / 1000)
        if 'actual_cpu_us_before_replay' in verification:
            verification['actual_cpu_us_with_replay'] = verification['actual_cpu_us_before_replay'] + verification['verification_cpu_us']
        if write:
            save(output / 'CHECK.json', verification)


def opened(source, output, git=False, cc='cc', sanitize=False):
    output.mkdir(parents=True, exist_ok=False)
    (output / 'implementation').mkdir()
    for name in study.IMPLEMENTATION:
        study.cp(study.ROOT / 'scripts' / name, output / 'implementation' / name)
    prepared = output / 'prepared'
    prepared.mkdir()
    study.prepare_source(source, prepared, git)
    data = prepared / 'data'
    data.mkdir()
    channel = [1, 81, 7, 97, 4, 2, 85, 120, 4, 2, 90, 3, 85, 6, 121, 4, 5]
    for i, name in enumerate(study.plan()['source_order']):
        kind = 'foundation' if i == 0 else 'channel' if i == 5 else 'text'
        tokens = [channel[:] if i == 5 else [97 + (i + j + t) % 26 for t in range(17)] for j in range(1 + i % 3)]
        for role in ['replay', 'endpoint']:
            rows = [[(t + 1 if role == 'endpoint' and 97 <= t < 122 else t) for t in row] for row in tokens]
            (data / role).mkdir(exist_ok=True)
            (data / role / (name + '.z4w')).write_bytes(windows.pack(rows, 16, kind, role))
    (data / 'train.tok').write_bytes(windows.token_bytes(channel * 40))
    (data / 'initial.tok').write_bytes(windows.token_bytes([97, 32, 98, 10] * 300))
    rows = [windows.prior.candidate('zero4-step43-opened', 'opened', op, 0, 0)[1]
            for op in ['add', 'multiply', 'add-rational', 'convert', 'solve-linear']]
    windows.prior.tsv(data / 'task.tsv', rows)
    header = 'id\tbenchmark\tgroup\tkind\tgold\tcontext\tchoice0\tchoice1\tchoice2\tchoice3\n'
    (data / 'blimp.tsv').write_text(header + 'opened/0\tblimp\topened\tpair\t0\t\t A cat runs.\t A cat run.\t\t\n'
                                  + 'opened/1\tblimp\topened\tpair\t0\t\t Birds fly.\t Birds flies.\t\t\n')
    (data / 'tinystories.tsv').write_text(header + 'opened/0\ttinystories\topened\trolling\t0\t\t A small cat sat.\t\t\t\n'
                                        + 'opened/1\ttinystories\topened\trolling\t0\t\t The bird came home.\t\t\t\n')
    study.cp(prepared / 'source/corpus/literary.bpe', data / 'literary.bpe')
    fixture = output / 'fixture'
    fixture.mkdir()
    processes = study.Processes(fixture, {**study.plan()['limits'], 'total_seconds': 180, 'child_seconds': 60})
    native = fixture / 'lm'
    study.build_native(prepared / 'source', fixture / 'windows.c')
    flags = study.FLAGS + ['-I', str(prepared / 'source'), '-I', str(study.ROOT / 'scripts')]
    if sanitize:
        os.environ['ASAN_OPTIONS'] = 'detect_leaks=0'
        os.environ['UBSAN_OPTIONS'] = 'halt_on_error=1'
        flags += ['-O1', '-fsanitize=address,undefined', '-fno-omit-frame-pointer']
    processes.run([cc, *flags, fixture / 'windows.c', '-o', native, '-lm'], prepared, 'fixture', 'compile')
    processes.run([cc, *flags, prepared / 'source/freeze_literary_teacher.c', '-o', fixture / 'freeze'], prepared, 'fixture', 'compile-freeze')
    processes.run([native, '--preset', 'literary', '--context', '16', '--dim', '8', '--heads', '2', '--layers', '1', '--ff', '16',
                   '--tokenizer', data / 'literary.bpe', '--text', data / 'initial.tok', '--steps', '1', '--tokens', '0', '--dropout', '0',
                   '--warmup', '0', '--seed', '5', '--report', '1', '--validation', '1', '--save', fixture / 'initial.ckpt'], prepared, 'fixture', 'initial')
    processes.run([fixture / 'freeze', fixture / 'initial.ckpt', data / 'zero3.teacher'], prepared, 'fixture', 'freeze')
    study.make_manifest(prepared, 'opened')
    study.run_study(prepared, output / 'study', cc, sanitize)
    # The historical window trainer and the new default must yield identical bytes.
    from build_zero4_window_source import build as old_build
    old_build(prepared / 'source', fixture / 'old.c')
    processes.run([cc, *flags, fixture / 'old.c', '-o', fixture / 'old-lm', '-lm'], prepared, 'fixture', 'compile-old')
    parity = {}
    cfg = load(prepared / 'MANIFEST.json')['config']
    for arm in study.ARMS[1:]:
        for name, exe in [('old', fixture / 'old-lm'), ('default', native)]:
            folder = fixture / (name + '-' + arm)
            folder.mkdir()
            state = {'attempts': 0, 'seed': 71, 'arm': arm}
            for offset in [0, 2]:
                state['attempts'] = offset
                args = [a for a in study.training_args(prepared, exe, cfg, state, folder) if a != '--controller-no-validation']
                processes.run(args, prepared, 'parity', name + '-' + arm + '-' + str(offset))
            current = output / 'study' / ('seed-71-' + arm)
            require(digest(folder / 'active.ckpt') == digest(current / 'checkpoint-000004.ckpt') and
                    (folder / 'samples.jsonl').read_bytes() == (current / 'samples.jsonl').read_bytes(), 'training-validation checkpoint or sample parity differs')
        parity[arm] = digest(output / 'study' / ('seed-71-' + arm) / 'checkpoint-000004.ckpt')
    # Compare every per-case aggregate with the historical evaluator on the same model.
    historical = fixture / 'quantity-legacy'
    processes.run([cc, *flags, '-DLITERARY_INFER_NO_MAIN', '-DFACULTY_CONTROLLER_NO_MAIN',
                   *[prepared / 'source' / n for n in ['quantity_request_eval.c', 'literary_infer.c', 'faculty_controller.c', 'quantity_oracle.c']],
                   '-o', historical, '-lm'], prepared, 'fixture', 'compile-legacy')
    for arm in study.ARMS:
        folder = output / 'study' / ('seed-71-' + arm)
        processes.run([historical, folder / 'selected.litq8', data / 'task.tsv', '--json', fixture / (arm + '.json'), '--jobs', '1'],
                      prepared, 'fixture', 'legacy-' + arm)
        old = load(fixture / (arm + '.json'))['quantity']
        new = scores.task(scores.jsonl(folder / 'task.jsonl'), scores.tsv(data / 'task.tsv'))
        require(all(old[k] == new[k] for k in ['cases', *scores.COUNTS]) and math.isclose(old['target_bits'], new['target_bits'], abs_tol=1e-8),
                'historical task evaluation differs')
    attacks = row_attacks(prepared, output / 'study')
    save(output / 'ROW-ATTACKS.json', attacks)
    # A completed over-budget chunk stays in custody while the frozen model is selected.
    budget_data = output / 'budget-prepared'
    shutil.copytree(prepared, budget_data)
    manifest = load(budget_data / 'MANIFEST.json')
    manifest['config']['training_cpu_us'] = 1
    save(budget_data / 'MANIFEST.json', manifest)
    study.run_study(budget_data, output / 'budget-study', cc, sanitize)
    budget_check = load(output / 'budget-study/CHECK.json')
    require(all(s['selected']['attempts'] == 0 for s in load(output / 'budget-study/TRAINING.json')) and
            all(s['status'] == 'training_budget_reached' for s in load(output / 'budget-study/TRAINING.json') if s['arm'] != 'frozen'), 'over-budget selection differs')
    require(sum(r['training_cpu_us'] for r in budget_check['owners'].values()) > 1, 'over-budget work disappeared from costs')
    # An invalid native training input keeps every failed process and the fallback model.
    failure_data = output / 'failure-prepared'
    shutil.copytree(prepared, failure_data)
    (failure_data / 'data/train.tok').write_bytes(windows.token_bytes([1, 97, 4]))
    manifest = load(failure_data / 'MANIFEST.json')
    manifest['files']['data/train.tok'] = study.binding(failure_data / 'data/train.tok', failure_data)
    save(failure_data / 'MANIFEST.json', manifest)
    failure = study.run_study(failure_data, output / 'failure-study', cc, sanitize)
    require(failure['status'] == 'failed' and load(output / 'failure-study/CHECK.json')['status'] == 'incomplete', 'failed comparison claimed completion')
    require(sum(s['status'] == 'failed' for s in load(output / 'failure-study/TRAINING.json')) == 4, 'failed training process coverage differs')
    report = {'schema': 'ilxyr.zero4_opened_study.v1', 'status': 'complete', 'production_teacher_forward_calls': 0,
              'historical_task_parity_models': 5, 'training_validation_parity': parity,
              'row_attacks': attacks, 'budget_check': budget_check, 'failure_check': load(output / 'failure-study/CHECK.json'),
              'check': load(output / 'study/CHECK.json'), 'sanitized': sanitize}
    save(output / 'OPENED.json', report)
    return report


def row_attacks(prepared, output):
    cfg = load(prepared / 'MANIFEST.json')['config']
    folder = output / 'seed-71-frozen'
    results = []

    def rejected(name, function, message):
        try:
            function()
        except ValueError as error:
            require(message in str(error), name + ': rejection came from another check')
            results.append({'case': name, 'status': 'rejected', 'error': str(error)})
        else:
            raise ValueError('altered record accepted: ' + name)

    task = scores.jsonl(folder / 'task.jsonl')
    inputs = scores.tsv(prepared / 'data/task.tsv')
    rejected('missing-task-case', lambda: scores.task(task[:-1], inputs), 'coverage')
    for name, field, value, reason in [('wrong-task-id', 'id', 'changed', 'identity'), ('boolean-task-count', 'closed', True, 'count'),
                                       ('invented-artifact', 'exact_artifact', 1, 'inconsistent'), ('oracle-failure', 'oracle_arithmetic', 0, 'control'),
                                       ('nonfinite-task-bits', 'target_bits', float('nan'), 'bits')]:
        changed = copy.deepcopy(task)
        changed[0][field] = value
        rejected(name, lambda changed=changed: scores.task(changed, inputs), reason)
    for name in ['blimp', 'tinystories']:
        rows, inputs = scores.jsonl(folder / (name + '.jsonl')), scores.tsv(prepared / ('data/' + name + '.tsv'))
        rejected('missing-' + name, lambda rows=rows, inputs=inputs, name=name: scores.language(rows[:-1], inputs, name), 'coverage')
        changed = copy.deepcopy(rows)
        changed[0]['scores'][0]['bytes'] += 1
        rejected('wrong-byte-count-' + name, lambda changed=changed, inputs=inputs, name=name: scores.language(changed, inputs, name), 'score')
    inputs = scores.tsv(prepared / 'data/blimp.tsv')
    changed = scores.jsonl(folder / 'blimp.jsonl')
    changed[0]['raw_prediction'] = 1 - changed[0]['raw_prediction']
    rejected('invented-language-prediction', lambda: scores.language(changed, inputs, 'blimp'), 'prediction')
    packs = [windows.unpack((prepared / f'data/endpoint/{name}.z4w').read_bytes(), cfg['context'],
                             'foundation' if i == 0 else 'channel' if i == 5 else 'text')
             for i, name in enumerate(study.plan()['source_order'])]
    summary, rows = load(folder / 'retention.json'), scores.jsonl(folder / 'retention.json.windows.jsonl')
    rejected('missing-retention-window', lambda: scores.retention(summary, rows[:-1], packs, cfg['context']), 'roster')
    changed = copy.deepcopy(rows)
    changed[0]['tokens_hash'] = '0' * 16
    rejected('changed-retention-input', lambda: scores.retention(summary, changed, packs, cfg['context']), 'input')
    changed_summary = copy.deepcopy(summary)
    changed_summary['ranges'][5]['loss'] *= 1.05
    rejected('invented-source-mean', lambda: scores.retention(changed_summary, rows, packs, cfg['context']), 'mean')
    changed_summary = copy.deepcopy(summary)
    changed_summary['learned_state_after'] = '0' * 16
    rejected('evaluation-state-mutation', lambda: scores.retention(changed_summary, rows, packs, cfg['context']), 'state')
    # Mutate a journal in place and restore its exact bytes after each read-only replay.
    journal = output / 'PROCESSES.json'
    original = journal.read_bytes()
    try:
        altered = json.loads(original)
        next(p for p in altered if p['stage'] == 'training')['stage'] = 'retention'
        save(journal, altered)
        rejected('endpoint-before-seal', lambda: check(prepared, output, write=False), 'before selection seal')
    finally:
        journal.write_bytes(original)
    # Rebind the edited receipt so the test reaches CPU arithmetic, not a hash mismatch.
    logs = json.loads(original)
    first = next(p for p in logs if p['stage'] == 'training')
    receipt_file = output / first['path'] / 'process.json'
    receipt_original = receipt_file.read_bytes()
    try:
        changed = json.loads(receipt_original)
        changed['resource_usage']['user_cpu_seconds'] += 1
        save(receipt_file, changed)
        first['receipt_sha256'] = digest(receipt_file)
        save(journal, logs)
        rejected('changed-training-cpu', lambda: check(prepared, output, write=False), 'candidate CPU accounting')
    finally:
        receipt_file.write_bytes(receipt_original)
        journal.write_bytes(original)
    training_file, seal_file = output / 'TRAINING.json', output / 'SELECTION.json'
    training_original, seal_original = training_file.read_bytes(), seal_file.read_bytes()
    try:
        states, seal = json.loads(training_original), json.loads(seal_original)
        states[0]['selected']['attempts'] = 1
        save(training_file, states)
        seal['training_sha256'] = digest(training_file)
        seal['choices'][0]['selected']['attempts'] = 1
        save(seal_file, seal)
        logs = json.loads(original)
        for p in logs[seal['processes_before_seal']:]:
            p['selection_sha256'] = digest(seal_file)
        save(journal, logs)
        rejected('changed-sealed-checkpoint-choice', lambda: check(prepared, output, write=False), 'selected checkpoint differs')
    finally:
        training_file.write_bytes(training_original)
        seal_file.write_bytes(seal_original)
        journal.write_bytes(original)
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path)
    parser.add_argument('--git', action='store_true')
    parser.add_argument('--prepared', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--cc', default='cc')
    parser.add_argument('--sanitize', action='store_true')
    args = parser.parse_args()
    try:
        result = opened(args.source.resolve(), args.out.resolve(), args.git, args.cc, args.sanitize) if args.source else check(args.prepared.resolve(), args.out.resolve())
    except BaseException as error:
        if args.source and args.out.exists():
            save(args.out / 'OPENED.json', {'status': 'failed', 'error': str(error), 'traceback': traceback.format_exc(), 'production_teacher_forward_calls': 0})
        raise
    print(json.dumps({'status': result['status']}))


if __name__ == '__main__':
    main()
