import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PHASE1_RESOURCE_LIMITS } from "./oracle-resource-accounting.mjs";

const closeoutPath = "experiments/weight-multiplicity/phase1/phase1-tail-calibration-run-20260901015649-closeout-v1.json";
const planPath = "examples/weight-multiplicity/phase1-corpus-plan-v1.json";
const manifestPath = "examples/weight-multiplicity/phase06-reduced-corpus-manifest-v1.json";
const systemsPath = "examples/weight-multiplicity/phase1-root-systems-v1.json";
const files = [closeoutPath, planPath, manifestPath, systemsPath,
  "examples/weight-multiplicity/rev3-contract.json",
  "examples/weight-multiplicity/phase06-lie-governance-v1.json",
  "experiments/weight-multiplicity/phase05/phase06-lie-preflight-closeout-v1.json",
  "scripts/run-weight-multiplicity-phase1-corpus.mjs",
  "scripts/lib/oracle-attempt-trace.mjs", "scripts/lib/oracle-query-batch.mjs",
  "scripts/lib/oracle-resource-accounting.mjs",
  "scripts/lib/weight-multiplicity-resource-policy.mjs",
  "scripts/prepare-weight-multiplicity-resource-policy.mjs",
  "scripts/test-weight-multiplicity-resource-policy.mjs"];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function createResourcePolicy(root) {
  const contents = Object.fromEntries(await Promise.all(files.map(async (path) =>
    [path, await readFile(resolve(root, path))])));
  const sourceBindings = Object.fromEntries(files.map((path) => [path, digest(contents[path])]));
  assert.equal(sourceBindings[closeoutPath], "4ddedd80e464ffa901fa24304b59139a5cc449871a8f7dcb8c525db69e93a398",
    "calibration closeout differs");
  const closeout = JSON.parse(contents[closeoutPath]);
  const plan = JSON.parse(contents[planPath]);
  assert.equal(sourceBindings[planPath], closeout.source_bindings.phase1_corpus_plan_sha256);
  assert.equal(sourceBindings[manifestPath], closeout.source_bindings.manifest_sha256);
  assert.equal(sourceBindings[systemsPath], closeout.source_bindings.root_systems_sha256);
  assert.deepEqual(PHASE1_RESOURCE_LIMITS, {
    final_p99_ms: Math.ceil(closeout.measurement.p99_ms * 1.25),
    hard_timeout_ms: closeout.measurement.hard_abort_ms,
    oracle_calls: closeout.budget.binding_call_limit,
    total_query_ms: closeout.budget.binding_query_ms_limit,
    elapsed_wall_seconds: closeout.budget.binding_wall_seconds,
  });
  return {
    schema: "ilxyr.weight_multiplicity_resource_policy.v1",
    id: "weight-multiplicity.phase1-final-p99.v1",
    status: "prepared_for_cloud_package",
    execution_authority: "separate_digest_bound_launch_approval_and_budget",
    source_bindings: sourceBindings,
    limits: { ...PHASE1_RESOURCE_LIMITS },
    accounting_scope: "all_workload_attempts_including_pilot",
    included_results: "all_completed_attempts_including_failures_and_values_above_31",
    setup_accounting: "retain_warmups_and_setup_wall_time_in_full_trace",
    workload_clock: "after_worker_setup_through_completed_queries_and_final_memory_check",
    p99_estimator: "exact_nearest_rank_over_complete_workload",
    p99_application: "progress_during_run_and_binding_before_corpus_manifest",
    cap_application: "fixed_before_first_workload_query",
    dispatch: "reserve_call_capacity_stop_on_first_hold_and_drain_in_flight",
    per_query_timeout: "hard_abort_at_30000_ms",
    pilot_projection: "diagnostic_with_fixed_caps_preserved",
    candidate_order: "original_generator_seed_batches_filters_and_partition_order",
    generator_seed: plan.generator.seed,
    candidate_batch_size: plan.generator.candidate_batch_size,
    expected_corpus_records: Object.values(plan.partitions).reduce((sum, row) => sum + row.records, 0),
    lie_workers: plan.oracle.primary.workers,
    zero_workers: plan.oracle.differential.workers,
    final_decision: "hold_preserves_trace_and_keeps_corpus_manifest_unpublished",
    pending_cloud_package: ["original_calibration_trace_replay", "immutable_source_archive",
      "machine_and_compiler", "storage_and_watchdog", "price_evidence_and_cost_ceiling"],
  };
}

export async function validateResourcePolicy(policy, root) {
  assert.deepEqual(policy, await createResourcePolicy(root),
    "resource policy differs from the frozen inputs, limits, or current source");
  return policy;
}
