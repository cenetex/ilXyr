// Reproduce the frozen generator with saved answers; native calls belong to the run.
import assert from 'node:assert/strict';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setup, selection, encode, digest } from './weight_pilot_job.mjs';
const [directory, output] = process.argv.slice(2); assert.ok([3,4].includes(process.argv.length));
const load = name => { const path=resolve(directory,name); assert.ok(statSync(path).size <= 64*1024*1024); return JSON.parse(readFileSync(path)); };
const run=load('RUN.json'); const settings=setup(run.job.id);
assert.deepEqual(run.job,settings.job); assert.deepEqual(load('CONFIG.json'),settings.config);
assert.deepEqual(load('CONTRACT.json'),settings.contract);
assert.deepEqual(run.representations,settings.reps.map(r => r.canonical_id));
const result=load('RESULT.json'); const answers=result.evaluations.filter(r => r.source==='oracle'); let index=0;
// Event hooks are synchronous. Compare their stream digest after replay.
let sequence=0; const {createHash}=await import('node:crypto'); const hash=createHash('sha256');
const replayed=await selection(settings,async (candidate,number) => {
  const answer=answers[index++]; assert.ok(answer); assert.equal(answer.source_query_sequence,number);
  assert.equal(answer.query_key,candidate.query_key); assert.equal(answer.slice_id,candidate.slice.id);
  if (answer.status==='failed') throw new Error(answer.reason);
  return {status:'ok',multiplicity:answer.multiplicity};
},event => hash.update(JSON.stringify({sequence:++sequence,...event})+'\n'));
assert.equal(index,answers.length); assert.deepEqual(replayed,result);
assert.equal(hash.digest('hex'),run.files['events.jsonl'].sha256);
const receipt=JSON.stringify({status:'verified_generator_replay',events:sequence,new_answers:index,native_oracle_calls:0,
  contract_sha256:digest(encode(settings.contract))});
if (output) writeFileSync(output,receipt+'\n',{flag:'wx'});
console.log(receipt);
