#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { gunzipSync, createGunzip } from "node:zlib";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const read = (path) => readFile(resolve(root, path));
const readJson = async (path) => JSON.parse((await read(path)).toString("utf8"));
const gunzipSha256 = async (path) => {
  const hash = createHash("sha256");
  const stream = createReadStream(resolve(root, path)).pipe(createGunzip());
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
};

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
const sessionV4PlanPath = "examples/weight-multiplicity/phase05-frontier-plan-v4.json";
const sessionV4ManifestPath = "examples/weight-multiplicity/phase05-representation-manifest-v4.json";
const sessionV4CompressedPath = "experiments/weight-multiplicity/phase05/session-frontier-v4.json.gz";
const sessionV4SummaryPath = "experiments/weight-multiplicity/phase05/session-frontier-v4-summary.json";
const sessionV4DecisionPath = "experiments/weight-multiplicity/phase05/SESSION-FRONTIER-V4-HOLD.md";
const sessionV5PlanPath = "examples/weight-multiplicity/phase05-frontier-plan-v5.json";
const sessionV5ManifestPath = "examples/weight-multiplicity/phase05-representation-manifest-v5.json";
const sessionV5CompressedPath = "experiments/weight-multiplicity/phase05/session-frontier-v5.json.gz";
const sessionV5SummaryPath = "experiments/weight-multiplicity/phase05/session-frontier-v5-summary.json";
const sessionV5HashesPath = "experiments/weight-multiplicity/phase05/session-frontier-v5.sha256";
const sessionV5DecisionPath = "experiments/weight-multiplicity/phase05/SESSION-FRONTIER-V5-HOLD.md";
const sessionV6PlanPath = "examples/weight-multiplicity/phase05-frontier-plan-v6.json";
const sessionV6ManifestPath = "examples/weight-multiplicity/phase05-representation-manifest-v6.json";
const sessionV6CompressedPath = "experiments/weight-multiplicity/phase05/session-frontier-v6.json.gz";
const sessionV6SummaryPath = "experiments/weight-multiplicity/phase05/session-frontier-v6-summary.json";
const sessionV6HashesPath = "experiments/weight-multiplicity/phase05/session-frontier-v6.sha256";
const sessionV6DecisionPath = "experiments/weight-multiplicity/phase05/SESSION-FRONTIER-V6-HOLD.md";
const sessionV7PlanPath = "examples/weight-multiplicity/phase05-frontier-plan-v7.json";
const sessionV7ManifestPath = "examples/weight-multiplicity/phase05-representation-manifest-v7.json";
const sessionV7CompressedPath = "experiments/weight-multiplicity/phase05/session-frontier-v7.json.gz";
const sessionV7SummaryPath = "experiments/weight-multiplicity/phase05/session-frontier-v7-summary.json";
const sessionV7HashesPath = "experiments/weight-multiplicity/phase05/session-frontier-v7.sha256";
const sessionV7DecisionPath = "experiments/weight-multiplicity/phase05/SESSION-FRONTIER-V7-HOLD.md";
const sessionV5CorrectnessResultPath = "experiments/weight-multiplicity/phase05/session-frontier-v5-correctness-addendum-v1.json";
const sessionV5CorrectnessHashesPath = "experiments/weight-multiplicity/phase05/session-frontier-v5-correctness-addendum-v1.sha256";
const sessionV5CorrectnessDecisionPath = "experiments/weight-multiplicity/phase05/SESSION-FRONTIER-V5-CORRECTNESS-ADDENDUM-V1.md";
const sessionCorrectnessPlanPath = "examples/weight-multiplicity/phase05-session-correctness-plan-v1.json";
const sessionCorrectnessResultPath = "experiments/weight-multiplicity/phase05/session-correctness-addendum-v1.json";
const sessionCorrectnessDecisionPath = "experiments/weight-multiplicity/phase05/SESSION-CORRECTNESS-ADDENDUM-V1-HOLD.md";
const sessionCorrectnessControllerPath = "scripts/run-weight-multiplicity-phase05-session-correctness.mjs";
const correctiveRoot = "experiments/weight-multiplicity/phase05/cloud-corrective-v1";
const correctiveLaunchPath = `${correctiveRoot}/launch.json`;
const correctiveStatusPath = `${correctiveRoot}/terminal-status.json`;
const correctiveAllocatorPath = `${correctiveRoot}/results/allocator-audit-v1.json`;
const correctiveExactnessPath = `${correctiveRoot}/results/exactness-correction-v1.json`;
const correctiveLiePath = `${correctiveRoot}/results/lie-cross-check-v5.json`;
const correctiveExecutionPath = `${correctiveRoot}/results/execution-record.json`;
const correctiveChecksumsPath = `${correctiveRoot}/results/sha256sums.txt`;
const correctiveCloseoutPath = "experiments/weight-multiplicity/phase05/PHASE05-CLOUD-CORRECTIVE-CLOSEOUT-V1.md";
const phase06ProposalPath = "experiments/weight-multiplicity/phase05/PHASE06-PERSISTENT-LIE-ORACLE-BAKEOFF-PROPOSAL-V1.md";
const bcErratumPath = "experiments/weight-multiplicity/phase05/BC-FAMILY-LABEL-ERRATUM-V1.md";

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
  sessionV4PlanBytes,
  sessionV4ManifestBytes,
  sessionV4CompressedBytes,
  sessionV4SummaryBytes,
  sessionV4DecisionBytes,
  sessionV5PlanBytes,
  sessionV5ManifestBytes,
  sessionV5CompressedBytes,
  sessionV5SummaryBytes,
  sessionV5HashesBytes,
  sessionV5DecisionBytes,
  sessionV6PlanBytes,
  sessionV6ManifestBytes,
  sessionV6CompressedBytes,
  sessionV6SummaryBytes,
  sessionV6HashesBytes,
  sessionV6DecisionBytes,
  sessionV7PlanBytes,
  sessionV7ManifestBytes,
  sessionV7CompressedBytes,
  sessionV7SummaryBytes,
  sessionV7HashesBytes,
  sessionV7DecisionBytes,
  sessionV5CorrectnessResultBytes,
  sessionV5CorrectnessHashesBytes,
  sessionV5CorrectnessDecisionBytes,
  sessionCorrectnessPlanBytes,
  sessionCorrectnessResultBytes,
  sessionCorrectnessDecisionBytes,
  sessionCorrectnessControllerBytes,
  correctiveLaunchBytes,
  correctiveStatusBytes,
  correctiveAllocatorBytes,
  correctiveExactnessBytes,
  correctiveLieBytes,
  correctiveExecutionBytes,
  correctiveChecksumsBytes,
  correctiveCloseoutBytes,
  phase06ProposalBytes,
  bcErratumBytes,
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
  read(sessionV4PlanPath),
  read(sessionV4ManifestPath),
  read(sessionV4CompressedPath),
  read(sessionV4SummaryPath),
  read(sessionV4DecisionPath),
  read(sessionV5PlanPath),
  read(sessionV5ManifestPath),
  read(sessionV5CompressedPath),
  read(sessionV5SummaryPath),
  read(sessionV5HashesPath),
  read(sessionV5DecisionPath),
  read(sessionV6PlanPath),
  read(sessionV6ManifestPath),
  read(sessionV6CompressedPath),
  read(sessionV6SummaryPath),
  read(sessionV6HashesPath),
  read(sessionV6DecisionPath),
  read(sessionV7PlanPath),
  read(sessionV7ManifestPath),
  read(sessionV7CompressedPath),
  read(sessionV7SummaryPath),
  read(sessionV7HashesPath),
  read(sessionV7DecisionPath),
  read(sessionV5CorrectnessResultPath),
  read(sessionV5CorrectnessHashesPath),
  read(sessionV5CorrectnessDecisionPath),
  read(sessionCorrectnessPlanPath),
  read(sessionCorrectnessResultPath),
  read(sessionCorrectnessDecisionPath),
  read(sessionCorrectnessControllerPath),
  read(correctiveLaunchPath),
  read(correctiveStatusPath),
  read(correctiveAllocatorPath),
  read(correctiveExactnessPath),
  read(correctiveLiePath),
  read(correctiveExecutionPath),
  read(correctiveChecksumsPath),
  read(correctiveCloseoutPath),
  read(phase06ProposalPath),
  read(bcErratumPath),
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
const sessionV4Result = JSON.parse(gunzipSync(sessionV4CompressedBytes).toString("utf8"));
const sessionV4Summary = JSON.parse(sessionV4SummaryBytes.toString("utf8"));
const sessionV4Decision = sessionV4DecisionBytes.toString("utf8");
const sessionV5Plan = JSON.parse(sessionV5PlanBytes.toString("utf8"));
const sessionV5Summary = JSON.parse(sessionV5SummaryBytes.toString("utf8"));
const sessionV5Hashes = sessionV5HashesBytes.toString("utf8");
const sessionV5Decision = sessionV5DecisionBytes.toString("utf8");
const sessionV6Plan = JSON.parse(sessionV6PlanBytes.toString("utf8"));
const sessionV6Manifest = JSON.parse(sessionV6ManifestBytes.toString("utf8"));
const sessionV6Summary = JSON.parse(sessionV6SummaryBytes.toString("utf8"));
const sessionV6Hashes = sessionV6HashesBytes.toString("utf8");
const sessionV6Decision = sessionV6DecisionBytes.toString("utf8");
const sessionV7Plan = JSON.parse(sessionV7PlanBytes.toString("utf8"));
const sessionV7Manifest = JSON.parse(sessionV7ManifestBytes.toString("utf8"));
const sessionV7Summary = JSON.parse(sessionV7SummaryBytes.toString("utf8"));
const sessionV7Hashes = sessionV7HashesBytes.toString("utf8");
const sessionV7Decision = sessionV7DecisionBytes.toString("utf8");
const sessionV5CorrectnessResult = JSON.parse(
  sessionV5CorrectnessResultBytes.toString("utf8"),
);
const sessionV5CorrectnessHashes =
  sessionV5CorrectnessHashesBytes.toString("utf8");
