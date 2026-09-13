"""Independently replay selection and cost records from a saved native pilot."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path

FIELDS = ['candidate_draws', 'construction_failed', 'no_representation', 'query_exclusions',
          'orbit_exclusions', 'candidates_reserved', 'candidate_evaluations', 'oracle_calls',
          'oracle_failures', 'cache_hits', 'label_matches', 'stratum_rejections', 'quota_rejections', 'accepted_rows']
MAX_LINE = 65536


def require(ok, reason):
    if not ok:
        raise ValueError(reason)


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as source:
        for raw in iter(lambda: source.read(1048576), b''):
            h.update(raw)
    return h.hexdigest()


def load(path):
    path = Path(path)
    require(path.stat().st_size <= 64 * 1024 * 1024, 'JSON size limit')
    return json.loads(path.read_bytes())


def stratum(value):
    require(isinstance(value, str) and value.isascii() and value.isdigit() and
            (value == '0' or not value.startswith('0')) and len(value) <= 4096, 'invalid exact label')
    if value in ('0', '1'):
        return value
    if len(value) == 1 and value <= '7':
        return '2-7'
    return '8-31' if len(value) < 2 or len(value) == 2 and value <= '31' else '>31'


def geometry(candidate, representations, systems):
    rep = representations.get(candidate['canonical_representation_id'])
    require(rep is not None, 'representation outside the frozen roster')
    kind = candidate['canonical_type']; high = candidate['highest_weight']; target = candidate['target_weight']
    require(kind == rep['canonical_type'] and high == rep['highest_weight'], 'representation or highest weight differs')
    require(isinstance(target, list) and len(target) == len(high) and
            all(type(x) is int and abs(x) <= 9007199254740991 for x in target), 'target weight differs')
    require(candidate['target_status'] == ('non_dominant' if any(x < 0 for x in target) else 'dominant'), 'target status differs')
    key = kind + '\t' + ','.join(map(str, high)) + '\t' + ','.join(map(str, target))
    require(candidate['query_key'] == key, 'canonical query key differs')
    dominant = list(target); cartan = systems[kind]['cartan']
    for _ in range(4096):
        negative = next((i for i,x in enumerate(dominant) if x < 0), None)
        if negative is None:
            break
        pairing = dominant[negative]
        dominant = [x - pairing * cartan[i][negative] for i,x in enumerate(dominant)]
    else:
        raise ValueError('dominant orientation failed')
    dom_key = ','.join(map(str, dominant))
    require(candidate['dominant_target_key'] == dom_key, 'dominant orbit differs')
    return key, kind + '|' + candidate['canonical_representation_id'] + '|' + dom_key


def replay(events, result, config, representations, systems, oracle_value=None):
    """oracle_value independently binds each evaluation to its native call record."""
    requested = config['slices']; limits = config['limits']
    require(result['limits'] == limits, 'frozen pilot limits differ')
    require(result['mode'] == ('cached' if config['cache'] else 'uncached_control'), 'frozen cache mode differs')
    require(result['scheduling'] == ('rotate_unfinished_slices_each_batch' if config['rotate'] else 'original_fixed_start'), 'frozen scheduling differs')
    if 'oracle_sha256' in config:
        require(result['oracle_sha256'] == config['oracle_sha256'], 'frozen oracle contract differs')
    quotas = {s['desired'] + '|' + s['status']: s['required'] for s in requested}
    require(len(quotas) == len(requested), 'duplicate quota')
    counts = {key: Counter({field: 0 for field in FIELDS}) for key in quotas}
    selected = []; selected_keys = set(); selected_orbits = set(); selected_counts = Counter()
    reserved = {}; reserved_orbits = set(); evaluated = {}; evaluations = []; cache = {}; all_values = {}
    calls = 0; cache_payload = 0; held_pending = []; hold = None; rollback = False; sequence = 0; checkpoints = []; previous = {k: Counter() for k in quotas}
    draws_by_batch = Counter(); reserved_by_batch = Counter(); newest_batch = 0
    def bump(field, sid):
        counts[sid][field] += 1
    for event in events:
        sequence += 1
        require(event.get('sequence') == sequence, 'event sequence differs')
        kind = event['kind']; batch = event['batch']
        require(type(batch) is int and batch >= 0, 'event batch differs')
        require(hold is None or kind in ('release', 'checkpoint'), 'work follows a hold')
        require(not rollback or kind in ('release','hold','checkpoint'), 'work follows construction rollback')
        if kind == 'draw':
            require(1 <= batch and batch >= newest_batch and batch <= newest_batch + 1, 'draw batch order differs')
            if batch > newest_batch:
                require(not reserved, 'reservation survives into a later batch')
                newest_batch = batch
            sid = event['slice_id']; require(sid in quotas and selected_counts[sid] < quotas[sid], 'draw uses a completed quota')
            bump('candidate_draws', sid); draws_by_batch[batch] += 1
            outcome = event['outcome']
            if outcome in ('construction_failed', 'no_representation'):
                require('candidate' not in event, 'failed draw contains a candidate')
                bump(outcome, sid); continue
            candidate = event['candidate']; key, orbit = geometry(candidate, representations, systems)
            require(candidate['target_status'] == sid.split('|')[1], 'draw slice status differs')
            used_key = key in selected_keys or key in reserved
            used_orbit = orbit in selected_orbits or orbit in reserved_orbits
            if outcome == 'query_exclusions':
                require(used_key, 'query exclusion lacks a used query'); bump(outcome, sid)
            elif outcome == 'orbit_exclusions':
                require(not used_key and used_orbit, 'orbit exclusion differs'); bump(outcome, sid)
            else:
                require(outcome == 'reserved' and not used_key and not used_orbit, 'query reservation differs')
                reserved[key] = (candidate, orbit, sid, batch); reserved_orbits.add(orbit)
                reserved_by_batch[batch] += 1; bump('candidates_reserved', sid)
        elif kind == 'evaluation':
            key = event['query_key']; require(key in reserved and key not in evaluated, 'evaluation lacks a fresh reservation')
            require(key == next(k for k in reserved if k not in evaluated), 'evaluation order differs')
            candidate, _, sid, source_batch = reserved[key]
            require(batch == source_batch and event['slice_id'] == sid, 'evaluation slice or batch differs')
            value = event.get('multiplicity'); source = event['source']; source_sequence = event['source_query_sequence']
            require(type(source_sequence) is int and source_sequence > 0, 'source query sequence differs')
            if source == 'oracle':
                calls += 1; require(source_sequence == calls, 'new-call sequence differs'); bump('oracle_calls', sid)
                if result['mode'] == 'cached':
                    frozen = config['cache_limits']
                    require(key not in cache, 'new call repeats a cached query')
                    require(len(cache) < frozen['maxEntries'] and cache_payload + len(key.encode()) + frozen.get('maxValueBytes',4096) <= frozen['maxPayloadBytes'], 'new call exceeds cache reserve')
                if oracle_value:
                    oracle_value(event, candidate)
                if event['status'] == 'failed':
                    bump('oracle_failures', sid); evaluated[key] = event; evaluations.append(event); continue
                require(event['status'] == 'ok', 'oracle status differs')
                stratum(value)
                require(key not in all_values or all_values[key] == value, 'inconsistent exact oracle label')
                all_values[key] = value
                if result['mode'] == 'cached':
                    cache[key] = (value, source_sequence); cache_payload += len(key.encode()) + len(value)
            else:
                require(source == 'cache' and result['mode'] == 'cached' and
                        cache.get(key) == (value, source_sequence), 'cache provenance differs')
                require(event['status'] == 'ok', 'cached status differs'); bump('cache_hits', sid)
            require(event['observed_stratum'] == stratum(value), 'observed stratum differs')
            bump('candidate_evaluations', sid); evaluated[key] = event; evaluations.append(event)
        elif kind == 'selection':
            key = event['query_key']; require(key in reserved and key in evaluated, 'selection lacks a completed evaluation')
            require(key == next(iter(reserved)) and all(k in evaluated for k in reserved), 'selection precedes completed batch or changes order')
            candidate, orbit, sid, source_batch = reserved[key]; evaluation = evaluated[key]
            require(batch == source_batch and evaluation['status'] == 'ok', 'selection batch or oracle status differs')
            match = stratum(evaluation['multiplicity']) == sid.split('|')[0]
            if match:
                bump('label_matches', sid)
            expected = 'stratum_rejections' if not match else 'quota_rejections' if selected_counts[sid] >= quotas[sid] else 'accepted'
            outcome = event['outcome']
            if outcome == 'occupancy_limit':
                require(expected == 'accepted' and len(selected) == limits['maxAcceptedRows'], 'occupancy stop differs')
                continue
            require(outcome == expected, 'selection decision differs')
            if outcome == 'accepted':
                bump('accepted_rows', sid); selected_counts[sid] += 1; selected_keys.add(key); selected_orbits.add(orbit)
                selected.append({'query_key':key,'orbit_key':orbit,'canonical_type':candidate['canonical_type'],
                                 'highest_weight':candidate['highest_weight'],'target_weight':candidate['target_weight'],
                                 'target_status':candidate['target_status'],'multiplicity':evaluation['multiplicity'],
                                 'slice_id':sid,'source_query_sequence':evaluation['source_query_sequence']})
            else:
                bump(outcome, sid)
            evaluation['disposition'] = outcome
            del reserved[key]; reserved_orbits.remove(orbit); del evaluated[key]
        elif kind == 'release':
            key = event['query_key']; require(key in reserved, 'release lacks a reservation')
            _, orbit, _, source_batch = reserved.pop(key); require(batch == source_batch, 'release batch differs')
            reserved_orbits.remove(orbit)
            if key in evaluated:
                if evaluated[key].get('disposition') == 'pending_batch':
                    evaluated[key]['disposition'] = 'uncommitted_at_hold'
                del evaluated[key]
            require(event['reason'] in ('incomplete_batch','incomplete_batch_construction'), 'release reason differs')
            if event['reason'] == 'incomplete_batch_construction':
                require(hold is None and not evaluated, 'construction rollback follows evaluation'); rollback = True
            else:
                require(hold is not None, 'batch released before its hold')
        elif kind == 'hold':
            require(hold is None, 'duplicate hold'); hold = event['reason']; held_pending = [k for k in reserved if k not in evaluated]
        elif kind == 'checkpoint':
            require(not reserved and event['accepted_rows'] == len(selected), 'checkpoint has pending rows or wrong count')
            require([s['id'] for s in event['slices']] == list(quotas), 'checkpoint slice roster differs')
            for record in event['slices']:
                sid = record['id']; require(sid in quotas, 'checkpoint slice differs')
                delta = {field: counts[sid][field] - previous[sid][field] for field in FIELDS}
                require(all(record.get(field) == value for field,value in delta.items()), 'checkpoint cost counters differ')
                remaining = quotas[sid] - selected_counts[sid]
                require(record['accepted'] == selected_counts[sid] and record['remaining'] == remaining, 'checkpoint occupancy differs')
                rate = delta['accepted_rows'] / delta['candidate_draws'] if delta['candidate_draws'] else None
                forecast = ((remaining * delta['oracle_calls'] + delta['accepted_rows'] - 1) // delta['accepted_rows']
                            if delta['accepted_rows'] and delta['oracle_calls'] else None)
                require(record['new_rows_per_draw'] == rate and record['calls_for_remaining_at_block_rate'] == forecast, 'checkpoint projection differs')
                previous[sid] = counts[sid].copy()
            checkpoints.append({k:v for k,v in event.items() if k not in ('kind','sequence')})
        else:
            raise ValueError('unknown event kind: ' + kind)
    require(not reserved and not reserved_orbits and not evaluated, 'unfinished reservations at trace end')
    require(selected == result['accepted'], 'retained rows differ')
    totals = {field: sum(c[field] for c in counts.values()) for field in FIELDS}
    require(totals == result['totals'] and {k:dict(v) for k,v in counts.items()} == result['by_slice'], 'final cost counters differ')
    require(result['selected_queries'] == len(selected_keys) and result['selected_orbits'] == len(selected_orbits), 'final selection state differs')
    require(checkpoints == result['checkpoints'], 'saved checkpoints differ')
    require(len(evaluations) == len(result['evaluations']), 'saved evaluation roster differs')
    # Evaluation dictionaries above share the trace event object used by selection.
    for saved, event in zip(result['evaluations'], evaluations):
        source = {k:v for k,v in event.items() if k not in ('kind','sequence','batch')}
        require(source == saved, 'saved evaluation differs')
    require(hold == result['hold'] and result['status'] == ('hold' if hold else 'requested_quotas_reached'), 'terminal state differs')
    require(result['candidate_support']['status'] == 'unknown', 'sampled support claim differs')
    if hold is None:
        require(all(selected_counts[sid] == q for sid,q in quotas.items()), 'completion lacks required rows')
    require([dict(desired=s['desired'], status=s['status'], required=s['required'], id=s['id'], accepted=s['accepted'], attempts=s['attempts']) for s in result['slices']] ==
            [dict(**s, id=s['desired']+'|'+s['status'], accepted=selected_counts[s['desired']+'|'+s['status']], attempts=counts[s['desired']+'|'+s['status']]['candidates_reserved']) for s in requested], 'saved slice state differs')
    require(totals['candidate_draws'] <= limits['maxDraws'] and calls <= limits['maxOracleCalls'] and
            totals['candidate_evaluations'] <= limits['maxEvaluations'] and len(selected) <= limits['maxAcceptedRows'], 'pilot limit exceeded')
    if hold:
        rules = {'candidate_draw_limit': totals['candidate_draws'] == limits['maxDraws'],
                 'oracle_call_limit': calls == limits['maxOracleCalls'],
                 'evaluation_limit': totals['candidate_evaluations'] == limits['maxEvaluations'],
                 'pilot_occupancy_limit': len(selected) == limits['maxAcceptedRows'],
                 'batch_limit': checkpoints[-1]['batch'] == limits['maxBatches'],
                 'candidate_generation_exhausted': reserved_by_batch[newest_batch] == 0 and draws_by_batch[newest_batch] == limits['batchSize']*100,
                 'oracle_failure': totals['oracle_failures'] > 0,
                 'invalid_oracle_result': totals['oracle_failures'] > 0,
                 'cache_capacity': result['mode'] == 'cached' and bool(held_pending) and (len(cache) >= config['cache_limits']['maxEntries'] or cache_payload + len(held_pending[0].encode()) + config['cache_limits'].get('maxValueBytes',4096) > config['cache_limits']['maxPayloadBytes'])}
        require(hold in rules and rules[hold], 'hold reason lacks its limiting condition')
    if result['mode'] == 'cached':
        snapshot = result['cache']; frozen = config['cache_limits']
        for field, key in [('max_entries','maxEntries'),('max_payload_bytes','maxPayloadBytes'),('max_key_bytes','maxKeyBytes'),('max_value_bytes','maxValueBytes')]:
            require(snapshot[field] == frozen.get(key, {'maxKeyBytes':512,'maxValueBytes':4096}.get(key)), 'frozen cache limit differs')
        require(snapshot['oracle_sha256'] == result['oracle_sha256'], 'cache oracle identity differs')
        payload = sum(len(k.encode())+len(v[0]) for k,v in cache.items())
        slots = 2
        while slots < 2 * snapshot['max_entries']:
            slots *= 2
        require(snapshot['entries'] == len(cache) and snapshot['used_payload_bytes'] == payload and
                snapshot['allocated_buffer_bytes'] == snapshot['max_payload_bytes'] + 16*snapshot['max_entries'] + 4*slots, 'cache storage counters differ')
        require(len(cache) <= snapshot['max_entries'] and payload <= snapshot['max_payload_bytes'], 'cache storage limit exceeded')
    else:
        require(result['mode'] == 'uncached_control' and result['cache'] is None, 'cache mode differs')
    return {'status':'verified_selection_and_accounting','events':sequence,'oracle_calls':calls,
            'cache_hits':totals['cache_hits'],'accepted_rows':len(selected),'hold':hold}


def check(trace, result_path, manifest_path, systems_path, config, expected_hash):
    result = load(result_path); manifest = load(manifest_path); systems = load(systems_path)['systems']
    reps = {r['canonical_id']:r for r in manifest['representations']}
    hashed = hashlib.sha256()
    def events():
        with Path(trace).open('rb') as stream:
            while True:
                raw = stream.readline(MAX_LINE + 1)
                if not raw:
                    break
                require(len(raw) <= MAX_LINE and raw.endswith(b'\n'), 'oversized or incomplete event')
                hashed.update(raw); yield json.loads(raw)
    verified = replay(events(), result, config, reps, systems)
    require(hashed.hexdigest() == expected_hash, 'event trace hash differs')
    return {**verified, 'trace_sha256':hashed.hexdigest(), 'native_identity_and_labels':'requires_native_call_layer'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['trace','result','manifest','systems','config','output']:
        parser.add_argument('--'+name, type=Path, required=True)
    parser.add_argument('--trace-sha256', required=True); args = parser.parse_args()
    value = check(args.trace,args.result,args.manifest,args.systems,load(args.config),args.trace_sha256)
    with args.output.open('x') as stream:
        json.dump(value,stream,indent=2,sort_keys=True); stream.write('\n')
    print(json.dumps(value,sort_keys=True))
