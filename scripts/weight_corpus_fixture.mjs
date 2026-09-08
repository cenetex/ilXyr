// Synthetic data for result-checker tests. This does not run an oracle.
import { readFile, mkdir } from 'node:fs/promises';
import { OracleAttemptTrace } from './lib/oracle-attempt-trace.mjs';
const [contextPath, rowPath, directory, slow] = process.argv.slice(2);
const context = JSON.parse(await readFile(contextPath));
const rows = JSON.parse(await readFile(rowPath));
await mkdir(directory, {recursive: true});
let now = 0;
const trace = new OracleAttemptTrace({directory, hardTimeoutMs: context.policy.limits.hard_timeout_ms,
  workloadLimits: context.policy.limits, clock: () => now});
function record(row, phase, elapsed_ms) {
  now += 100;
  trace.record({...row, query_key: `${row.canonical_type}\t${row.highest_weight}\t${row.target_weight}`},
    {status: 'ok', multiplicity: row.multiplicity, elapsed_ms, worker_id: 'lie-1'},
    {sliceId: phase === 'setup' ? 'setup:warmup' : row.partition, phase,
     dispatchSequence: trace.nextDispatch()});
}
record(rows[0], 'setup', 1);
trace.startWorkload();
for (const row of rows) record(row, 'workload', slow ? 51 : 1);
trace.finish(true);
