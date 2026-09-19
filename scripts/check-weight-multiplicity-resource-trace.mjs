import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { OracleResourceAccounting } from "./lib/oracle-resource-accounting.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const [tracePath, outputPath, ...extra] = process.argv.slice(2);
assert(tracePath && outputPath && extra.length === 0,
  "usage: node scripts/check-weight-multiplicity-resource-trace.mjs TRACE.jsonl OUTPUT.json");
const closeoutUrl = new URL("../experiments/weight-multiplicity/phase1/phase1-tail-calibration-run-20260901015649-closeout-v1.json", import.meta.url);
const closeoutBytes = await readFile(closeoutUrl);
const closeout = JSON.parse(closeoutBytes);
const hash = createHash("sha256");
for await (const chunk of createReadStream(tracePath)) hash.update(chunk);
assert.equal(hash.digest("hex"), closeout.artifacts.trace_sha256, "calibration trace digest differs");
const tracker = new OracleResourceAccounting();
const replayHash = createHash("sha256");
const input = createReadStream(tracePath);
input.on("data", (chunk) => replayHash.update(chunk));
const lines = createInterface({ input, crlfDelay: Infinity });
for await (const line of lines) {
  assert(line.length > 0, "trace contains an empty row");
  const row = JSON.parse(line);
  const disposition = row.multiplicity === null ? "oracle_error"
    : BigInt(row.multiplicity) <= 31n ? "inside_label_range" : "outside_label_range";
  tracker.observe({ ...row, slice_id: row.pilot_slice_id, disposition }, 0);
}
assert.equal(replayHash.digest("hex"), closeout.artifacts.trace_sha256, "trace changed during replay");
// Query records supply latency and identity. Wall time requires its own evidence.
const snapshot = tracker.snapshot();
assert.equal(snapshot.calls, closeout.measurement.calls);
assert.equal(snapshot.cumulative_p99_ms, closeout.measurement.p99_ms);
assert.equal(snapshot.top_50[0].elapsed_ms, closeout.measurement.maximum_ms);
const ranges = Object.fromEntries(snapshot.breakdowns.label_range.map((row) => [row.key, row.calls]));
assert.equal(ranges.inside_0_31, closeout.tail.inside_0_31.calls);
assert.equal(ranges.outside_above_31, closeout.tail.outside_above_31.calls);
assert(snapshot.top_50.every((row) => row.label_range === "outside_above_31"));
const topTypes = {};
for (const row of snapshot.top_50) topTypes[row.canonical_type] = (topTypes[row.canonical_type] ?? 0) + 1;
assert.deepEqual(topTypes, closeout.tail.top_50_by_type);
const output = {
  schema: "ilxyr.oracle_resource_trace_audit.v1",
  evidence_kind: "arithmetic_check_of_existing_measurements",
  trace_sha256: closeout.artifacts.trace_sha256,
  closeout_sha256: digest(closeoutBytes),
  checker_sha256: digest(await readFile(new URL(import.meta.url))),
  component_sha256: digest(await readFile(new URL("./lib/oracle-resource-accounting.mjs", import.meta.url))),
  calls: snapshot.calls,
  p99_ms: snapshot.cumulative_p99_ms,
  top_50: snapshot.top_50,
  breakdowns: snapshot.breakdowns,
  wall_time_evidence: "requires_separate_record",
  corpus_resource_decision: null,
};
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ output: outputPath, calls: output.calls, p99_ms: output.p99_ms }));
