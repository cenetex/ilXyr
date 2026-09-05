import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, copyFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setImmediate } from "node:timers/promises";
import { BudgetTracker, queryLieBatch, writePendingCorpusManifest } from "./run-weight-multiplicity-phase1-corpus.mjs";
import { OracleAttemptTrace } from "./lib/oracle-attempt-trace.mjs";
import { PHASE1_RESOURCE_LIMITS } from "./lib/oracle-resource-accounting.mjs";
import { createResourcePolicy, validateResourcePolicy } from "./lib/weight-multiplicity-resource-policy.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const directory = mkdtempSync(resolve(tmpdir(), "ilxyr-resource-policy-"));
const plan = JSON.parse(readFileSync(resolve(root, "examples/weight-multiplicity/phase1-corpus-plan-v1.json")));
const policy = await createResourcePolicy(root);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const result = (elapsed_ms, multiplicity = "1") => ({ status: "ok", elapsed_ms, multiplicity });
const candidate = (i) => ({ canonical_type: "A1", canonical_representation_id: "A1:1",
  highest_weight: [1], target_weight: [1 - i * 2], target_status: i ? "non_dominant" : "dominant",
  target_depth: i, desired_stratum: "1", query_key: `A1|1|${1 - i * 2}` });
let fixtureIndex = 0;
const fixture = async (overrides = {}) => {
  const out = resolve(directory, String(fixtureIndex++));
  await mkdir(out);
  let now = 0;
  const selected = { ...policy, limits: { ...policy.limits, ...overrides } };
  const trace = new OracleAttemptTrace({ directory: out, hardTimeoutMs: 30000,
    workloadLimits: selected.limits, clock: () => now });
  const budget = new BudgetTracker(plan, { resourcePolicy: selected });
  budget.trace = trace;
  return { out, trace, budget, advance: (ms) => { now += ms; } };
};
const batch = (budget, results, workers = null) => {
  let index = 0;
  return queryLieBatch({ budget,
    workers: workers ?? [{ id: "lie-1", query: async () => results[index++] }],
    candidates: results.map((_, i) => candidate(i)), coordinateMapping: {},
    monitor: { assertOkay() {} }, sliceId: "training" });
};
const seal = (f) => writePendingCorpusManifest({ trace: f.trace,
  path: resolve(f.out, "corpus-manifest.json.pending"), manifest: { status: "sealed", fixture: true } });
const failures = [];

