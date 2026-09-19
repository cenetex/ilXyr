// Run one frozen selection job and preserve both decision and native call records.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, openSync, writeSync, closeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PersistentLie } from './run-weight-multiplicity-phase1-corpus.mjs';
import { runSelectionPilot } from './lib/weight-selection-pilot.mjs';
import { fnv1a, makeRandom, prepareRepresentations, RepresentationPicker } from './lib/weight-candidates-v2.mjs';

export const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
export const PLAN = 'experiments/research-step-56/PILOT-PLAN.json';
export const digest = raw => createHash('sha256').update(raw).digest('hex');
export const encode = value => JSON.stringify(value, null, 2) + '\n';
const load = name => JSON.parse(readFileSync(resolve(ROOT, name)));
export function setup(id) {
  const plan = load(PLAN);
  for (const [name, hash] of Object.entries(plan.input_hashes)) assert.equal(digest(readFileSync(resolve(ROOT,name))), hash, name);
  const smoke = id === 'smoke';
  const job = smoke ? plan.smoke.job : plan.ordered_jobs.find(j => j.id === id);
  assert.ok(job, 'job outside frozen roster');
  const arm = plan.arms.find(a => a.id === job.arm); assert.ok(arm);
  const original = load('examples/weight-multiplicity/phase1-corpus-plan-v1.json');
  const contract = { schema: 'ilxyr.weight_pilot_oracle_contract.v1',
    lie_sha256: plan.runtime.lie_sha256, zero_sha256: plan.runtime.zero_sha256,
    coordinate_mapping: original.oracle.primary.coordinate_mapping,
    primary: 'LiE_persistent_dom_char', differential: 'Zero_fresh_process_query',
    hard_query_timeout_ms: plan.execution_limits.hard_query_timeout_ms,
    differential_sample_every: plan.differential.sample_every };
  const config = { slices: smoke ? plan.smoke.slices : plan.slices,
    limits: smoke ? plan.smoke.limits : plan.pilot_limits,
    cache: arm.cache, rotate: arm.rotate,
    cache_limits: smoke ? plan.smoke.cache_limits : plan.cache_limits,
    oracle_sha256: digest(encode(contract)) };
  let reps = prepareRepresentations(load('examples/weight-multiplicity/phase06-reduced-corpus-manifest-v1.json'),
    load('examples/weight-multiplicity/phase1-root-systems-v1.json')).filter(r => r.revision3_role === plan.role);
  assert.equal(reps.length, plan.representations);
  if (smoke) reps = reps.filter(r => plan.smoke.representation_ids.includes(r.canonical_id));
  assert.ok(reps.length);
  return { plan, job, arm, smoke, contract, config, reps };
}
export function selection(settings, query, onEvent) {
  const { job, config, reps, plan } = settings;
  return runSelectionPilot({ picker: new RepresentationPicker(reps, job.seed ^ fnv1a(plan.random.picker_domain)),
    random: makeRandom(job.seed ^ fnv1a(plan.random.candidate_domain)),
    slices: config.slices, limits: config.limits, oracleSha256: config.oracle_sha256,
    cacheLimits: config.cache ? config.cache_limits : null, rotateSlices: config.rotate, query, onEvent });
}
class Events {
  constructor(path, cap) { this.fd = openSync(path,'wx'); this.cap = cap; this.bytes = 0; this.sequence = 0; this.hash = createHash('sha256'); }
  append(value) {
    const raw = Buffer.from(JSON.stringify({ sequence: this.sequence + 1, ...value }) + '\n');
    assert.ok(raw.length <= 65536 && this.bytes + raw.length <= this.cap, 'event_size_limit');
    writeSync(this.fd,raw); this.hash.update(raw); this.bytes += raw.length; this.sequence++;
  }
  finish() { closeSync(this.fd); return { bytes: this.bytes, events: this.sequence, sha256: this.hash.digest('hex') }; }
}
export async function run(id, lie, zero, output) {
  const settings = setup(id); const { plan, job, contract, config, smoke } = settings;
  assert.equal(process.platform, 'linux'); assert.equal(process.arch,'x64'); assert.equal(process.versions.node,plan.runtime.node);
  assert.equal(digest(readFileSync(lie)), contract.lie_sha256); assert.equal(digest(readFileSync(zero)), contract.zero_sha256);
  mkdirSync(output, { recursive: false });
  const save = (name, value) => { const raw = encode(value); assert.ok(Buffer.byteLength(raw) <= plan.execution_limits.max_result_bytes_per_job); writeFileSync(resolve(output,name),raw,{flag:'wx'}); return {bytes:Buffer.byteLength(raw),sha256:digest(raw)}; };
  const header = { schema:'ilxyr.weight_native_job.v1', status:'failed', scope:smoke?'small_A1_correctness':'prospective_capacity_pilot',
    job, plan_sha256:digest(readFileSync(resolve(ROOT,PLAN))), contract_sha256:config.oracle_sha256,
    representations:settings.reps.map(r => r.canonical_id), files:{} };
  header.files['CONTRACT.json'] = save('CONTRACT.json',contract);
  header.files['CONFIG.json'] = save('CONFIG.json',config);
  const trace = new Events(resolve(output,'events.jsonl'),plan.execution_limits.max_trace_bytes_per_job);
  const native = new Events(resolve(output,'native.jsonl'),plan.execution_limits.max_trace_bytes_per_job);
  let callId = 0; const covered = new Set();
  const start = (oracle, phase, candidate, number, input) => { const id = ++callId;
    native.append({kind:'start',call_id:id,oracle,phase,query_key:candidate.query_key,
      source_query_sequence:number,input,...(phase==='workload'?{slice_id:candidate.slice.id}:{})}); return id; };
  const finish = (id, value) => {
    let status = value.status; let multiplicity = value.multiplicity;
    if (status === 'ok' && value.elapsed_ms >= contract.hard_query_timeout_ms) status = 'hard_timeout';
    if (status === 'ok' && (typeof multiplicity !== 'string' || !/^(0|[1-9][0-9]*)$/.test(multiplicity) || multiplicity.length > 4096)) status = 'invalid_multiplicity';
    const record = {status,multiplicity:status === 'ok'?multiplicity:null,elapsed_ms:value.elapsed_ms};
    native.append({kind:'finish',call_id:id,...record}); return record;
  };
  let warmId; let warmFinished = false;
  const worker = new PersistentLie({id:job.id,executable:lie,stdbuf:'/usr/bin/stdbuf',hardTimeoutMs:contract.hard_query_timeout_ms,
    onWarmup:value => { finish(warmId,value); warmFinished=true; } });
  const command = candidate => { const order = contract.coordinate_mapping[candidate.canonical_type];
    const map = v => (order?order.map(i => v[i]):v).join(',');
    return `dom_char([${map(candidate.highest_weight)}],[${map(candidate.target_weight)}],${candidate.canonical_type})`; };
  try {
    warmId = start('lie','setup',{query_key:'A1\t1\t1'},0,'dom_char([1],[1],A1)');
    await worker.start();
    const result = await selection(settings,async (candidate,number) => {
      const input = command(candidate); const id = start('lie','workload',candidate,number,input);
      const primary = finish(id,await worker.query(input));
      if (primary.status !== 'ok') throw new Error('primary_oracle_failure');
      const triple = candidate.canonical_type+'|'+candidate.slice.id;
      const sampled = !covered.has(triple) || BigInt('0x'+digest(candidate.query_key)) % BigInt(contract.differential_sample_every) === 0n;
      covered.add(triple);
      if (sampled) {
        const args = ['query',candidate.canonical_type,candidate.highest_weight.join(','),candidate.target_weight.join(',')];
        const secondaryId = start('zero','workload',candidate,number,args); const began = performance.now();
        const child = spawnSync(zero,args,{encoding:'utf8',timeout:contract.hard_query_timeout_ms,maxBuffer:1024*1024});
        let value = {status:child.status === 0?'ok':'process_failure',multiplicity:null,elapsed_ms:performance.now()-began};
        if (value.status === 'ok') { try { const answer = JSON.parse(child.stdout).multiplicity;
          assert.ok(typeof answer === 'string' || Number.isSafeInteger(answer)); value.multiplicity=String(answer);
        } catch { value.status='invalid_response'; } }
        const secondary = finish(secondaryId,value);
        if (secondary.status !== 'ok') throw new Error('differential_oracle_failure');
        if (secondary.multiplicity !== primary.multiplicity) throw new Error('differential_oracle_disagreement');
      }
      return primary;
    },event => trace.append(event));
    header.files['RESULT.json'] = save('RESULT.json',result); header.status='complete_record';
  } catch (error) {
    header.error=error.message; header.warmup_finished=warmFinished; process.exitCode=1;
  } finally {
    await worker.close();
    header.files['events.jsonl']=trace.finish(); header.files['native.jsonl']=native.finish(); save('RUN.json',header);
  }
  console.log(JSON.stringify({status:header.status,job:job.id,files:header.files}));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length,6,'expected job id, LiE, Zero, output');
  await run(...process.argv.slice(2));
}
