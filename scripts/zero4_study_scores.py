"""Check complete endpoint rows and apply the frozen ZERO.4 outcome rules."""
import csv
import json
import math
import re
import statistics

import zero4_window_data as windows

COUNTS = ['closed', 'syntax', 'operation', 'arguments', 'exact_request',
          'oracle_arithmetic', 'committed', 'exact_artifact', 'rejected',
          'rejected_state_mutations']


def require(ok, message):
    if not ok:
        raise ValueError(message)


def load(path):
    return json.loads(path.read_bytes())


def jsonl(path):
    return [json.loads(line) for line in path.read_text().splitlines()]


def tsv(path):
    with path.open() as stream:
        return list(csv.DictReader(stream, delimiter='\t'))


def finite(value, minimum=0):
    return type(value) in (int, float) and math.isfinite(value) and value >= minimum


def retention(summary, rows, packs, context):
    require(summary['schema'] == 'zero.literary_eval.v3', 'retention schema differs')
    require(all(type(summary[k]) is int for k in ['context', 'requested_validation_batches', 'evaluated_windows', 'validation_batches']) and
            summary['context'] == context and summary['requested_validation_batches'] == 6,
            'retention invocation differs')
    require(re.fullmatch('[0-9a-f]{16}', summary['learned_state_before']) is not None and
            summary['learned_state_before'] == summary['learned_state_after'], 'evaluation changed learned state')
    require(len(packs) == len(summary['ranges']) == 6, 'retention source roster differs')
    expected = [(i, j) for i, pack in enumerate(packs) for j in range(len(pack))]
    require(all(type(r['range']) is int and type(r['window']) is int for r in rows) and
            [(r['range'], r['window']) for r in rows] == expected, 'retention window roster differs')
    require(summary['evaluated_windows'] == summary['validation_batches'] == len(rows), 'retention coverage differs')
    losses = []
    for i, (pack, group) in enumerate(zip(packs, summary['ranges'])):
        require(all(type(group[k]) is int for k in ['index', 'channel', 'foundation', 'windows']) and
                group['index'] == i and group['channel'] == int(i == 5) and group['foundation'] == int(i == 0)
                and group['weight'] == 1 and group['windows'] == len(pack), 'retention source identity differs')
        values = [r for r in rows if r['range'] == i]
        for r, tokens in zip(values, pack):
            require(r['tokens_hash'] == windows.fnv(tokens) and r['targets'] == windows.targets(tokens, i == 5)
                    and type(r['targets']) is int and r['targets'] > 0, 'retention window input differs')
            require(finite(r['loss'], 1e-12), 'invalid retention window loss')
        mean = statistics.mean(r['loss'] for r in values)
        require(finite(group['loss'], 1e-12) and math.isclose(mean, group['loss'], rel_tol=2e-6), 'retention source mean differs')
        losses.append(mean)
    require(finite(summary['loss'], 1e-12) and math.isclose(statistics.mean(losses), summary['loss'], rel_tol=2e-6),
            'retention equal-source mean differs')
    return losses


def task(rows, inputs):
    require(len(rows) == len(inputs) > 0, 'task coverage differs')
    require(len({r['id'] for r in inputs}) == len(inputs), 'duplicate task input id')
    for i, (r, item) in enumerate(zip(rows, inputs)):
        require(r['schema'] == 'ilxyr.zero4_task_case.v1' and type(r['ordinal']) is int and r['ordinal'] == i and r['id'] == item['id'],
                'task case identity differs')
        require(type(r['cases']) is int and type(r['operation_only']) is int and r['cases'] == r['operation_only'] == 1, 'task case mode differs')
        require(all(type(r[k]) is int and r[k] in (0, 1) for k in COUNTS), 'invalid task count')
        require(r['oracle_arithmetic'] == r['arguments'] == 1, 'exact task control failed')
        require(r['syntax'] <= r['closed'] and r['exact_request'] <= r['operation'] <= r['syntax'] and
                r['exact_artifact'] <= r['committed'] <= r['syntax'] and
                r['rejected_state_mutations'] <= r['rejected'] and r['rejected'] + r['committed'] <= 1,
                'inconsistent task counts')
        require(finite(r['target_bits']), 'invalid task bits')
    return {'cases': len(rows), **{k: sum(r[k] for r in rows) for k in COUNTS},
            'target_bits': statistics.mean(r['target_bits'] for r in rows)}


