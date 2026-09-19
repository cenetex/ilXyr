import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ExactP99, PHASE1_RESOURCE_LIMITS } from "./lib/oracle-resource-accounting.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const closeoutPath = "experiments/weight-multiplicity/phase1/phase1-tail-calibration-run-20260901015649-closeout-v1.json";
const closeoutSha = "4ddedd80e464ffa901fa24304b59139a5cc449871a8f7dcb8c525db69e93a398";

export function summarizeTrace(rows) {
  assert(rows.length > 0, "trace is empty");
  const exact = new ExactP99();
  let total = 0;
  const inside = [], outside = [];
  for (const [index, row] of rows.entries()) {
    assert.equal(row.sequence, index + 1, "trace sequence differs");
    assert.equal(row.status, "ok", "historical query status differs");
    assert(Number.isFinite(row.elapsed_ms) && row.elapsed_ms >= 0, "trace latency differs");
    assert(typeof row.multiplicity === "string" && /^(0|[1-9][0-9]*)$/.test(row.multiplicity),
      "multiplicity differs");
    const value = BigInt(row.multiplicity);
    assert.equal(row.multiplicity_bit_length, value === 0n ? 0 : value.toString(2).length,
      "multiplicity bit length differs");
    assert(Number.isSafeInteger(row.target_depth), "target depth differs");
    for (const key of ["canonical_type", "canonical_representation_id", "pilot_slice_id", "worker_id"])
      assert(typeof row[key] === "string" && row[key].length > 0, `${key} differs`);
    for (const key of ["highest_weight", "target_weight"])
      assert(Array.isArray(row[key]) && row[key].length > 0 && row[key].every(Number.isSafeInteger),
        `${key} differs`);
    assert.equal(row.highest_weight.length, row.target_weight.length, "weight dimensions differ");
    exact.add(row.elapsed_ms);
    total += row.elapsed_ms;
    (value <= 31n ? inside : outside).push(row.elapsed_ms);
  }
  const distribution = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const percentile = (numerator, denominator) => sorted[Math.ceil(numerator * sorted.length / denominator) - 1] ?? null;
    return { calls: values.length, mean_ms: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
      p50_ms: percentile(1, 2), p95_ms: percentile(95, 100), p99_ms: percentile(99, 100),
      p999_ms: percentile(999, 1000), maximum_ms: sorted.at(-1) ?? null };
  };
  const overall = distribution(rows.map((row) => row.elapsed_ms));
  assert.equal(exact.value, overall.p99_ms, "streaming and sorted p99 differ");
  const top = [...rows].sort((a, b) => b.elapsed_ms - a.elapsed_ms || a.sequence - b.sequence).slice(0, 50);
  return { overall, total_query_ms: total, top,
    by_label_range: { inside_0_31: distribution(inside), outside_above_31: distribution(outside) } };
}

export async function verifyTrace(tracePath, tailPath, root) {
  const [traceBytes, tailBytes, closeoutBytes] = await Promise.all([
    readFile(tracePath), readFile(tailPath), readFile(resolve(root, closeoutPath)),
  ]);
  assert.equal(digest(closeoutBytes), closeoutSha, "historical closeout differs");
  const closeout = JSON.parse(closeoutBytes);
  assert.equal(digest(traceBytes), closeout.artifacts.trace_sha256, "historical trace digest differs");
  assert.equal(digest(tailBytes), closeout.artifacts.tail_report_sha256, "historical tail digest differs");
  const rows = traceBytes.toString("utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
  const tail = JSON.parse(tailBytes);
  const measured = summarizeTrace(rows);
  assert.equal(rows.length, 26624, "historical query count differs");
  assert.deepEqual(measured.overall, tail.overall, "historical percentile summary differs");
  assert.deepEqual(measured.top, tail.top, "historical slow-query roster differs");
  for (const key of ["calls", "mean_ms", "p50_ms", "p95_ms", "p99_ms", "p999_ms", "maximum_ms"])
    assert.equal(measured.overall[key], closeout.measurement[key], `closeout ${key} differs`);
  const proposed = Math.ceil(measured.overall.p99_ms * 1.25);
  assert.equal(proposed, tail.proposed_generation_p99_limit_ms);
  assert.equal(proposed, PHASE1_RESOURCE_LIMITS.final_p99_ms);
  for (const [name, field] of [["inside_0_31", "inside_0_31"], ["outside_above_31", "outside_above_31"]])
    for (const [key, value] of Object.entries(closeout.tail[field]))
      assert.equal(measured.by_label_range[name][key], value, `${name} ${key} differs`);
  const countBy = (key) => Object.fromEntries([...new Set(measured.top.map((row) => row[key]))].sort()
    .map((value) => [value, measured.top.filter((row) => row[key] === value).length]));
  assert(measured.top.every((row) => BigInt(row.multiplicity) > 31n), "slow-query label range differs");
  assert.deepEqual(countBy("canonical_type"), closeout.tail.top_50_by_type);
  return { schema: "ilxyr.weight_calibration_trace_verification.v1",
    scope: "read_only_verification_of_recorded_cloud_latencies", performance_run_started: false,
    source: { closeout_sha256: closeoutSha, trace_sha256: digest(traceBytes), trace_bytes: traceBytes.length,
      trace_s3_version_id: closeout.artifacts.trace_s3_version_id, tail_sha256: digest(tailBytes) },
    overall: measured.overall, total_query_ms: measured.total_query_ms,
    by_label_range: measured.by_label_range, proposed_final_p99_ms: proposed,
    recorded_query_gates: {
      final_p99: measured.overall.p99_ms <= PHASE1_RESOURCE_LIMITS.final_p99_ms,
      hard_timeout: measured.overall.maximum_ms < PHASE1_RESOURCE_LIMITS.hard_timeout_ms,
      calls: rows.length <= PHASE1_RESOURCE_LIMITS.oracle_calls,
      total_query_ms: measured.total_query_ms <= PHASE1_RESOURCE_LIMITS.total_query_ms,
    },
    wall_gate: "workload_wall_clock_unavailable_in_per_query_trace",
    full_corpus_status: "pending_separate_package_and_run",
    slowest_50: { all_multiplicities_above_31: true, by_type: countBy("canonical_type"),
      sequences: measured.top.map((row) => row.sequence) },
    historical_wrapper_status: closeout.operational_status,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [trace, tail, output] = process.argv.slice(2);
  assert(trace && tail && output && process.argv.length === 5,
    "usage: node scripts/verify-weight-multiplicity-calibration-trace.mjs TRACE TAIL OUTPUT");
  const result = await verifyTrace(trace, tail, resolve(import.meta.dirname, ".."));
  await writeFile(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ verified_queries: result.overall.calls, p99_ms: result.overall.p99_ms,
    proposed_limit_ms: result.proposed_final_p99_ms, recorded_query_gates: result.recorded_query_gates }));
}