const sessionV5CorrectnessDecision =
  sessionV5CorrectnessDecisionBytes.toString("utf8");
const sessionCorrectnessPlan = JSON.parse(sessionCorrectnessPlanBytes.toString("utf8"));
const sessionCorrectnessResult = JSON.parse(sessionCorrectnessResultBytes.toString("utf8"));
const sessionCorrectnessDecision = sessionCorrectnessDecisionBytes.toString("utf8");
const correctiveLaunch = JSON.parse(correctiveLaunchBytes.toString("utf8"));
const correctiveStatus = JSON.parse(correctiveStatusBytes.toString("utf8"));
const correctiveAllocator = JSON.parse(correctiveAllocatorBytes.toString("utf8"));
const correctiveExactness = JSON.parse(correctiveExactnessBytes.toString("utf8"));
const correctiveLie = JSON.parse(correctiveLieBytes.toString("utf8"));
const correctiveExecution = JSON.parse(correctiveExecutionBytes.toString("utf8"));
const correctiveChecksums = correctiveChecksumsBytes.toString("utf8");
const correctiveCloseout = correctiveCloseoutBytes.toString("utf8");
const phase06Proposal = phase06ProposalBytes.toString("utf8");
const bcErratum = bcErratumBytes.toString("utf8");

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

assert.equal(sha256(sessionV4PlanBytes), "3124323d7f5d7b236adeeef6d529fb2a9a1b6f36fffaa911df07d126145bd71a");
assert.equal(sha256(sessionV4ManifestBytes), "50d0bd848f145edc08e963bb173fff6e055218fc04569f5f257a70bc568cacdb");
assert.equal(sha256(gunzipSync(sessionV4CompressedBytes)), "d2f91c4d898b5c48929ace5d5cc00858a1950d2346b5f216f7900ed28c33563d");
assert.equal(sha256(sessionV4CompressedBytes), "1dc6fd54cf8236f8ef78ec4776ec769e4ef8da52f02efd352ce6d8b2d2e44db9");
assert.equal(sha256(sessionV4SummaryBytes), "b98a27f96092d85b484525a3e188299df2fe603ca6c20ad5ff2df3623946afd8");
assert.equal(sessionV4Result.decision, "hold");
assert.equal(sessionV4Summary.decision, "hold");
assert.equal(
  sessionV4Summary.bindings.oracle_executable_sha256,
  "7483043242d6fabf2fcaa72fc4746e7a13a858a4a3bcb6efefa37a5079d937ab",
);
assert.equal(
  sessionV4Summary.capture.measurement_controller_revision,
  "b220efee5294c42e6529a99068138ad4164f4532",
);
assert.equal(
  sessionV4Summary.capture.finalizer_revision,
  "9bf7088d93a06321f01d863fac6af3a67f9e10b1",
);
assert.deepEqual(sessionV4Summary.coverage.classifications, {
  pass: 825,
  time_fail: 1,
  order_sensitive: 1,
  time_fail_memory_unknown: 1,
});
assert.equal(sessionV4Summary.coverage.representations, 828);
assert.equal(sessionV4Summary.coverage.grouped_runs, 2484);
assert.equal(sessionV4Summary.coverage.grouped_runs_with_hard_timeout, 3);
assert.equal(sessionV4Summary.coverage.exactness_pass_representations, 827);
assert.equal(sessionV4Summary.coverage.exactness_unknown_representations, 1);
assert.equal(sessionV4Summary.coverage.exactness_disagreements, 0);
assert.equal(sessionV4Summary.coverage.replay_failures, 0);
assert.equal(
  sessionV4Summary.resource.maximum_known_grouped_incremental_memory_bytes,
  21528576,
);
assert.equal(
  sessionV4Summary.resource.safe_parallel_workers_under_full_time_contract,
  0,
);
assert.deepEqual(
  sessionV4Summary.order_sensitive.map((entry) => entry.id),
  ["E8:0,0,2,1,2,0,0,3"],
);
assert.deepEqual(
  sessionV4Summary.time_failures.map((entry) => entry.id),
  ["E7:0,0,7,1,0,0,0"],
);
assert.deepEqual(
  sessionV4Summary.hard_timeouts.map((entry) => entry.id),
  ["E8:0,0,8,0,0,0,0,0"],
);
assert.deepEqual(
  sessionV4Summary.exactness_unknown.map((entry) => entry.id),
  ["E8:0,0,8,0,0,0,0,0"],
);
assert(
  sessionV4Summary.hard_timeouts.every(
    (entry) =>
      entry.exactness_status === "unknown_after_hard_timeout" &&
      entry.cold.memory_observation === "unknown_after_hard_timeout" &&
      entry.cold.incremental_memory_bytes === null &&
      entry.grouped_orders.every(
        (run) =>
          run.memory_observation === "unknown_after_hard_timeout" &&
          run.incremental_memory_bytes === null,
      ),
  ),
);
assert.equal(
  sessionV4Summary.independent_lie_witness.category,
  "independent_predecessor_correctness_witness_separate_from_current_internal_resource_evidence",
);
assert.equal(
  sessionV4Summary.independent_lie_witness.direct_current_oracle_witness,
  false,
);
assert.equal(
  sessionV4Summary.independent_lie_witness.current_oracle_relationship,
  "predecessor_independent_witness_linked_by_internal_every_recursive_state_differential",
);
assert.deepEqual(sessionV4Summary.phase_1, {
  authorized: false,
  corpus_generated: false,
  models_trained: false,
});
assert.match(sessionV4Decision, /825 passes, up from 812/);
assert.match(sessionV4Decision, /5\.57x/);
assert.match(sessionV4Decision, /4\.35x fixed-work Amdahl ceiling/);
assert.match(sessionV4Decision, /requires 80\s+unsigned bits/);
assert.match(sessionV4Decision, /separate independent predecessor correctness witness/);
assert.match(sessionV4Decision, /No corpus generation or training is authorized/);

