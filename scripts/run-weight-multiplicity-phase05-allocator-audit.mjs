#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  compareRuns,
  describeType,
  generateTargets,
  runOrderedGroup,
  sha256,
  stableJson,
} from "./run-weight-multiplicity-phase05.mjs";

const parseArguments = (values) => {
  const options = { auditPlan: null, sourcePlan: null, oracle: null, out: null };
  const keys = {
    "--audit-plan": "auditPlan",
    "--source-plan": "sourcePlan",
    "--oracle": "oracle",
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
    throw new Error("--audit-plan, --source-plan, --oracle, and --out are required");
  return options;
};

const readJson = async (path) => {
  const bytes = await readFile(resolve(path));
  return { bytes, value: JSON.parse(bytes.toString("utf8")) };
};

const targetFingerprint = (targets) =>
  sha256(
    stableJson(
      targets.map((target) => ({
        generation_index: target.generation_index,
        target_weight: target.target_weight,
        target_depth: target.target_depth,
        target_status: target.target_status,
        dominant_target_key: target.dominant_target_key,
        anchor_per_mille: target.anchor_per_mille,
        trajectory: target.trajectory,
      })),
    ),
  );

const observedMemory = (run, limitBytes) => {
  const peakBytes = run.hard_timeout
    ? run.hard_timeout.sampled_peak_rss_bytes
    : run.memory_bytes.group_peak_rss;
  const readyBytes = run.memory_bytes.ready_peak_rss;
  const incrementalBytes =
    peakBytes === null || peakBytes === undefined || readyBytes === null
      ? null
      : Math.max(0, peakBytes - readyBytes);
  const observation = run.hard_timeout
    ? run.hard_timeout.peak_rss_observation
    : "exact_process_high_water_after_complete_run";
  let status = "unknown";
  if (incrementalBytes !== null) {
    if (incrementalBytes > limitBytes) status = "limit_exceeded_before_termination";
    else if (run.hard_timeout) status = "under_limit_until_hard_timeout";
    else status = "under_limit_complete_run";
  }
  const entries = run.memory_bytes.maximum_memo_entries;
  const entryBytes = run.memo_configuration?.entry_bytes ?? null;
  const liveEntryBytes = entryBytes === null ? null : entries * entryBytes;
  const capacityBytes = Math.max(
    run.memory_bytes.maximum_memo_capacity ?? 0,
    run.hard_timeout?.memo_progress?.bytes_after ?? 0,
  );
  return {
    status,
    observation,
    peak_rss_bytes: peakBytes,
    ready_peak_rss_bytes: readyBytes,
    incremental_rss_bytes: incrementalBytes,
    limit_bytes: limitBytes,
    memo_entries: entries,
    memo_entry_bytes: entryBytes,
    live_entry_bytes: liveEntryBytes,
    memo_capacity_bytes: capacityBytes,
    capacity_to_live_entry_ratio:
      liveEntryBytes && capacityBytes ? capacityBytes / liveEntryBytes : null,
    memo_peak_simultaneous_allocated_bytes:
      run.memory_bytes.maximum_memo_peak_allocated,
  };
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  const [auditRecord, sourcePlanRecord, oracleBytes] = await Promise.all([
    readJson(options.auditPlan),
    readJson(options.sourcePlan),
    readFile(resolve(options.oracle)),
  ]);
  const audit = auditRecord.value;
  if (sha256(sourcePlanRecord.bytes) !== audit.bindings.prior_cloud_plan_sha256)
    throw new Error("source plan does not match the corrective audit binding");
  if (sha256(oracleBytes) !== audit.bindings.oracle_executable_sha256)
    throw new Error("oracle executable does not match the corrective audit binding");
  const allocator = audit.allocator_audit;
  const descriptions = new Map();
  const measurements = [];
  for (const selected of allocator.representations) {
    const representation = selected.representation;
    if (!descriptions.has(representation.type))
      descriptions.set(
        representation.type,
        describeType(resolve(options.oracle), representation.type),
      );
    const targets = generateTargets(
      representation,
      descriptions.get(representation.type),
      sourcePlanRecord.value,
    );
    const generatedTargetsSha256 = targetFingerprint(targets);
    if (
      targets.length !== 32 ||
      generatedTargetsSha256 !== selected.generated_targets_sha256
    )
      throw new Error(`generated targets drifted for ${representation.id}`);
    const policies = [];
    for (const policy of allocator.policies) {
      process.stdout.write(`${representation.id}\t${policy.id}\tstarted\n`);
      const run = await runOrderedGroup({
        oracle: resolve(options.oracle),
        representation,
        targets,
        plan: {
          frontier: {
            optimization_sequence: ["unused", `allocator_policy_${policy.id}`],
            measurement_hard_timeout_ms: allocator.measurement_hard_timeout_ms,
            query_timeout_ms: allocator.query_p95_limit_ms,
            p95_limit_ms: allocator.query_p95_limit_ms,
            peak_incremental_memory_limit_bytes:
              allocator.peak_incremental_memory_limit_bytes,
            hard_timeout_rss_sampling_start_ms:
              allocator.hard_timeout_rss_sampling_start_ms,
            hard_timeout_rss_sampling_interval_ms:
              allocator.hard_timeout_rss_sampling_interval_ms,
          },
        },
        mode: "grouped",
        order: allocator.binding_target_order,
        oracleEnvironment: {
          ZERO_WEIGHT_MEMO_INITIAL_CAPACITY: String(policy.initial_capacity),
          ZERO_WEIGHT_MEMO_PROGRESS: "1",
        },
      });
      policies.push({
        policy,
        run,
        observed_memory: observedMemory(
          run,
          allocator.peak_incremental_memory_limit_bytes,
        ),
      });
      process.stdout.write(
        `${representation.id}\t${policy.id}\t${run.hard_timeout ? "hard_timeout" : run.oracle_error ? "oracle_error" : "complete"}\t${run.completed_queries}/${targets.length}\n`,
      );
    }
    const disagreements = compareRuns(policies[0].run, policies[1].run);
    measurements.push({
      representation,
      provenance: {
        old_local_safe_prefix_gzip_sha256:
          audit.bindings.old_local_safe_prefix_gzip_sha256,
        old_local_measurement_index: selected.old_local_measurement_index,
      },
      targets: {
        count: targets.length,
        sha256: generatedTargetsSha256,
        order: allocator.binding_target_order,
      },
      policies,
      observed_answer_disagreements: disagreements,
      observed_memory_classification_changed:
        policies[0].observed_memory.status !== policies[1].observed_memory.status,
    });
    const partial = {
      schema_version: 1,
      evidence_status: "allocator_audit_in_progress",
      audit_id: audit.audit_id,
      audit_plan_sha256: sha256(auditRecord.bytes),
      source_plan_sha256: sha256(sourcePlanRecord.bytes),
      oracle_executable_sha256: sha256(oracleBytes),
      measurements,
      phase_1: { authorized: false, corpus_generated: false, models_trained: false },
    };
    await writeFile(resolve(options.out), stableJson(partial));
  }
  const disagreements = measurements.reduce(
    (sum, measurement) => sum + measurement.observed_answer_disagreements.length,
    0,
  );
  const result = {
    schema_version: 1,
    evidence_status:
      disagreements > 0 ? "hold_on_allocator_answer_disagreement" : "complete",
    audit_id: audit.audit_id,
    audit_plan_sha256: sha256(auditRecord.bytes),
    source_plan_sha256: sha256(sourcePlanRecord.bytes),
    oracle_executable_sha256: sha256(oracleBytes),
    fixed_processing_order: allocator.representations.map(
      (selected) => selected.representation.id,
    ),
    fixed_policy_order: allocator.policies.map((policy) => policy.id),
    measurements,
    summary: {
      representations: measurements.length,
      policy_runs: measurements.length * allocator.policies.length,
      observed_answer_disagreements: disagreements,
      memory_classification_changes: measurements.filter(
        (measurement) => measurement.observed_memory_classification_changed,
      ).length,
      default_limit_exceeded_before_termination: measurements.filter(
        (measurement) =>
          measurement.policies[0].observed_memory.status ===
          "limit_exceeded_before_termination",
      ).length,
      presized_limit_exceeded_before_termination: measurements.filter(
        (measurement) =>
          measurement.policies[1].observed_memory.status ===
          "limit_exceeded_before_termination",
      ).length,
    },
    interpretation:
      "This audit tests whether the observed two-GiB boundary changes under presizing on the same machine, exact executable, representations, target order, and hard timeout. A timed-out run below the limit proves only that it stayed below the limit until termination, not that an unbounded query would remain below it.",
    phase_1: { authorized: false, corpus_generated: false, models_trained: false },
  };
  await writeFile(resolve(options.out), stableJson(result));
  process.stdout.write(stableJson({ evidence_status: result.evidence_status, summary: result.summary }));
  if (disagreements > 0) process.exitCode = 2;
};

await main();
