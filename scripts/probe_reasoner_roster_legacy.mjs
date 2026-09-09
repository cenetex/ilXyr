import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {loadSource,candidate,freshness,primitiveKey,mapKey,encode,sha} from './reasoner_fresh_roster.mjs';
const [source,output]=process.argv.slice(2);if(!source||!output)throw new Error('source and output paths required');
const {verifyCohort}=await import(pathToFileURL(resolve(source,'scripts/lib/reasoner55_matched.mjs')));
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../experiments/research-step-39')+'/';const read=n=>JSON.parse(readFileSync(root+n));await loadSource(source);
const original=read('ROSTER.json'),prior=read('EXCLUSIONS.json').records,plan=read('ROSTER-PLAN.json'),mask=Array(4096).fill(0);for(const ast of read('SOURCE-SYNTAX.json'))mask[ast]=1;
const behaviors=new Set([...prior,...original].map(r=>mapKey(r.target))),primitives=new Set([...prior,...original].map(r=>primitiveKey(r.primitive_by_role)));
let changed;
for(let nonce=original[0].nonce+1;nonce<=65535;nonce++) {
 const f=candidate(plan.seed,0,nonce),row={...original[0],nonce,family_seed:f.familySeed.toString(16).padStart(16,'0'),primitive_by_role:f.primitiveByRole,surface_to_role:f.surfaceToRole,surface_ids:f.surfaceIds,target_roles:f.targetRoles,target:f.target,example_input:f.exampleInput,example_output:f.exampleOutput,rejections:[nonce,0,0,0]};
 if(freshness(row,mask,behaviors,primitives)===-1){changed=row;break;}
}
if(!changed)throw new Error('probe exhausted');const altered=[changed,...original.slice(1)];verifyCohort(original,32,plan.seed);verifyCohort(altered,32,plan.seed);
const result={schema:'ilxyr.reasoner_legacy_roster_probe.v1',scope:'Controlled validator alteration; historical cohorts remain unchanged',status:'coverage_gap_reproduced',original_nonce:original[0].nonce,altered_nonce:changed.nonce,original_first_candidate_was_eligible:true,legacy_checker_accepted_later_candidate:true,legacy_checker_accepted_invented_rejection_counts:true,altered_row:changed,original_roster_sha256:sha(readFileSync(root+'ROSTER.json')),legacy_checker_sha256:sha(readFileSync(resolve(source,'scripts/lib/reasoner55_matched.mjs'))),fresh_family_method_evaluations:0};writeFileSync(output,encode(result),{flag:'wx'});console.log(JSON.stringify({...result,altered_row:undefined}));
