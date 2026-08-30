#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const parseArguments = (values) => {
  const options = {
    input: null,
    output: null,
    summaryOut: null,
    plan: "examples/weight-multiplicity/phase05-frontier-plan-v2.json",
    manifest: "examples/weight-multiplicity/phase05-representation-manifest-v2.json",
    lieManifest: "examples/weight-multiplicity/phase05-lie-cross-check-manifest-v4.json",
    lieResult: "experiments/weight-multiplicity/phase05/lie-cross-check-v4.json",
  };
  const names = {
    "--in": "input",
    "--out": "output",
    "--summary-out": "summaryOut",
    "--plan": "plan",
    "--manifest": "manifest",
    "--lie-manifest": "lieManifest",
    "--lie-result": "lieResult",
  };
  for (let index = 0; index < values.length; index += 1) {
    const key = names[values[index]];
    if (!key) throw new Error(`unknown argument: ${values[index]}`);
    const value = values[++index];
    if (!value) throw new Error(`${values[index - 1]} requires a value`);
    options[key] = value;
  }
  if (!options.input || !options.output || !options.summaryOut)
    throw new Error("--in, --out, and --summary-out are required");
  return options;
};

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const readRecord = async (path) => {
  const bytes = await readFile(resolve(root, path));
  return { bytes, value: JSON.parse(bytes.toString("utf8")) };
};

const p95Pass = (run, limit) =>
  !run.hard_timeout &&
  !run.oracle_error &&
  run.latency_ms.p95 !== null &&
  run.latency_ms.p95 <= limit;

const timePass = (run, limit) =>
  p95Pass(run, limit) && run.latency_ms.threshold_exceedances === 0;

const memoryStatus = (run, limit) => {
  if (run.memory_bytes.observation === "lower_bound_limit_exceeded") return "fail";
  if (run.memory_bytes.observation !== "exact_process_high_water") return "unknown";
  if (run.memory_bytes.incremental_from_ready === null) return "unknown";
  return run.memory_bytes.incremental_from_ready <= limit ? "pass" : "fail";
};

const runComplete = (run, expectedQueries) =>
  !run.hard_timeout &&
  !run.oracle_error &&
  run.completed_queries === expectedQueries;

const normalizeMeasurement = (measurement, plan) => {
  const groupedRuns = [measurement.binding, ...measurement.sensitivities];
  const correctnessRuns = [
    measurement.cold,
    ...groupedRuns,
    ...measurement.replays,
  ];
  const expectedQueries = measurement.targets.raw;
  const explicitExactnessFailure =
    measurement.exactness.mismatches.length > 0 ||
    !measurement.exactness.replay_byte_identical;
  const correctnessObserved =
    measurement.replays.length === plan.frontier.replays &&
    correctnessRuns.every((run) => runComplete(run, expectedQueries));
  const hasHardTimeout = correctnessRuns.some((run) => run.hard_timeout);
  const hasOracleError = correctnessRuns.some((run) => run.oracle_error);
  const exactnessStatus = explicitExactnessFailure
    ? "fail"
    : correctnessObserved
      ? "pass"
      : hasHardTimeout
        ? "unknown_after_hard_timeout"
        : hasOracleError
          ? "unknown_after_oracle_error"
          : "unknown_after_incomplete_run";
  const timePasses = groupedRuns.map((run) =>
    timePass(run, plan.frontier.p95_limit_ms),
  );
  const p95Passes = groupedRuns.map((run) =>
    p95Pass(run, plan.frontier.p95_limit_ms),
  );
  const memoryStatuses = groupedRuns.map((run) =>
    memoryStatus(run, plan.frontier.peak_incremental_memory_limit_bytes),
  );
  const orderSensitive = p95Passes.some((value) => value !== p95Passes[0]);
  const groupedTimePass = timePasses.every(Boolean);
  const groupedMemoryPass = memoryStatuses.every((status) => status === "pass");
  const memoryUnknown = memoryStatuses.includes("unknown");
  const memoryFail = memoryStatuses.includes("fail");
  let classification = "pass";
  if (exactnessStatus === "fail") classification = "exactness_fail";
  else if (orderSensitive) classification = "order_sensitive";
  else if (!groupedTimePass && memoryFail) classification = "time_and_memory_fail";
  else if (!groupedTimePass && memoryUnknown)
    classification = "time_fail_memory_unknown";
  else if (!groupedTimePass) classification = "time_fail";
  else if (memoryFail) classification = "memory_fail";
  else if (memoryUnknown) classification = "memory_unknown";
  else if (exactnessStatus !== "pass") classification = "exactness_unknown";
  measurement.classification = classification;
  measurement.boundary = {
    exactness_status: exactnessStatus,
    exactness_known: exactnessStatus === "pass" || exactnessStatus === "fail",
    exactness_pass: exactnessStatus === "pass",
    time_pass: groupedTimePass,
    memory_pass: groupedMemoryPass,
    memory_known: !memoryUnknown,
    memory_statuses: memoryStatuses,
    per_query_time_passes: groupedRuns.map(
      (run) => run.latency_ms.threshold_exceedances === 0,
    ),
    p95_time_passes: p95Passes,
    order_sensitive: orderSensitive,
  };
  measurement.exactness.status = exactnessStatus;
  measurement.exactness.expected_queries_per_run = expectedQueries;
  measurement.exactness.correctness_runs_complete = correctnessObserved;
  measurement.exactness.replay_byte_identical =
    measurement.replays.length === 0
      ? null
      : measurement.exactness.replay_byte_identical;
  return measurement;
};

