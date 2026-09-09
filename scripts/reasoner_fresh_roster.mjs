/** Fresh roster construction; domain generation follows the frozen public matched source. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
let generateR55FamilyFromSeed, decodeR55Replay;
export const sha = b => createHash('sha256').update(b).digest('hex');
export const encode = v => JSON.stringify(v, null, 2) + '\n';
const read = p => JSON.parse(readFileSync(p));
export const PLAN_SHA='96b4345e1661eee5697300b591b0e1a2f6bcad97e8a45fd2af3d790b982dc501';
export const EXCLUSIONS_SHA='c853efff3bce284c9e216f0ab6cd9b2477de652db4a3bc5e755e96543ce8dc1f';
export function boundInputs(plan,exclusions) {
  assert.equal(sha(readFileSync(plan)),PLAN_SHA,'fixed plan differs');
  assert.equal(sha(readFileSync(exclusions)),EXCLUSIONS_SHA,'fixed exclusions differ');
  return [read(plan),read(exclusions)];
}
const lines = p => readFileSync(p,'utf8').trim().split('\n').filter(Boolean).map(v => JSON.parse(v));
export async function loadSource(source) {
  ({generateR55FamilyFromSeed,decodeR55Replay} = await import(pathToFileURL(resolve(source,'scripts/lib/reasoner55_replay.mjs'))));
}
export const mapKey = map => [...map.matrix, ...map.bias].join(",");
const operationsKey = maps => maps.map(mapKey).join(":");
const identityMap = () => ({ matrix: [1,0,0,0,1,0,0,0,1], bias: [0,0,0] });
export function compose(a, b) {
  const matrix = [], bias = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let value = 0;
      for (let k = 0; k < 3; k++) value += a.matrix[r * 3 + k] * b.matrix[k * 3 + c];
      matrix.push(value % 5);
    }
    bias.push((a.bias[r] + b.bias.reduce((sum, value, c) => sum + a.matrix[r * 3 + c] * value, 0)) % 5);
  }
  return { matrix, bias };
}
function mix64(input) {
  const mask = (1n << 64n) - 1n;
  let value = (input + 0x9e3779b97f4a7c15n) & mask;
  value = ((value ^ (value >> 30n)) * 0xbf58476d1ce4e5b9n) & mask;
  value = ((value ^ (value >> 27n)) * 0x94d049bb133111ebn) & mask;
  return (value ^ (value >> 31n)) & mask;
}
function rng(seed, stream) {
  const range = 1n << 64n;
  let state = mix64(seed ^ mix64(stream));
  return bound => {
    let value;
    do { state = (state + 0x9e3779b97f4a7c15n) % range; value = mix64(state); } while (value < range % BigInt(bound));
    return Number(value % BigInt(bound));
  };
}
export function candidate(root, ordinal, nonce) {
  const seed = mix64(BigInt(`0x${root}`) ^ (BigInt(ordinal) << 16n) ^ BigInt(nonce));
  const family = generateR55FamilyFromSeed({ familySeed: seed, generator: 0, ordinal });
  if (ordinal >= 64) for (const role of [6, 7]) {
    const random = rng(seed, 0x64656e73652d7631n + BigInt(role));
    let dense;
    for (let attempt = 0; attempt < 1024; attempt++) {
      const m = Array.from({ length: 9 }, () => 1 + random(4));
      const det = m[0]*(m[4]*m[8]-m[5]*m[7])-m[1]*(m[3]*m[8]-m[5]*m[6])+m[2]*(m[3]*m[7]-m[4]*m[6]);
      if ((det % 5 + 5) % 5 === 0) continue;
      dense = { matrix: m, bias: role === 7 ? Array.from({ length: 3 }, () => 1 + random(4)) : [0,0,0] };
      break;
    }
    assert.ok(dense, "dense generation exhausted");
    family.primitiveByRole[role] = dense;
  }
  const random = rng(seed, 0x636f6d702d763031n), binding = [0,1,2,3,4,5,6,7];
  for (let i = 7; i > 0; i--) { const j = random(i + 1); [binding[i], binding[j]] = [binding[j], binding[i]]; }
  family.targetRoles = Array.from({ length: 4 }, (_, i) => binding[Math.floor(ordinal / 32) % 2 ? i % 2 : i]);
  family.targetSurface = family.targetRoles.map(role => family.roleToSurface[role]);
  family.target = family.targetRoles.reduce((map, role) => compose(family.primitiveByRole[role], map), identityMap());
  family.exampleOutput = family.target.bias.map((bias, r) => (bias + family.exampleInput.reduce((sum, value, c) =>
    sum + family.target.matrix[r * 3 + c] * value, 0)) % 5);
  return family;
}

export const primitiveKey = maps => maps.map(mapKey).sort().join(':');
export const astKey = roles => roles.reduce((a,b) => a*8+b,0);
export const tokens = (ast, length=4) => Array.from({length},(_,i)=>(ast >> (3*(length-1-i))) & 7);
export const program = (maps, roles) => roles.reduce((map,role)=>compose(maps[role],map),identityMap());
const normalize = (family, scope, id) => ({scope,id,primitive_by_role:family.primitiveByRole,
  target_roles:family.targetRoles,target:family.target});
export function validateFamily(row) {
  assert.equal(row.primitive_by_role.length,8); assert.equal(row.target_roles.length,4);
  for(const role of row.target_roles) assert.ok(Number.isInteger(role) && role>=0 && role<8);
  for(const map of [...row.primitive_by_role,row.target]) {
    assert.equal(map.matrix.length,9);assert.equal(map.bias.length,3);
    assert.ok([...map.matrix,...map.bias].every(v=>Number.isInteger(v)&&v>=0&&v<5));
  }
  assert.deepEqual(program(row.primitive_by_role,row.target_roles),row.target,'declared target composition differs');
}
export function syntaxMask(exclusions) {
  const mask = Array(4096).fill(0);
  for(const row of exclusions) {
    validateFamily(row);
    if(row.scope==='source') for(let ast=0;ast<4096;ast++)
      if(mapKey(program(row.primitive_by_role,tokens(ast)))===mapKey(row.target)) mask[ast]=1;
    if(['source','development'].includes(row.scope))mask[astKey(row.target_roles)]=1;
  }
  return mask;
}
export function freshness(row, mask, behaviors, primitives) {
  if(!row.target_roles.some(role=>role>=6))return 0;
  if(mask[astKey(row.target_roles)])return 1;
  if(behaviors.has(mapKey(row.target)))return 2;
  if(primitives.has(primitiveKey(row.primitive_by_role)))return 3;
  return -1;
}
function minimum(maps,target) {
  if(mapKey(target)===mapKey(identityMap()))return 0;
  for(let n=1;n<4;n++)for(let ast=0;ast<8**n;ast++)
    if(mapKey(program(maps,tokens(ast,n)))===mapKey(target))return n;
  return 4;
}
export function generate(plan, exclusions) {
  assert.equal(plan.families,128);assert.equal(plan.families_per_cell,32);assert.equal(plan.maximum_nonce,65535);
  const mask=syntaxMask(exclusions),behaviors=new Set(exclusions.map(r=>mapKey(r.target))),primitives=new Set(exclusions.map(r=>primitiveKey(r.primitive_by_role)));
  const rows=[], decisions=[];
  for(let ordinal=0;ordinal<plan.families;ordinal++) {
    const counts=[0,0,0,0];let accepted=false;
    for(let nonce=0;nonce<=plan.maximum_nonce;nonce++) {
      const f=candidate(plan.seed,ordinal,nonce),row={ordinal,cell:Math.floor(ordinal/32),nonce,family_seed:f.familySeed.toString(16).padStart(16,'0'),
        primitive_by_role:f.primitiveByRole,surface_to_role:f.surfaceToRole,surface_ids:f.surfaceIds,target_roles:f.targetRoles,target:f.target,example_input:f.exampleInput,example_output:f.exampleOutput};
      const reason=freshness(row,mask,behaviors,primitives);
      decisions.push({ordinal,nonce,reason,family_seed:row.family_seed});
      if(reason>=0){counts[reason]++;continue;}
      row.rejections=[...counts];row.minimum_length=minimum(row.primitive_by_role,row.target);rows.push(row);
      behaviors.add(mapKey(row.target));primitives.add(primitiveKey(row.primitive_by_role));accepted=true;break;
    }
    assert.ok(accepted,'nonce bound exhausted at ordinal '+ordinal);
  }
  return {rows,decisions,mask};
}
export function exclusionInputs(source,matched,opened) {
  const specs=[['source','benchmarks/reasoner55-transfer-diagnostics-v1/DIAGNOSTICS.json','823e83db92d244e9c6843b9976d478046ee5f50344295eebf3039e9d3570f410'],
    ['development','benchmarks/reasoner55-generated-primitive-transfer-v1/DEVELOPMENT-TRACE.jsonl','60f0886ec2291374c5a46c7ee69d104b2486f9962cc8833718178543c9f30287'],
    ['fixed','benchmarks/reasoner55-fixed-transfer-v1/RESULTS.json','377e96366957d7d5435670eb218e7cc3ed96c7dc8b57b5e5d82ec75d393c2655'],
    ['matched',matched,'f5af9bfa11e04413e1eb81b2d6c1707d009a5ca19112d2df8878e6fc5032b778'],
    ['opened',opened,'5fb9c0f241d06df59b98ff3a8ecd4631f2ec496577aa8df44cb2382900277bfc']];
  const files={},bindings={};for(const [scope,path,expected] of specs) {
    const absolute=resolve(source,path),raw=readFileSync(absolute);assert.equal(sha(raw),expected,scope+' input hash');files[scope]=absolute;bindings[scope]={sha256:expected,bytes:raw.length};
  }
  const sourceRows=read(files.source).arms[0].sources.map(r=>normalize(generateR55FamilyFromSeed({familySeed:r.family_seed,generator:r.generator,ordinal:r.ordinal}),'source',r.generator+':'+r.ordinal));
  const development=new Map();for(const row of lines(files.development))if(row.arm==='target_only') {
    const f=decodeR55Replay(row),key=f.generator+':'+f.ordinal;const value=normalize(f,'development',key);
    if(development.has(key))assert.deepEqual(development.get(key),value);development.set(key,value);
  }
  const records=[...sourceRows,...development.values()];
  for(const scope of ['fixed','matched','opened'])for(const row of scope==='fixed'?read(files.fixed).families:lines(files[scope]))
    records.push({scope,id:String(row.ordinal),primitive_by_role:row.primitive_by_role,target_roles:row.target_roles,target:row.target});
  for(const r of records)validateFamily(r);
  assert.deepEqual(Object.fromEntries(['source','development','fixed','matched','opened'].map(k=>[k,records.filter(r=>r.scope===k).length])),{source:128,development:8,fixed:128,matched:128,opened:4});
  return {schema:'ilxyr.reasoner_exclusions.v1',inputs:bindings,records};
}
function header(plan, exclusions) {
  const affine=map=>'{{'+map.matrix.join(',')+'},{'+map.bias.join(',')+'}}';
  return '#define R39_ROOT UINT64_C(0x'+plan.seed+')\n#define R39_PRIOR_COUNT '+exclusions.length+'\n'+
    'typedef struct { r55_affine ops[8],target; uint8_t roles[4],scope; } r39_prior;\n'+
    'static const r39_prior r39_priors[R39_PRIOR_COUNT] = {\n'+exclusions.map(r=>'{ {'+r.primitive_by_role.map(affine).join(',')+'},'+affine(r.target)+',{'+r.target_roles.join(',')+'},'+['source','development','fixed','matched','opened'].indexOf(r.scope)+'}').join(',\n')+'\n};\n';
}
export async function main(args) {
  const [mode,source,a,b,c]=args;await loadSource(source);
  if(mode==='exclusions')writeFileSync(c,encode(exclusionInputs(source,a,b)),{flag:'wx'});
  else if(mode==='generate') {
    const [plan,excluded]=boundInputs(a,b);mkdirSync(c,{recursive:false});
    const result=generate(plan,excluded.records);
    writeFileSync(resolve(c,'ROSTER.json'),encode(result.rows));writeFileSync(resolve(c,'DECISIONS.json'),encode(result.decisions));writeFileSync(resolve(c,'SOURCE-SYNTAX.json'),encode(result.mask.flatMap((v,i)=>v?[i]:[])));
    writeFileSync(resolve(c,'exclusions.h'),header(plan,excluded.records));
    const summary={schema:'ilxyr.reasoner_roster_generation.v1',status:'complete',plan_sha256:sha(readFileSync(a)),exclusions_sha256:sha(readFileSync(b)),families:result.rows.length,candidates:result.decisions.length,
      rejected:result.decisions.length-result.rows.length,rejections:[0,1,2,3].map(k=>result.decisions.filter(r=>r.reason===k).length),excluded_source_syntax:result.mask.reduce((a,b)=>a+b,0),unique_prior_behaviors:new Set(excluded.records.map(r=>mapKey(r.target))).size,unique_prior_primitive_multisets:new Set(excluded.records.map(r=>primitiveKey(r.primitive_by_role))).size,model_calls:0,fresh_family_scoring:0};
    writeFileSync(resolve(c,'GENERATION.json'),encode(summary));console.log(encode(summary));
  } else if(mode==='check') {
    const [planFile,excludeFile,output,nativeFile,checkFile]=args.slice(2),[plan,excluded]=boundInputs(planFile,excludeFile),exclusions=excluded.records;
    const result=generate(plan,exclusions),native=lines(nativeFile);
    assert.deepEqual(native.filter(r=>r.kind==='decision').map(({kind,...r})=>r),result.decisions,'native rejection replay differs');
    assert.deepEqual(native.filter(r=>r.ordinal!==undefined&&!r.kind),result.rows,'native family bytes differ');
    assert.deepEqual(native.filter(r=>r.kind==='syntax').map(r=>r.ast),result.mask.flatMap((v,i)=>v?[i]:[]),'source exact solution mask differs');
    assert.equal(read(resolve(output,'GENERATION.json')).plan_sha256,PLAN_SHA);assert.equal(read(resolve(output,'GENERATION.json')).exclusions_sha256,EXCLUSIONS_SHA);
    assert.equal(readFileSync(resolve(output,'exclusions.h'),'utf8'),header(plan,exclusions),'native exclusion header differs');
    assert.deepEqual(read(resolve(output,'ROSTER.json')),result.rows);assert.deepEqual(read(resolve(output,'DECISIONS.json')),result.decisions);assert.deepEqual(read(resolve(output,'SOURCE-SYNTAX.json')),result.mask.flatMap((v,i)=>v?[i]:[]));
    assert.equal(native.length,result.decisions.length+result.rows.length+result.mask.reduce((a,b)=>a+b,0));
    const report={schema:'ilxyr.reasoner_fresh_roster_check.v1',status:'verified_complete',families:result.rows.length,replayed_decisions:result.decisions.length,source_syntax:result.mask.reduce((a,b)=>a+b,0),files:Object.fromEntries(['ROSTER.json','DECISIONS.json','SOURCE-SYNTAX.json','exclusions.h'].map(n=>[n,sha(readFileSync(resolve(output,n)))])),native_sha256:sha(readFileSync(nativeFile)),fresh_family_scoring:0};
    writeFileSync(checkFile,encode(report),{flag:'wx'});console.log(encode(report));
  } else throw new Error('mode must be exclusions, generate or check');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main(process.argv.slice(2));
