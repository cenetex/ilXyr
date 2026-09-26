# Retry collection and decision rule

Run `weight-pilot-56-20260926T233104Z` uses instance `i-09b9ada38cd4afe2b`. Its shutdown deadline is September 27, 2026, 01:01:04 UTC. The launch receipt is `/private/tmp/weight-pilot-retry-live-20260926/launch/receipt.json`.

Read instance state with EC2 `describe-instances`. After it reaches `terminated`, collect into a fresh directory:

```sh
python3 -B scripts/weight_cloud_collect.py receive \
  --plan experiments/research-step-59-weight-pilot/RETRY-PLAN.json \
  --identity /private/tmp/weight-pilot-retry-live-20260926/launch/receipt.json \
  --output /private/tmp/weight-pilot-retry-collected-20260927
```

The collector checks instance identity and termination, zero remaining volumes and interfaces, exact S3 object versions and checksums, and archive paths. Keep its `RECEIPT.json`, termination, cleanup, terminal, collection, and extracted result records. A collection error remains evidence; resolve its cause before retrying collection.

Review the saved independent checks with a small local receipt pass:

```sh
python3 - <<'PY'
import hashlib, json
from pathlib import Path
root=Path('/private/tmp/weight-pilot-retry-collected-20260927')
read=lambda path: json.loads(path.read_text())
receive=read(root/'RECEIPT.json')
terminal=read(root/'host-terminal.json')
plan=read(Path('experiments/research-step-56/PILOT-PLAN.json'))
assert receive['instance_termination_verified']
assert terminal['instance_id']=='i-09b9ada38cd4afe2b'
assert terminal['package_sha256']=='fe7e6f2cbec425df875f905c0d5681d5cefacf844a035450c83b68ad509186e9'
controller_path=root/'results/pilot/RESULT.json'
if not controller_path.exists():
    print(json.dumps({'status':'host_stopped_before_controller_result','terminal':terminal['status']}))
    raise SystemExit
controller=read(controller_path)
assert controller['package_sha256']=='adea1791925e3336d28e4a26ccc80c5c20baa7892fc84675b422e325295569c7'
assert [j['id'] for j in controller['jobs']]==[j['id'] for j in plan['ordered_jobs']]
rows=[]
for job in controller['jobs']:
    entry={'id':job['id'],'status':job['status']}
    if job['status']=='verified':
        directory=root/'results/pilot/jobs'/job['id']
        run=read(directory/'RUN.json')
        result=read(directory/'RESULT.json')
        native=read(directory/'CHECK.json')
        replay=read(root/'results/pilot/logs'/(job['id']+'-replay')/'stdout.log')
        run_sha=hashlib.sha256((directory/'RUN.json').read_bytes()).hexdigest()
        assert run_sha==job['run_sha256']==native['run_sha256']
        assert job['process']['status']==job['check']['status']==job['replay']['status']=='complete'
        assert run['job']['id']==job['id'] and run['status']=='complete_record'
        assert native['status']=='verified_native_and_selection'
        assert replay['status']=='verified_generator_replay' and replay['native_oracle_calls']==0
        assert result['totals']==job['totals']
        entry.update(hold=result['hold'],totals=result['totals'],by_slice=result['by_slice'],
                     candidate_support=result['candidate_support'])
    else:
        entry['reason']=job.get('reason')
    rows.append(entry)
complete=(terminal['status']=='complete' and receive['host_collection_complete']
          and controller['status']=='complete_record' and all(r['status']=='verified' for r in rows))
print(json.dumps({'comparison_status':'complete_record' if complete else 'partial_record',
                  'host_status':terminal['status'],'controller_status':controller['status'],
                  'jobs':rows},indent=2,sort_keys=True))
PY
```

The frozen pilot compares four controls on the same machine, image, roster, limits, and four seeds. For each seed and each of eight declared slices, compare new accepted rows at the frozen draw and new-call bounds. Report candidate draws, evaluations, cache hits, oracle calls, query and orbit exclusions, failures, accepted rows, and holds. Preserve every failed or skipped job. A complete comparison requires all sixteen jobs, native checks, and generator replays verified. Sampled candidate support remains unknown. This pilot measures selection yield; full corpus release has separate partition, exact-label, cross-oracle, latency, and resource gates.

The cloud controller runs the independent native check and generator replay after each completed job. A new full replay of all downloaded traces is heavy work under `docs/CLOUD-EXECUTION.md` and needs its own venue and budget decision. Keep actual provider billing unknown until provider evidence arrives.