assert.equal(sha256(sessionV5PlanBytes), "f728ae0f21a757d3e0fc7dad60d18b90ab9c76e9f781bceb9ad66bdd02f038dd");
assert.equal(sha256(sessionV5ManifestBytes), "66567ba15cf3743d0fa38bc96b5ff2709e1abcf46e946fe62f2166255a02d1d8");
assert.equal(
  await gunzipSha256(sessionV5CompressedPath),
  "dad2926e23b9b711ce0d0ff5d8f2c14ba043c6058a8b5445e8390b9e0752e9e6",
);
assert.equal(sha256(sessionV5CompressedBytes), "996232dace6728e1b669d3ae83b2750c92e4a61fd685033d9517ab32f3d413d4");
assert.equal(sha256(sessionV5SummaryBytes), "84e477eda7790440b0e88258ec357eb4ecb17af64bc1f4277f2c56cb85e98b6c");
assert.equal(
  sessionV5Hashes,
  "996232dace6728e1b669d3ae83b2750c92e4a61fd685033d9517ab32f3d413d4  session-frontier-v5.json.gz\n84e477eda7790440b0e88258ec357eb4ecb17af64bc1f4277f2c56cb85e98b6c  session-frontier-v5-summary.json\n",
);
assert.equal(sessionV5Plan.schema_version, 4);
assert.equal(sessionV5Plan.oracle.interface_version, 3);
assert.equal(sessionV5Plan.oracle.zero_revision, "0714eb0b4f6d1e31497d819c6e8bd4b996c2f702");
assert.equal(
  sessionV5Plan.oracle.prepared_dependency_dag_revision,
  "0eba7457e5edb63ce418adc3e07c0a7cc804d639",
);
assert.equal(sessionV5Plan.frontier.session_mode, "prepared");
assert.equal(sessionV5Plan.frontier.prepared_workers_per_process, 8);
assert.equal(
  sessionV5Plan.predecessor.session_frontier_v4_compressed_result_sha256,
  sha256(sessionV4CompressedBytes),
);
assert.equal(sessionV5Summary.decision, "hold");
assert.equal(
  sessionV5Summary.bindings.oracle_executable_sha256,
  "4b4c9d24a7df7d07c9f84210d952a0fcd0a9b20e833e98d4432bb6c6c9150e87",
);
assert.equal(
  sessionV5Summary.capture.measurement_controller_revision,
  "518ed561dfe2abb15482a5976a653a9fed12ca09",
);
assert.equal(
  sessionV5Summary.capture.finalizer_revision,
  "f0966230568c454c49b635f31fa25e68bb6373a6",
);
assert.deepEqual(sessionV5Summary.coverage.classifications, {
  pass: 827,
  time_fail_memory_unknown: 1,
});
assert.equal(sessionV5Summary.coverage.representations, 828);
assert.equal(sessionV5Summary.coverage.grouped_runs, 2484);
assert.equal(sessionV5Summary.coverage.grouped_runs_with_hard_timeout, 3);
assert.equal(sessionV5Summary.coverage.exactness_pass_representations, 827);
assert.equal(sessionV5Summary.coverage.exactness_unknown_representations, 1);
assert.equal(sessionV5Summary.coverage.exactness_disagreements, 0);
assert.equal(sessionV5Summary.coverage.replay_failures, 0);
assert.equal(sessionV5Summary.coverage.replay_projection_pass_representations, 827);
assert.deepEqual(sessionV5Summary.order_sensitive, []);
assert.deepEqual(sessionV5Summary.time_failures, []);
assert.deepEqual(
  sessionV5Summary.hard_timeouts.map((entry) => entry.id),
  ["E8:0,0,8,0,0,0,0,0"],
);
assert.deepEqual(
  sessionV5Summary.exactness_unknown.map((entry) => entry.id),
  ["E8:0,0,8,0,0,0,0,0"],
);
assert(
  sessionV5Summary.hard_timeouts[0].grouped_orders.every(
    (run) =>
      run.memory_observation === "unknown_after_hard_timeout" &&
      run.incremental_memory_bytes === null,
  ),
);
assert.equal(
  sessionV5Summary.resource.maximum_known_grouped_incremental_memory_bytes,
  164528128,
);
assert.equal(
  sessionV5Summary.resource.maximum_completed_prepared_working_set_peak_allocated_bytes,
  1139810304,
);
assert.equal(
  sessionV5Summary.resource.maximum_completed_prepared_graph_capacity_bytes,
  1024466944,
);
assert.equal(
  sessionV5Summary.resource.maximum_hard_timeout_incremental_rss_lower_bound_bytes,
  1197834240,
);
assert.equal(
  sessionV5Summary.resource.safe_parallel_workers_under_full_time_contract,
  8,
);
assert.equal(
  sessionV5Summary.independent_lie_witness.category,
  "independent_predecessor_correctness_witness_separate_from_current_internal_resource_evidence",
);
assert.equal(
  sessionV5Summary.independent_lie_witness.direct_current_oracle_witness,
  false,
);
assert.deepEqual(sessionV5Summary.phase_1, {
  authorized: false,
  corpus_generated: false,
  models_trained: false,
});
assert.match(sessionV5Decision, /827 passes, up from 825/);
assert.match(sessionV5Decision, /zero measured time failures/);
assert.match(sessionV5Decision, /zero order-sensitive classifications/);
assert.match(sessionV5Decision, /eight-worker candidate/);
assert.match(sessionV5Decision, /memory is therefore unknown, not passed/);
assert.match(
  sessionV5Decision,
  /not\s+as a direct independent witness for the current oracle/,
);
assert.match(sessionV5Decision, /No corpus generation or training is authorized/);

