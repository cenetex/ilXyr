import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ExactQueryCache, canonicalQuery } from './lib/weight-query-cache.mjs';
import { runSelectionPilot, selectionBatch } from './lib/weight-selection-pilot.mjs';
import { candidateFor, createCandidateBatch, fnv1a, makeRandom, prepareRepresentations,
  queryKey, RepresentationPicker } from './lib/weight-candidates-v2.mjs';

const oracleSha256 = 'a'.repeat(64);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const candidate = (target, desired = '1', value = '1', orbit = String(Math.abs(target))) => ({
  canonical_type: 'A1', canonical_representation_id: 'A1:8', highest_weight: [8], target_weight: [target],
  target_status: target < 0 ? 'non_dominant' : 'dominant', dominant_target_key: orbit,
  desired_stratum: desired, query_key: queryKey('A1', [8], [target]), test_value: value,
});
const limits = { maxDraws: 1000, maxOracleCalls: 50, maxEvaluations: 30, maxBatches: 10,
  batchSize: 1, maxAcceptedRows: 20 };
const cacheLimits = { maxEntries: 40, maxPayloadBytes: 4096, maxValueBytes: 64 };
const fixture = (values, overrides = {}) => {
  let index = 0;
  return { picker: { pick: () => ({}) }, random: () => 0,
    makeCandidate: (_, desired) => { const next = values[index++ % values.length]; return next && { ...next, desired_stratum: desired }; },
    query: async c => ({ status: 'ok', multiplicity: c.test_value }), oracleSha256,
    slices: [{ desired: '1', status: 'dominant', required: 2 }], limits, cacheLimits, ...overrides };
};
const roots = JSON.parse(readFileSync(new URL('../examples/weight-multiplicity/phase1-root-systems-v1.json', import.meta.url)));
const manifest = JSON.parse(readFileSync(new URL('../examples/weight-multiplicity/phase06-reduced-corpus-manifest-v1.json', import.meta.url)));

test('copied candidate and batch rules match each frozen source block', () => {
  const binding = JSON.parse(readFileSync(new URL('../experiments/research-step-55/CANDIDATE-SOURCE.json', import.meta.url)));
  const original = readFileSync(binding.source, 'utf8'); const copy = readFileSync(binding.copy, 'utf8');
  assert.equal(hash(original), binding.source_sha256);
  for (const block of binding.blocks) {
    const bytes = original.slice(original.indexOf(block.start), original.indexOf(block.end_before));
    assert.equal(hash(bytes), block.sha256); assert.ok(copy.includes(bytes));
  }
});

test('instrumented batches preserve original candidates and reservations across occupancy', () => {
  const reps = prepareRepresentations(manifest, roots).filter(r => ['A1','A2','B2','C3'].includes(r.canonical_type));
  for (const seed of [1, 2, 1378397233]) {
    const slices = () => ['0','1','2-7','8-31'].flatMap(desired => ['dominant','non_dominant'].map(status =>
      ({ desired, status, accepted: desired === '0' ? 2 : 0, required: 2, attempts: 0 })));
    const a = { picker: new RepresentationPicker(reps, seed), random: makeRandom(seed ^ 77), slices: slices(),
      usedQueries: new Set(), trainingOrbits: new Set(), orbitRestricted: true };
    const b = { picker: new RepresentationPicker(reps, seed), random: makeRandom(seed ^ 77), slices: slices(),
      state: { usedQueries: new Set(), trainingOrbits: new Set(), orbitRestricted: true }, bump: () => {} };
    for (let round = 0; round < 3; round += 1) {
      const baseline = createCandidateBatch({ ...a, batchSize: 16, exceptionalState: null, sliceStats: { total_attempts: 0 } });
      const measured = selectionBatch({ ...b, batchSize: 16 });
      assert.deepEqual(measured, baseline);
      assert.deepEqual(b.state.usedQueries, a.usedQueries); assert.deepEqual(b.state.trainingOrbits, a.trainingOrbits);
    }
  }
});

