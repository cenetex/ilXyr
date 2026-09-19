#!/usr/bin/env node

import { gunzipSync } from "node:zlib";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  assessExactness,
  sha256,
  stableJson,
  summarize,
} from "./run-weight-multiplicity-phase05.mjs";

const parseArguments = (values) => {
  const options = { auditPlan: null, sourcePlan: null, frontier: null, out: null };
  const keys = {
    "--audit-plan": "auditPlan",
    "--source-plan": "sourcePlan",
    "--frontier": "frontier",
    "--out": "out",
  };
  for (let index = 0; index < values.length; index += 1) {
    const key = keys[values[index]];
    if (!key) throw new Error(`unknown argument: ${values[index]}`);
    const next = values[++index];
    if (!next) throw new Error(`${values[index - 1]} requires a value`);
    options[key] = next;
  }
  if (Object.values(options).some((value) => value === null))
    throw new Error("--audit-plan, --source-plan, --frontier, and --out are required");
  return options;
};

const readJson = async (path) => {
  const bytes = await readFile(resolve(path));
  return { bytes, value: JSON.parse(bytes.toString("utf8")) };
};

const decodeFrontier = (bytes) => {
  const decoded = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
  return { decoded, value: JSON.parse(decoded.toString("utf8")) };
};

const runPassesTime = (run, plan) =>
  !run.hard_timeout &&
  !run.oracle_error &&
  run.latency_ms.p95 !== null &&
  run.latency_ms.p95 <= plan.frontier.p95_limit_ms;

const correctedMeasurement = (measurement, sourcePlan, requiredReplays) => {
  const expectedQueries = measurement.targets.raw;
  const replays = measurement.replays ?? [];
  const orderRuns = [measurement.binding, ...(measurement.sensitivities ?? [])];
  const requiredGroupedRuns = [...orderRuns, ...replays];
  const exactness = assessExactness({
    runs: [measurement.cold, ...requiredGroupedRuns],
    binding: measurement.binding,
    replays,
    expectedQueries,
    requiredReplays,
    mismatches: measurement.exactness.mismatches,
  });
  const timePass =
    replays.length === requiredReplays &&
    requiredGroupedRuns.every((run) => runPassesTime(run, sourcePlan));
  const statuses = measurement.boundary.memory_statuses ?? [];
  const memoryFail = statuses.includes("fail");
  const memoryUnknown = statuses.some((status) =>
    ["unknown", "unresolved"].includes(status),
  );
  const memoryPass = statuses.length > 0 && statuses.every((status) => status === "pass");
  let classification = "pass";
  if (exactness.status === "fail") classification = "exactness_fail";
  else if (measurement.boundary.order_sensitive) classification = "order_sensitive";
  else if (!timePass && memoryFail) classification = "time_and_memory_fail";
  else if (!timePass && memoryUnknown) classification = "time_fail_memory_unknown";
  else if (!timePass) classification = "time_fail";
  else if (memoryFail) classification = "memory_fail";
  else if (memoryUnknown || !memoryPass) classification = "memory_unknown";
  return {
    ...measurement,
    classification,
    boundary: {
      ...measurement.boundary,
      exactness_pass: exactness.status === "pass",
      exactness_known:
        exactness.status !== "unknown_after_hard_timeout_or_oracle_error",
      exactness_status: exactness.status,
      time_pass: timePass,
      memory_pass: memoryPass,
      memory_known: !memoryUnknown,
    },
    exactness: {
      ...measurement.exactness,
      all_runs_complete: exactness.all_runs_complete,
      replay_observed: exactness.replay_observed,
      replay_byte_identical: exactness.replay_byte_identical,
      replay_runs: replays.length,
      required_replay_runs: requiredReplays,
    },
  };
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  const [auditRecord, sourcePlanRecord, frontierBytes] = await Promise.all([
    readJson(options.auditPlan),
    readJson(options.sourcePlan),
    readFile(resolve(options.frontier)),
  ]);
  const audit = auditRecord.value;
  if (sha256(sourcePlanRecord.bytes) !== audit.bindings.prior_cloud_plan_sha256)
    throw new Error("source plan does not match the corrective audit binding");
  if (sha256(frontierBytes) !== audit.bindings.prior_cloud_frontier_gzip_sha256)
    throw new Error("frontier does not match the corrective audit binding");
  const frontierRecord = decodeFrontier(frontierBytes);
  const frontier = frontierRecord.value;
  if (
    frontier.plan_sha256 !== audit.bindings.prior_cloud_plan_sha256 ||
    frontier.manifest_sha256 !== audit.bindings.prior_cloud_manifest_sha256 ||
    frontier.oracle_executable_sha256 !== audit.bindings.oracle_executable_sha256 ||
    frontier.controller_revision !== audit.bindings.prior_cloud_controller_revision
  )
    throw new Error("frontier embedded identities do not match the corrective audit");

  const corrected = frontier.measurements.map((measurement) =>
    correctedMeasurement(
      measurement,
      sourcePlanRecord.value,
      audit.exactness_correction.required_replays,
    ),
  );
  const changes = corrected.flatMap((measurement, index) => {
    const original = frontier.measurements[index];
    if (original.classification === measurement.classification) return [];
    return [{
      representation_id: measurement.representation.id,
      prior_classification: original.classification,
      corrected_classification: measurement.classification,
      observed_multiplicity_mismatches: measurement.exactness.mismatches.length,
      prior_replay_byte_identical: original.exactness.replay_byte_identical,
      corrected_replay_byte_identical: measurement.exactness.replay_byte_identical,
      exactness_status: measurement.boundary.exactness_status,
      time_pass: measurement.boundary.time_pass,
    }];
  });
  const changedIds = changes.map((change) => change.representation_id).sort();
  const expectedIds = [...audit.exactness_correction.expected_prior_false_labels].sort();
  if (JSON.stringify(changedIds) !== JSON.stringify(expectedIds))
    throw new Error(
      `corrected labels differ from the frozen expectation: ${changedIds.join(",")}`,
    );
  if (
    changes.some(
      (change) =>
        change.prior_classification !== "exactness_fail" ||
        change.corrected_classification !== "time_fail" ||
        change.observed_multiplicity_mismatches !== 0 ||
        change.corrected_replay_byte_identical !== null,
    )
  )
    throw new Error("the frozen false-label correction did not have the expected shape");

  const result = {
    schema_version: 1,
    record_kind: "append_only_exactness_classification_correction",
    audit_id: audit.audit_id,
    source: {
      compressed_frontier_sha256: sha256(frontierBytes),
      decoded_frontier_sha256: sha256(frontierRecord.decoded),
      run_id: audit.bindings.prior_cloud_run_id,
      controller_revision: frontier.controller_revision,
      oracle_executable_sha256: frontier.oracle_executable_sha256,
    },
    rule: audit.exactness_correction.rule,
    changes,
    corrected_exactness_statuses: Object.fromEntries(
      ["pass", "fail", "unknown_after_hard_timeout_or_oracle_error"].map(
        (status) => [
          status,
          corrected.filter(
            (measurement) => measurement.boundary.exactness_status === status,
          ).length,
        ],
      ),
    ),
    prior_summary: frontier.summary,
    corrected_summary: summarize(corrected),
    decision: {
      phase_1_authorized: false,
      corpus_generated: false,
      models_trained: false,
      effect: "Two false exactness labels become time failures. No arithmetic disagreement was observed.",
    },
  };
  await writeFile(resolve(options.out), stableJson(result));
  process.stdout.write(
    stableJson({ changes: result.changes, classifications: result.corrected_summary.classifications }),
  );
};

await main();
