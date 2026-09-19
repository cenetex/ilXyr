"""Bind pilot evaluations to independently checked native process calls."""
from collections import Counter
import hashlib
import json
import math
from pathlib import Path

from weight_pilot_check import require, stratum, MAX_LINE, load, sha, replay


def parse_key(key):
    parts = key.split('\t'); require(len(parts) == 3, 'native query key differs')
    kind = parts[0]
    require(len(kind) == 2 and kind[0] in 'ABCDEFG' and kind[1] in '12345678', 'native type differs')
    vectors = []
    for raw in parts[1:]:
        values = raw.split(',')
        require(len(values) == int(kind[1]) and all(x == str(int(x)) and abs(int(x)) <= 9007199254740991 for x in values), 'native coordinates differ')
        vectors.append([int(x) for x in values])
    return kind, *vectors


class NativeCalls:
    def __init__(self, path, contract):
        require(Path(path).stat().st_size <= 64*1024*1024, 'native trace size limit')
        self.contract = contract; self.primary = {}; self.secondary = {}; self.callbacks = set()
        self.calls = []; self.hash = hashlib.sha256(); active = None; sequence = 0; call_number = 0
        with Path(path).open('rb') as stream:
            while True:
                raw = stream.readline(MAX_LINE + 1)
                if not raw:
                    break
                require(len(raw) <= MAX_LINE and raw.endswith(b'\n'), 'native event size or termination differs')
                self.hash.update(raw); row = json.loads(raw); sequence += 1
                require(row['sequence'] == sequence, 'native event sequence differs')
                if row['kind'] == 'start':
                    require(set(row) == {'sequence','kind','call_id','oracle','phase','query_key','source_query_sequence','input'} | ({'slice_id'} if row['phase']=='workload' else set()), 'native start fields differ')
                    call_number += 1
                    require(active is None and row['call_id'] == call_number, 'native call order differs')
                    kind, high, target = parse_key(row['query_key'])
                    if row['oracle'] == 'lie':
                        order = contract['coordinate_mapping'].get(kind)
                        a = [high[i] for i in order] if order else high
                        b = [target[i] for i in order] if order else target
                        expected = 'dom_char(['+','.join(map(str,a))+'],['+','.join(map(str,b))+'],'+kind+')'
                        require(row['input'] == expected, 'primary input mapping differs')
                    else:
                        require(row['oracle'] == 'zero' and row['input'] == ['query',kind,','.join(map(str,high)),','.join(map(str,target))], 'differential input mapping differs')
                    require(row['phase'] in ('setup','workload'), 'native phase differs')
                    require((row['phase']=='setup') == (call_number==1), 'warmup order differs')
                    if row['oracle']=='zero':
                        require(self.calls and self.calls[-1]['oracle']=='lie' and self.calls[-1]['phase']=='workload' and self.calls[-1]['source_query_sequence']==row['source_query_sequence'], 'differential call order differs')
                    active = row
                else:
                    require(set(row) == {'sequence','kind','call_id','status','multiplicity','elapsed_ms'}, 'native finish fields differ')
                    require(row['kind'] == 'finish' and active is not None and row['call_id'] == active['call_id'], 'native return lacks its call')
                    require(type(row['elapsed_ms']) in (int,float) and math.isfinite(row['elapsed_ms']) and row['elapsed_ms'] >= 0, 'native elapsed time differs')
                    if row['status'] == 'ok':
                        stratum(row['multiplicity'])
                        require(row['elapsed_ms'] < contract['hard_query_timeout_ms'], 'successful query exceeds timeout')
                    else:
                        require(isinstance(row['status'],str) and row['status'] and row.get('multiplicity') is None, 'failed native call contains a usable value')
                    complete = active | {k:v for k,v in row.items() if k not in ('kind','sequence')}
                    self.calls.append(complete)
                    if complete['phase'] == 'setup':
                        require(complete['oracle'] == 'lie' and complete['source_query_sequence'] == 0 and
                                complete['query_key'] == 'A1\t1\t1' and complete['status'] == 'ok' and complete['multiplicity'] == '1', 'warmup differs')
                    else:
                        source = self.primary if complete['oracle']=='lie' else self.secondary
                        number = complete['source_query_sequence']
                        require(type(number) is int and number > 0 and number not in source, 'native source sequence differs')
                        source[number] = complete
                    active = None
        require(active is None, 'native call still pending')
        require(sum(c['phase']=='setup' for c in self.calls) == 1, 'one native warmup required')
        require(list(self.primary) == list(range(1,len(self.primary)+1)), 'native primary sequence has a gap')
        self.covered = set(); self.selected = set()

    def evaluation(self, event, candidate):
        number = event['source_query_sequence']; require(number in self.primary, 'evaluation lacks native primary call')
        require(number not in self.callbacks, 'native primary reused as a new call'); self.callbacks.add(number)
        primary = self.primary[number]
        require(primary['query_key'] == candidate['query_key'] and primary['slice_id'] == event['slice_id'], 'native primary identity differs')
        failure = None
        if primary['status'] != 'ok':
            failure = 'primary_oracle_failure'
        else:
            triple = (candidate['canonical_type'],event['slice_id'])
            sampled = triple not in self.covered or int(hashlib.sha256(candidate['query_key'].encode()).hexdigest(),16) % self.contract['differential_sample_every'] == 0
            self.covered.add(triple)
            if sampled:
                self.selected.add(number); require(number in self.secondary, 'selected differential call is absent')
                secondary = self.secondary[number]
                require(secondary['query_key'] == candidate['query_key'] and secondary['slice_id'] == event['slice_id'], 'differential identity differs')
                if secondary['status'] != 'ok':
                    failure = 'differential_oracle_failure'
                elif secondary['multiplicity'] != primary['multiplicity']:
                    failure = 'differential_oracle_disagreement'
            else:
                require(number not in self.secondary, 'unselected differential call')
        if failure:
            require(event['status'] == 'failed' and event['reason'] == failure, 'native failure differs from evaluation')
        else:
            require(event['status'] == 'ok' and event['multiplicity'] == primary['multiplicity'], 'native value differs from evaluation')

    def finish(self):
        require(self.callbacks == set(self.primary) and self.selected == set(self.secondary), 'native call coverage differs')
        groups = {}
        for oracle in ('lie','zero'):
            for phase in ('setup','workload'):
                rows = [r for r in self.calls if r['oracle']==oracle and r['phase']==phase]
                times = sorted(r['elapsed_ms'] for r in rows)
                groups[oracle+'_'+phase] = {'calls':len(rows),'statuses':dict(Counter(r['status'] for r in rows)),
                    'total_elapsed_ms':sum(r['elapsed_ms'] for r in rows),
                    'p99_ms':times[(99*len(times)+99)//100-1] if times else None}
        return {'status':'verified_native_calls','trace_sha256':self.hash.hexdigest(),
                'calls':len(self.calls),'selected_differential_calls':len(self.secondary),'groups':groups}


def check_job(directory, repo):
    directory, repo = Path(directory), Path(repo)
    plan = load(repo/'experiments/research-step-56/PILOT-PLAN.json'); run = load(directory/'RUN.json')
    require(run['schema']=='ilxyr.weight_native_job.v1' and run['status']=='complete_record', 'native record incomplete')
    require(run['plan_sha256']==sha(repo/'experiments/research-step-56/PILOT-PLAN.json'), 'native plan differs')
    job = run['job']; smoke = job['id']=='smoke'
    require(job in ([plan['smoke']['job']] if smoke else plan['ordered_jobs']), 'native job roster differs')
    require(run['scope']==('small_A1_correctness' if smoke else 'prospective_capacity_pilot'), 'native scope differs')
    require(set(run['files'])=={'CONTRACT.json','CONFIG.json','RESULT.json','events.jsonl','native.jsonl'}, 'native file roster differs')
    for name, binding in run['files'].items():
        path = directory/name
        require(path.stat().st_size <= 64*1024*1024 and path.stat().st_size==binding['bytes'] and sha(path)==binding['sha256'], 'native file binding differs: '+name)
    for name, expected in plan['input_hashes'].items():
        require(sha(repo/name)==expected, 'native input binding differs')
    original = load(repo/'examples/weight-multiplicity/phase1-corpus-plan-v1.json')
    contract = load(directory/'CONTRACT.json')
    require(contract=={'schema':'ilxyr.weight_pilot_oracle_contract.v1',
        'lie_sha256':plan['runtime']['lie_sha256'],'zero_sha256':plan['runtime']['zero_sha256'],
        'coordinate_mapping':original['oracle']['primary']['coordinate_mapping'],
        'primary':'LiE_persistent_dom_char','differential':'Zero_fresh_process_query',
        'hard_query_timeout_ms':plan['execution_limits']['hard_query_timeout_ms'],
        'differential_sample_every':plan['differential']['sample_every']}, 'native contract differs')
    contract_sha = sha(directory/'CONTRACT.json'); require(contract_sha==run['contract_sha256'], 'native contract binding differs')
    arm = next(a for a in plan['arms'] if a['id']==job['arm']); config = load(directory/'CONFIG.json')
    require(config=={'slices':plan['smoke']['slices'] if smoke else plan['slices'],
        'limits':plan['smoke']['limits'] if smoke else plan['pilot_limits'], 'cache':arm['cache'], 'rotate':arm['rotate'],
        'cache_limits':plan['smoke']['cache_limits'] if smoke else plan['cache_limits'],'oracle_sha256':contract_sha}, 'native frozen settings differ')
    reps = [r for r in load(repo/'examples/weight-multiplicity/phase06-reduced-corpus-manifest-v1.json')['representations'] if r['revision3_role']==plan['role']]
    require(len(reps)==plan['representations'], 'native training roster differs')
    if smoke:
        reps = [r for r in reps if r['canonical_id'] in plan['smoke']['representation_ids']]
    require(run['representations']==[r['canonical_id'] for r in reps], 'native representation order differs')
    native = NativeCalls(directory/'native.jsonl',contract); event_count=0
    def events():
        nonlocal event_count
        with (directory/'events.jsonl').open('rb') as stream:
            while True:
                raw = stream.readline(MAX_LINE+1)
                if not raw:
                    break
                require(len(raw)<=MAX_LINE and raw.endswith(b'\n'),'selection event size differs')
                event_count+=1; yield json.loads(raw)
    selection = replay(events(),load(directory/'RESULT.json'),config,{r['canonical_id']:r for r in reps},
        load(repo/'examples/weight-multiplicity/phase1-root-systems-v1.json')['systems'],native.evaluation)
    native_result=native.finish()
    require(event_count==run['files']['events.jsonl']['events'] and len(native.calls)*2==run['files']['native.jsonl']['events'], 'native event count differs')
    return {'schema':'ilxyr.weight_native_check.v1','status':'verified_native_and_selection',
        'job':job,'run_sha256':sha(directory/'RUN.json'),'selection':selection,'native':native_result,
        'timing_scope':'Recorded native call durations including failures. Full job cost belongs to the process receipt.',
        'generator_order':'requires_source_bound_replay'}


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['directory','repo','output']:
        parser.add_argument('--'+name,type=Path,required=True)
    args=parser.parse_args(); result=check_job(args.directory,args.repo)
    with args.output.open('x') as stream:
        json.dump(result,stream,indent=2,sort_keys=True); stream.write('\n')
    print(json.dumps(result,sort_keys=True))
