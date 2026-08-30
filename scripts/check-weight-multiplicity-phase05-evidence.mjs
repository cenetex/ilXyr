#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const read = (path) => readFile(resolve(root, path));
const readJson = async (path) => JSON.parse((await read(path)).toString("utf8"));

const coldPlanPath = "examples/weight-multiplicity/phase05-cold-replay-plan-v1.json";
const coldSummaryPath = "experiments/weight-multiplicity/phase05/cold-replay-v1-summary.json";
const coldCompressedPath = "experiments/weight-multiplicity/phase05/cold-replay-v1.json.gz";
const coldDecisionPath = "experiments/weight-multiplicity/phase05/COLD-REPLAY-V1-HOLD.md";
const lieManifestV3Path = "examples/weight-multiplicity/phase05-lie-cross-check-manifest-v3.json";
const lieManifestV4Path = "examples/weight-multiplicity/phase05-lie-cross-check-manifest-v4.json";
const lieResultV4Path = "experiments/weight-multiplicity/phase05/lie-cross-check-v4.json";
const lieDecisionV4Path = "experiments/weight-multiplicity/phase05/LIE-CROSS-CHECK-V4-PASS.md";

const [
  coldPlanBytes,
  coldSummaryBytes,
  coldCompressedBytes,
  coldDecisionBytes,
  lieManifestV3,
  lieManifestV4Bytes,
  lieResultV4Bytes,
  lieDecisionV4Bytes,
] = await Promise.all([
  read(coldPlanPath),
  read(coldSummaryPath),
  read(coldCompressedPath),
  read(coldDecisionPath),
  readJson(lieManifestV3Path),
  read(lieManifestV4Path),
  read(lieResultV4Path),
  read(lieDecisionV4Path),
]);

const coldRawBytes = gunzipSync(coldCompressedBytes);
const cold = JSON.parse(coldRawBytes.toString("utf8"));
const coldSummary = JSON.parse(coldSummaryBytes.toString("utf8"));
const coldDecision = coldDecisionBytes.toString("utf8");
const lieManifestV4 = JSON.parse(lieManifestV4Bytes.toString("utf8"));
const lieResultV4 = JSON.parse(lieResultV4Bytes.toString("utf8"));
const lieDecisionV4 = lieDecisionV4Bytes.toString("utf8");

assert.equal(sha256(coldPlanBytes), "4355bc8a9d156fb7ae3ae9f3867bb0d91f80e76d6b6ac9c56f85cb4bcc4611a1");
assert.equal(sha256(coldSummaryBytes), "7aea6035dbabe4b53423df03b9e495b81377628a39528a3ed59314708319690b");
assert.equal(sha256(coldRawBytes), "722539ae1083263dcff72a34ea33a200d11763147d0d500ed63e293e95f352c7");
assert.equal(sha256(coldCompressedBytes), "68a37cbb77109144883849cf1313e9159750f28b4528a9c6f0d08e6a7fa90ef7");
assert.equal(cold.evidence_status, "hold");
assert.equal(cold.summary.cells, 248);
assert.equal(cold.summary.requests, 19139);
assert.equal(cold.summary.completed_requests, 19139);
assert.equal(cold.summary.former_timeouts_recovered, 35);
assert.equal(cold.summary.exactness.matches, 19104);
assert.equal(cold.summary.exactness.mismatches, 0);
assert.equal(cold.summary.hard_timeouts, 0);
assert.equal(cold.summary.oracle_errors, 0);
assert.equal(cold.summary.time_threshold_exceedances, 2);
assert.equal(cold.summary.memory.pass, 248);
assert.equal(cold.summary.memory.fail, 0);
assert.equal(cold.summary.memory.unknown, 0);
assert.equal(cold.summary.memory.maximum_measured_incremental_bytes, 5128192);
assert.deepEqual(
  cold.cells
    .flatMap((cell) => cell.requests)
    .filter((request) => request.threshold_exceeded)
    .map((request) => request.request),
  [
    "E8\t0,0,1,0,3,2,0,0\t1,-1,1,2,0,0,0,1",
    "E8\t1,1,1,1,1,1,1,1\t0,2,1,1,1,0,0,0",
  ],
);
assert.equal(coldSummary.evidence_status, "hold");
assert.equal(coldSummary.summary.known_label_matches, cold.summary.exactness.matches);
assert.equal(coldSummary.summary.time_threshold_exceedances, 2);
assert.match(coldDecision, /Hold for the canonicalization-only resource stage/);
assert.match(coldDecision, /session-memo stage may now be measured/);

assert.equal(sha256(lieManifestV4Bytes), "cef67e70a8865fba8c0e03be7688c455c7da75b00e823c68003c3da42d6b04e4");
assert.equal(sha256(lieResultV4Bytes), "f5e724365db6a8f815c133133b21bd9acbbb8245035e8e111b0ef2bd7c16449b");
assert.equal(lieManifestV4.witness_version, 4);
assert.equal(lieManifestV4.zero_executable_sha256, "e09f8059d77598b969f33f24e6e9c38818c195b6f61aed699c771f45f1019914");
assert.deepEqual(lieManifestV4.cases, lieManifestV3.cases);
assert.equal(lieResultV4.evidence_status, "pass");
assert.equal(lieResultV4.summary.completed, 496);
assert.equal(lieResultV4.summary.agreements, 496);
assert.equal(lieResultV4.summary.disagreements, 0);
assert(lieResultV4.results.every((result) => result.agreement));
assert.match(lieDecisionV4, /independent correctness witness/);
assert.match(lieDecisionV4, /separate from the internal/);

console.log(JSON.stringify({
  status: "pass",
  cold_replay: {
    decision: cold.evidence_status,
    requests: cold.summary.requests,
    exact_matches: cold.summary.exactness.matches,
    former_timeouts_recovered: cold.summary.former_timeouts_recovered,
    time_failures: cold.summary.time_threshold_exceedances,
  },
  independent_lie_witness: {
    decision: lieResultV4.evidence_status,
    agreements: lieResultV4.summary.agreements,
  },
}));
