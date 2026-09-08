"""Check weight corpus output independently from its producer."""
import argparse
from array import array
from collections import Counter
import gzip
import hashlib
import heapq
import json
import math
from pathlib import Path, PurePosixPath
import re

from weight_source_kit import check_path, sha

MAX_JSON = 64 * 1024 * 1024
MAX_LINE = 64 * 1024


def require(condition, message):
    if not condition:
        raise ValueError(message)


def number(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def integer(value):
    return type(value) is int and abs(value) <= 9007199254740991


def close(left, right):
    return number(left) and number(right) and math.isclose(left, right, rel_tol=1e-12, abs_tol=1e-6)


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as source:
        for raw in iter(lambda: source.read(1024 * 1024), b''):
            value.update(raw)
    return value.hexdigest()


def path_in(root, name):
    check_path(name)
    path = root / name
    require(not any(part.is_symlink() for part in [path, *path.parents] if part != root.parent), 'result path is a link: ' + name)
    require(path.is_file() and path.resolve().is_relative_to(root.resolve()), 'result file is missing: ' + name)
    return path


def read_json(path):
    require(path.stat().st_size <= MAX_JSON, 'JSON file exceeds bound: ' + path.name)
    def reject(value):
        raise ValueError('nonfinite JSON number: ' + value)
    return json.loads(path.read_bytes(), parse_constant=reject)


def load_context(kit):
    # The caller verifies the immutable source-kit archive before this read.
    source = read_json(kit / 'experiments/research-step-33/SOURCE-PLAN.json')
    policy_raw = (kit / source['resource_policy_path']).read_bytes()
    require(sha(policy_raw) == source['resource_policy_sha256'], 'source policy hash differs')
    return {'policy': json.loads(policy_raw), 'policy_raw': policy_raw,
            'plan': read_json(kit / 'examples/weight-multiplicity/phase1-corpus-plan-v1.json'),
            'systems': read_json(kit / 'examples/weight-multiplicity/phase1-root-systems-v1.json')['systems']}


def trace_metrics(path, limits):
    groups = {name: {'latencies': array('d'), 'total_query_ms': 0.0, 'statuses': Counter(),
                     'label_ranges': Counter(), 'top': []} for name in ['setup', 'workload', 'all']}
    count = 0; work_count = 0; errors = []; hashed = hashlib.sha256()
    dispatches = bytearray(limits['oracle_calls'] + 1024)
    with path.open('rb') as source:
        while True:
            raw = source.readline(MAX_LINE + 1)
            if not raw:
                break
            hashed.update(raw)
            try:
                require(len(raw) <= MAX_LINE and raw.endswith(b'\n'), 'trace line is oversized or incomplete')
                row = json.loads(raw)
                require(row['sequence'] == count + 1, 'trace sequence differs')
                dispatch = row['dispatch_sequence']
                require(integer(dispatch) and 0 < dispatch < len(dispatches) and not dispatches[dispatch], 'trace dispatch differs')
                dispatches[dispatch] = 1
                phase = row['phase']; require(phase in ['setup', 'workload'], 'trace phase differs')
                require(not (phase == 'setup' and work_count), 'setup query follows workload')
                require(number(row['elapsed_ms']), 'trace latency differs')
                for field in ['status', 'worker_id', 'canonical_type', 'canonical_representation_id', 'slice_id', 'disposition']:
                    require(isinstance(row[field], str) and bool(row[field]), 'trace field differs: ' + field)
                for field in ['highest_weight', 'target_weight']:
                    require(isinstance(row[field], list) and 0 < len(row[field]) <= 8 and all(integer(v) for v in row[field]), 'trace weight differs')
                require(len(row['highest_weight']) == len(row['target_weight']), 'trace weight dimensions differ')
                value = row['multiplicity']
                require(value is None or isinstance(value, str) and re.fullmatch(r'0|[1-9][0-9]*', value), 'trace multiplicity differs')
                require(value is not None or row['status'] != 'ok', 'successful trace query lacks a value')
                value = None if value is None else int(value)
                label = 'unavailable' if value is None else 'inside_0_31' if value <= 31 else 'outside_above_31'
                require(row['label_range'] == label, 'trace label range differs')
                require(row['multiplicity_bit_length'] == (None if value is None else value.bit_length()), 'trace bit length differs')
                count += 1
                if phase == 'workload': work_count += 1
                for name in ['all', phase]:
                    group = groups[name]; group['latencies'].append(row['elapsed_ms']); group['total_query_ms'] += row['elapsed_ms']
                    group['statuses'][row['status']] += 1; group['label_ranges'][label] += 1
                    sequence = work_count if name == 'workload' else count
                    key = (row['elapsed_ms'], -sequence)
                    if len(group['top']) < 50 or key > group['top'][0][:2]:
                        item = dict(row)
                        if name == 'workload': item.update(trace_sequence=count, sequence=work_count)
                        entry = (*key, item)
                        if len(group['top']) < 50: heapq.heappush(group['top'], entry)
                        else: heapq.heapreplace(group['top'], entry)
            except (ValueError, KeyError, TypeError, OverflowError) as error:
                errors.append({'after_complete_rows': count, 'error': str(error)})
                for tail in iter(lambda: source.read(1024 * 1024), b''): hashed.update(tail)
                break
    summary = {'trace_sha256': hashed.hexdigest(), 'errors': errors, 'phases': {}}
    for name, group in groups.items():
        values = sorted(group['latencies']); n = len(values)
        summary['phases'][name] = {'calls': n, 'total_query_ms': group['total_query_ms'],
            'cumulative_p99_ms': values[(99 * n + 99) // 100 - 1] if n else None,
            'maximum_ms': values[-1] if n else None, 'statuses': dict(group['statuses']),
            'label_ranges': dict(group['label_ranges']), 'top_50': [r[2] for r in sorted(group['top'], key=lambda r: (-r[0], -r[1]))]}
    return summary


def check_accounting(saved, measured, limits, complete):
    require(saved['limits'] == limits, 'accounting limits differ')
    for name in ['calls', 'cumulative_p99_ms']:
        require(saved[name] == measured[name], 'accounting ' + name + ' differs')
    require(close(saved['total_query_ms'], measured['total_query_ms']), 'accounting query sum differs')
    require(number(saved['elapsed_wall_seconds']), 'accounting wall time differs')
    require(saved['top_50'] == measured['top_50'], 'accounting slowest queries differ')
    for label in ['status', 'label_range']:
        recorded = {entry['key']: entry['calls'] for entry in saved['breakdowns'][label]}
        require(recorded == measured['statuses' if label == 'status' else 'label_ranges'], 'accounting groups differ: ' + label)
    if complete:
        require(saved['complete_call_set'] is True and saved['hold'] is None, 'accounting call set is incomplete')
        require(measured['calls'] > 0 and measured['statuses'] == {'ok': measured['calls']}, 'accounting has failed calls')
        require(measured['maximum_ms'] < limits['hard_timeout_ms'], 'hard query timeout reached')
        for field, cap in [('calls', 'oracle_calls'), ('total_query_ms', 'total_query_ms'), ('cumulative_p99_ms', 'final_p99_ms')]:
            if limits[cap] is not None: require(measured[field] <= limits[cap], 'resource limit exceeded: ' + cap)
        if limits['elapsed_wall_seconds'] is not None:
            require(saved['elapsed_wall_seconds'] <= limits['elapsed_wall_seconds'], 'workload wall limit exceeded')


def check_memory(memory, plan):
    require(memory['failure'] is None and integer(memory['samples']) and memory['samples'] > 0, 'memory record is incomplete')
    require(memory['sample_interval_ms'] == plan['memory']['sample_interval_ms'], 'memory sampling differs')
    lie_ids = {f'lie-{i + 1}' for i in range(plan['oracle']['primary']['workers'])}
    zero_ids = {f'zero-{i + 1}' for i in range(plan['oracle']['differential']['workers'])}
    for name in ['lie_worker_baseline_rss_bytes', 'lie_worker_peak_rss_bytes', 'lie_worker_peak_incremental_rss_bytes']:
        require(set(memory[name]) == lie_ids and all(integer(v) and v >= 0 for v in memory[name].values()), 'LiE memory workers differ')
    for worker in lie_ids:
        baseline = memory['lie_worker_baseline_rss_bytes'][worker]; peak = memory['lie_worker_peak_rss_bytes'][worker]
        incremental = memory['lie_worker_peak_incremental_rss_bytes'][worker]
        require(baseline > 0 and peak >= baseline and incremental == peak - baseline, 'LiE memory arithmetic differs')
        require(incremental <= min(plan['memory']['sustained_divergence_stop_bytes_per_worker'], plan['memory']['formal_limit_bytes_per_worker']), 'LiE memory limit exceeded')
    peaks = memory['zero_worker_peak_rss_bytes']
    require(set(peaks) == zero_ids and all(integer(v) and v > 0 for v in peaks.values()), 'Zero memory workers differ')
    aggregate = memory['peak_aggregate_oracle_rss_bytes']
    require(integer(aggregate) and max([*memory['lie_worker_peak_rss_bytes'].values(), *peaks.values()]) <= aggregate <= plan['memory']['aggregate_worker_rss_stop_bytes'], 'aggregate memory differs')


def expected_partitions(plan):
    result = {}
    for name, spec in plan['partitions'].items():
        if name in ['exceptional_stratified', 'exceptional_unstratified']:
            for kind in ['G2', 'F4', 'E6', 'E7', 'E8']: result[name + '_' + kind] = spec['records_per_type']
        else: result[name] = spec['records']
    return result


def check_checksums(root):
    entries = {}
    for line in path_in(root, 'sha256sums.txt').read_text().splitlines():
        require(re.fullmatch(r'[0-9a-f]{64}  .+', line) is not None, 'checksum line differs')
        expected, name = line.split('  ', 1)
        require(name not in entries, 'duplicate checksum entry')
        require(digest(path_in(root, name)) == expected, 'result checksum differs: ' + name)
        entries[name] = expected
    return entries


def check_corpus(root, manifest, context, checksums):
    expected = expected_partitions(context['plan']); artifacts = manifest['partitions']
    require(len(artifacts) == len(expected) and {a['partition'] for a in artifacts} == set(expected), 'partition roster differs')
    seen_queries = {}; records_by_id = {}; targets = {}; total = 0
    for artifact in artifacts:
        name = artifact['partition']; require(artifact['records'] == expected[name], 'partition count differs: ' + name)
        require(artifact['file'] == name + '.ndjson.gz', 'partition filename differs')
        path = path_in(root, 'corpus/' + artifact['file'])
        require(checksums.get('corpus/' + artifact['file']) == artifact['gzip_sha256'], 'partition hash binding differs')
        require(path.stat().st_size == artifact['gzip_bytes'], 'partition compressed size differs')
        hashed = hashlib.sha256(); count = 0; size = 0
        strata = Counter({'0': 0, '1': 0, '2-7': 0, '8-31': 0, '>31': 0}); statuses = Counter({'dominant': 0, 'non_dominant': 0}); types = Counter()
        with gzip.open(path, 'rb') as source:
            while True:
                raw = source.readline(MAX_LINE + 1)
                if not raw: break
                require(len(raw) <= MAX_LINE and raw.endswith(b'\n'), 'corpus line is oversized or incomplete')
                size += len(raw); hashed.update(raw); count += 1
                require(count <= expected[name] and size <= artifact['uncompressed_bytes'], 'corpus expansion exceeds manifest')
                row = json.loads(raw); require(row['partition'] == name and row['id'] == f'{name}-{count:06d}', 'corpus row identity differs')
                value = row['multiplicity']; require(isinstance(value, str) and re.fullmatch(r'0|[1-9][0-9]*', value), 'corpus label differs')
                value = int(value); label = '0' if value == 0 else '1' if value == 1 else '2-7' if value <= 7 else '8-31' if value <= 31 else '>31'
                require(row['multiplicity_stratum'] == label and row['in_exact_range'] is (value <= 31), 'corpus label range differs')
                kind = row['canonical_type']; require(kind in context['systems'], 'corpus root system differs')
                rank = context['systems'][kind]['rank']; require(row['rank'] == rank, 'corpus rank differs')
                for field in ['highest_weight', 'target_weight']:
                    require(isinstance(row[field], list) and len(row[field]) == rank and all(integer(v) for v in row[field]), 'corpus weight differs')
                status = 'dominant' if all(v >= 0 for v in row['target_weight']) else 'non_dominant'
                require(row['target_status'] == status, 'target status differs')
                key = (kind, tuple(row['highest_weight']), tuple(row['target_weight']))
                require(key not in seen_queries, 'duplicate corpus query'); seen_queries[key] = (row['multiplicity'], row['canonical_representation_id'])
                require(row['id'] not in records_by_id, 'duplicate corpus id')
                records_by_id[row['id']] = (kind, row['multiplicity'], label, status)
                if name in ['cross_rank_stratified', 'acr2_transformed']:
                    targets[row['id']] = (tuple(row['highest_weight']), tuple(row['target_weight']), row['target_depth'])
                strata[label] += 1; statuses[status] += 1; types[kind] += 1
        require(count == expected[name] and size == artifact['uncompressed_bytes'] and hashed.hexdigest() == artifact['uncompressed_sha256'], 'partition uncompressed binding differs')
        require(dict(strata) == artifact['multiplicity_strata'] and dict(statuses) == artifact['target_statuses'] and dict(types) == artifact['per_type'], 'partition distribution differs')
        total += count
    require(total == manifest['total_records'] == manifest['unique_query_keys'] == sum(expected.values()), 'total corpus count differs')
    return total, records_by_id, seen_queries, targets


def check_query_labels(root, queries):
    matched = set()
    with path_in(root, 'evidence/oracle-attempts.jsonl').open('rb') as source:
        for raw in source:
            row = json.loads(raw)
            if row['phase'] != 'workload' or row['status'] != 'ok' or row['slice_id'].startswith('pilot:'):
                continue
            key = (row['canonical_type'], tuple(row['highest_weight']), tuple(row['target_weight']))
            if key in queries:
                require((row['multiplicity'], row['canonical_representation_id']) == queries[key], 'corpus label differs from oracle trace')
                matched.add(key)
    require(len(matched) == len(queries), 'corpus query is missing from workload trace')


def read_gzip_json(root, directory, record, name_field='file'):
    path = path_in(root, directory + '/' + record[name_field])
    with gzip.open(path, 'rb') as source:
        raw = source.read(MAX_JSON + 1)
    require(len(raw) <= MAX_JSON and sha(raw) == record['uncompressed_sha256'] and digest(path) == record['gzip_sha256'], 'compressed JSON binding differs')
    return json.loads(raw)


def check_differential(root, manifest, records, plan):
    saved = manifest['zero_differential']; value = read_gzip_json(root, 'evidence', saved, 'gzip_file')
    selected = value['records']; require(len(selected) == saved['selected'] and len({r['record_id'] for r in selected}) == len(selected), 'differential selection differs')
    counts = Counter()
    for row in selected:
        require(row['record_id'] in records, 'differential record missing from corpus')
        kind, label, stratum, target = records[row['record_id']]
        require((row['canonical_type'], row['lie_multiplicity'], row['multiplicity_stratum'], row['target_status']) == (kind, label, stratum, target), 'differential corpus binding differs')
        require(number(row['elapsed_ms']), 'differential latency differs')
        require(row['status'] in ['agreement', 'unavailable'], 'differential arithmetic disagreement')
        require(row['zero_multiplicity'] == (label if row['status'] == 'agreement' else None), 'differential value differs')
        counts[row['status']] += 1
    completed = counts['agreement']; unavailable = counts['unavailable']; n = len(selected)
    require(n > 0 and completed * 1000 >= n * plan['zero_sample']['minimum_completed_fraction_per_mille'], 'differential completion floor failed')
    for name, expected in {'selected': n, 'completed': completed, 'agreements': completed, 'disagreements': 0, 'unavailable': unavailable}.items():
        require(saved[name] == value[name] == expected, 'differential count differs: ' + name)
    require(close(saved['completion_fraction'], completed / n), 'differential fraction differs')
    return {'selected': n, 'completed': completed, 'unavailable': unavailable}


def check_result(root, context, process):
    root = root.resolve(); result = {'schema': 'ilxyr.weight_corpus_result_check.v1', 'status': 'incomplete_or_invalid', 'errors': [], 'corpus_accepted': False}
    try:
        policy = context['policy']; plan = context['plan']; limits = policy['limits']
        summary = read_json(path_in(root, 'runner-summary.json')); state = summary['status']
        require(state in ['hold', 'corpus_complete'], 'runner terminal state differs')
        require(path_in(root, 'evidence/resource-policy.json').read_bytes() == context['policy_raw'], 'executed resource policy differs')
        trace = trace_metrics(path_in(root, 'evidence/oracle-attempts.jsonl'), limits); result['trace'] = trace
        require(not trace['errors'], 'trace is incomplete or invalid')
        accounting = read_json(path_in(root, 'evidence/oracle-accounting.json'))
        require(accounting['trace_sha256'] == trace['trace_sha256'], 'trace hash differs')
        require(accounting['phase_calls'] == {p: trace['phases'][p]['calls'] for p in ['setup', 'workload']}, 'phase counts differ')
        full_limits = {key: value if key == 'hard_timeout_ms' else None for key, value in limits.items()}
        complete = state == 'corpus_complete'
        check_accounting(accounting, trace['phases']['all'], full_limits, complete)
        check_accounting(accounting['workload_accounting'], trace['phases']['workload'], limits, complete)
        checksums = check_checksums(root)
        common = {'evidence/resource-policy.json', 'evidence/oracle-attempts.jsonl', 'evidence/oracle-accounting.json', 'runner-summary.json'}
        require(common <= set(checksums), 'required evidence checksum missing')
        if not complete:
            hold = read_json(path_in(root, 'hold.json')); require(hold == summary and 'hold.json' in checksums, 'Hold terminal records differ')
            require(isinstance(hold['reason'], str) and bool(hold['reason']) and accounting['hold'] is not None, 'Hold reason is missing')
            for key, value in hold['oracle_accounting'].items(): require(accounting[key] == value, 'Hold accounting differs')
            require(hold['closures']['corpus_sealed'] is False, 'Hold corpus scope differs')
            require(not (root / 'corpus-manifest.json').exists(), 'Hold has a sealed corpus')
            require(process['exit_code'] in [1, 2] and process['stop_reason'] is None and not process['descendant_cleanup'], 'Hold process was interrupted')
            result.update(status='verified_hold', hold_reason=hold['reason'], partial_corpus_files=sorted(p.name for p in (root / 'corpus').glob('*') if p.is_file()))
            return result
        require(process['status'] == 'complete' and process['exit_code'] == 0 and process['stop_reason'] is None and not process['descendant_cleanup'], 'successful result has failed process')
        require(trace['phases']['setup']['calls'] == policy['lie_workers'], 'warmup count differs')
        require(accounting['status'] == 'accounting_complete' and accounting['workload_accounting']['status'] == 'resource_pass', 'final resource state differs')
        require(accounting['workload_accounting']['p99_decision_stage'] == 'final', 'p99 is provisional')
        manifest_raw = path_in(root, 'corpus-manifest.json').read_bytes(); manifest = json.loads(manifest_raw)
        require(manifest['status'] == 'sealed' and manifest['smoke'] is False, 'corpus manifest state differs')
        require(sha(manifest_raw) == summary['corpus_manifest_sha256'] == checksums.get('corpus-manifest.json'), 'manifest hash differs')
        bindings = manifest['source_bindings']
        for field, path in [('plan_sha256', 'examples/weight-multiplicity/phase1-corpus-plan-v1.json'), ('reduced_manifest_sha256', 'examples/weight-multiplicity/phase06-reduced-corpus-manifest-v1.json'), ('root_systems_sha256', 'examples/weight-multiplicity/phase1-root-systems-v1.json')]:
            require(bindings[field] == policy['source_bindings'][path], 'corpus source binding differs: ' + field)
        require(bindings['resource_policy_sha256'] == sha(context['policy_raw']), 'manifest resource policy differs')
        require(manifest['oracle_identity'] == {'lie_source_sha256': plan['oracle']['primary']['source_sha256'], 'zero_source_commit': plan['oracle']['differential']['source_commit']}, 'oracle identity differs')
        require(all(manifest['closures'][key] is False for key in ['model_training_authorized', 'model_evaluation_authorized', 'oracle_promotion_authorized']), 'corpus scope differs')
        frozen = read_json(path_in(root, 'evidence/frozen-budget.json'))
        require(digest(root / 'evidence/frozen-budget.json') == bindings['frozen_budget_sha256'] == summary['frozen_budget_sha256'], 'frozen budget hash differs')
        require(frozen['status'] == 'frozen_before_first_workload_query' and frozen['resource_policy_id'] == policy['id'] and frozen['workers'] == policy['lie_workers'], 'budget was frozen under a different rule')
        for key, limit in [('binding_call_limit', 'oracle_calls'), ('binding_query_ms_limit', 'total_query_ms'), ('binding_wall_seconds', 'elapsed_wall_seconds')]: require(frozen[key] == limits[limit], 'frozen budget differs: ' + key)
        evidence = read_json(path_in(root, 'evidence/generation-evidence.json'))
        require(evidence['status'] == 'corpus_complete' and evidence['smoke'] is False and evidence['corpus_manifest_sha256'] == sha(manifest_raw), 'generation evidence differs')
        check_memory(evidence['memory'], plan)
        total, records, queries, targets = check_corpus(root, manifest, context, checksums)
        check_query_labels(root, queries)
        require(total == policy['expected_corpus_records'] == summary['total_records'], 'frozen corpus size differs')
        result['differential'] = check_differential(root, manifest, records, plan)
        for key in ['selected', 'completed', 'agreements', 'disagreements', 'unavailable']:
            require(summary['zero_differential'][key] == evidence['zero_differential'][key] == manifest['zero_differential'][key], 'differential terminal count differs')
        required = common | {'corpus-manifest.json', 'evidence/generation-evidence.json', 'evidence/frozen-budget.json',
            'evidence/generation-progress.json', 'evidence/' + manifest['zero_differential']['gzip_file'],
            'corpus/' + manifest['acr2_control']['file']} | {'corpus/' + a['file'] for a in manifest['partitions']}
        require(set(checksums) == required, 'complete result checksum roster differs')
        control = read_gzip_json(root, 'corpus', manifest['acr2_control'])
        require(control['model_facing_pair_metadata'] is False and len(control['pairs']) == manifest['acr2_control']['pairs'] == plan['partitions']['acr2_transformed']['records'], 'ACR2 control size differs')
        transformed = set()
        for pair in control['pairs']:
            base = records.get(pair['base_record_id']); target = records.get(pair['transformed_record_id'])
            require(base is not None and target is not None and base[:3] == target[:3], 'ACR2 pair binding differs')
            require(pair['base_record_id'].startswith('cross_rank_stratified-') and pair['transformed_record_id'].startswith('acr2_transformed-'), 'ACR2 pair partition differs')
            require(pair['transformed_record_id'] not in transformed, 'duplicate ACR2 transformed record'); transformed.add(pair['transformed_record_id'])
            high, weight, depth = targets[pair['base_record_id']]
            target_high, target_weight, target_depth = targets[pair['transformed_record_id']]
            require(high == target_high and target[3] == 'non_dominant' and weight != target_weight, 'ACR2 target relation differs')
            cartan = context['systems'][base[0]]['cartan']; word = pair['weyl_word_zero_based_simple_reflections']
            require(len(word) == pair['coxeter_length'] and all(integer(i) and 0 <= i < len(weight) for i in word), 'ACR2 word differs')
            for simple in reversed(word):
                pairing = weight[simple]
                if depth is not None: depth += pairing
                weight = tuple(v - pairing * cartan[j][simple] for j, v in enumerate(weight))
            require(weight == target_weight and depth == target_depth, 'ACR2 reflected target differs')
        require(summary['oracle_calls'] == trace['phases']['workload']['calls'] and close(summary['oracle_query_ms'], trace['phases']['workload']['total_query_ms']), 'summary query accounting differs')
        result.update(status='verified_corpus', corpus_accepted=True, corpus_records=total, corpus_manifest_sha256=sha(manifest_raw))
    except (ValueError, KeyError, TypeError, OSError, OverflowError) as error:
        result['errors'].append(str(error))
    return result
