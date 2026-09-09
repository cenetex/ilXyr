import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { primitiveKey,mapKey,freshness,boundInputs,encode,main } from './reasoner_fresh_roster.mjs';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..'),FROZEN=resolve(ROOT,'experiments/research-step-39');
const [source,roster,native]=process.argv.slice(2),plan=resolve(FROZEN,'ROSTER-PLAN.json'),excluded=resolve(FROZEN,'EXCLUSIONS.json');
const prior=JSON.parse(readFileSync(excluded)).records,row=JSON.parse(readFileSync(resolve(FROZEN,'ROSTER.json')))[0];
let checked=0;
const mask=Array(4096).fill(0),empty=new Set();
assert.equal(freshness(row,mask,empty,empty),-1);checked++;
assert.equal(freshness(row,mask,new Set([mapKey(row.target)]),empty),2);checked++;
assert.equal(freshness(row,mask,empty,new Set([primitiveKey([...row.primitive_by_role].reverse())])),3);checked++;
const changed=structuredClone(row.primitive_by_role);changed[0]=changed[1];assert.notEqual(primitiveKey(changed),primitiveKey(row.primitive_by_role));checked++;
const root=mkdtempSync(resolve(tmpdir(),'reasoner39-tamper-'));
try {
  const e=resolve(root,'excluded.json');writeFileSync(e,encode({records:prior.slice(1)}));assert.throws(()=>boundInputs(plan,e),/fixed exclusions differs/u);checked++;
  const p=resolve(root,'plan.json');writeFileSync(p,encode({...JSON.parse(readFileSync(plan)),seed:'0000000000000001'}));assert.throws(()=>boundInputs(p,excluded),/fixed plan differs/u);checked++;
  if(source&&roster&&native) {
    const original=readFileSync(native,'utf8').trim().split('\n').map(v=>JSON.parse(v));
    const cases=[
      rows=>{rows.find(r=>r.kind==='decision').reason=3;},
      rows=>{rows.splice(rows.findIndex(r=>r.kind==='decision'),1);},
      rows=>{rows.find(r=>!r.kind).target.bias[0]=(rows.find(r=>!r.kind).target.bias[0]+1)%5;},
      rows=>{rows.splice(rows.findIndex(r=>r.kind==='syntax'),1);},
      rows=>{rows.find(r=>!r.kind).nonce+=1;},
      rows=>{rows.push(structuredClone(rows.find(r=>!r.kind)));},
    ];
    for(const mutate of cases) {
      const rows=structuredClone(original);mutate(rows);const n=resolve(root,'native-'+checked+'.jsonl');writeFileSync(n,rows.map(v=>JSON.stringify(v)).join('\n')+'\n');
      await assert.rejects(main(['check',source,plan,excluded,roster,n,resolve(root,'CHECK-'+checked+'.json')]));checked++;
    }
    const copy=resolve(root,'roster');cpSync(roster,copy,{recursive:true});const h=resolve(copy,'exclusions.h');writeFileSync(h,readFileSync(h,'utf8')+'\n');
    await assert.rejects(main(['check',source,plan,excluded,copy,native,resolve(root,'changed-header.json')]),/native exclusion header differs/u);checked++;
  }
  console.log(JSON.stringify({status:'passed',cases:checked,native_tamper_cases:source?7:0}));
} finally {rmSync(root,{recursive:true,force:true});}
