// Independent exact arithmetic for the report-derived targets. Predictors are never loaded.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const lines = p => fs.readFileSync(p, 'utf8').trim().split('\n').map(JSON.parse);
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
function gcd(a,b) { a=a<0n?-a:a; b=b<0n?-b:b; while(b) [a,b]=[b,a%b]; return a; }
function rational(n,d=1n) {
  n=BigInt(n);d=BigInt(d);assert(d!==0n);
  if(d<0n) { n=-n;d=-d; }
  const g=gcd(n,d);return [n/g,d/g];
}
function parse(s) { assert(/^-?\d+(\/\d+)?$/.test(s));const [a,b='1']=s.split('/');return rational(a,b); }
const add=(a,b)=>rational(a[0]*b[1]+b[0]*a[1],a[1]*b[1]);
const neg=a=>[-a[0],a[1]];
const sub=(a,b)=>add(a,neg(b));
const mul=(a,b)=>rational(a[0]*b[0],a[1]*b[1]);
const div=(a,b)=>rational(a[0]*b[1],a[1]*b[0]);
const text=a=>a[1]===1n?String(a[0]):`${a[0]}/${a[1]}`;
function rounded(a) {
  const sign=a[0]<0n?-1n:1n;const scaled=(a[0]<0n?-a[0]:a[0])*100n;
  let cents=scaled/a[1];if(2n*(scaled%a[1])>=a[1]) cents++;
  const fraction=String(cents%100n).padStart(2,'0').replace(/0+$/,'');
  return (sign<0n && cents>0n?'-':'')+String(cents/100n)+(fraction?'.'+fraction:'');
}
function expected(form,family) {
  const value=(role,year)=>parse(family.facts.find(f=>f.role===role && f.year===year).value);
  const a=value('a',2025),b=value('b',2025),old=value('a',2024);
  const numeric={lookup:[a,family.unit],single_year_ratio:[div(a,b),'ratio'],percent_of:[mul(div(b,a),[100n,1n]),'percent'],
    excess:[sub(a,b),family.unit],single_year_sum:[add(a,b),family.unit],year_sum:[add(old,a),family.unit],
    year_average:[div(add(old,a),[2n,1n]),family.unit],year_ratio:[div(a,old),'ratio'],year_change:[sub(a,old),family.unit],
    year_percent_change:[mul(div(sub(a,old),old),[100n,1n]),'percent']};
  if(form==='cumulative_return_difference') {
    assert.equal(family.kind,'shareholder');
    return [mul(sub(div(a,value('a',2020)),div(b,value('b',2020))),[100n,1n]),'percentage_points'];
  }
  return numeric[form];
}
export function check(root, expectedManifestSha) {
  assert(/^[0-9a-f]{64}$/.test(expectedManifestSha));
  assert.equal(hash(fs.readFileSync(path.join(root,'PREPARE.json'))),expectedManifestSha);
  const manifest=read(path.join(root,'PREPARE.json'));
  for(const [file,binding] of Object.entries(manifest.files)) {
    const raw=fs.readFileSync(path.join(root,file));assert.equal(raw.length,binding.bytes);assert.equal(hash(raw),binding.sha256);
  }
  const families=new Map(read(path.join(root,'FAMILIES.json')).map(f=>[f.id,f]));
  const roster=read(path.join(root,'ROSTER.json'));
  const inputs=lines(path.join(root,'predictor/INPUTS.jsonl')),targets=lines(path.join(root,'grader/TARGETS.jsonl'));
  assert.equal(inputs.length,228);assert.equal(targets.length,228);assert.equal(roster.length,228);assert.equal(families.size,8);
  assert.equal(new Set(inputs.map(r=>r.id)).size,228);
  let numeric=0,abstention=0;const styles={canonical:0,paraphrase:0},forms={};const pairs=new Map();
  const missing=new Set(['missing_year','missing_series','ambiguous_label','conflicting_year']);
  for(let i=0;i<roster.length;i++) {
    const r=roster[i],input=inputs[i],target=targets[i],family=families.get(r.family);
    assert.equal(r.id,input.id);assert.equal(r.id,target.id);assert(family);
    assert.deepEqual(Object.keys(input).sort(),['id','question','retrieved_evidence','schema']);
    assert.equal(input.schema,'ilxyr.feral_fresh_input.v1');assert(r.style in styles);styles[r.style]++;
    forms[r.form]=(forms[r.form]??0)+1;
    const answer=expected(r.form,family);
    if(answer) {
      numeric++;assert.equal(target.kind,'numeric');assert.equal(target.exact_value,text(answer[0]));
      assert.equal(target.rounded_value,rounded(answer[0]));assert.equal(target.unit,answer[1]);
      assert(target.source_fact_ids.every(id=>family.facts.some(f=>f.id===id)));
    } else { abstention++;assert(missing.has(r.form));assert.equal(target.kind,'abstention');assert.equal(typeof target.reason,'string'); }
    const pairKey=r.family+':'+r.form;const previous=pairs.get(pairKey);
    if(previous) {
      assert(!previous.styles.has(r.style));previous.styles.add(r.style);
      assert.deepEqual({...previous.target,id:null},{...target,id:null});
      assert.deepEqual(previous.evidence,input.retrieved_evidence);
    } else pairs.set(pairKey,{styles:new Set([r.style]),target,evidence:input.retrieved_evidence});
  }
  assert.equal(numeric,164);assert.equal(abstention,64);assert.deepEqual(styles,{canonical:114,paraphrase:114});
  assert.equal(pairs.size,114);
  assert([...pairs.values()].every(p=>p.styles.size===2));
  return {status:'verified',cases:228,numeric_cases:numeric,abstention_cases:abstention,question_pairs:pairs.size,
    arithmetic:'independent_BigInt_rationals',fresh_predictor_calls:0,forms};
}
if(process.argv[1]===new URL(import.meta.url).pathname) console.log(JSON.stringify(check(process.argv[2],process.argv[3])));
