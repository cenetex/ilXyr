import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setImmediate } from "node:timers/promises";
import { BudgetTracker, PersistentLie, ResourceMonitor, queryLieBatch, transformTarget } from "./run-weight-multiplicity-phase1-corpus.mjs";
import { OracleAttemptTrace } from "./lib/oracle-attempt-trace.mjs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const candidate = (index, extra = {}) => ({ canonical_type: "A1",
  canonical_representation_id: "A1:1", highest_weight: [1], target_weight: [1 - index * 2],
  target_depth: index, target_status: index ? "non_dominant" : "dominant",
  desired_stratum: "1", query_key: `A1|1|${1 - index * 2}`, ...extra });
const ok = (elapsed_ms = 1, multiplicity = "1") => ({ status: "ok", elapsed_ms, multiplicity });
const monitor = { assertOkay() {} };
const directories = [];
const fixture = () => {
  const directory = mkdtempSync(resolve(tmpdir(), "ilxyr-observed-batch-"));
  directories.push(directory);
  const budget = new BudgetTracker({});
  budget.trace = new OracleAttemptTrace({ directory, hardTimeoutMs: 10000 });
  return { directory, budget };
};
const rows = (budget) => readFileSync(budget.trace.tracePath, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const batch = (budget, workers, count, extra = {}) => queryLieBatch({
  workers, candidates: Array.from({ length: count }, (_, index) => candidate(index)),
  coordinateMapping: {}, budget, monitor, sliceId: "training", ...extra,
});
const pendingWorkers = () => {
  const pending = [];
  return { pending, workers: [1, 2].map((id) => ({ id: `lie-${id}`,
    query: () => new Promise((resolveQuery) => pending.push(resolveQuery)) })) };
};

try {
  // Final memory collection waits for the sample already in progress.
  {
    const memory = new ResourceMonitor({ lieWorkers: [], zeroWorkers: [], plan: { memory: {} } });
    let release;
    let stopped = false;
    memory.takeSample = () => new Promise((resolveSample) => { release = resolveSample; });
    const sampling = memory.sample();
    assert.equal(memory.sample(), sampling);
    const stopping = memory.stop().then(() => { stopped = true; });
    await setImmediate();
    assert.equal(stopped, false);
    release();
    await stopping;
    assert.equal(stopped, true);
  }

  // Concurrent checkpoints leave one complete progress record and a valid trace digest.
  {
    const { budget, directory } = fixture();
    budget.frozen = { binding_call_limit: 100, binding_query_ms_limit: 100,
      binding_wall_seconds: 100 };
    budget.setProgressPath(resolve(directory, "progress.json"));
    await Promise.all(Array.from({ length: 5 }, () => budget.checkpoint(true)));
    assert.equal(JSON.parse(readFileSync(budget.progressPath)).oracle_calls, 0);
    budget.trace.finish(false);
  }

  // A failure drains all started calls and stops further dispatches.
  {
    const { budget } = fixture();
    const { workers, pending } = pendingWorkers();
    const completion = batch(budget, workers, 8);
    assert.equal(pending.length, 2);
    pending[0]({ status: "hard_timeout", multiplicity: null, elapsed_ms: 10000 });
    await setImmediate();
    assert.equal(pending.length, 2);
    pending[1](ok(42, "2633282666151119789"));
    await assert.rejects(completion, /lie_query_failure/);
    assert.equal(budget.calls, 2);
    assert.equal(budget.queryMs, 10042);
    const summary = budget.trace.finish(false);
    assert.equal(summary.calls, 2);
    assert.equal(summary.hold.triggering_query.dispatch_sequence, 1);
    assert.equal(summary.top_50.length, 2);
    assert.equal(summary.breakdowns.label_range.find((group) => group.key === "outside_above_31").calls, 1);
    const records = rows(budget);
    assert.deepEqual(records.map((row) => row.dispatch_sequence), [1, 2]);
    assert.equal(records[1].multiplicity_bit_length, 62);
    assert.equal(summary.trace_sha256, createHash("sha256").update(readFileSync(budget.trace.tracePath)).digest("hex"));
  }

  // Completion order changes the trace order; consumers still receive candidate order.
  {
    const { budget } = fixture();
    const { workers, pending } = pendingWorkers();
    const completion = batch(budget, workers, 3);
    pending[1](ok(2, "2"));
    await setImmediate();
    assert.equal(pending.length, 3);
    pending[2](ok(3, "3"));
    pending[0](ok(1));
    const results = await completion;
    assert.deepEqual(results.map((row) => row.multiplicity), ["1", "2", "3"]);
    const records = rows(budget);
    assert.equal(records[0].dispatch_sequence, 2);
    assert.deepEqual(records.map((row) => row.sequence), [1, 2, 3]);
    assert.equal(budget.trace.finish(true).cumulative_p99_ms, 3);
  }

  // Reserve the remaining call allowance before starting concurrent work.
  {
    const { budget } = fixture();
    budget.frozen = { binding_call_limit: 1, binding_query_ms_limit: 100,
      binding_wall_seconds: 100 };
    let calls = 0;
    await assert.rejects(batch(budget, [1, 2].map((id) => ({ id: `lie-${id}`,
      query: async () => { calls += 1; return ok(); } })), 5), /call_budget/);
    assert.equal(calls, 1);
    assert.equal(budget.calls, 1);
    budget.trace.finish(false);
  }

  for (const outcome of ["exception", "negative", "legacy_time"]) {
    const { budget } = fixture();
    const worker = { id: "lie-1", query: async () => {
      if (outcome === "exception") throw new Error("fixture worker failed");
      return outcome === "negative" ? ok(1, "-1") : ok(1001);
    } };
    await assert.rejects(batch(budget, [worker], 3));
    assert.equal(budget.calls, 1);
    assert.equal(rows(budget).length, 1);
    assert.equal(rows(budget)[0].dispatch_sequence, 1);
    if (outcome === "negative") assert.equal(rows(budget)[0].returned_multiplicity, "-1");
    budget.trace.finish(false);
  }

  // Setup and workload remain visible as separate counts in one complete trace.
  {
    const { budget } = fixture();
    budget.trace.record(candidate(0), { ...ok(), worker_id: "lie-1" }, {
      sliceId: "setup:warmup", dispatchSequence: budget.trace.nextDispatch(), phase: "setup",
    });
    await batch(budget, [{ id: "lie-1", query: async () => ok(60) }], 2,
      { candidates: [candidate(0, { target_depth: -1 }), candidate(1, { target_depth: null })] });
    const summary = budget.trace.finish(true);
    assert.deepEqual(summary.phase_calls, { setup: 1, workload: 2 });
    assert.equal(budget.calls, 2);
    assert.equal(summary.p99_decision_stage, "measurement_only");
    assert.equal(summary.hold, null);
    assert.equal(summary.breakdowns.target_depth_band.find((group) => group.key === "below_0").calls, 1);
    assert.equal(summary.breakdowns.target_depth_band.find((group) => group.key === "unavailable").calls, 1);
  }

  // A transformed target carries its new depth. Two inverse reflections recover it.
  assert.deepEqual(transformTarget([1], 0, [[2]], [0]), { weight: [-1], depth: 1 });
  assert.deepEqual(transformTarget([1], 0, [[2]], [0, 0]), { weight: [1], depth: 0 });

  // Exercise the real process timer with a tiny controlled worker.
  {
    const { directory, budget } = fixture();
    const program = resolve(directory, "fake-lie");
    writeFileSync(program, `#!${process.execPath}\nimport('node:readline').then(({createInterface}) => {
      let count = 0; createInterface({ input: process.stdin }).on('line', () => {
        if (++count === 1) process.stdout.write('1\\n');
      }); });\n`, { mode: 0o755 });
    const worker = new PersistentLie({ id: "lie-1", executable: program, hardTimeoutMs: 2500 });
    try {
      await worker.start();
      worker.hardTimeoutMs = 25;
      await assert.rejects(batch(budget, [worker], 2), /lie_query_failure/);
      assert.equal(rows(budget)[0].status, "hard_timeout");
      assert.equal(budget.calls, 1);
    } finally { await worker.close(); budget.trace.finish(false); }
  }

  // The command itself preserves a failed warmup and writes a terminal checksum set.
  {
    const { directory, budget } = fixture();
    budget.trace.finish(false);
    const program = resolve(directory, "wrong-warmup");
    writeFileSync(program, `#!${process.execPath}\nimport('node:readline').then(({createInterface}) => {
      createInterface({ input: process.stdin }).on('line', () => process.stdout.write('2\\n'));
    });\n`, { mode: 0o755 });
    const source = resolve(directory, "lie-source");
    writeFileSync(source, "fixture source");
    const plan = JSON.parse(readFileSync(resolve(root, "examples/weight-multiplicity/phase1-corpus-plan-v1.json")));
    plan.oracle.primary.source_sha256 = createHash("sha256").update("fixture source").digest("hex");
    const planPath = resolve(directory, "plan.json");
    writeFileSync(planPath, JSON.stringify(plan));
    const output = resolve(directory, "run");
    const run = spawnSync(process.execPath, [resolve(root, "scripts/run-weight-multiplicity-phase1-corpus.mjs"),
      "--plan", planPath, "--lie", program, "--lie-source", source,
      "--zero", process.execPath, "--zero-commit", plan.oracle.differential.source_commit,
      "--out", output], { encoding: "utf8", timeout: 10000 });
    assert.equal(run.status, 2, run.stderr);
    const hold = JSON.parse(readFileSync(resolve(output, "hold.json")));
    assert.equal(hold.reason, "lie_warmup_failure");
    assert.equal(hold.oracle_accounting.calls, 1);
    assert.equal(hold.oracle_accounting.hold.triggering_query.multiplicity, "2");
    const sums = readFileSync(resolve(output, "sha256sums.txt"), "utf8").trim().split("\n");
    assert.equal(sums.length, 4);
    for (const line of sums) {
      const [expected, path] = line.split("  ");
      assert.equal(createHash("sha256").update(readFileSync(resolve(output, path))).digest("hex"), expected);
    }
  }
  console.log("Real batch accounting, call reservations, completion order, failure traces, setup scope, and worker timeout passed.");
} finally {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
}
