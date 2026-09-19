import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runSelectionPilot } from './lib/weight-selection-pilot.mjs';
import { queryKey } from './lib/weight-candidates-v2.mjs';

const oracleSha256 = 'a'.repeat(64);
const limits = { maxDraws: 1000, maxOracleCalls: 50, maxEvaluations: 30, maxBatches: 10, batchSize: 1, maxAcceptedRows: 20 };
const cacheLimits = { maxEntries: 40, maxPayloadBytes: 4096, maxValueBytes: 64 };
const candidate = target => ({ canonical_type: 'A1', canonical_representation_id: 'A1:8', highest_weight: [8],
  target_weight: [target], target_status: target < 0 ? 'non_dominant' : 'dominant', dominant_target_key: String(Math.abs(target)),
  query_key: queryKey('A1', [8], [target]) });
const cases = [
  { id: 'reuse', targets: [10,10,8,6] },
  { id: 'uncached', targets: [10,10,8,6], cache: false },
  { id: 'capacity', targets: [10,12], cacheLimits: { ...cacheLimits, maxEntries: 1 } },
  { id: 'draw_limit', targets: [8,6], limits: { ...limits, maxDraws: 1, batchSize: 2 } },
  { id: 'occupancy', targets: [8,6], limits: { ...limits, maxAcceptedRows: 1, batchSize: 2 } },
  { id: 'worker_failure', targets: [8,6], limits: { ...limits, batchSize: 2 }, fail: 2 },
  { id: 'invalid_result', targets: [8], badValue: '-1' },
  { id: 'query_capacity', targets: [8] },
  { id: 'oracle_limit', targets: [10,12], limits: { ...limits, maxOracleCalls: 1 } },
  { id: 'evaluation_limit', targets: [10], limits: { ...limits, maxEvaluations: 1 } },
  { id: 'batch_limit', targets: [10], limits: { ...limits, maxBatches: 1 } },
  { id: 'quota_overflow', targets: [8,6], slices: [{ desired:'1', status:'dominant', required:1 }], limits:{ ...limits,batchSize:2 } },
];
const [output] = process.argv.slice(2);
await mkdir(output, { recursive: false });
for (const fixture of cases) {
  const events = []; let cursor = 0; let calls = 0;
  const config = { slices: fixture.slices ?? [{ desired: '1', status: 'dominant', required: 2 }],
    limits: fixture.limits ?? limits, cache: fixture.cache !== false, rotate: true,
    cache_limits: fixture.cacheLimits ?? cacheLimits, oracle_sha256: oracleSha256 };
  const result = await runSelectionPilot({ picker: { pick: () => ({}) }, random: () => 0,
    slices: config.slices, limits: config.limits, oracleSha256,
    cacheLimits: config.cache ? config.cache_limits : null,
    makeCandidate: (_, desired) => ({ ...candidate(fixture.targets[cursor++ % fixture.targets.length]), desired_stratum: desired }),
    query: async c => { if (++calls === fixture.fail) throw new Error('invented_worker_failure');
      return { status: 'ok', multiplicity: fixture.badValue ?? (Math.abs(c.target_weight[0]) <= 8 ? '1' : '0') }; },
    onEvent: event => events.push({ sequence: events.length + 1, ...structuredClone(event) }) });
  const directory = resolve(output, fixture.id); await mkdir(directory);
  for (const [name, data] of [['config',config],['result',result]]) await writeFile(resolve(directory,name+'.json'),JSON.stringify(data,null,2)+'\n');
  await writeFile(resolve(directory,'events.jsonl'),events.map(e => JSON.stringify(e)+'\n').join(''));
}
console.log(JSON.stringify({ fixtures: cases.length, native_oracle_calls: 0 }));