test('cache binds canonical inputs and exact large values to one oracle', () => {
  const cache = new ExactQueryCache({ oracleSha256, ...cacheLimits }); const c = candidate(8);
  const value = '2633282666151119789'; cache.put(c, oracleSha256, value, 7);
  assert.deepEqual(cache.get({ ...c, canonical_representation_id: 'another-label', desired_stratum: '8-31' }, oracleSha256),
    { multiplicity: value, source_query_sequence: 7 });
  assert.equal(cache.get({ ...c, highest_weight: [10], query_key: undefined }, oracleSha256), null);
  assert.throws(() => cache.get(c, 'b'.repeat(64)), /oracle_identity_differs/);
  assert.throws(() => cache.put(c, oracleSha256, '1', 8), /conflicting_cached_value/);
  assert.throws(() => canonicalQuery({ ...c, query_key: 'forged' }), /query_identity_differs/);
});

test('hash slot collisions preserve distinct exact keys', () => {
  const cache = new ExactQueryCache({ oracleSha256, maxEntries: 2, maxPayloadBytes: 4096, maxValueBytes: 64 });
  const bins = new Map(); let pair;
  for (let target = 0; target < 20; target += 1) {
    const c = candidate(target); const slot = createHash('sha256').update(c.query_key).digest().readUInt32LE(0) & 3;
    if (bins.has(slot)) { pair = [bins.get(slot), c]; break; } bins.set(slot, c);
  }
  assert.ok(pair);
  pair.forEach((c, i) => cache.put(c, oracleSha256, String(i + 2), i + 1));
  pair.forEach((c, i) => assert.equal(cache.get(c, oracleSha256).multiplicity, String(i + 2)));
  assert.equal(cache.snapshot().allocated_buffer_bytes, 4096 + 2 * 16 + 4 * 4);
});

test('repeated mismatches reuse exact answers and preserve selected rows', async () => {
  const values = [candidate(10, '1', '0'), candidate(10, '1', '0'), candidate(8), candidate(6)];
  const cached = await runSelectionPilot(fixture(values));
  const baseline = await runSelectionPilot(fixture(values, { cacheLimits: null }));
  assert.equal(cached.status, 'requested_quotas_reached');
  assert.deepEqual(cached.accepted.map(r => r.query_key), baseline.accepted.map(r => r.query_key));
  assert.equal(cached.totals.oracle_calls, 3); assert.equal(baseline.totals.oracle_calls, 4);
  assert.equal(cached.totals.cache_hits, 1); assert.equal(cached.totals.stratum_rejections, 2);
  assert.equal(cached.evaluations[1].source_query_sequence, 1);
});

test('a cached result can satisfy a later requested stratum', async () => {
  const result = await runSelectionPilot(fixture([candidate(8)], { slices: [
    { desired: '2-7', status: 'dominant', required: 1 }, { desired: '1', status: 'dominant', required: 1 }],
    limits: { ...limits, batchSize: 2, maxBatches: 2 } }));
  assert.equal(result.hold, 'batch_limit');
  assert.equal(result.totals.oracle_calls, 1); assert.equal(result.totals.cache_hits, 1);
  assert.equal(result.accepted[0].slice_id, '1|dominant');
});

test('perfect raw matches can exhaust finite query support', async () => {
  const result = await runSelectionPilot(fixture([candidate(8)]));
  assert.equal(result.hold, 'candidate_generation_exhausted');
  assert.equal(result.totals.label_matches, 1); assert.equal(result.totals.candidate_evaluations, 1);
  assert.equal(result.accepted.length, 1); assert.equal(result.slices[0].required, 2);
  assert.equal(result.totals.query_exclusions, 100);
  assert.equal(result.candidate_support.status, 'unknown');
  assert.equal(result.checkpoints.at(-1).slices[0].calls_for_remaining_at_block_rate, null);
});