try {
  await validateResourcePolicy(policy, root);
  for (const update of [
    (p) => { p.limits.final_p99_ms = 51; },
    (p) => { p.generator_seed += 1; },
    (p) => { p.accounting_scope = "accepted_corpus_only"; },
    (p) => { p.limits.oracle_calls += 1; },
  ]) {
    const changed = structuredClone(policy); update(changed);
    await assert.rejects(validateResourcePolicy(changed, root), /resource policy differs/);
  }
  const copied = resolve(directory, "changed-source");
  for (const path of Object.keys(policy.source_bindings)) {
    await mkdir(dirname(resolve(copied, path)), { recursive: true });
    await copyFile(resolve(root, path), resolve(copied, path));
  }
  await writeFile(resolve(copied, "scripts/run-weight-multiplicity-phase1-corpus.mjs"), "changed source");
  await assert.rejects(validateResourcePolicy(policy, copied), /resource policy differs/);
  const policyPath = resolve(directory, "policy.json");
  writeFileSync(policyPath, JSON.stringify(policy));
  const check = spawnSync(process.execPath, [resolve(root, "scripts/run-weight-multiplicity-phase1-corpus.mjs"),
    "--check-resource-policy", policyPath], { encoding: "utf8", timeout: 10000 });
  assert.equal(check.status, 0, check.stderr);
  assert.equal(JSON.parse(check.stdout).oracle_processes_started, 0);
  const smaller = spawnSync(process.execPath, [resolve(root, "scripts/run-weight-multiplicity-phase1-corpus.mjs"),
    "--resource-policy", policyPath, "--smoke"], { encoding: "utf8", timeout: 10000 });
  assert.equal(smaller.status, 1);
  assert.match(smaller.stderr, /complete frozen workload/);

  // Warmup work remains in the total record. The fixed clause follows the
  // calibration's workload population, including out-of-range attempts.
  {
    const f = await fixture();
    f.trace.record(candidate(0), { ...result(29999), worker_id: "lie-1" }, {
      sliceId: "setup:warmup", phase: "setup", dispatchSequence: f.trace.nextDispatch() });
    f.advance(10000);
    f.trace.startWorkload();
    await batch(f.budget, [result(1001, "2633282666151119789")]);
    assert.equal(f.trace.workloadAccounting.snapshot().p99_decision_stage, "progress_only");
    assert.equal(f.trace.accounting.firstHold, null);
    await batch(f.budget, Array.from({ length: 99 }, () => result(50)));
    f.advance(1000);
    const expected = await seal(f);
    assert.equal(digest(readFileSync(resolve(f.out, "corpus-manifest.json.pending"))), expected);
    const summary = JSON.parse(readFileSync(f.trace.summaryPath));
    assert.equal(summary.calls, 101);
    assert.equal(summary.total_query_ms, 29999 + 1001 + 99 * 50);
    assert.equal(summary.elapsed_wall_seconds, 11);
    assert.equal(summary.workload_accounting.calls, 100);
    assert.equal(summary.workload_accounting.elapsed_wall_seconds, 1);
    assert.equal(summary.workload_accounting.cumulative_p99_ms, 50);
    assert.equal(summary.workload_accounting.status, "resource_pass");
    assert.equal(summary.workload_accounting.top_50[0].trace_sequence, 2);
    assert.equal(summary.workload_accounting.breakdowns.label_range.find((r) => r.key === "outside_above_31").calls, 1);
    assert.equal(summary.trace_sha256, digest(readFileSync(f.trace.tracePath)));
  }

  // Final p99 is binding before even the pending corpus manifest is written.
  {
    const f = await fixture(); f.trace.startWorkload();
    await batch(f.budget, Array.from({ length: 100 }, (_, i) => result(i < 2 ? 51 : 50)));
    assert.equal(f.trace.accounting.firstHold, null);
    await assert.rejects(seal(f), /final_p99_limit/);
    assert.equal(existsSync(resolve(f.out, "corpus-manifest.json.pending")), false);
    const summary = JSON.parse(readFileSync(f.trace.summaryPath));
    assert.equal(summary.workload_accounting.complete_call_set, true);
    assert.equal(summary.workload_accounting.cumulative_p99_ms, 51);
    failures.push({ fixture: "final_p99_above_limit", reason: summary.hold.reason, calls: summary.calls,
      pending_manifest_created: false });
  }

  // Call slots are reserved before dispatch, and every started call drains.
  {
    const f = await fixture({ oracle_calls: 1 }); f.trace.startWorkload();
    let calls = 0;
    await assert.rejects(batch(f.budget, [result(1), result(1)], [1, 2].map((id) => ({ id: `lie-${id}`,
      query: async () => { calls += 1; return result(1); } }))), /oracle_call_limit/);
    assert.equal(calls, 1);
    assert.equal(f.trace.finish(false).calls, 1);
  }
  {
    const f = await fixture({ total_query_ms: 1 }); f.trace.startWorkload();
    const pending = [];
    const workers = [1, 2].map((id) => ({ id: `lie-${id}`,
      query: () => new Promise((done) => pending.push(done)) }));
    const run = batch(f.budget, Array(8).fill(result(1)), workers);
    assert.equal(pending.length, 2);
    pending[0](result(2)); await setImmediate();
    assert.equal(pending.length, 2);
    const firstHold = structuredClone(f.trace.accounting.firstHold);
    pending[1](result(3, "32"));
    await assert.rejects(run);
    const summary = f.trace.finish(false);
    assert.equal(summary.calls, 2);
    assert.equal(summary.total_query_ms, 5);
    assert.deepEqual(summary.hold, firstHold);
    assert.equal(summary.hold.reason, "total_query_time_limit");
    failures.push({ fixture: "query_cost_hold_with_in_flight_work", reason: summary.hold.reason,
      calls: summary.calls, total_query_ms: summary.total_query_ms,
      test_limit_query_ms: 1, first_completed_query_ms: 2, in_flight_query_ms: 3 });
  }
  {
    const f = await fixture({ elapsed_wall_seconds: 1 }); f.trace.startWorkload();
    f.advance(1001);
    let calls = 0;
    await assert.rejects(batch(f.budget, [result(1)], [{ id: "lie-1", query: async () => { calls++; return result(1); } }]), /wall_time_limit/);
    assert.equal(calls, 0);
    assert.equal(f.trace.finish(false).hold.reason, "wall_time_limit");
  }
  {
    const f = await fixture(); f.trace.startWorkload();
    await assert.rejects(batch(f.budget, [result(30000)]), /hard_timeout/);
    const summary = f.trace.finish(false);
    assert.equal(summary.calls, 1);
    assert.equal(summary.hold.reason, "hard_timeout");
  }
  {
    const f = await fixture(); f.trace.startWorkload();
    await assert.rejects(seal(f), /incomplete_call_set/);
    assert.equal(existsSync(resolve(f.out, "corpus-manifest.json.pending")), false);
  }
  {
    const f = await fixture(); f.trace.startWorkload();
    const before = structuredClone(f.budget.frozen);
    f.budget.freeze([{ id: "fixture", hits: 1, attempts: 1, required: 4,
      query_ms: { mean: 1, p95: 1 } }], 0, 8);
    for (const key of ["binding_call_limit", "binding_query_ms_limit", "binding_wall_seconds"])
      assert.equal(f.budget.frozen[key], before[key]);
    assert.notEqual(f.budget.frozen.pilot_projection.binding_call_limit, before.binding_call_limit);
    f.trace.finish(false);
  }

  const summary = { schema: "ilxyr.weight_multiplicity_resource_policy_smoke.v1",
    scope: "controlled_correctness_fixtures", performance_evidence: false,
    full_oracle_run: false, limits: PHASE1_RESOURCE_LIMITS,
    sources: policy.source_bindings, retained_failures: failures,
    checks: ["read_only_policy_preflight", "changed_limits_and_sources_rejected", "full_workload_required",
      "setup_and_workload_accounting", "out_of_range_costs", "final_p99_before_pending_manifest",
      "call_reservations", "in_flight_costs_and_first_hold", "wall_gate_before_dispatch",
      "hard_timeout_boundary", "empty_call_set_hold", "fixed_caps_survive_pilot_projection"] };
  if (process.argv[2]) await writeFile(resolve(process.argv[2]), `${JSON.stringify(summary, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ status: "pass", checks: summary.checks.length, retained_failures: failures }));
} finally { await rm(directory, { recursive: true, force: true }); }
