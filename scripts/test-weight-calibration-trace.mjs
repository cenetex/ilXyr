import assert from "node:assert/strict";
import { summarizeTrace } from "./verify-weight-multiplicity-calibration-trace.mjs";

const row = (sequence, elapsed_ms, multiplicity = "0") => ({ sequence, elapsed_ms, multiplicity,
  multiplicity_bit_length: multiplicity === "0" ? 0 : BigInt(multiplicity).toString(2).length,
  status: "ok", target_depth: 4, canonical_type: "A1", canonical_representation_id: "A1:1",
  pilot_slice_id: "training|0|dominant", worker_id: "lie-1", highest_weight: [1], target_weight: [1] });

const measured = summarizeTrace(Array.from({ length: 100 }, (_, i) => row(i + 1, i + 1)));
assert.equal(measured.overall.p99_ms, 99);
assert.equal(measured.overall.p999_ms, 100);
assert.equal(measured.total_query_ms, 5050);
assert.deepEqual(measured.top.map((r) => r.sequence), Array.from({ length: 50 }, (_, i) => 100 - i));

const tied = summarizeTrace([row(1, 10, "31"), row(2, 10, "32"), row(3, 2, "9007199254740993")]);
assert.deepEqual(tied.top.map((r) => r.sequence), [1, 2, 3]);
assert.equal(tied.by_label_range.inside_0_31.calls, 1);
assert.equal(tied.by_label_range.outside_above_31.calls, 2);

for (const changed of [
  { sequence: 2 }, { status: "error" }, { elapsed_ms: -1 }, { elapsed_ms: Infinity },
  { multiplicity: "-1" }, { multiplicity_bit_length: 1 }, { target_depth: null },
  { highest_weight: [] }, { target_weight: [1, 2] }, { worker_id: "" },
]) assert.throws(() => summarizeTrace([{ ...row(1, 1), ...changed }]));
assert.throws(() => summarizeTrace([]));
console.log("Historical quantiles, slow-query order, exact large multiplicities, and altered trace rows passed.");
