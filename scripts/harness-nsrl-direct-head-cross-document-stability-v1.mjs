#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const options = parseArgs(process.argv.slice(2));
verifyRepository(options.repo, options.commit, options.git);

const files = {
  contract:
    "benchmarks/production-model-v1/p10m-direct-head-cross-document-stability-v1-contract.json",
  gate:
    "benchmarks/production-model-v1/p10m-direct-head-cross-document-stability-v1-gate.json",
  runner: "scripts/run-production-direct-head-cross-document-stability-v1.sh",
  checker: "scripts/check-production-direct-head-cross-document-stability-v1.mjs",
};
const expectedHashes = {
  contract: "13dedcd040940e761c526d558be446076b10b157ebfe359a40d331a0242277c3",
  gate: "0756db8b0bc1c9dbd1b20e59429cbaca115d08855dde2434c97ef3026a7fcf08",
  runner: "d68247581e702ec8f5ee2ce9fb95878c0b90545af5a7f9c20f9318f5537aedf9",
  checker: "b99df596065539bd3cb1c3b94d67588a8faf5b26c632ca7d77d0c9d5d64f30a9",
};
for (const [name, relative] of Object.entries(files)) {
  assert(sha256(path.join(options.repo, relative)) === expectedHashes[name],
    `${name} artifact hash mismatch`);
}

const contract = readJson(options.repo, files.contract);
const gate = readJson(options.repo, files.gate);
const runner = fs.readFileSync(path.join(options.repo, files.runner), "utf8");
const checker = fs.readFileSync(path.join(options.repo, files.checker), "utf8");
assert(contract.schema
  === "nsrl.production_direct_head_cross_document_stability_contract.v1",
"cross-document stability contract schema mismatch");
assert(contract.implementation.support_commit
  === "efce17c7e808377fe299c431efdc99af35bae1db"
  && contract.implementation.command
    === "nsrl-production-model direct-head-cross-document-audit"
  && contract.implementation.method
    === "exact_frozen_direction_cross_document_matrix"
  && contract.implementation.parameter_scope === "output_matrix_only"
  && contract.implementation.model_mutation
    === "none_read_only_restored_after_every_probe"
  && contract.surface.context_tokens === 64
  && contract.surface.document_start === 2
  && contract.surface.documents === 8
  && contract.surface.windows_per_document === 32
  && contract.surface.document_end_exclusive === 10
  && JSON.stringify(contract.surface.prior_lineage_documents_excluded) === "[0,1]",
"cross-document stability authority mismatch");

const expectedDirections = [
  [8303, 1, 61290, -601],
  [8310, -1, 57061, -963],
  [8445, 1, 57212, -586],
  [8335, -1, 57210, -586],
  [8428, 1, 57145, -583],
  [8377, 1, 57211, -578],
  [8263, 1, 48929, -666],
  [8431, -1, 53069, -582],
];
assert(contract.directions.length === expectedDirections.length
  && contract.directions.every((direction, index) => JSON.stringify([
    direction.global_coordinate,
    direction.delta,
    direction.parent_proposal_nll_improvement_q20,
    direction.parent_guard_nll_improvement_q20,
  ]) === JSON.stringify(expectedDirections[index])),
"cross-document frozen direction mismatch");
assert(contract.classification.stable_direction_descent_documents_minimum === 6
  && contract.classification
    .stable_direction_total_nll_improvement_q20_minimum_exclusive === 0
  && contract.classification
    .stable_directions_minimum_for_same_coordinate_family_followup === 1
  && contract.authorization.model_writes === false
  && contract.authorization.public_development_evaluation === false
  && contract.authorization.public_test_evaluation === false
  && contract.authorization.open_generation === false
  && contract.authorization.hidden_panel_access === false
  && contract.authorization.paid_scaling === false
  && contract.authorization.p20m_p30m_scaling === false,
"cross-document stability gate or authorization mismatch");

assert(gate.schema
  === "nsrl.production_direct_head_cross_document_stability_gate.v1"
  && gate.contract.sha256 === expectedHashes.contract
  && gate.audit.sha256 === gate.replay_audit.sha256
  && gate.audit.sha256
    === "7a908ae32be4971eaebcb486e1ea62e9610e284f53f28a29f1eac127c51fe17d",
"cross-document stability evidence binding mismatch");

