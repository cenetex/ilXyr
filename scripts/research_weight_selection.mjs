import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSelectionPilot } from './lib/weight-selection-pilot.mjs';
import { finiteSupportCapacity } from './lib/weight-finite-support.mjs';
import { fnv1a, makeRandom, prepareRepresentations, queryKey, RepresentationPicker } from './lib/weight-candidates-v2.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const fixtureContract = { kind: 'declared_A1_development_answers', highest: 8,
  values: { '-8': '1', '6': '1', '8': '1', '10': '0', '12': '0' } };
const oracleSha256 = digest(JSON.stringify(fixtureContract));
const limits = { maxDraws: 1000, maxOracleCalls: 50, maxEvaluations: 30, maxBatches: 10,
  batchSize: 1, maxAcceptedRows: 20 };
const cacheLimits = { maxEntries: 40, maxPayloadBytes: 4096, maxValueBytes: 64 };
const candidate = target => ({ canonical_type: 'A1', canonical_representation_id: 'A1:8',
  highest_weight: [8], target_weight: [target], target_status: target < 0 ? 'non_dominant' : 'dominant',
  dominant_target_key: String(Math.abs(target)), query_key: queryKey('A1', [8], [target]) });
const fixture = (targets, overrides = {}) => {
  let index = 0;
  return { oracleSha256, limits, cacheLimits, picker: { pick: () => ({}) }, random: () => 0,
    slices: [{ desired: '1', status: 'dominant', required: 2 }],
    makeCandidate: (_, desired) => ({ ...candidate(targets[index++ % targets.length]), desired_stratum: desired }),
    query: async c => ({ status: 'ok', multiplicity: fixtureContract.values[c.target_weight[0]] }), ...overrides };
};

export async function development() {
  const cases = {};
  cases.repeated_rejection_uncached = await runSelectionPilot(fixture([10,10,8,6], { cacheLimits: null }));
  cases.repeated_rejection_cached = await runSelectionPilot(fixture([10,10,8,6]));
  const starving = { slices: [{ desired: '2-7', status: 'dominant', required: 1 },
    { desired: '1', status: 'dominant', required: 1 }], limits: { ...limits, batchSize: 2, maxBatches: 2 } };
  cases.fixed_start_starvation = await runSelectionPilot(fixture([8], { ...starving, rotateSlices: false }));
  cases.rotated_start = await runSelectionPilot(fixture([8], starving));
  cases.finite_query_support = await runSelectionPilot(fixture([8]));
  cases.cache_capacity = await runSelectionPilot(fixture([10,12], { cacheLimits: { ...cacheLimits, maxEntries: 1 } }));
  const roster = [8,-8].map(target => ({ ...candidate(target), multiplicity: '1' }));
  const finite = finiteSupportCapacity(roster, [{ desired: '1', status: 'dominant', required: 1 },
    { desired: '1', status: 'non_dominant', required: 1 }]);
  const root = new URL('../', import.meta.url);
  const reps = prepareRepresentations(JSON.parse(await readFile(new URL('examples/weight-multiplicity/phase06-reduced-corpus-manifest-v1.json', root))),
    JSON.parse(await readFile(new URL('examples/weight-multiplicity/phase1-root-systems-v1.json', root))))
    .filter(r => r.canonical_type === 'A1' && r.highest_weight[0] === 1);
  const a1Contract = { kind: 'A1_highest_1_closed_form_development_control', positive_targets: [-1,1] };
  cases.frozen_A1_candidate_smoke = await runSelectionPilot({ picker: new RepresentationPicker(reps, 17),
    random: makeRandom(17 ^ fnv1a('candidate')), slices: [{ desired: '1', status: 'dominant', required: 2 }],
    oracleSha256: digest(JSON.stringify(a1Contract)), limits: { ...limits, batchSize: 4 }, cacheLimits,
    query: async c => ({ status: 'ok', multiplicity: Math.abs(c.target_weight[0]) === 1 ? '1' : '0' }) });
  assert.equal(cases.repeated_rejection_uncached.totals.oracle_calls, 4);
  assert.equal(cases.repeated_rejection_cached.totals.oracle_calls, 3);
  assert.equal(cases.fixed_start_starvation.accepted.length, 0);
  assert.equal(cases.rotated_start.accepted.length, 1);
  assert.equal(finite.maximum_assignable_rows, 1);
  assert.equal(cases.frozen_A1_candidate_smoke.accepted.length, 1);
  return { schema: 'ilxyr.weight_selection_development.v1', status: 'development_checks_passed_with_quota_holds',
    scope: 'Invented finite rosters and one small A1 candidate smoke using a declared answer control.',
    full_corpus_comparisons: 0, native_oracle_calls: 0,
    development_answer_calls: Object.values(cases).reduce((sum, r) => sum + r.totals.oracle_calls, 0),
    fixture_contracts: [fixtureContract, a1Contract], finite_roster: { records: roster, capacity: finite },
    cases };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [flag, output] = process.argv.slice(2); assert.equal(flag, '--output'); assert.ok(output); assert.equal(process.argv.length, 4);
  await mkdir(output, { recursive: false });
  const result = await development();
  await writeFile(resolve(output, 'RESULT.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: result.status, cases: Object.keys(result.cases).length,
    development_answer_calls: result.development_answer_calls, native_oracle_calls: 0 }));
}
