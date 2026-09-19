// Small native correctness check for the source-bound A1 generator and cache.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { PersistentLie } from './run-weight-multiplicity-phase1-corpus.mjs';
import { runSelectionPilot } from './lib/weight-selection-pilot.mjs';
import { fnv1a, makeRandom, prepareRepresentations, RepresentationPicker } from './lib/weight-candidates-v2.mjs';

const [lie, zero, output] = process.argv.slice(2);
assert.ok(lie && zero && output && process.argv.length === 5);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const contract = { lie_sha256: digest(await readFile(lie)), zero_sha256: digest(await readFile(zero)),
  canonical_mapping: 'A1_identity', query: 'dom_char(highest,target,A1)', scope: 'small_A1_correctness' };
const oracleSha256 = digest(JSON.stringify(contract));
const root = new URL('../', import.meta.url);
const reps = prepareRepresentations(JSON.parse(await readFile(new URL('examples/weight-multiplicity/phase06-reduced-corpus-manifest-v1.json', root))),
  JSON.parse(await readFile(new URL('examples/weight-multiplicity/phase1-root-systems-v1.json', root))))
  .filter(r => r.canonical_type === 'A1' && r.highest_weight[0] === 1);
assert.equal(reps.length, 1);
const result = { schema: 'ilxyr.weight_selection_native_smoke.v1', status: 'failed',
  oracle_contract: contract, oracle_contract_sha256: oracleSha256, full_corpus_comparisons: 0,
  native_calls: { lie_setup: 0, lie_workload: 0, zero_workload: 0 }, observations: [], pilots: {} };
const worker = new PersistentLie({ id: 'selection-smoke', executable: lie, stdbuf: '/usr/bin/stdbuf', hardTimeoutMs: 5000,
  onWarmup: () => { result.native_calls.lie_setup += 1; } });
try {
  await worker.start();
  for (const mode of ['uncached', 'cached', 'reuse_uncached', 'reuse_cached']) {
    const reuse = mode.startsWith('reuse_'); let fixtureCursor = 0;
    result.pilots[mode] = await runSelectionPilot({ picker: new RepresentationPicker(reps, 17),
      random: makeRandom(17 ^ fnv1a('candidate')), slices: [{ desired: '1', status: 'dominant', required: reuse ? 1 : 2 }],
      ...(reuse ? { makeCandidate: (_, desired) => {
        const target = [3,3,1][fixtureCursor++ % 3];
        return { canonical_type: 'A1', canonical_representation_id: 'A1:1', highest_weight: [1], target_weight: [target],
          target_status: 'dominant', dominant_target_key: String(target), desired_stratum: desired,
          query_key: `A1\t1\t${target}` };
      } } : {}),
      oracleSha256, limits: { maxDraws: 1000, maxOracleCalls: 16, maxEvaluations: 64, maxBatches: 4, batchSize: reuse ? 1 : 4, maxAcceptedRows: 4 },
      cacheLimits: ['cached','reuse_cached'].includes(mode) ? { maxEntries: 16, maxPayloadBytes: 4096, maxValueBytes: 64 } : null,
      query: async candidate => {
        assert.equal(candidate.canonical_type, 'A1'); assert.deepEqual(candidate.highest_weight, [1]);
        result.native_calls.lie_workload += 1;
        const primary = await worker.query(`dom_char([1],[${candidate.target_weight}],A1)`);
        assert.equal(primary.status, 'ok');
        result.native_calls.zero_workload += 1;
        const child = spawnSync(zero, ['query','A1','1',candidate.target_weight.join(',')], { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 });
        assert.equal(child.status, 0, child.stderr || child.error?.message);
        const differential = String(JSON.parse(child.stdout).multiplicity);
        const expected = Math.abs(candidate.target_weight[0]) === 1 ? '1' : '0';
        result.observations.push({ mode, target_weight: candidate.target_weight, lie: primary.multiplicity, zero: differential, expected });
        assert.equal(primary.multiplicity, expected); assert.equal(differential, expected);
        return primary;
      } });
    assert.equal(result.pilots[mode].accepted.length, 1);
    assert.equal(result.pilots[mode].status, reuse ? 'requested_quotas_reached' : 'hold');
  }
  const rows = pilot => pilot.accepted.map(({ source_query_sequence, ...row }) => row);
  assert.deepEqual(rows(result.pilots.uncached), rows(result.pilots.cached));
  assert.deepEqual(rows(result.pilots.reuse_uncached), rows(result.pilots.reuse_cached));
  assert.equal(result.pilots.reuse_uncached.totals.oracle_calls, 3);
  assert.equal(result.pilots.reuse_cached.totals.oracle_calls, 2);
  assert.equal(result.pilots.reuse_cached.totals.cache_hits, 1);
  assert.equal(result.native_calls.lie_setup, 1);
  assert.ok(result.native_calls.lie_workload <= 32 && result.native_calls.zero_workload <= 32);
  result.status = 'passed_with_expected_quota_hold';
} finally {
  await worker.close();
  await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
}
