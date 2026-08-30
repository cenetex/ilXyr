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
const sessionCompressedPath = "experiments/weight-multiplicity/phase05/session-frontier-v2.json.gz";
const sessionSummaryPath = "experiments/weight-multiplicity/phase05/session-frontier-v2-summary.json";
const sessionDecisionPath = "experiments/weight-multiplicity/phase05/SESSION-FRONTIER-V2-HOLD.md";
const sessionV3PlanPath = "examples/weight-multiplicity/phase05-frontier-plan-v3.json";
const sessionV3ManifestPath = "examples/weight-multiplicity/phase05-representation-manifest-v3.json";
const sessionV3CompressedPath = "experiments/weight-multiplicity/phase05/session-frontier-v3.json.gz";
const sessionV3SummaryPath = "experiments/weight-multiplicity/phase05/session-frontier-v3-summary.json";
const sessionV3DecisionPath = "experiments/weight-multiplicity/phase05/SESSION-FRONTIER-V3-HOLD.md";

const [
  coldPlanBytes,
  coldSummaryBytes,
  coldCompressedBytes,
  coldDecisionBytes,
  lieManifestV3,
  lieManifestV4Bytes,
  lieResultV4Bytes,
  lieDecisionV4Bytes,
  sessionCompressedBytes,
  sessionSummaryBytes,
  sessionDecisionBytes,
  sessionV3PlanBytes,
  sessionV3ManifestBytes,
  sessionV3CompressedBytes,
  sessionV3SummaryBytes,
  sessionV3DecisionBytes,
] = await Promise.all([
  read(coldPlanPath),
  read(coldSummaryPath),
  read(coldCompressedPath),
  read(coldDecisionPath),
  readJson(lieManifestV3Path),
  read(lieManifestV4Path),
  read(lieResultV4Path),
  read(lieDecisionV4Path),
  read(sessionCompressedPath),
  read(sessionSummaryPath),
  read(sessionDecisionPath),
  read(sessionV3PlanPath),
  read(sessionV3ManifestPath),
  read(sessionV3CompressedPath),
  read(sessionV3SummaryPath),
  read(sessionV3DecisionPath),
]);

const coldRawBytes = gunzipSync(coldCompressedBytes);
const cold = JSON.parse(coldRawBytes.toString("utf8"));
const coldSummary = JSON.parse(coldSummaryBytes.toString("utf8"));
const coldDecision = coldDecisionBytes.toString("utf8");
const lieManifestV4 = JSON.parse(lieManifestV4Bytes.toString("utf8"));
const lieResultV4 = JSON.parse(lieResultV4Bytes.toString("utf8"));
const lieDecisionV4 = lieDecisionV4Bytes.toString("utf8");
const sessionSummary = JSON.parse(sessionSummaryBytes.toString("utf8"));
const sessionDecision = sessionDecisionBytes.toString("utf8");
const sessionV3Summary = JSON.parse(sessionV3SummaryBytes.toString("utf8"));
const sessionV3Decision = sessionV3DecisionBytes.toString("utf8");

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