test('different exact queries compete for the same allowed orbit', async () => {
  let draws = 0;
  const result = await runSelectionPilot(fixture([], { slices: [
    { desired: '1', status: 'dominant', required: 1 }, { desired: '1', status: 'non_dominant', required: 1 }],
    makeCandidate: (_, desired, status) => { draws++; return candidate(status === 'dominant' ? 8 : -8, desired); },
    limits: { ...limits, batchSize: 2 } }));
  assert.equal(result.accepted.length, 1); assert.equal(result.hold, 'candidate_generation_exhausted');
  assert.ok(result.totals.orbit_exclusions > 0); assert.equal(result.selected_orbits, 1);
  assert.equal(draws, result.totals.candidate_draws);
});

test('cache capacity stops before another call and keeps the first result', async () => {
  let calls = 0;
  const result = await runSelectionPilot(fixture([candidate(10,'1','0'), candidate(12,'1','0')], {
    cacheLimits: { ...cacheLimits, maxEntries: 1 }, query: async c => { calls++; return { status: 'ok', multiplicity: c.test_value }; } }));
  assert.equal(result.hold, 'cache_capacity'); assert.equal(calls, 1); assert.equal(result.cache.entries, 1);
  assert.equal(result.selected_queries, 0); assert.equal(result.selected_orbits, 0);
});

test('candidate draw and occupancy limits release pending reservations', async () => {
  const draw = await runSelectionPilot(fixture([candidate(8), candidate(6)], { limits: { ...limits, maxDraws: 1, batchSize: 2 } }));
  assert.equal(draw.hold, 'candidate_draw_limit'); assert.equal(draw.selected_queries, 0); assert.equal(draw.totals.oracle_calls, 0);
  const occupancy = await runSelectionPilot(fixture([candidate(8), candidate(6)], { limits: { ...limits, batchSize: 2, maxAcceptedRows: 1 } }));
  assert.equal(occupancy.hold, 'pilot_occupancy_limit'); assert.equal(occupancy.selected_queries, 1);
  assert.equal(occupancy.evaluations[1].disposition, 'uncommitted_at_hold');
});

test('quota overflow matches remain separate from accepted rows', async () => {
  const result = await runSelectionPilot(fixture([candidate(8), candidate(6)], {
    slices: [{ desired: '1', status: 'dominant', required: 1 }], limits: { ...limits, batchSize: 2 } }));
  assert.equal(result.totals.label_matches, 2); assert.equal(result.totals.quota_rejections, 1);
  assert.equal(result.accepted.length, 1); assert.equal(result.selected_queries, 1);
});

test('oracle failures retain completed observations and release the incomplete batch', async () => {
  let calls = 0;
  const result = await runSelectionPilot(fixture([candidate(8), candidate(6)], { limits: { ...limits, batchSize: 2 },
    query: async c => { if (++calls === 2) throw new Error('invented worker failure'); return { status: 'ok', multiplicity: c.test_value }; } }));
  assert.equal(result.hold, 'oracle_failure'); assert.equal(result.cache.entries, 1);
  assert.equal(result.evaluations[0].disposition, 'uncommitted_at_hold'); assert.equal(result.evaluations[1].status, 'failed');
  assert.equal(result.selected_queries, 0); assert.equal(result.totals.oracle_calls, 2);
});

test('malformed oracle results and source fields fail closed', async () => {
  for (const value of ['-1', '01', '1.0', 1, null]) {
    const result = await runSelectionPilot(fixture([candidate(8)], { query: async () => ({ status: 'ok', multiplicity: value }) }));
    assert.equal(result.hold, 'invalid_oracle_result'); assert.equal(result.cache.entries, 0);
  }
  const c = candidate(8);
  assert.throws(() => canonicalQuery({ ...c, target_weight: [1.5] }), /invalid_query_weight/);
  assert.throws(() => new ExactQueryCache({ oracleSha256, ...cacheLimits, maxEntries: -1 }), /invalid_cache_limits/);
});