const testedCeilings = (measurements) => {
  const result = {};
  for (const type of new Set(measurements.map((item) => item.representation.type))) {
    const ordered = measurements
      .filter((item) => item.representation.type === type)
      .sort((left, right) =>
        BigInt(left.representation.representation_dimension) <
        BigInt(right.representation.representation_dimension)
          ? -1
          : 1,
      );
    let dimension = null;
    let failed = false;
    const passAfterFirstFailure = [];
    for (const measurement of ordered) {
      if (!failed && measurement.classification === "pass")
        dimension = measurement.representation.representation_dimension;
      else if (measurement.classification !== "pass") failed = true;
      else
        passAfterFirstFailure.push({
          highest_weight: measurement.representation.highest_weight,
          dimension: measurement.representation.representation_dimension,
        });
    }
    result[type] = { dimension, pass_after_first_failure: passAfterFirstFailure };
  }
  return result;
};

const runBoundary = (run) => ({
  order: run.order,
  p95_ms: run.latency_ms.p95,
  maximum_ms: run.latency_ms.maximum,
  threshold_exceedances: run.latency_ms.threshold_exceedances,
  completed_queries: run.completed_queries,
  hard_timeout: run.hard_timeout,
  memory_observation: run.memory_bytes.observation,
  incremental_memory_bytes: run.memory_bytes.incremental_from_ready,
  hard_timeout_incremental_rss_lower_bound:
    run.memory_bytes.hard_timeout_incremental_rss_lower_bound,
  hard_timeout_rss_sampling: run.memory_bytes.hard_timeout_rss_sampling,
});

const normalizeParallelism = (parallelism, plan) => {
  for (const candidate of parallelism.candidates) {
    candidate.p95_safe = candidate.runs.every(
      (run) =>
        !run.hard_timeout &&
        !run.oracle_error &&
        run.p95_ms !== null &&
        run.p95_ms <= plan.frontier.p95_limit_ms,
    );
    candidate.per_query_safe = candidate.runs.every(
      (run) =>
        run.maximum_ms !== null &&
        run.maximum_ms <= plan.frontier.query_timeout_ms,
    );
    candidate.safe = candidate.p95_safe && candidate.per_query_safe;
  }
  parallelism.safe_parallel_workers =
    parallelism.candidates.filter((candidate) => candidate.safe).at(-1)
      ?.workers ?? 0;
  return parallelism;
};