const measurement = gate.measurements;
assert(JSON.stringify(measurement.documents) === "[2,3,4,5,6,7,8,9]"
  && measurement.windows_per_document === 32
  && measurement.stable_direction_count === 0
  && measurement.mixed_direction_count === 7
  && measurement.consistent_regression_direction_count === 1
  && measurement.expected_matrix_cells === 64
  && measurement.observed_matrix_cells === 64
  && measurement.stable_directions.length === 0,
"cross-document stability summary mismatch");
const expectedMeasurements = [
  [8303, 1, 4, 4, -2803, -1175, 256, "mixed"],
  [8310, -1, 2, 6, -2228, -1048, 297, "consistent_regression"],
  [8445, 1, 4, 4, -2047, -1374, 388, "mixed"],
  [8335, -1, 4, 4, -2047, -1374, 388, "mixed"],
  [8428, 1, 4, 4, -2062, -1374, 388, "mixed"],
  [8377, 1, 4, 4, -2052, -1374, 388, "mixed"],
  [8263, 1, 3, 5, -3607, -1518, 375, "mixed"],
  [8431, -1, 4, 4, -1925, -1374, 388, "mixed"],
];
assert(measurement.directions.length === expectedMeasurements.length
  && measurement.directions.every((direction, index) =>
    direction.parameter_group === "output_weight"
      && direction.local_coordinate === direction.global_coordinate
      && direction.unchanged_documents === 0
      && JSON.stringify([
        direction.global_coordinate,
        direction.delta,
        direction.descent_documents,
        direction.regression_documents,
        direction.total_nll_improvement_q20,
        direction.minimum_nll_improvement_q20,
        direction.maximum_nll_improvement_q20,
        direction.classification,
      ]) === JSON.stringify(expectedMeasurements[index])),
"cross-document direction measurements mismatch");

const gates = gate.gates;
assert(gate.same_coordinate_family_followup_supported === false
  && gate.public_development_opened === false
  && gate.public_test_opened === false
  && gate.open_generation_opened === false
  && gate.hidden_panel_opened === false
  && gate.paid_scaling_opened === false
  && gates.exact_trace_rerun_replay === true
  && gates.complete_direction_document_matrix === true
  && gates.source_model_unchanged === true
  && gates.frozen_parameters_unchanged === true
  && gates.same_coordinate_family_followup_requires_stable_direction === false,
"cross-document stop decision mismatch");

assert(runner.startsWith("#!/usr/bin/env bash\nset -euo pipefail\n"),
  "cross-document runner does not fail closed");
const firstAudit = runner.indexOf("run_audit \"$out_dir/audit.json\"");
const replayAudit = runner.indexOf("run_audit \"$out_dir/replay-audit.json\"");
const gateCheck = runner.indexOf(
  "node scripts/check-production-direct-head-cross-document-stability-v1.mjs",
);
assert(firstAudit >= 0
  && replayAudit > firstAudit
  && gateCheck > replayAudit
  && !runner.includes("evaluate-canonical")
  && !runner.includes("dev.nsrltok")
  && !runner.includes("test.nsrltok")
  && checker.includes("if (!passed) process.exitCode = 1;"),
"cross-document runner can bypass its stop gate or reach an unauthorized surface");

const aggregateImprovements = measurement.directions.map(
  direction => direction.total_nll_improvement_q20,
);
console.log(JSON.stringify({
  metrics: {
    documents_evaluated: measurement.documents.length,
    windows_per_document: measurement.windows_per_document,
    frozen_directions: measurement.directions.length,
    direction_document_cells: measurement.observed_matrix_cells,
    stable_directions: measurement.stable_direction_count,
    mixed_directions: measurement.mixed_direction_count,
    consistent_regression_directions:
      measurement.consistent_regression_direction_count,
    maximum_descent_documents: Math.max(...measurement.directions.map(
      direction => direction.descent_documents,
    )),
    least_negative_aggregate_nll_improvement_q20:
      Math.max(...aggregateImprovements),
    most_negative_aggregate_nll_improvement_q20:
      Math.min(...aggregateImprovements),
    exact_trace_rerun_replay: 1,
    complete_direction_document_matrix: 1,
    source_model_unchanged: 1,
    frozen_parameters_unchanged: 1,
    same_coordinate_family_followup_supported: 0,
    public_development_opened: 0,
    public_test_opened: 0,
    open_generation_opened: 0,
    hidden_panel_opened: 0,
    paid_scaling_opened: 0,
  },
  source: {
    repository: options.repository,
    commit: options.commit,
    artifacts: Object.values(files).map(relative => sourceArtifact(options.repo, relative)),
  },
}));

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) {
      throw new Error(`invalid argument ${argv[index] ?? "<missing>"}`);
    }
    values.set(argv[index].slice(2), argv[index + 1]);
  }
  for (const key of ["repo", "repository", "commit", "git"]) {
    if (!values.has(key)) throw new Error(`--${key} is required`);
  }
  return {
    repo: fs.realpathSync(path.resolve(values.get("repo"))),
    repository: values.get("repository"),
    commit: values.get("commit"),
    git: values.get("git"),
  };
}

function readJson(repo, relative) {
  return JSON.parse(fs.readFileSync(path.join(repo, relative), "utf8"));
}

function sourceArtifact(repo, relative) {
  return {path: relative, sha256: sha256(path.join(repo, relative))};
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function verifyRepository(repo, commit, git) {
  const head = command(git, ["-C", repo, "rev-parse", "HEAD"]).trim();
  if (head !== commit) throw new Error(`repository commit mismatch: ${head} != ${commit}`);
  const status = command(git, ["-C", repo, "status", "--porcelain"]);
  if (status.trim()) throw new Error("repository must be clean for exact evidence check");
}

function command(program, args) {
  const result = spawnSync(program, args, {encoding: "utf8", env: {}});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} exited ${result.status}: ${result.stderr}`);
  return result.stdout;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