assert.equal(
  sha256(sessionV6PlanBytes),
  "384f9bc440dd3cc6184a56e345d80db313dd850dc045927807dce88caebb7208",
);
assert.equal(
  sha256(sessionV6ManifestBytes),
  "ea9594ace7983c46d02fb803153d063f63177e67cd1e374a012cdf6f6e09480d",
);
assert.equal(
  await gunzipSha256(sessionV6CompressedPath),
  "756fa0e70046d06bc2fb7997ba7661e3624b1dd958d9fffc51f1ed60e3c70f1c",
);
assert.equal(
  sha256(sessionV6CompressedBytes),
  "84d795a8d194f5344bb5b66065d6ed56acabada155d8ba0180b59cbe95e878a8",
);
assert.equal(
  sha256(sessionV6SummaryBytes),
  "7a6157f9bc7f1c122d326cc6c4145afa0011f797a2b2934c4303c34f9c959478",
);
assert.equal(
  sessionV6Hashes,
  "84d795a8d194f5344bb5b66065d6ed56acabada155d8ba0180b59cbe95e878a8  session-frontier-v6.json.gz\n7a6157f9bc7f1c122d326cc6c4145afa0011f797a2b2934c4303c34f9c959478  session-frontier-v6-summary.json\n",
);
assert.equal(sessionV6Plan.schema_version, 4);
assert.equal(sessionV6Plan.oracle.interface_version, 3);
assert.equal(
  sessionV6Plan.oracle.zero_revision,
  "349e6c2ef5487d4709a8dd525b2dbaac7d590f08",
);
assert.equal(
  sessionV6Plan.oracle.prepared_dependency_dag_revision,
  "da56686d84e9bee28636acd9fe723f11eb9a9160",
);
assert.equal(sessionV6Plan.frontier.session_mode, "prepared");
assert.equal(sessionV6Plan.frontier.prepared_workers_per_process, 8);
assert.equal(
  sessionV6Plan.frontier.optimization_sequence.at(-1),
  "lock_light_compact_prepared_dependency_edges",
);
assert.equal(
  sessionV6Plan.predecessor.session_frontier_v5_compressed_result_sha256,
  sha256(sessionV5CompressedBytes),
);
assert.equal(
  sessionV6Plan.predecessor.session_frontier_v5_summary_sha256,
  sha256(sessionV5SummaryBytes),
);
assert.deepEqual(
  sessionV6Manifest.representations,
  JSON.parse(sessionV5ManifestBytes.toString("utf8")).representations,
);
assert.equal(sessionV6Summary.decision, "hold");
assert.equal(
  sessionV6Summary.bindings.capture_sha256,
  "4af7d6f6fe6545351d4274a17fb9a0ae266b7e2e4440db5f3b79e3bc9849fab6",
);
assert.equal(
  sessionV6Summary.bindings.oracle_executable_sha256,
  "e6ad8c85bbcfff1a6148020f7b97b4dabdcea7a703ed1cf5675550ac7ca342e4",
);
assert.equal(
  sessionV6Summary.capture.measurement_controller_revision,
  "0608b1d00b0e684a77da9449d6d1166935998ce4",
);
assert.equal(
  sessionV6Summary.capture.finalizer_revision,
  "0608b1d00b0e684a77da9449d6d1166935998ce4",
);
assert.deepEqual(sessionV6Summary.coverage.classifications, {
  pass: 827,
  order_sensitive: 1,
});
assert.equal(sessionV6Summary.coverage.representations, 828);
assert.equal(sessionV6Summary.coverage.grouped_runs, 2484);
assert.equal(sessionV6Summary.coverage.grouped_runs_with_hard_timeout, 0);
assert.equal(sessionV6Summary.coverage.exactness_pass_representations, 828);
assert.equal(sessionV6Summary.coverage.exactness_unknown_representations, 0);
assert.equal(sessionV6Summary.coverage.exactness_disagreements, 0);
assert.equal(sessionV6Summary.coverage.replay_failures, 0);
assert.equal(sessionV6Summary.coverage.replay_projection_pass_representations, 828);
assert.deepEqual(
  sessionV6Summary.order_sensitive.map((entry) => entry.id),
  ["E8:0,0,8,0,0,0,0,0"],
);
assert.deepEqual(sessionV6Summary.time_failures, []);
assert.deepEqual(sessionV6Summary.hard_timeouts, []);
assert.deepEqual(sessionV6Summary.exactness_unknown, []);
assert.deepEqual(
  sessionV6Summary.order_sensitive[0].grouped_orders.map((run) => ({
    order: run.order,
    p95_ms: run.p95_ms,
    maximum_ms: run.maximum_ms,
    threshold_exceedances: run.threshold_exceedances,
    memory_observation: run.memory_observation,
  })),
  [
    {
      order: "descending_depth_dominant_first_lexicographic",
      p95_ms: 0.047459,
      maximum_ms: 9573.796667,
      threshold_exceedances: 1,
      memory_observation: "exact_process_high_water",
    },
    {
      order: "ascending_depth_dominant_first_lexicographic",
      p95_ms: 3414.887792,
      maximum_ms: 4934.035209,
      threshold_exceedances: 3,
      memory_observation: "exact_process_high_water",
    },
    {
      order: "seeded_generation_order",
      p95_ms: 3442.4955,
      maximum_ms: 4925.11525,
      threshold_exceedances: 3,
      memory_observation: "exact_process_high_water",
    },
  ],
);
assert.equal(
  sessionV6Summary.resource.maximum_known_grouped_incremental_memory_bytes,
  2054946816,
);
assert.equal(
  sessionV6Summary.resource.maximum_completed_prepared_working_set_peak_allocated_bytes,
  1809596416,
);
assert.equal(
  sessionV6Summary.resource.maximum_completed_prepared_graph_capacity_bytes,
  1564491776,
);
assert.equal(
  sessionV6Summary.resource.maximum_hard_timeout_incremental_rss_lower_bound_bytes,
  null,
);
assert.equal(
  sessionV6Summary.resource.safe_parallel_workers_under_full_time_contract,
  8,
);
assert.equal(
  sessionV6Summary.independent_lie_witness.category,
  "independent_predecessor_correctness_witness_separate_from_current_internal_resource_evidence",
);
assert.equal(
  sessionV6Summary.independent_lie_witness.direct_current_oracle_witness,
  false,
);
assert.deepEqual(sessionV6Summary.phase_1, {
  authorized: false,
  corpus_generated: false,
  models_trained: false,
});
assert.match(sessionV6Decision, /827 passes/);
assert.match(sessionV6Decision, /zero grouped hard timeouts/);
assert.match(sessionV6Decision, /no remaining unknown-memory cells/);
assert.match(sessionV6Decision, /capacity-only change is accepted/);
assert.match(sessionV6Decision, /recurrence-counter change still fails/);
assert.match(sessionV6Decision, /separate independent predecessor witness/);
assert.match(sessionV6Decision, /not\s+as a direct independent witness/);
assert.match(sessionV6Decision, /No corpus generation or training is authorized/);