test('the real A1 generator exposes a quota failure under the original orbit rule', async () => {
  const reps = prepareRepresentations(manifest, roots).filter(r => r.canonical_type === 'A1' && r.highest_weight[0] === 1);
  assert.equal(reps.length, 1);
  const result = await runSelectionPilot({ picker: new RepresentationPicker(reps, 17), random: makeRandom(17 ^ fnv1a('candidate')),
    slices: [{ desired: '1', status: 'dominant', required: 2 }], limits: { ...limits, batchSize: 4 },
    oracleSha256, cacheLimits, query: async c => ({ status: 'ok', multiplicity:
      Math.abs(c.target_weight[0]) === 1 ? '1' : '0' }) });
  assert.equal(result.accepted.length, 1); assert.equal(result.status, 'hold');
  assert.equal(result.selected_orbits, 1); assert.ok(result.totals.query_exclusions > 0);
});


test('original fixed batch start can starve a later matching range', async () => {
  const options = { slices: [{ desired: '2-7', status: 'dominant', required: 1 },
    { desired: '1', status: 'dominant', required: 1 }], limits: { ...limits, batchSize: 2, maxBatches: 2 }, rotateSlices: false };
  const result = await runSelectionPilot(fixture([candidate(8)], options));
  assert.equal(result.accepted.length, 0); assert.equal(result.totals.oracle_calls, 1);
  assert.equal(result.totals.cache_hits, 1); assert.equal(result.hold, 'batch_limit');
});

const { finiteSupportCapacity } = await import('./lib/weight-finite-support.mjs');
test('complete finite roster proves coupled quota failure despite perfect label yield', () => {
  const roster = [candidate(8), candidate(-8)].map(c => ({ ...c, multiplicity: '1' }));
  const slices = [{ desired: '1', status: 'dominant', required: 1 },
    { desired: '1', status: 'non_dominant', required: 1 }];
  const result = finiteSupportCapacity(roster, slices);
  assert.equal(result.status, 'quota_unreachable');
  assert.equal(result.unique_queries, 2); assert.equal(result.maximum_assignable_rows, 1);
  assert.equal(finiteSupportCapacity(roster, slices, { orbitRestricted: false }).status, 'quota_assignment_exists');
});

test('finite capacity can reassign an orbit to satisfy both target-status quotas', () => {
  const roster = [candidate(8), candidate(-8), candidate(6)].map(c => ({ ...c, multiplicity: '1' }));
  const result = finiteSupportCapacity(roster, [{ desired: '1', status: 'dominant', required: 1 },
    { desired: '1', status: 'non_dominant', required: 1 }]);
  assert.equal(result.status, 'quota_assignment_exists'); assert.equal(result.maximum_assignable_rows, 2);
  assert.throws(() => finiteSupportCapacity([...roster, { ...roster[0], multiplicity: '2' }],
    [{ desired: '1', status: 'dominant', required: 1 }]), /conflicting_finite_label/);
});

test('finite assignment agrees with exhaustive choices on all three-orbit support patterns', () => {
  for (let pattern = 0; pattern < 64; pattern += 1) {
    const roster = []; const allowed = [];
    for (let orbit = 0; orbit < 3; orbit += 1) {
      const mask = (pattern >> (orbit * 2)) & 3; allowed.push(mask);
      for (const [bit, sign] of [[1,1],[2,-1]]) if (mask & bit)
        roster.push({ ...candidate(sign * (8 - 2 * orbit)), multiplicity: '1' });
    }
    for (let dominant = 1; dominant <= 3; dominant += 1) for (let other = 1; other <= 3; other += 1) {
      function brute(index, d, n) {
        if (index === 3) return d + n;
        return Math.max(brute(index + 1, d, n),
          allowed[index] & 1 && d < dominant ? brute(index + 1, d + 1, n) : 0,
          allowed[index] & 2 && n < other ? brute(index + 1, d, n + 1) : 0);
      }
      const actual = finiteSupportCapacity(roster, [{ desired: '1', status: 'dominant', required: dominant },
        { desired: '1', status: 'non_dominant', required: other }]);
      assert.equal(actual.maximum_assignable_rows, brute(0,0,0));
    }
  }
});