const summarize = (result, hashes, lie) => {
  const classifications = {};
  for (const measurement of result.measurements)
    classifications[measurement.classification] =
      (classifications[measurement.classification] ?? 0) + 1;
  const groupedRuns = result.measurements.flatMap((measurement) => [
    measurement.binding,
    ...measurement.sensitivities,
  ]);
  const exactMemoryValues = groupedRuns
    .filter((run) => run.memory_bytes.observation === "exact_process_high_water")
    .map((run) => run.memory_bytes.incremental_from_ready)
    .filter((value) => value !== null);
  const orderSensitive = result.measurements
    .filter((measurement) => measurement.classification === "order_sensitive")
    .map((measurement) => ({
      id: measurement.representation.id,
      type: measurement.representation.type,
      highest_weight: measurement.representation.highest_weight,
      representation_dimension:
        measurement.representation.representation_dimension,
      cold_p95_ms: measurement.cold.latency_ms.p95,
      grouped_orders: [measurement.binding, ...measurement.sensitivities].map(
        runBoundary,
      ),
    }));
  const hardTimeouts = result.measurements
    .filter((measurement) =>
      [measurement.binding, ...measurement.sensitivities].some(
        (run) => run.hard_timeout,
      ),
    )
    .map((measurement) => ({
      id: measurement.representation.id,
      type: measurement.representation.type,
      highest_weight: measurement.representation.highest_weight,
      representation_dimension:
        measurement.representation.representation_dimension,
      exactness_status: measurement.boundary.exactness_status,
      cold: runBoundary(measurement.cold),
      grouped_orders: [measurement.binding, ...measurement.sensitivities].map(
        runBoundary,
      ),
    }));
  const timeFailures = result.measurements
    .filter((measurement) => measurement.classification === "time_fail")
    .map((measurement) => ({
      id: measurement.representation.id,
      type: measurement.representation.type,
      highest_weight: measurement.representation.highest_weight,
      representation_dimension:
        measurement.representation.representation_dimension,
      grouped_orders: [measurement.binding, ...measurement.sensitivities].map(
        runBoundary,
      ),
    }));
  return {
    schema_version: 1,
    evidence_stage: result.evidence_stage,
    decision: "hold",
    decision_basis: {
      order_sensitive_representations: orderSensitive.length,
      time_fail_representations: timeFailures.length,
      time_fail_memory_unknown_representations: hardTimeouts.length,
      resource_pass_requires_every_query_and_p95_in_every_frozen_order_to_pass:
        true,
    },
    bindings: hashes,
    capture: {
      started_at: result.started_at,
      completed_at: result.completed_at,
      measurement_controller_revision: result.controller_revision,
      finalizer_revision: result.finalizer_revision,
      reference_hardware: result.reference_hardware,
    },
    coverage: {
      representations: result.measurements.length,
      classifications,
      grouped_runs: groupedRuns.length,
      grouped_runs_with_hard_timeout: groupedRuns.filter((run) => run.hard_timeout)
        .length,
      exactness_pass_representations: result.measurements.filter(
        (measurement) => measurement.boundary.exactness_status === "pass",
      ).length,
      exactness_unknown_representations: result.measurements.filter(
        (measurement) => !measurement.boundary.exactness_known,
      ).length,
      exactness_disagreements: result.measurements.reduce(
        (sum, measurement) => sum + measurement.exactness.mismatches.length,
        0,
      ),
      replay_failures: result.measurements.filter(
        (measurement) => measurement.exactness.replay_byte_identical === false,
      ).length,
    },
    resource: {
      time_limit_ms: 1000,
      measurement_hard_timeout_ms: 10000,
      peak_incremental_memory_limit_bytes: 2147483648,
      maximum_known_grouped_incremental_memory_bytes:
        exactMemoryValues.length === 0 ? null : Math.max(...exactMemoryValues),
      unknown_memory_is_never_reported_as_pass: true,
      safe_parallel_workers_under_full_time_contract:
        result.parallelism.safe_parallel_workers,
    },
    order_sensitive: orderSensitive,
    time_failures: timeFailures,
    hard_timeouts: hardTimeouts,
    tested_ceilings: result.summary.tested_ceilings,
    independent_lie_witness: lie,
    phase_1: result.phase_1,
  };
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  const [capture, plan, manifest, lieManifest, lieResult] = await Promise.all([
    readRecord(options.input),
    readRecord(options.plan),
    readRecord(options.manifest),
    readRecord(options.lieManifest),
    readRecord(options.lieResult),
  ]);
  if (capture.value.plan_sha256 !== sha256(plan.bytes))
    throw new Error("capture does not bind the current plan");
  if (capture.value.manifest_sha256 !== sha256(manifest.bytes))
    throw new Error("capture does not bind the current manifest");
  if (lieResult.value.summary?.disagreements !== 0)
    throw new Error("independent LiE witness has disagreements");
  const result = capture.value;
  result.schema_version = 2;
  result.capture_sha256 = sha256(capture.bytes);
  result.capture_evidence_status = result.evidence_status;
  result.evidence_status = "binding_session_frontier_hold";
  result.decision = "hold";
  result.finalizer_revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  result.measurements = result.measurements.map((measurement) =>
    normalizeMeasurement(measurement, plan.value),
  );
  result.parallelism = normalizeParallelism(result.parallelism, plan.value);
  const classifications = {};
  for (const measurement of result.measurements)
    classifications[measurement.classification] =
      (classifications[measurement.classification] ?? 0) + 1;
  result.summary = {
    representations: result.measurements.length,
    classifications,
    tested_ceilings: testedCeilings(result.measurements),
  };
  const bindings = {
    capture_sha256: result.capture_sha256,
    plan_sha256: sha256(plan.bytes),
    manifest_sha256: sha256(manifest.bytes),
    oracle_executable_sha256: result.oracle_executable_sha256,
    lie_manifest_sha256: sha256(lieManifest.bytes),
    lie_result_sha256: sha256(lieResult.bytes),
  };
  const lie = {
    category: "independent_correctness_witness_separate_from_internal_resource_evidence",
    decision: "pass",
    agreements: lieResult.value.summary.agreements,
    disagreements: lieResult.value.summary.disagreements,
    manifest_sha256: bindings.lie_manifest_sha256,
    result_sha256: bindings.lie_result_sha256,
  };
  const summary = summarize(result, bindings, lie);
  await Promise.all([
    writeFile(resolve(root, options.output), stableJson(result)),
    writeFile(resolve(root, options.summaryOut), stableJson(summary)),
  ]);
  console.log(
    JSON.stringify({
      decision: summary.decision,
      coverage: summary.coverage,
      resource: summary.resource,
    }),
  );
};

await main();