assert.equal(
  sha256(sessionV7PlanBytes),
  "74a16761d1fef3c3dea04624fe9e5b2d491bb285bd810cb41514493e160f5a6f",
);
assert.equal(
  sha256(sessionV7ManifestBytes),
  "7b4d83e01b3af05195bfe92d2c08d8d76da8a33b4ce83953df909e98dedf37ff",
);
assert.equal(
  await gunzipSha256(sessionV7CompressedPath),
  "5b935cb61846c570f3ba573be92a9d3a9143257701225e4a478b6ac2bf716530",
);
assert.equal(
  sha256(sessionV7CompressedBytes),
  "997efbe48f6d1025e49f8befa7cb06899a33e70ca94d5e254d47f64438f481e7",
);
assert.equal(
  sha256(sessionV7SummaryBytes),
  "c08bba3348deeaa3ab8a55e910b9695d4918bc2ada0ccdf95644a7b633768fb0",
);
assert.equal(
  sessionV7Hashes,
  "997efbe48f6d1025e49f8befa7cb06899a33e70ca94d5e254d47f64438f481e7  session-frontier-v7.json.gz\nc08bba3348deeaa3ab8a55e910b9695d4918bc2ada0ccdf95644a7b633768fb0  session-frontier-v7-summary.json\n",
);
assert.equal(sessionV7Plan.schema_version, 5);
assert.equal(sessionV7Plan.oracle.interface_version, 4);
assert.equal(
  sessionV7Plan.oracle.zero_revision,
  "443d8e99a7b6e9045a8a9ee6735c3c75f2b29b66",
);
assert.equal(
  sessionV7Plan.oracle.root_ray_factorization_revision,
  "bb9644ca2d93be2f92411bea9ff8764810373021",
);
assert.equal(
  sessionV7Plan.oracle.parallel_root_ray_dag_revision,
  "443d8e99a7b6e9045a8a9ee6735c3c75f2b29b66",
);
assert.equal(sessionV7Plan.frontier.session_mode, "ray");
assert.equal(sessionV7Plan.frontier.ray_workers_per_process, 8);
assert.equal(
  sessionV7Plan.frontier.optimization_sequence.at(-1),
  "parallel_level_order_root_ray_dag",
);
assert.equal(
  sessionV7Plan.predecessor.session_frontier_v6_compressed_result_sha256,
  sha256(sessionV6CompressedBytes),
);
assert.equal(
  sessionV7Plan.predecessor.session_frontier_v6_summary_sha256,
  sha256(sessionV6SummaryBytes),
);
assert.deepEqual(
  sessionV7Manifest.representations,
  sessionV6Manifest.representations,
);
assert.equal(sessionV7Summary.decision, "hold");
assert.equal(
  sessionV7Summary.bindings.capture_sha256,
  "ea024d1234c2afc37ab578b7ab3c134ed3d1a7c6f86a56feaf7f298a55d696e6",
);
assert.equal(
  sessionV7Summary.bindings.oracle_executable_sha256,
  "245ee35504604014f562e4c1916a8cf987569aef72533a1c06218b90e270fcdf",
);
assert.equal(
  sessionV7Summary.capture.measurement_controller_revision,
  "dcb15c0c7b33c52dd739cb1fd403f58ca53a0310",
);
assert.equal(
  sessionV7Summary.capture.checkpoint_writer_revision,
  "ecdc1f0ae16e7b52f5fbd56e1de380ab3da95ba7",
);
assert.equal(
  sessionV7Summary.capture.finalizer_revision,
  "56655d36618eb2372519643f7f980e032acd9547",
);
assert.deepEqual(sessionV7Summary.coverage.classifications, {
  pass: 826,
  time_fail: 1,
  order_sensitive: 1,
});
assert.equal(sessionV7Summary.coverage.representations, 828);
assert.equal(sessionV7Summary.coverage.grouped_runs, 2484);
assert.equal(sessionV7Summary.coverage.grouped_runs_with_hard_timeout, 0);
assert.equal(sessionV7Summary.coverage.exactness_pass_representations, 828);
assert.equal(sessionV7Summary.coverage.exactness_unknown_representations, 0);
assert.equal(sessionV7Summary.coverage.exactness_disagreements, 0);
assert.equal(sessionV7Summary.coverage.replay_failures, 0);
assert.equal(sessionV7Summary.coverage.replay_projection_pass_representations, 828);
assert.deepEqual(
  sessionV7Summary.order_sensitive.map((entry) => entry.id),
  ["E8:0,0,8,0,0,0,0,0"],
);
assert.deepEqual(
  sessionV7Summary.time_failures.map((entry) => entry.id),
  ["E8:0,0,2,1,2,0,0,3"],
);
assert.deepEqual(sessionV7Summary.hard_timeouts, []);
assert.deepEqual(sessionV7Summary.exactness_unknown, []);
assert.deepEqual(
  sessionV7Summary.order_sensitive[0].grouped_orders.map((run) => ({
    order: run.order,
    p95_ms: run.p95_ms,
    maximum_ms: run.maximum_ms,
    threshold_exceedances: run.threshold_exceedances,
    memory_observation: run.memory_observation,
  })),
  [
    {
      order: "descending_depth_dominant_first_lexicographic",
      p95_ms: 0.115625,
      maximum_ms: 4263.395208,
      threshold_exceedances: 1,
      memory_observation: "exact_process_high_water",
    },
    {
      order: "ascending_depth_dominant_first_lexicographic",
      p95_ms: 3235.453375,
      maximum_ms: 3454.100708,
      threshold_exceedances: 2,
      memory_observation: "exact_process_high_water",
    },
    {
      order: "seeded_generation_order",
      p95_ms: 2722.60275,
      maximum_ms: 9497.799291,
      threshold_exceedances: 2,
      memory_observation: "exact_process_high_water",
    },
  ],
);
assert.deepEqual(
  sessionV7Summary.time_failures[0].grouped_orders.map((run) => ({
    order: run.order,
    p95_ms: run.p95_ms,
    maximum_ms: run.maximum_ms,
    threshold_exceedances: run.threshold_exceedances,
  })),
  [
    {
      order: "descending_depth_dominant_first_lexicographic",
      p95_ms: 0.073292,
      maximum_ms: 1172.780292,
      threshold_exceedances: 1,
    },
    {
      order: "ascending_depth_dominant_first_lexicographic",
      p95_ms: 369.770292,
      maximum_ms: 557.081875,
      threshold_exceedances: 0,
    },
    {
      order: "seeded_generation_order",
      p95_ms: 236.934459,
      maximum_ms: 581.014334,
      threshold_exceedances: 0,
    },
  ],
);
assert.equal(
  sessionV7Summary.resource.maximum_known_grouped_incremental_memory_bytes,
  1445609472,
);
assert.equal(
  sessionV7Summary.resource.maximum_completed_working_set_peak_allocated_bytes,
  1324881920,
);
assert.equal(
  sessionV7Summary.resource.maximum_completed_ray_graph_capacity_bytes,
  111149056,
);
assert.equal(
  sessionV7Summary.resource.maximum_completed_ray_capacity_bytes,
  1087903744,
);
assert.equal(
  sessionV7Summary.resource.maximum_hard_timeout_incremental_rss_lower_bound_bytes,
  null,
);
assert.equal(
  sessionV7Summary.resource.safe_parallel_workers_under_full_time_contract,
  8,
);
assert.equal(
  sessionV7Summary.independent_lie_witness.category,
  "independent_predecessor_correctness_witness_separate_from_current_internal_resource_evidence",
);
assert.equal(
  sessionV7Summary.independent_lie_witness.direct_current_oracle_witness,
  false,
);
assert.deepEqual(sessionV7Summary.phase_1, {
  authorized: false,
  corpus_generated: false,
  models_trained: false,
});
assert.match(sessionV7Decision, /826 passes/);
assert.match(sessionV7Decision, /one E8 time failure/);
assert.match(sessionV7Decision, /one order-sensitive E8 representation/);
assert.match(sessionV7Decision, /zero grouped hard timeouts/);
assert.match(sessionV7Decision, /no\s+unknown-memory cells/);
assert.match(sessionV7Decision, /changed storage only/);
assert.match(sessionV7Decision, /separate independent predecessor witness/);
assert.match(sessionV7Decision, /not\s+as a direct independent witness/);
assert.match(sessionV7Decision, /No corpus generation or training is authorized/);