assert.equal(sha256(gunzipSync(sessionCompressedBytes)), "4d4fa4dfcb3e51b2ce4443a10d0e906be8f7f2fd41df08aa0b26bd203b5f1b9e");
assert.equal(sha256(sessionCompressedBytes), "e0c55c0038119136d5b3d39fb13231fb15f8146a52cd7ff6246591f48f4e9a4f");
assert.equal(sha256(sessionSummaryBytes), "f928ec7b90581bd7689545eada4f8396cb2d884c9385ae618f7c6424cd4b3a5c");
assert.equal(sessionSummary.evidence_stage, "bounded_session_memo_and_order_sensitivity");
assert.equal(sessionSummary.decision, "hold");
assert.deepEqual(sessionSummary.coverage.classifications, {
  pass: 815,
  time_fail: 7,
  order_sensitive: 4,
  time_fail_memory_unknown: 2,
});
assert.equal(sessionSummary.coverage.representations, 828);
assert.equal(sessionSummary.coverage.grouped_runs, 2484);
assert.equal(sessionSummary.coverage.grouped_runs_with_hard_timeout, 6);
assert.equal(sessionSummary.coverage.exactness_pass_representations, 826);
assert.equal(sessionSummary.coverage.exactness_unknown_representations, 2);
assert.equal(sessionSummary.coverage.exactness_disagreements, 0);
assert.equal(sessionSummary.coverage.replay_failures, 0);
assert.equal(
  sessionSummary.resource.maximum_known_grouped_incremental_memory_bytes,
  21479424,
);
assert.equal(
  sessionSummary.resource.safe_parallel_workers_under_full_time_contract,
  0,
);
assert.equal(sessionSummary.resource.unknown_memory_is_never_reported_as_pass, true);
assert.deepEqual(
  sessionSummary.order_sensitive.map((entry) => entry.id),
  [
    "E7:1,1,5,1,0,0,0",
    "E7:0,0,7,1,0,0,0",
    "E8:1,1,2,0,0,1,1,0",
    "E8:3,0,0,1,0,0,0,4",
  ],
);
assert.deepEqual(
  sessionSummary.time_failures.map((entry) => entry.id),
  [
    "B8:0,0,2,2,1,0,3,0",
    "B8:0,1,1,0,0,2,1,3",
    "B8:0,0,1,1,1,2,2,1",
    "C8:0,0,2,1,4,1,0,0",
    "C8:1,1,0,1,3,1,1,0",
    "C8:0,0,1,1,1,2,3,0",
    "D8:0,0,1,1,2,4,0,0",
  ],
);
assert.deepEqual(
  sessionSummary.hard_timeouts.map((entry) => entry.id),
  ["E8:0,0,2,1,2,0,0,3", "E8:0,0,8,0,0,0,0,0"],
);
assert(
  sessionSummary.hard_timeouts.every(
    (entry) =>
      entry.exactness_status === "unknown_after_hard_timeout" &&
      entry.grouped_orders.every(
        (run) =>
          run.memory_observation === "unknown_after_hard_timeout" &&
          run.incremental_memory_bytes === null,
      ),
  ),
);
assert.equal(sessionSummary.independent_lie_witness.decision, "pass");
assert.equal(sessionSummary.independent_lie_witness.agreements, 496);
assert.match(
  sessionSummary.independent_lie_witness.category,
  /separate_from_internal_resource_evidence/,
);
assert.deepEqual(sessionSummary.phase_1, {
  authorized: false,
  corpus_generated: false,
  models_trained: false,
});
assert.match(sessionDecision, /Hold for the separate bounded-session/);
assert.match(sessionDecision, /unknown, not passed/);
assert.match(sessionDecision, /separate independent\s+correctness witness/);

