#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareRuns,
  describeType,
  generateTargets,
  runOrderedGroup,
  sha256,
  stableJson,
} from "./run-weight-multiplicity-phase05.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const parseArguments = (values) => {
  const options = {
    plan: "examples/weight-multiplicity/phase05-session-correctness-plan-v1.json",
    referenceOracle: null,
    sessionOracle: null,
    out: null,
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const keys = {
      "--plan": "plan",
      "--reference-oracle": "referenceOracle",
      "--session-oracle": "sessionOracle",
      "--out": "out",
    };
    const key = keys[value];
    if (!key) throw new Error(`unknown argument: ${value}`);
    const next = values[++index];
    if (!next) throw new Error(`${value} requires a value`);
    options[key] = next;
  }
  if (!options.referenceOracle || !options.sessionOracle || !options.out)
    throw new Error("--reference-oracle, --session-oracle, and --out are required");
  return options;
};

const readJson = async (path) => {
  const bytes = await readFile(path);
  return { bytes, value: JSON.parse(bytes.toString("utf8")) };
};

const stripRun = (run, expectedQueries) => ({
  mode: run.mode,
  order: run.order,
  expected_queries: expectedQueries,
  completed_queries: run.completed_queries,
  complete:
    !run.hard_timeout &&
    !run.oracle_error &&
    run.completed_queries === expectedQueries,
  hard_timeout: run.hard_timeout
    ? {
        request: run.hard_timeout.request,
        target_depth: run.hard_timeout.target_depth,
      }
    : null,
  oracle_error: run.oracle_error,
  records: run.records.map((record) => ({
    request: record.request,
    multiplicity: record.multiplicity,
    response_sha256: sha256(record.response),
  })),
});

const runComplete = (run, expectedQueries) =>
  !run.hard_timeout &&
  !run.oracle_error &&
  run.completed_queries === expectedQueries;