assert.equal(
  sha256(sessionV5CorrectnessResultBytes),
  "4ad0ef7ec7787798e89fcb285b9b9a0bf244a156f8151f3509e4cfbe81d598c9",
);
assert.equal(
  sha256(sessionV5CorrectnessDecisionBytes),
  "0c5c26f4fff66b9e2d749a8194de9deb1136a81dccc4c78a530567c440dcf3a2",
);
assert.equal(
  sessionV5CorrectnessHashes,
  "4ad0ef7ec7787798e89fcb285b9b9a0bf244a156f8151f3509e4cfbe81d598c9  session-frontier-v5-correctness-addendum-v1.json\n0c5c26f4fff66b9e2d749a8194de9deb1136a81dccc4c78a530567c440dcf3a2  SESSION-FRONTIER-V5-CORRECTNESS-ADDENDUM-V1.md\n",
);
assert.equal(
  sha256(sessionV5DecisionBytes),
  "9570eec4dcf3494ae46e3eba4cfd08e60b242af147cf00af85dac04a3b0f399b",
);
assert.equal(
  sessionV5CorrectnessResult.bindings.session_frontier_v4_compressed_sha256,
  sha256(sessionV4CompressedBytes),
);
assert.equal(
  sessionV5CorrectnessResult.bindings.session_frontier_v5_compressed_sha256,
  sha256(sessionV5CompressedBytes),
);
assert.equal(
  sessionV5CorrectnessResult.bindings.session_frontier_v5_summary_sha256,
  sha256(sessionV5SummaryBytes),
);
assert.equal(
  sessionV5CorrectnessResult.observation.representation_id,
  "E8:0,0,2,1,2,0,0,3",
);
assert.equal(sessionV5CorrectnessResult.observation.raw_targets, 32);
assert.equal(sessionV5CorrectnessResult.observation.unique_requests, 12);
assert.equal(
  sessionV5CorrectnessResult.observation.version_5_same_run_fresh_reference
    .completed_queries,
  5,
);
assert.equal(
  sessionV5CorrectnessResult.observation.version_5_same_run_fresh_reference
    .complete,
  false,
);
assert.equal(
  sessionV5CorrectnessResult.observation.sealed_predecessor_comparison
    .agreements,
  12,
);
assert.equal(
  sessionV5CorrectnessResult.observation.sealed_predecessor_comparison
    .disagreements,
  0,
);
const sessionV5CorrectnessAnswers =
  sessionV5CorrectnessResult.observation.sealed_predecessor_comparison
    .answer_map;
assert.equal(sessionV5CorrectnessAnswers.length, 12);
assert.equal(
  new Set(sessionV5CorrectnessAnswers.map((entry) => entry.request)).size,
  12,
);
assert.deepEqual(
  sessionV5CorrectnessAnswers.map((entry) => entry.request),
  [...sessionV5CorrectnessAnswers]
    .map((entry) => entry.request)
    .sort((left, right) => left.localeCompare(right)),
);
const sessionV5CorrectnessProjectionSha = sha256(
  Buffer.from(`${JSON.stringify(sessionV5CorrectnessAnswers)}\n`),
);
assert.equal(
  sessionV5CorrectnessProjectionSha,
  "2bd8df410586f0a4f58e2e95ac667fba4da71b5afc9d1fa671aa68cb3c7d2f22",
);
assert.equal(
  sessionV5CorrectnessResult.observation.sealed_predecessor_comparison
    .version_4_projection_sha256,
  sessionV5CorrectnessProjectionSha,
);
assert.equal(
  sessionV5CorrectnessResult.observation.sealed_predecessor_comparison
    .version_5_projection_sha256,
  sessionV5CorrectnessProjectionSha,
);
assert.equal(
  sessionV5CorrectnessResult.interpretation.classification_change,
  "none",
);
assert.equal(sessionV5CorrectnessResult.interpretation.independent, false);
assert.equal(sessionV5CorrectnessResult.phase_1_authorized, false);
assert.match(sessionV5CorrectnessDecision, /completed only 5 entries/);
assert.match(sessionV5CorrectnessDecision, /12 agreements and zero disagreements/);
assert.match(sessionV5CorrectnessDecision, /It is not an independent audit/);
assert.match(sessionV5CorrectnessDecision, /not a\s+direct independent witness/);
assert.match(sessionV5CorrectnessDecision, /No corpus generation or training is\s+authorized/);

assert.equal(
  sha256(sessionCorrectnessPlanBytes),
  "804ceb2977508d6553e83fa3b525cbad69dfac50ccd50a156537805036d833fd",
);
assert.equal(
  sha256(sessionCorrectnessResultBytes),
  "2c36e7fea57806c0265c9983e982c25a88aec1a6aa770a146b8966b114347617",
);
assert.equal(
  sha256(sessionCorrectnessDecisionBytes),
  "61196453cc1ba14328fa5c10c169d523a4235fd2b497e476efa8cec8107cea53",
);
assert.equal(
  sha256(sessionCorrectnessControllerBytes),
  "d5a54e17b050175845dd9d47a928fa4f27ae2b91073a254a240b0dd7408118e8",
);
assert.equal(sessionCorrectnessPlan.resource_claims, false);
assert.equal(
  sessionCorrectnessPlan.bindings.source_plan.sha256,
  sha256(sessionV3PlanBytes),
);
assert.equal(
  sessionCorrectnessPlan.bindings.source_manifest.sha256,
  sha256(sessionV3ManifestBytes),
);
assert.equal(
  sessionCorrectnessPlan.bindings.source_result.sha256,
  sha256(sessionV3CompressedBytes),
);
assert.equal(
  sessionCorrectnessResult.plan_sha256,
  sha256(sessionCorrectnessPlanBytes),
);
assert.deepEqual(
  sessionCorrectnessPlan.correctness.representation_ids,
  sessionV3Summary.exactness_unknown.map((entry) => entry.id),
);
assert.equal(sessionCorrectnessResult.resource_claims, false);
assert.equal(
  sessionCorrectnessResult.evidence_status,
  "correctness_addendum_hold",
);
assert.deepEqual(sessionCorrectnessResult.summary.statuses, {
  pass: 4,
  fail: 0,
  unknown_after_hard_timeout_or_oracle_error: 1,
});
assert.equal(sessionCorrectnessResult.summary.target_requests, 160);
assert.equal(
  sessionCorrectnessResult.summary.observed_session_to_reference_comparisons,
  640,
);
assert.equal(sessionCorrectnessResult.summary.disagreements, 0);
assert.equal(sessionCorrectnessResult.summary.replay_failures, 0);
assert.equal(sessionCorrectnessResult.summary.replay_unknown, 1);
assert.deepEqual(
  sessionCorrectnessResult.measurements
    .filter((measurement) => measurement.exactness.status === "pass")
    .map((measurement) => measurement.representation.id),
  [
    "D8:0,0,1,1,2,4,0,0",
    "E7:1,1,5,1,0,0,0",
    "E7:0,0,7,1,0,0,0",
    "E8:0,0,2,1,2,0,0,3",
  ],
);
for (const measurement of sessionCorrectnessResult.measurements.slice(0, 4)) {
  assert.equal(measurement.exactness.all_runs_complete, true);
  assert.equal(measurement.exactness.observed_comparisons, 160);
  assert.deepEqual(measurement.exactness.mismatches, []);
  assert.equal(measurement.exactness.replay_observed, true);
  assert.equal(measurement.exactness.replay_byte_identical, true);
  assert.equal(measurement.cold_reference.complete, true);
  assert(measurement.session_runs.every((run) => run.complete));
  assert.equal("latency_ms" in measurement.cold_reference, false);
  assert.equal("memory_bytes" in measurement.cold_reference, false);
  assert(
    measurement.session_runs.every(
      (run) => !("latency_ms" in run) && !("memory_bytes" in run),
    ),
  );
}
const unresolvedSessionCorrectness = sessionCorrectnessResult.measurements[4];
assert.equal(
  unresolvedSessionCorrectness.representation.id,
  "E8:0,0,8,0,0,0,0,0",
);
assert.equal(
  unresolvedSessionCorrectness.exactness.status,
  "unknown_after_hard_timeout_or_oracle_error",
);
assert.equal(unresolvedSessionCorrectness.exactness.observed_comparisons, 0);
assert.equal(unresolvedSessionCorrectness.exactness.replay_observed, false);
assert.equal(unresolvedSessionCorrectness.exactness.replay_byte_identical, null);
assert.equal(unresolvedSessionCorrectness.cold_reference.completed_queries, 0);
assert(unresolvedSessionCorrectness.cold_reference.hard_timeout);
assert(
  unresolvedSessionCorrectness.session_runs.every(
    (run) => run.completed_queries === 0 && run.hard_timeout,
  ),
);
assert.deepEqual(sessionCorrectnessResult.phase_1, {
  authorized: false,
  corpus_generated: false,
  models_trained: false,
});
assert.match(sessionCorrectnessDecision, /makes no time or memory claim/);
assert.match(sessionCorrectnessDecision, /four prior unknowns become observed passes/);
assert.match(sessionCorrectnessDecision, /one\s+remains unknown/);
assert.match(sessionCorrectnessDecision, /Empty output is not treated as agreement/);
assert.match(sessionCorrectnessDecision, /separate independent witness/);
assert.match(sessionCorrectnessDecision, /No corpus generation or model training is authorized/);

