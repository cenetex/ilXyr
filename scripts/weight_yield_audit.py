"""Audit a saved weight trace and partial corpus with zero oracle calls."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re

MAX_LINE = 65536
STRATA = ('0', '1', '2-7', '8-31', '>31')


def require(ok, message):
    if not ok:
        raise ValueError(message)


def encode(value):
    return (json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + '\n').encode()


def stratum(value):
    require(isinstance(value, str) and re.fullmatch(r'0|[1-9][0-9]*', value), 'invalid multiplicity')
    # Only compare short decimal strings: labels may exceed machine integer range.
    if value in ('0', '1'):
        return value
    if len(value) == 1 and value <= '7':
        return '2-7'
    return '8-31' if len(value) < 2 or len(value) == 2 and value <= '31' else '>31'


def identity(row):
    kind = row['canonical_type']
    require(isinstance(kind, str) and re.fullmatch(r'[A-G][1-8]', kind), 'invalid type')
    weights = [row['highest_weight'], row['target_weight']]
    for values in weights:
        require(isinstance(values, list) and 1 <= len(values) <= 8
                and all(type(v) is int and abs(v) <= 9007199254740991 for v in values), 'invalid weight')
    require(len(weights[0]) == len(weights[1]) == int(kind[1]), 'weight rank differs')
    return kind + '\t' + '\t'.join(','.join(map(str, values)) for values in weights)


def rows(path, hashed):
    with Path(path).open('rb') as stream:
        while True:
            raw = stream.readline(MAX_LINE + 1)
            if not raw:
                return
            require(len(raw) <= MAX_LINE and raw.endswith(b'\n'), 'oversized or incomplete line')
            hashed.update(raw)
            yield json.loads(raw)


def audit(trace, corpus, expected_trace_sha, *, max_calls=3000000, max_unique=500000,
          max_group_keys=1500000, block_calls=250000):
    require(all(type(v) is int and v > 0 for v in (max_calls, max_unique, max_group_keys, block_calls)), 'invalid bounds')
    corpus_hash = hashlib.sha256(); corpus_records = {}; corpus_counts = Counter()
    for row in rows(corpus, corpus_hash):
        key = identity(row)
        require(key not in corpus_records, 'duplicate corpus query')
        require(len(corpus_records) < max_unique, 'corpus unique bound reached')
        label = stratum(row['multiplicity'])
        require(label == row['multiplicity_stratum'] and label != '>31', 'corpus label differs')
        require(row['partition'] == 'training', 'audit requires partial training corpus')
        require(row['target_status'] in ('dominant', 'non_dominant'), 'invalid corpus target status')
        corpus_records[key] = (row['multiplicity'], label, row['target_status'])
        corpus_counts[label + '|' + row['target_status']] += 1
    trace_hash = hashlib.sha256(); calls = 0; generation_calls = 0; group_keys = 0
    all_seen = {}; generation_seen = set(); selected_seen = set(); groups = {}; blocks = {}
    dispatches = bytearray(max_calls + 1); phase_counts = Counter(); dispositions = Counter()
    for row in rows(trace, trace_hash):
        calls += 1
        require(calls <= max_calls, 'trace call bound reached')
        require(type(row['sequence']) is int and row['sequence'] == calls, 'trace sequence differs')
        dispatch = row['dispatch_sequence']
        require(type(dispatch) is int and 1 <= dispatch <= max_calls and not dispatches[dispatch], 'trace dispatch differs')
        dispatches[dispatch] = 1
        phase = row['phase']; slice_id = row['slice_id']
        require(phase in ('setup', 'workload') and isinstance(slice_id, str) and len(slice_id) <= 200, 'trace phase or slice differs')
        require(phase != 'setup' or not phase_counts['workload'], 'setup follows workload')
        require(row['status'] == 'ok', 'oracle failure needs separate audit')
        value = row['multiplicity']; observed = stratum(value); key = identity(row)
        if key in all_seen:
            require(all_seen[key] == value, 'same query has conflicting labels')
        else:
            require(len(all_seen) < max_unique, 'trace unique bound reached')
            all_seen[key] = value
        desired = row['desired_stratum']; status = row['target_status']
        require(status in ('dominant', 'non_dominant'), 'invalid trace target status')
        pilot = slice_id.startswith('pilot:')
        require(phase == 'setup' or desired in STRATA[:-1], 'invalid desired stratum')
        expected_disposition = ('warmup' if phase == 'setup' else 'pilot_observation' if pilot
                                else 'candidate_for_selection' if observed == desired else 'stratum_mismatch')
        require(row['disposition'] == expected_disposition, 'trace disposition differs')
        phase_counts[phase] += 1; dispositions[expected_disposition] += 1
        group_id = f'{slice_id}|{desired}|{status}'
        if group_id not in groups:
            require(len(groups) < 200, 'slice bound reached')
            groups[group_id] = {'slice_id': slice_id, 'desired_stratum': desired, 'target_status': status,
                                'counts': Counter(), 'observed': Counter(), 'keys': set(), 'types': Counter()}
        group = groups[group_id]; count = group['counts']
        count['calls'] += 1; group['observed'][observed] += 1; group['types'][row['canonical_type']] += 1
        new_in_group = key not in group['keys']
        if new_in_group:
            group_keys += 1
            require(group_keys <= max_group_keys, 'group unique bound reached')
            group['keys'].add(key)
        matching = observed == desired
        count['matching_calls'] += matching
        count['unique_matching_queries'] += new_in_group and matching
        if phase == 'workload' and not pilot:
            require(slice_id == 'training', 'audit requires generation in training only')
            generation_calls += 1
            repeated = key in generation_seen
            generation_seen.add(key)
            count['repeated_generation_calls'] += repeated
            count['repeated_mismatch_calls'] += repeated and not matching
            selected = matching and key in corpus_records
            if selected:
                require(corpus_records[key] == (value, observed, status), 'corpus and trace label or status differs')
                require(key not in selected_seen, 'selected corpus query appears twice as a match')
                selected_seen.add(key)
            count['corpus_records'] += selected
            block = blocks.setdefault((generation_calls - 1) // block_calls, Counter())
            block['calls'] += 1; block['matching_calls'] += matching; block['corpus_records'] += selected
            block['nonzero_corpus_records'] += selected and observed != '0'
            block['repeated_calls'] += repeated
    require(trace_hash.hexdigest() == expected_trace_sha, 'trace hash differs')
    require(all(dispatches[1:calls + 1]) and not any(dispatches[calls + 1:]), 'dispatch set incomplete')
    require(len(selected_seen) == len(corpus_records), 'corpus query missing from successful matching trace')
    result_groups = []
    for _, group in sorted(groups.items()):
        count = dict(group['counts'])
        count['unique_queries'] = len(group['keys'])
        count['matching_fraction'] = count.get('matching_calls', 0) / count['calls']
        result_groups.append({k:v for k,v in group.items() if k not in ('counts', 'keys')} | count)
    generation = [g for g in result_groups if g['slice_id'] == 'training']
    return {'schema': 'ilxyr.weight_yield_audit.v1', 'status': 'saved_trace_verified', 'new_oracle_calls': 0,
            'scope': 'Read-only diagnosis of the opened partial training run. Query candidates rejected before dispatch and orbit occupancy are absent from this trace.',
            'trace_sha256': trace_hash.hexdigest(), 'corpus_sha256': corpus_hash.hexdigest(),
            'trace_calls': calls, 'phase_calls': dict(phase_counts), 'dispositions': dict(dispositions),
            'unique_queries_all_phases': len(all_seen), 'generation_calls': generation_calls,
            'unique_generation_queries': len(generation_seen),
            'repeated_generation_calls': generation_calls - len(generation_seen),
            'repeated_generation_mismatch_calls': sum(g['repeated_mismatch_calls'] for g in generation),
            'corpus_records': len(corpus_records), 'corpus_records_by_slice': dict(sorted(corpus_counts.items())),
            'generation_matching_calls': sum(g['matching_calls'] for g in generation),
            'bounds': {'max_calls': max_calls, 'max_unique': max_unique, 'max_group_keys': max_group_keys},
            'groups': result_groups,
            'generation_blocks': [{'index': n, 'first_generation_call': n * block_calls + 1,
                'last_generation_call': n * block_calls + c['calls'], **dict(c)} for n,c in sorted(blocks.items())]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ('trace', 'corpus', 'output'):
        parser.add_argument('--' + key, type=Path, required=True)
    parser.add_argument('--trace-sha256', required=True)
    args = parser.parse_args()
    result = audit(args.trace, args.corpus, args.trace_sha256)
    with args.output.open('xb') as target:
        target.write(encode(result))
    print(json.dumps({k:v for k,v in result.items() if k not in ('groups','generation_blocks')}))


if __name__ == '__main__':
    main()