const measureRepresentation = async ({
  referenceOracle,
  sessionOracle,
  representation,
  description,
  sourcePlan,
  plan,
}) => {
  const targets = generateTargets(representation, description, sourcePlan);
  const runPlan = {
    frontier: {
      optimization_sequence: [
        "recursive_weyl_canonicalization_fresh_reference",
        "bounded_session_memo_correctness_only",
      ],
      measurement_hard_timeout_ms: plan.correctness.hard_timeout_ms,
      query_timeout_ms: plan.correctness.hard_timeout_ms,
      peak_incremental_memory_limit_bytes: plan.correctness.memo_limit_bytes,
      hard_timeout_rss_sampling_start_ms:
        plan.correctness.hard_timeout_rss_sampling_start_ms,
      hard_timeout_rss_sampling_interval_ms:
        plan.correctness.hard_timeout_rss_sampling_interval_ms,
    },
  };
  const run = async (label, oracle, mode, order) => {
    process.stdout.write(
      `${representation.id}\t${label}\tstarted\t${targets.length} targets\n`,
    );
    const value = await runOrderedGroup({
      oracle,
      representation,
      targets,
      plan: runPlan,
      mode,
      order,
    });
    process.stdout.write(
      `${representation.id}\t${label}\t${runComplete(value, targets.length) ? "complete" : "incomplete"}\t${value.completed_queries}/${targets.length}\n`,
    );
    return value;
  };

  const reference = await run(
    "cold_reference",
    referenceOracle,
    "fresh",
    "seeded_generation_order",
  );
  const binding = await run(
    "ascending",
    sessionOracle,
    "grouped",
    plan.correctness.binding_target_order,
  );
  const sensitivities = [];
  for (const order of plan.correctness.sensitivity_target_orders) {
    sensitivities.push(
      await run(order, sessionOracle, "grouped", order),
    );
  }
  const replays = [];
  for (let replay = 0; replay < plan.correctness.binding_replays; replay += 1) {
    replays.push(
      await run(
        `ascending_replay_${replay + 1}`,
        sessionOracle,
        "grouped",
        plan.correctness.binding_target_order,
      ),
    );
  }

  const sessionRuns = [binding, ...sensitivities, ...replays];
  const mismatches = sessionRuns.flatMap((sessionRun) =>
    compareRuns(reference, sessionRun),
  );
  const replayObserved =
    runComplete(binding, targets.length) &&
    replays.length === plan.correctness.binding_replays &&
    replays.every((replay) => runComplete(replay, targets.length));
  const replayByteIdentical = replayObserved
    ? replays.every(
        (replay) =>
          replay.records.length === binding.records.length &&
          replay.records.every(
            (record, index) => record.response === binding.records[index].response,
          ),
      )
    : null;
  const allRunsComplete = [reference, ...sessionRuns].every((value) =>
    runComplete(value, targets.length),
  );
  const exactnessStatus =
    mismatches.length > 0 || replayByteIdentical === false
      ? "fail"
      : allRunsComplete && replayByteIdentical
        ? "pass"
        : "unknown_after_hard_timeout_or_oracle_error";

  return {
    representation: {
      id: representation.id,
      type: representation.type,
      highest_weight: representation.highest_weight,
      representation_dimension: representation.representation_dimension,
    },
    targets: {
      count: targets.length,
      sha256: sha256(
        stableJson(
          targets.map((target) => ({
            generation_index: target.generation_index,
            target_weight: target.target_weight,
            target_depth: target.target_depth,
            target_status: target.target_status,
            dominant_target_key: target.dominant_target_key,
          })),
        ),
      ),
    },
    exactness: {
      status: exactnessStatus,
      all_runs_complete: allRunsComplete,
      mismatches,
      replay_observed: replayObserved,
      replay_byte_identical: replayByteIdentical,
      observed_comparisons: sessionRuns.reduce(
        (sum, sessionRun) =>
          sum +
          sessionRun.records.filter((record) =>
            reference.records.some(
              (referenceRecord) => referenceRecord.request === record.request,
            ),
          ).length,
        0,
      ),
    },
    cold_reference: stripRun(reference, targets.length),
    session_runs: [binding, ...sensitivities, ...replays].map((value) =>
      stripRun(value, targets.length),
    ),
  };
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  const planPath = resolve(root, options.plan);
  const planRecord = await readJson(planPath);
  const plan = planRecord.value;
  const sourcePlanPath = resolve(root, plan.bindings.source_plan.path);
  const sourceManifestPath = resolve(root, plan.bindings.source_manifest.path);
  const sourceResultPath = resolve(root, plan.bindings.source_result.path);
  const [sourcePlanRecord, sourceManifestRecord, sourceResultBytes] =
    await Promise.all([
      readJson(sourcePlanPath),
      readJson(sourceManifestPath),
      readFile(sourceResultPath),
    ]);
  const boundFiles = [
    ["source plan", sourcePlanRecord.bytes, plan.bindings.source_plan.sha256],
    [
      "source manifest",
      sourceManifestRecord.bytes,
      plan.bindings.source_manifest.sha256,
    ],
    ["source result", sourceResultBytes, plan.bindings.source_result.sha256],
  ];
  for (const [label, bytes, expected] of boundFiles)
    if (sha256(bytes) !== expected)
      throw new Error(`${label} does not match the correctness plan`);

  const referenceOracle = resolve(options.referenceOracle);
  const sessionOracle = resolve(options.sessionOracle);
  const [referenceBytes, sessionBytes] = await Promise.all([
    readFile(referenceOracle),
    readFile(sessionOracle),
  ]);
  if (sha256(referenceBytes) !== plan.oracles.cold_reference.executable_sha256)
    throw new Error("cold reference executable does not match the correctness plan");
  if (sha256(sessionBytes) !== plan.oracles.session.executable_sha256)
    throw new Error("session executable does not match the correctness plan");

  const byId = new Map(
    sourceManifestRecord.value.representations.map((value) => [value.id, value]),
  );
  const representations = plan.correctness.representation_ids.map((id) => {
    const representation = byId.get(id);
    if (!representation) throw new Error(`missing bound representation ${id}`);
    return representation;
  });
  const descriptions = new Map();
  const result = {
    schema_version: 1,
    evidence_status: "correctness_addendum_in_progress",
    evidence_stage: "bounded_session_memo_correctness_addendum",
    resource_claims: false,
    plan_sha256: sha256(planRecord.bytes),
    bindings: plan.bindings,
    oracles: plan.oracles,
    started_at: new Date().toISOString(),
    measurements: [],
    summary: null,
    phase_1: { authorized: false, corpus_generated: false, models_trained: false },
  };
  for (const representation of representations) {
    if (!descriptions.has(representation.type))
      descriptions.set(
        representation.type,
        describeType(sessionOracle, representation.type),
      );
    const measurement = await measureRepresentation({
      referenceOracle,
      sessionOracle,
      representation,
      description: descriptions.get(representation.type),
      sourcePlan: sourcePlanRecord.value,
      plan,
    });
    result.measurements.push(measurement);
    await writeFile(resolve(root, options.out), stableJson(result));
  }

  const statuses = Object.fromEntries(
    ["pass", "fail", "unknown_after_hard_timeout_or_oracle_error"].map(
      (status) => [
        status,
        result.measurements.filter(
          (measurement) => measurement.exactness.status === status,
        ).length,
      ],
    ),
  );
  result.summary = {
    representations: result.measurements.length,
    statuses,
    target_requests: result.measurements.reduce(
      (sum, measurement) => sum + measurement.targets.count,
      0,
    ),
    observed_session_to_reference_comparisons: result.measurements.reduce(
      (sum, measurement) =>
        sum + measurement.exactness.observed_comparisons,
      0,
    ),
    disagreements: result.measurements.reduce(
      (sum, measurement) => sum + measurement.exactness.mismatches.length,
      0,
    ),
    replay_failures: result.measurements.filter(
      (measurement) => measurement.exactness.replay_byte_identical === false,
    ).length,
    replay_unknown: result.measurements.filter(
      (measurement) => measurement.exactness.replay_byte_identical === null,
    ).length,
  };
  result.completed_at = new Date().toISOString();
  result.evidence_status =
    statuses.fail > 0
      ? "correctness_addendum_fail"
      : statuses.unknown_after_hard_timeout_or_oracle_error > 0
        ? "correctness_addendum_hold"
        : "correctness_addendum_pass";
  await writeFile(resolve(root, options.out), stableJson(result));
  process.stdout.write(`${stableJson({ evidence_status: result.evidence_status, summary: result.summary })}`);
};

await main();