assert.equal(
  sha256(correctiveLaunchBytes),
  "82e9ece8160bf52c0ea46351e1e186680b7c44d9a43a3410b4340b731353c9c8",
);
assert.equal(
  sha256(correctiveStatusBytes),
  "0a12b75e713bbf1668f9b2e5af2a3a984c6221169156739d83a15e7362333682",
);
assert.equal(
  sha256(correctiveAllocatorBytes),
  "dbe8459a5f97ae5df86de2a3682939cc0fe861536c87283b6ed0ae8313f5519d",
);
assert.equal(
  sha256(correctiveExactnessBytes),
  "a530708ef55415a84beeab3522e0be3f378bcbd6ee6e08e45e7bd3fb68c4c77a",
);
assert.equal(
  sha256(correctiveLieBytes),
  "937c52c4764f08544da01315761ccdd1d6fbd36da39922af42e90ae6c4e93759",
);
assert.equal(
  sha256(correctiveExecutionBytes),
  "ef9146fede0e6e336d76502907cda7fa5d5458a42c648bea09eefa3a2b3fd5e0",
);

const correctiveChecksumMap = new Map(
  correctiveChecksums
    .trim()
    .split("\n")
    .map((line) => {
      const [digest, filename] = line.trim().split(/\s+/);
      return [filename, digest];
    }),
);
assert.equal(
  correctiveChecksumMap.get("allocator-audit-v1.json"),
  sha256(correctiveAllocatorBytes),
);
assert.equal(
  correctiveChecksumMap.get("exactness-correction-v1.json"),
  sha256(correctiveExactnessBytes),
);
assert.equal(
  correctiveChecksumMap.get("lie-cross-check-v5.json"),
  sha256(correctiveLieBytes),
);
assert.equal(
  correctiveChecksumMap.get("execution-record.json"),
  sha256(correctiveExecutionBytes),
);

assert.equal(correctiveLaunch.run_id, "33353839104");
assert.equal(correctiveLaunch.instance_id, "i-07ed6044d7463a155");
assert.equal(correctiveLaunch.instance_type, "c6i.4xlarge");
assert.equal(correctiveLaunch.maximum_ec2_usd, 0.5);
assert.equal(correctiveStatus.status, "complete");
assert.equal(correctiveStatus.exit_code, 0);
assert.equal(correctiveStatus.elapsed_instance_seconds, 247);
assert.equal(correctiveStatus.estimated_ec2_usd, 0.046655555556);
assert.deepEqual(correctiveExecution.closures, {
  phase_1_authorized: false,
  corpus_generated: false,
  models_trained: false,
});

assert.equal(correctiveAllocator.evidence_status, "complete");
assert.deepEqual(correctiveAllocator.summary, {
  representations: 5,
  policy_runs: 10,
  observed_answer_disagreements: 0,
  memory_classification_changes: 0,
  default_limit_exceeded_before_termination: 0,
  presized_limit_exceeded_before_termination: 0,
});
assert.deepEqual(correctiveAllocator.phase_1, {
  authorized: false,
  corpus_generated: false,
  models_trained: false,
});
for (const measurement of correctiveAllocator.measurements) {
  assert.deepEqual(measurement.observed_answer_disagreements, []);
  assert.equal(measurement.observed_memory_classification_changed, false);
  assert.equal(measurement.policies.length, 2);
  const defaultPolicy = measurement.policies.find(
    (entry) => entry.policy.id === "default",
  );
  const presizedPolicy = measurement.policies.find(
    (entry) => entry.policy.id === "presized",
  );
  assert(defaultPolicy);
  assert(presizedPolicy);
  assert.equal(
    defaultPolicy.run.hard_timeout.target_depth,
    presizedPolicy.run.hard_timeout.target_depth,
  );
  for (const policy of measurement.policies) {
    assert.equal(
      policy.observed_memory.status,
      "under_limit_until_hard_timeout",
    );
    assert(
      policy.observed_memory.peak_rss_bytes <
        policy.observed_memory.limit_bytes,
    );
  }
}
for (const id of ["B7:0,2,0,1,0,1,0", "C6:0,6,1,0,0,0"]) {
  const measurement = correctiveAllocator.measurements.find(
    (entry) => entry.representation.id === id,
  );
  const defaultPolicy = measurement.policies.find(
    (entry) => entry.policy.id === "default",
  );
  assert.equal(
    defaultPolicy.run.hard_timeout.memo_progress.projected_simultaneous_bytes,
    2063597568,
  );
  assert.equal(defaultPolicy.observed_memory.memo_entries, 2936012);
  assert.equal(defaultPolicy.observed_memory.live_entry_bytes, 481505968);
}
const correctiveB8 = correctiveAllocator.measurements.find(
  (entry) => entry.representation.id === "B8:0,0,0,0,2,0,0,0",
);
assert(
  correctiveB8.policies.find((entry) => entry.policy.id === "presized")
    .observed_memory.capacity_to_live_entry_ratio > 11,
);

assert.equal(correctiveExactness.record_kind, "append_only_exactness_classification_correction");
assert.deepEqual(
  correctiveExactness.changes.map((entry) => ({
    id: entry.representation_id,
    prior: entry.prior_classification,
    corrected: entry.corrected_classification,
    mismatches: entry.observed_multiplicity_mismatches,
  })),
  [
    {
      id: "B6:0,0,1,2,1,0",
      prior: "exactness_fail",
      corrected: "time_fail",
      mismatches: 0,
    },
    {
      id: "F4:0,2,5,0",
      prior: "exactness_fail",
      corrected: "time_fail",
      mismatches: 0,
    },
  ],
);
assert.deepEqual(correctiveExactness.corrected_summary.classifications, {
  pass: 572,
  order_sensitive: 17,
  time_fail: 239,
});
assert.deepEqual(correctiveExactness.corrected_exactness_statuses, {
  pass: 595,
  fail: 0,
  unknown_after_hard_timeout_or_oracle_error: 233,
});