assert.equal(sha256(sessionV3PlanBytes), "0af98a10412b085f204edb9ec58c8a5a10101f0956fc42b2b0aaeb972af30665");
assert.equal(sha256(sessionV3ManifestBytes), "e4345e005c28996fb17b3af5b7882bca35ea0ab6a97fe49df2190d0393497392");
assert.equal(sha256(gunzipSync(sessionV3CompressedBytes)), "3fa76f3b81d33a4aeb8d796726cde3a59a2c05a23922fa83ea034e763c483cc1");
assert.equal(sha256(sessionV3CompressedBytes), "370361788e71538e357faa31d3179a1ba500d7661d243cd7030d5320c3cb97e2");
assert.equal(sha256(sessionV3SummaryBytes), "e21ea0de680fe6313ce662ae8aee5455957c6edeefd3bb8e6f51a99b99f90a80");
assert.equal(sessionV3Summary.decision, "hold");
assert.equal(
  sessionV3Summary.bindings.oracle_executable_sha256,
  "626a28f53e6e94bc04724dabe3df71c9b1da9e0cb1cb56305ada07d95e9931a7",
);
assert.equal(
  sessionV3Summary.capture.measurement_controller_revision,
  "9cefcdc45a313f8c7f8c393fa265c28400374912",
);
assert.equal(
  sessionV3Summary.capture.finalizer_revision,
  "23c81304ab27e69232375a64d5391f160fbd7fa4",
);
assert.deepEqual(sessionV3Summary.coverage.classifications, {
  pass: 812,
  time_fail: 9,
  order_sensitive: 4,
  time_fail_memory_unknown: 3,
});
assert.equal(sessionV3Summary.coverage.representations, 828);
assert.equal(sessionV3Summary.coverage.grouped_runs, 2484);
assert.equal(sessionV3Summary.coverage.grouped_runs_with_hard_timeout, 7);
assert.equal(sessionV3Summary.coverage.exactness_pass_representations, 823);
assert.equal(sessionV3Summary.coverage.exactness_unknown_representations, 5);
assert.equal(sessionV3Summary.coverage.exactness_disagreements, 0);
assert.equal(sessionV3Summary.coverage.replay_failures, 0);
assert.equal(
  sessionV3Summary.resource.maximum_known_grouped_incremental_memory_bytes,
  21495808,
);
assert.equal(
  sessionV3Summary.resource.safe_parallel_workers_under_full_time_contract,
  0,
);
assert.deepEqual(
  sessionV3Summary.order_sensitive.map((entry) => entry.id),
  [
    "D8:0,0,1,1,2,4,0,0",
    "E7:1,1,5,1,0,0,0",
    "E8:1,1,2,0,0,1,1,0",
    "E8:3,0,0,1,0,0,0,4",
  ],
);
assert.deepEqual(
  sessionV3Summary.time_failures.map((entry) => entry.id),
  [
    "B8:0,0,2,2,1,0,3,0",
    "B8:0,1,1,0,0,2,1,3",
    "B8:0,0,1,1,1,2,2,1",
    "C8:0,0,2,1,4,1,0,0",
    "C8:1,1,0,1,3,1,1,0",
    "C8:0,0,1,1,1,2,3,0",
    "D8:0,0,1,0,5,0,0,0",
    "D8:1,0,0,2,0,3,1,1",
    "E7:0,0,0,5,0,2,1",
  ],
);
assert.deepEqual(
  sessionV3Summary.hard_timeouts.map((entry) => entry.id),
  [
    "E7:0,0,7,1,0,0,0",
    "E8:0,0,2,1,2,0,0,3",
    "E8:0,0,8,0,0,0,0,0",
  ],
);
assert.deepEqual(
  sessionV3Summary.exactness_unknown.map((entry) => entry.id),
  [
    "D8:0,0,1,1,2,4,0,0",
    "E7:1,1,5,1,0,0,0",
    "E7:0,0,7,1,0,0,0",
    "E8:0,0,2,1,2,0,0,3",
    "E8:0,0,8,0,0,0,0,0",
  ],
);
assert(
  sessionV3Summary.exactness_unknown.every(
    (entry) => entry.exactness_status === "unknown_after_hard_timeout",
  ),
);
assert.equal(sessionV3Summary.independent_lie_witness.decision, "pass");
assert.match(sessionV3Decision, /controlling bounded-session result/);
assert.match(sessionV3Decision, /Exactness is unknown, not\s+passed, for five/);
assert.match(sessionV3Decision, /separate independent correctness witness/);
assert.match(sessionV3Decision, /No corpus generation or training is authorized/);

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
  session_frontier: {
    decision: sessionSummary.decision,
    pass: sessionSummary.coverage.classifications.pass,
    time_fail: sessionSummary.coverage.classifications.time_fail,
    order_sensitive: sessionSummary.coverage.classifications.order_sensitive,
    time_fail_memory_unknown:
      sessionSummary.coverage.classifications.time_fail_memory_unknown,
  },
  current_session_frontier: {
    decision: sessionV3Summary.decision,
    pass: sessionV3Summary.coverage.classifications.pass,
    time_fail: sessionV3Summary.coverage.classifications.time_fail,
    order_sensitive:
      sessionV3Summary.coverage.classifications.order_sensitive,
    time_fail_memory_unknown:
      sessionV3Summary.coverage.classifications.time_fail_memory_unknown,
    exactness_unknown:
      sessionV3Summary.coverage.exactness_unknown_representations,
  },
}));