def language(rows, inputs, name):
    require(len(rows) == len(inputs) > 0, 'language coverage differs')
    require(len({r['id'] for r in inputs}) == len(inputs), 'duplicate language input id')
    for i, (r, item) in enumerate(zip(rows, inputs)):
        require(r['schema'] == 'zero.external_eval_case_result.v1' and type(r['ordinal']) is int and r['ordinal'] == i and
                all(r[k] == item[k] for k in ['id', 'benchmark', 'group', 'kind']) and r['gold'] == int(item['gold']),
                'language case identity differs')
        count = 2 if name == 'blimp' else 1
        require(r['kind'] == ('pair' if name == 'blimp' else 'rolling') and r['benchmark'] == name and
                len(r['scores']) == count, 'language case kind differs')
        for j, score in enumerate(r['scores']):
            require(finite(score['bits']) and type(score['bytes']) is int and
                    score['bytes'] == len(item['choice' + str(j)].encode('utf-8')) > 0 and
                    type(score['greedy_exact']) is bool, 'invalid language score')
        raw = min(range(count), key=lambda j: r['scores'][j]['bits'])
        normalized = min(range(count), key=lambda j: r['scores'][j]['bits'] / r['scores'][j]['bytes'])
        require(type(r['raw_prediction']) is int and type(r['normalized_prediction']) is int and
                r['raw_prediction'] == raw and r['normalized_prediction'] == normalized, 'language prediction differs')
    return {'cases': len(rows), 'correct': sum(r['raw_prediction'] == r['gold'] for r in rows),
            'bits_per_byte': sum(r['scores'][0]['bits'] for r in rows) / sum(r['scores'][0]['bytes'] for r in rows)}


def paired(values):
    return {'mean': statistics.mean(values), 'standard_error': statistics.stdev(values) / math.sqrt(len(values)) if len(values) > 1 else None,
            'count': len(values)}


def compare(endpoint, baseline, limits):
    source_changes = []
    for i, maximum in enumerate(limits['source_relative_loss_limits']):
        before = [r['loss'] for r in baseline['retention_rows'] if r['range'] == i]
        after = [r['loss'] for r in endpoint['retention_rows'] if r['range'] == i]
        relative = statistics.mean(after) / statistics.mean(before) - 1
        source_changes.append({'index': i, 'relative_change': relative, 'maximum': maximum,
                               'passes': relative <= maximum, 'paired_loss_change': paired([a - b for a, b in zip(after, before)])})
    task_changes = [a['exact_artifact'] - b['exact_artifact'] for a, b in zip(endpoint['task_rows'], baseline['task_rows'])]
    blimp_changes = [int(a['raw_prediction'] == a['gold']) - int(b['raw_prediction'] == b['gold'])
                     for a, b in zip(endpoint['blimp_rows'], baseline['blimp_rows'])]
    tiny_changes = [a['scores'][0]['bits'] / a['scores'][0]['bytes'] - b['scores'][0]['bits'] / b['scores'][0]['bytes']
                    for a, b in zip(endpoint['tinystories_rows'], baseline['tinystories_rows'])]
    tiny_relative = endpoint['tinystories']['bits_per_byte'] / baseline['tinystories']['bits_per_byte'] - 1
    return {'sources': source_changes, 'task_change': paired(task_changes), 'blimp_change': paired(blimp_changes),
            'tinystories_case_change': paired(tiny_changes), 'tinystories_relative_change': tiny_relative,
            'retention_passes': all(r['passes'] for r in source_changes),
            'blimp_passes': statistics.mean(blimp_changes) >= -limits['blimp_accuracy_drop_limit'],
            'tinystories_passes': tiny_relative <= limits['tinystories_relative_bits_per_byte_limit']}


def decisions(endpoints, seeds, primary):
    result = []
    for arm in primary['candidate_arms']:
        rows = []
        for seed in seeds:
            model = endpoints[seed, arm]
            changes = compare(model, endpoints[seed, 'frozen'], primary)
            gains = {ref: (model['task']['exact_artifact'] - endpoints[seed, ref]['task']['exact_artifact']) / model['task']['cases']
                     for ref in primary['references']}
            rows.append({'seed': seed, 'changes': changes, 'task_gains': gains,
                         'passes': all(gain >= primary['task_gain_fraction'] for gain in gains.values()) and
                         all(changes[key] for key in ['retention_passes', 'blimp_passes', 'tinystories_passes'])})
        mutations = sum(e['task']['rejected_state_mutations'] for e in endpoints.values())
        result.append({'arm': arm, 'seeds': rows, 'passes': all(r['passes'] for r in rows) and mutations == 0})
    return result