assert.equal(correctiveLie.evidence_status, "pass");
assert.equal(correctiveLie.summary.completed, 496);
assert.equal(correctiveLie.summary.agreements, 496);
assert.equal(correctiveLie.summary.disagreements, 0);
assert(correctiveLie.results.every((result) => result.agreement));
const legacyB8Fundamental = correctiveLie.results.find(
  (result) =>
    result.type === "B8" &&
    result.highest_weight.join(",") === "1,0,0,0,0,0,0,0",
);
const legacyC8Fundamental = correctiveLie.results.find(
  (result) =>
    result.type === "C8" &&
    result.highest_weight.join(",") === "1,0,0,0,0,0,0,0",
);
assert.equal(legacyB8Fundamental.representation_dimension, "16");
assert.equal(legacyB8Fundamental.lie.query_type, "C8");
assert.equal(legacyC8Fundamental.representation_dimension, "17");
assert.equal(legacyC8Fundamental.lie.query_type, "B8");

const percentile = (values, fraction) => {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor((ordered.length - 1) * fraction)];
};
const lieTimes = correctiveLie.results.map((result) => result.lie.elapsed_ms);
const zeroTimes = correctiveLie.results.map((result) => result.zero.elapsed_ms);
assert.equal(percentile(lieTimes, 0.5).toFixed(3), "2.141");
assert.equal(percentile(lieTimes, 0.95).toFixed(3), "2.404");
assert.equal(percentile(zeroTimes, 0.5).toFixed(3), "2.284");
assert.equal(percentile(zeroTimes, 0.95).toFixed(3), "3.767");
assert.equal(Math.max(...zeroTimes).toFixed(3), "85.047");
for (const id of ["C8:lie:07", "E8:lie:15", "E8:lie:16"]) {
  const result = correctiveLie.results.find((entry) => entry.id === id);
  assert(result.zero.elapsed_ms > 80);
  assert(result.lie.elapsed_ms < 2.5);
}

assert.match(correctiveCloseout, /Contractual outcome:\*\* \*\*Stop under Revision 3/);
assert.match(correctiveCloseout, /Estimated EC2 cost: \$0\.046655555556/);
assert.match(correctiveCloseout, /No corpus may be generated/);
assert.match(correctiveCloseout, /historical B\/C public labels are transposed/);
assert.match(phase06Proposal, /includes all 256 corrected non-pass representations/);
assert.match(phase06Proposal, /theoretical maximum before deduplication is 8,192 requests/);
assert.match(phase06Proposal, /authorizes neither corpus generation nor model training/);
assert.match(phase06Proposal, /one long-lived LiE interpreter per worker/);
assert.match(phase06Proposal, /### `use_lie_reduced`/);
assert.match(phase06Proposal, /### `lie_resource_fail`/);
assert.doesNotMatch(phase06Proposal, /### `keep_zero`/);
assert.match(phase06Proposal, /differential coverage as both a count and a fraction/);
assert.match(phase06Proposal, /LiE-only cost frontier/);
assert.match(phase06Proposal, /every tested hole below\s+that ceiling/);
assert.match(phase06Proposal, /specific accountable name/);
assert.match(phase06Proposal, /does not authorize corpus generation or model training/);
assert.match(bcErratum, /Historical Zero weight-multiplicity outputs transpose/);
assert.match(bcErratum, /A corpus generated before repair/);

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
  predecessor_session_frontier: {
    decision: sessionV4Summary.decision,
    pass: sessionV4Summary.coverage.classifications.pass,
    time_fail: sessionV4Summary.coverage.classifications.time_fail,
    order_sensitive:
      sessionV4Summary.coverage.classifications.order_sensitive,
    time_fail_memory_unknown:
      sessionV4Summary.coverage.classifications.time_fail_memory_unknown,
    exactness_unknown:
      sessionV4Summary.coverage.exactness_unknown_representations,
  },
  predecessor_session_frontier_v5: {
    decision: sessionV5Summary.decision,
    pass: sessionV5Summary.coverage.classifications.pass,
    time_fail:
      sessionV5Summary.coverage.classifications.time_fail ?? 0,
    order_sensitive:
      sessionV5Summary.coverage.classifications.order_sensitive ?? 0,
    time_fail_memory_unknown:
      sessionV5Summary.coverage.classifications.time_fail_memory_unknown,
    exactness_unknown:
      sessionV5Summary.coverage.exactness_unknown_representations,
    safe_parallel_workers:
      sessionV5Summary.resource.safe_parallel_workers_under_full_time_contract,
  },
  predecessor_session_frontier_v6: {
    decision: sessionV6Summary.decision,
    pass: sessionV6Summary.coverage.classifications.pass,
    time_fail:
      sessionV6Summary.coverage.classifications.time_fail ?? 0,
    order_sensitive:
      sessionV6Summary.coverage.classifications.order_sensitive ?? 0,
    time_fail_memory_unknown:
      sessionV6Summary.coverage.classifications.time_fail_memory_unknown ?? 0,
    exactness_unknown:
      sessionV6Summary.coverage.exactness_unknown_representations,
    grouped_hard_timeouts:
      sessionV6Summary.coverage.grouped_runs_with_hard_timeout,
    safe_parallel_workers:
      sessionV6Summary.resource.safe_parallel_workers_under_full_time_contract,
  },
  current_session_frontier: {
    decision: sessionV7Summary.decision,
    pass: sessionV7Summary.coverage.classifications.pass,
    time_fail:
      sessionV7Summary.coverage.classifications.time_fail ?? 0,
    order_sensitive:
      sessionV7Summary.coverage.classifications.order_sensitive ?? 0,
    time_fail_memory_unknown:
      sessionV7Summary.coverage.classifications.time_fail_memory_unknown ?? 0,
    exactness_unknown:
      sessionV7Summary.coverage.exactness_unknown_representations,
    grouped_hard_timeouts:
      sessionV7Summary.coverage.grouped_runs_with_hard_timeout,
    safe_parallel_workers:
      sessionV7Summary.resource.safe_parallel_workers_under_full_time_contract,
  },
  predecessor_session_frontier_v5_correctness_addendum: {
    representation:
      sessionV5CorrectnessResult.observation.representation_id,
    fresh_reference_completed:
      sessionV5CorrectnessResult.observation.version_5_same_run_fresh_reference
        .completed_queries,
    unique_predecessor_agreements:
      sessionV5CorrectnessResult.observation.sealed_predecessor_comparison
        .agreements,
    disagreements:
      sessionV5CorrectnessResult.observation.sealed_predecessor_comparison
        .disagreements,
    independent: sessionV5CorrectnessResult.interpretation.independent,
  },
  session_correctness_addendum: {
    decision: sessionCorrectnessResult.evidence_status,
    pass: sessionCorrectnessResult.summary.statuses.pass,
    fail: sessionCorrectnessResult.summary.statuses.fail,
    unknown:
      sessionCorrectnessResult.summary.statuses
        .unknown_after_hard_timeout_or_oracle_error,
    comparisons:
      sessionCorrectnessResult.summary
        .observed_session_to_reference_comparisons,
  },
  corrective_cloud_audit: {
    status: correctiveStatus.status,
    cost_usd: correctiveStatus.estimated_ec2_usd,
    allocator_representations: correctiveAllocator.summary.representations,
    memory_classification_changes:
      correctiveAllocator.summary.memory_classification_changes,
    exactness_failures:
      correctiveExactness.corrected_exactness_statuses.fail,
    lie_agreements: correctiveLie.summary.agreements,
    phase_1_authorized: correctiveExecution.closures.phase_1_authorized,
  },
}));
