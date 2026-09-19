/** Independent replay of every distinct measured result, using frozen JS domain code.
 * The search replay below follows step 36 check_reasoner55_eligible.mjs at 0c52536.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
function heapReplay(ranks, limit=64) {
  const heap=[];let comparisons=0;
  const compare=(a,b)=>{++comparisons;return a-b;};
  for(const rank of ranks) {
    if(!limit) continue;
    if(heap.length<limit) {
      let i=heap.length;heap.push(rank);
      while(i) {
        const p=Math.floor((i-1)/2);
        if(compare(heap[i],heap[p])<=0) break;
        [heap[i],heap[p]]=[heap[p],heap[i]];i=p;
      }
    } else if(compare(rank,heap[0])<0) {
      heap[0]=rank;let i=0;
      for(;;) {
        let c=i*2+1;if(c>=heap.length) break;
        if(c+1<heap.length&&compare(heap[c+1],heap[c])>0) ++c;
        if(compare(heap[i],heap[c])>=0) break;
        [heap[i],heap[c]]=[heap[c],heap[i]];i=c;
      }
    }
  }
  return {ranks:heap.sort((a,b)=>a-b),comparisons};
}
if(process.argv.length===3&&process.argv[2]==='--heap-unit') {
  for(let n=0;n<=257;++n) for(const reverse of [false,true]) {
    const ranks=Array.from({length:n},(_,i)=>i);if(reverse)ranks.reverse();
    assert.deepEqual(heapReplay(ranks).ranks,Array.from({length:Math.min(n,64)},(_,i)=>i));
  }
  console.log('516 heap cases passed');process.exit(0);
}
const [source, root, prepared, output] = process.argv.slice(2);
assert.equal(process.argv.length, 6);
const read = p => JSON.parse(readFileSync(p));
const sha = x => createHash('sha256').update(x).digest('hex');
const lines = p => readFileSync(p, 'utf8').trim().split('\n').map(s => JSON.parse(s));
const fromSource = p => import(pathToFileURL(resolve(source, 'scripts/lib', p)));
const { loadModel } = await fromSource('reasoner55_fixed_transfer.mjs');
const { publicTask, buildUniverse, featureGroups, featureDigest, rankGroups } = await fromSource('reasoner55_semantic_guide.mjs');
const { deriveR55TieSalt } = await fromSource('reasoner55_replay.mjs');
const { canonicalCandidateOrder } = await fromSource('reasoner5_harness.mjs');
const ARMS = ['semantic_frequency', 'task_guide', 'raw_lexical_task_guide', 'task_without_prior_feature'];
const MAPPED = [1,3,5,7];
const TIMERS = ['adapter_ns','enumerate_ns','group_ns','score_ns','sort_ns','receipt_ns','search_ns','wall_ns','cpu_ns'];
const stable = row => Object.fromEntries(Object.entries(row).filter(([k]) => !TIMERS.includes(k) && k !== 'phase'));
const key = map => [...map.matrix, ...map.bias].reduce((sum,v,i) => sum + v * 5 ** i, 0);
const apply = (map,input) => map.bias.map((b,r) => (b + input.reduce((sum,v,c) => sum + map.matrix[r*3+c]*v,0)) % 5);
const digestMap = map => sha(Buffer.concat([Buffer.from('reasoner55-affine\0'), Buffer.from([...map.matrix,...map.bias])]));
const run = read(resolve(root,'RUN.json')), selected = read(resolve(root,'WORKLOAD.json'));
assert.ok(['opened','cloud'].includes(run.mode));
assert.equal(selected.mode,run.mode);
const raw = run.mode === 'cloud' ? read(resolve(prepared,'ROSTER.json')) : lines(resolve(prepared,'OPENED.jsonl'));
assert.equal(sha(readFileSync(resolve(prepared,run.mode === 'cloud' ? 'ROSTER.json' : 'OPENED.jsonl'))),
  run.mode === 'cloud' ? '037caefb37b9656e5681dc3dd145a2cf20d4517582c5faf373b42265782da42e' : '5fb9c0f241d06df59b98ff3a8ecd4631f2ec496577aa8df44cb2382900277bfc');
const families = raw.map(r => ({ordinal:r.ordinal, familySeed:BigInt('0x'+r.family_seed), primitiveByRole:r.primitive_by_role,
  surfaceToRole:r.surface_to_role, roleToSurface:Array.from({length:8},(_,i)=>r.surface_to_role.indexOf(i)),
  surfaceIds:r.surface_ids, targetRoles:r.target_roles, targetSurface:r.target_roles.map(i=>r.surface_to_role.indexOf(i)),
  target:r.target, exampleInput:r.example_input, exampleOutput:r.example_output, generator:0}));
const model = loadModel(), bases = new Map();
for (const family of families) {
  const base = buildUniverse(publicTask(family));
  base.fallback = canonicalCandidateOrder(base.programs.map(p => ({semantic:p.key,ast:p.ast,partial_expansions:1})));
  bases.set(family.ordinal,base);
}
let replayed = 0;
  function replay(row, arm) {
    const family = families.find(f => f.ordinal === Math.floor(row.episode / 4));
    const base = bases.get(family.ordinal), source = Math.floor(row.episode / 2) % 2, tie = row.episode % 2;
    const eligible = row.case === 'empty_eligible_set' ? [] : base.groups.filter(g => g.loss === 0);
    const features = featureGroups({ ...base, groups: eligible }, model.guides[source], MAPPED[arm]);
    const allRanked = rankGroups(features, model.weights[source], MAPPED[arm], deriveR55TieSalt(family.familySeed, source, tie));
    const ranked = allRanked.slice(0, row.budget);
    const rankByKey=new Map(allRanked.map((g,i)=>[g.key,i]));
    const heap=heapReplay(features.map(g=>rankByKey.get(g.key)),row.budget);
    assert.equal(row.heap_comparisons,heap.comparisons,'independent heap comparisons');
    assert.equal(row.selected,ranked.length);
    const batches=[];
    for(let start=0;start<base.groups.length;start+=64)
      batches.push(base.groups.slice(start,start+64).filter(g=>g.loss===0).length);
    assert.equal(row.batches,batches.filter(n=>n>0).length,'independent batch count');
    assert.equal(row.maximum_batch,Math.max(0,...batches),'independent maximum batch');
    assert.equal(row.groups, base.groups.length);
    assert.equal(row.eligible_groups, eligible.length);
    assert.equal(row.eligible_programs, eligible.reduce((sum, g) => sum + g.members.length, 0));
    assert.equal(row.features_sha256, featureDigest(features));
    assert.deepEqual(row.proposal_keys, ranked.map(g => g.key));
    const order = Buffer.alloc(ranked.length * 4); ranked.forEach((g, i) => order.writeUInt32LE(g.key, i * 4));
    assert.equal(row.proposal_order_sha256, sha(order));
    const injection = base.programs.find(p => p.key !== key(family.target));
    assert.equal(row.injection_ast, injection.ast);
    const seen = new Set(); let checks = 0, partial = 4096 + base.groups.length, solved = false, hit = false;
    let firstCounterexample = 4294967295, accepted = 4294967295, proposalAttempts = 0, fallbackAttempts = 0, fallbackChecks = 0;
    function visit(ast) {
      if (checks >= row.cap) { hit = true; return true; }
      ++partial;
      const candidate = base.programs[ast];
      if (seen.has(candidate.key)) return false;
      seen.add(candidate.key); ++checks;
      for (let point = 0; point < 125; ++point) {
        const input = [Math.floor(point / 25), Math.floor(point / 5) % 5, point % 5];
        if (apply(candidate.semantic, input).some((v, lane) => v !== apply(family.target, input)[lane])) {
          if (checks === 1) firstCounterexample = point;
          return false;
        }
      }
      solved = true; accepted = ast; return true;
    }
    assert.equal(visit(injection.ast), false);
    for (const group of ranked) { ++proposalAttempts; if (visit(group.representative)) break; }
    const fallback = !solved && !hit;
    if (fallback) {
      const before = checks;
      for (const candidate of base.fallback) { ++fallbackAttempts; if (visit(candidate.ast)) break; }
      fallbackChecks = checks - before;
    }
    const expected = { verifier_checks: checks, partial_expansions: partial, exact: solved, certificate_valid: solved,
      primary_cost: solved ? checks : row.cap + 1, counterexample: firstCounterexample, accepted_ast: accepted,
      proposal_attempts: proposalAttempts, fallback_attempts: fallbackAttempts, fallback_checks: fallbackChecks,
      fallback_started: fallback, global_cap_hit: hit, fallback_exhausted: fallback && !solved && !hit,
      injected_invalid_rejected: true, accepted_semantic_sha256: solved ? digestMap(family.target) : '0'.repeat(64),
      observation_queries: 32, source_artifact_reads: arm === 0 ? 0 : arm === 3 ? 16 : 921 };
    for (const [name, value] of Object.entries(expected)) assert.deepEqual(row[name], value, `independent ${name}`);
    ++replayed;
  }

const passes = run.mode === 'cloud' ? 12 : 2;
const episodes = families.flatMap(f=>[0,1,2,3].map(v=>f.ordinal*4+v));
const order = p => [...episodes].sort((a,b) => {
  const hash = e => sha(`reasoner-step40-order-v1:${p}:${e}`);
  return hash(a).localeCompare(hash(b)) || a-b;
});
const jobs = Array.from({length:passes},(_,p)=>ARMS.slice(p%4).concat(ARMS.slice(0,p%4)).map((arm,i)=>({index:p*4+i,pass:p,arm}))).flat();
assert.deepEqual(selected.jobs,jobs);
assert.deepEqual(selected.orders,Array.from({length:passes},(_,p)=>order(p)));
const previous = new Map();
for (const job of jobs) {
  const records = lines(resolve(root,'jobs',String(job.index).padStart(4,'0'),'stdout.log'));
  assert.equal(records.length,episodes.length*2+2);
  const meta=records[0], end=records.at(-1), rows=records.slice(1,-1);
  for(const [k,v] of Object.entries({kind:'metadata',mode:run.mode,arm:job.arm,pass:job.pass,planner:'eligible',roster_sha256:selected.roster_sha256})) assert.deepEqual(meta[k],v,k);
  for(const k of ['model_load_ns','preparation_ns','preparation_cpu_ns']) assert.ok(Number.isSafeInteger(meta[k])&&meta[k]>=0,k);
  assert.ok(meta.model_load_ns<=meta.preparation_ns);
  assert.deepEqual([end.kind,end.failed,end.completed_episodes],['process',false,rows.length]);
  assert.ok(end.peak_rss_bytes>0);
  assert.deepEqual(rows.filter(r=>r.phase==='warmup').map(r=>r.episode),order(job.pass));
  assert.deepEqual(rows.filter(r=>r.phase==='measured').map(r=>r.episode),order(job.pass));
  for(const row of rows) {
    assert.equal(row.kind,'row');assert.equal(row.failed,false);assert.equal(row.case,'normal');
    assert.equal(row.budget,64);assert.equal(row.cap,4096);assert.equal(row.program_scans,4096);
    for(const timer of TIMERS) assert.ok(Number.isSafeInteger(row[timer])&&row[timer]>=0,timer);
    assert.ok(row.wall_ns>=TIMERS.slice(0,-2).reduce((a,k)=>a+row[k],0));
    assert.ok(row.maximum_batch<=64&&row.selected<=64);
    assert.equal(row.scored_groups,row.eligible_groups);assert.equal(row.feature_programs,row.eligible_programs);
    assert.equal(row.prior_calls,job.arm==='task_guide'||job.arm==='raw_lexical_task_guide'?row.feature_programs:0);
    assert.equal(row.rich_groups,job.arm==='semantic_frequency'?0:row.scored_groups);
    const id=job.arm+':'+row.episode;
    if(previous.has(id)) assert.deepEqual(stable(row),previous.get(id),'stable replay differs');
    else { previous.set(id,stable(row)); }
    if(job.pass===0&&row.phase==='measured') replay(row,ARMS.indexOf(job.arm));
  }
  assert.ok(end.process_wall_ns>=meta.preparation_ns+rows.reduce((s,r)=>s+r.wall_ns,0));
  assert.ok(end.process_cpu_ns>=meta.preparation_cpu_ns+rows.reduce((s,r)=>s+r.cpu_ns,0));
}
assert.equal(replayed,episodes.length*4);
const stableRows=Object.fromEntries([...previous.entries()].sort(([a],[b])=>a.localeCompare(b)));
const result={schema:'ilxyr.reasoner_study_replay.v1',status:'verified',mode:run.mode,jobs:jobs.length,
  native_episode_visits:jobs.length*episodes.length*2,independent_measured_replays:replayed,
  fresh_episode_visits:run.mode==='cloud'?jobs.length*episodes.length*2:0,
  stable_rows_sha256:sha(JSON.stringify(stableRows)+'\n'),
  verifier_checks:Object.fromEntries(ARMS.map(arm=>[arm,episodes.reduce((sum,e)=>sum+previous.get(arm+':'+e).verifier_checks,0)]))};
writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result));
