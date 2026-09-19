import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ExactP99, OracleResourceAccounting, PHASE1_RESOURCE_LIMITS } from "./lib/oracle-resource-accounting.mjs";

const query = (sequence, elapsed_ms = 1, extra = {}) => ({
  sequence, elapsed_ms, slice_id: "training|1|dominant", worker_id: "lie-0",
  canonical_type: "A2", canonical_representation_id: "A2:1,0",
  highest_weight: [1, 0], target_weight: [1, 0], target_depth: 0,
  multiplicity: "1", status: "ok", disposition: "inside_label_range", ...extra,
});
const finish = (tracker, complete = true, elapsedWallSeconds = 1) =>
  tracker.finish({ complete, elapsedWallSeconds });

// Compare every prefix with a separate sort across rank boundaries and ties.
for (const values of [
  Array.from({ length: 401 }, (_, i) => i),
  Array.from({ length: 401 }, (_, i) => 400 - i),
  Array(401).fill(50),
  Array.from({ length: 401 }, (_, i) => ((i * 7919) % 337) / 7),
]) {
  const accumulator = new ExactP99();
  const prefix = [];
  for (const value of values) {
    prefix.push(value);
    const reference = [...prefix].sort((a, b) => a - b)[Math.ceil(prefix.length * 99 / 100) - 1];
    assert.equal(accumulator.add(value), reference);
    assert.equal(accumulator.count, prefix.length);
  }
}

const earlyTail = new OracleResourceAccounting();
earlyTail.observe(query(1, 1000, { multiplicity: "2633282666151119789" }), 0);
assert.equal(earlyTail.snapshot().status, "collecting");
assert.equal(earlyTail.snapshot().cumulative_p99_ms, 1000);
assert.equal(earlyTail.snapshot().p99_decision_stage, "progress_only");
for (let i = 2; i <= 100; i += 1) earlyTail.observe(query(i, 50), 0);
const passed = finish(earlyTail);
assert.equal(passed.status, "resource_pass");
assert.equal(passed.cumulative_p99_ms, 50);
assert.equal(passed.top_50[0].multiplicity_bit_length, 62);
assert.equal(passed.breakdowns.label_range.find((x) => x.key === "outside_above_31").calls, 1);
assert.equal(passed.top_50.length, 50);
assert.deepEqual(passed.top_50.slice(1).map((x) => x.sequence), Array.from({ length: 49 }, (_, i) => i + 2));
assert.throws(() => earlyTail.observe(query(101), 1), /already final/);

const finalTail = new OracleResourceAccounting();
for (let i = 1; i <= 100; i += 1) finalTail.observe(query(i, i <= 2 ? 51 : 50), 0);
assert.equal(finalTail.snapshot().status, "collecting");
assert.equal(finish(finalTail).hold.reason, "final_p99_limit");

for (const [limits, record, wall, reason] of [
  [{}, query(1, 30000), 0, "hard_timeout"],
  [{}, query(1, 1, { status: "hard_timeout", multiplicity: null }), 0, "hard_timeout"],
  [{}, query(1, 1, { status: "process_exit", multiplicity: null }), 0, "oracle_query_failure"],
  [{ total_query_ms: 1 }, query(1, 1.001), 0, "total_query_time_limit"],
  [{ elapsed_wall_seconds: 1 }, query(1), 1.001, "wall_time_limit"],
]) {
  const tracker = new OracleResourceAccounting({ ...PHASE1_RESOURCE_LIMITS, ...limits });
  tracker.observe(record, wall);
  const first = tracker.snapshot().hold;
  assert.equal(first.reason, reason);
  assert.equal(first.triggering_query.sequence, 1);
  tracker.observe(query(2, 30001, { status: "hard_timeout", multiplicity: null }), wall);
  const result = finish(tracker, false, wall);
  assert.equal(result.calls, 2);
  assert.equal(result.hold.reason, reason);
  assert.equal(result.hold.triggering_query.sequence, 1);
  assert.equal(result.breakdowns.label_range.find((x) => x.key === "unavailable").calls, record.multiplicity === null ? 2 : 1);
}

const capacity = new OracleResourceAccounting({ ...PHASE1_RESOURCE_LIMITS, oracle_calls: 1, total_query_ms: 2 });
capacity.observe(query(1), 0);
assert.equal(capacity.snapshot().hold, null);
capacity.observe(query(2), 0);
assert.equal(finish(capacity).hold.reason, "oracle_call_limit");
assert.equal(finish(new OracleResourceAccounting()).hold.reason, "incomplete_call_set");
const incomplete = new OracleResourceAccounting();
incomplete.observe(query(1), 0);
assert.equal(finish(incomplete, false).hold.reason, "incomplete_call_set");

for (const changed of [
  { sequence: 2 }, { sequence: 0 }, { elapsed_ms: NaN }, { elapsed_ms: -1 },
  { multiplicity: "-1" }, { multiplicity: null }, { target_weight: [1] },
  { worker_id: "" }, { target_depth: 1.5 }, { disposition: "" },
]) {
  const tracker = new OracleResourceAccounting();
  assert.throws(() => tracker.observe(query(1, 1, changed), 0));
  assert.equal(tracker.snapshot().calls, 0);
}
const clock = new OracleResourceAccounting();
clock.observe(query(1), 1);
assert.throws(() => clock.observe(query(2), 0), /monotonic/);
assert.equal(clock.snapshot().calls, 1);
const detached = clock.snapshot();
detached.top_50[0].highest_weight[0] = 42;
assert.equal(clock.snapshot().top_50[0].highest_weight[0], 1);

const closeout = JSON.parse(await readFile(new URL("../experiments/weight-multiplicity/phase1/phase1-tail-calibration-run-20260901015649-closeout-v1.json", import.meta.url)));
assert.equal(PHASE1_RESOURCE_LIMITS.final_p99_ms, Math.ceil(closeout.measurement.p99_ms * 1.25));
assert.equal(PHASE1_RESOURCE_LIMITS.hard_timeout_ms, closeout.measurement.hard_abort_ms);
assert.equal(PHASE1_RESOURCE_LIMITS.oracle_calls, closeout.budget.binding_call_limit);
assert.equal(PHASE1_RESOURCE_LIMITS.total_query_ms, closeout.budget.binding_query_ms_limit);
assert.equal(PHASE1_RESOURCE_LIMITS.elapsed_wall_seconds, closeout.budget.binding_wall_seconds);
console.log("Exact p99, final gates, complete accounting, failure retention, and frozen limits passed.");
