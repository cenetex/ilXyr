#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const options = parseArgs(process.argv.slice(2));
verifyRepository(options.repo, options.commit, options.git);

const files = {
  contract:
    "benchmarks/production-model-v1/p10m-direct-head-nll-guard-v1-contract.json",
  development:
    "benchmarks/production-model-v1/p10m-direct-head-nll-guard-v1-development-gate.json",
  runner: "scripts/run-production-direct-head-nll-guard-v1.sh",
  checker: "scripts/check-production-direct-head-nll-guard-development-v1.mjs",
};
const expectedHashes = {
  contract: "592ee07674b8d932f7f06319c1a365b5239fb1c5db98dc28ebb6b9d7daee9387",
  development: "f7b27e53d17770f3d8eb04cbeff417aafcc5d6b330fa65b1b3e07f4f93ab9d9b",
  runner: "9b012cd9a569851acc953b37071a09f8e5d0bb80ab43bb8f26b8a05734cac956",
  checker: "a5115cffc068c4ab0ccf6060a6a77a5d1de1412b72ae3062f7b5093755550df1",
};
for (const [name, relative] of Object.entries(files)) {
  assert(sha256(path.join(options.repo, relative)) === expectedHashes[name],
    `${name} artifact hash mismatch`);
}

const contract = readJson(options.repo, files.contract);
const development = readJson(options.repo, files.development);
const runner = fs.readFileSync(path.join(options.repo, files.runner), "utf8");
const checker = fs.readFileSync(path.join(options.repo, files.checker), "utf8");
assert(contract.schema === "nsrl.production_direct_head_nll_guard_contract.v1",
  "direct-head NLL guard contract schema mismatch");
assert(contract.implementation.support_commit
  === "c6fe214f321cdd595017dc042b23a4ae5cd4037b"
  && contract.training.train_windows === 64
  && contract.training.guard_windows === 32
  && contract.training.candidates_per_round === 8
  && contract.training.max_rounds === 8
  && contract.training.require_guard_nll_nonworsening === true
  && contract.authorization?.hidden_panel_access === false
  && contract.authorization?.paid_scaling === false
  && contract.authorization?.public_test_only_after_development_gate === true
  && contract.authorization?.open_generation_only_after_confirmation_gate === true,
"direct-head NLL guard authority mismatch");
assert(development.schema
  === "nsrl.production_direct_head_nll_guard_development_gate.v1"
  && development.contract.sha256 === expectedHashes.contract,
"direct-head NLL guard evidence binding mismatch");

const measurement = development.measurements;
const rejected = measurement.rejected_candidates;
assert(JSON.stringify(measurement.training_documents) === "[0]"
  && JSON.stringify(measurement.guard_documents) === "[1]"
  && measurement.training_guard_document_overlap.length === 0
  && measurement.candidates_evaluated === 8
  && measurement.guard_rejections === 1
  && measurement.descent_steps === 0
  && measurement.round_weight_saturation_count === 0,
"direct-head NLL guard training measurements mismatch");
assert(rejected.length === 1
  && rejected[0].round === 0
  && rejected[0].output_weight_coordinate === 8445
  && rejected[0].output_bias_coordinate === null
  && rejected[0].train_nll_improvement_q20 === 57212
  && rejected[0].guard_nll_improvement_q20 === -586
  && rejected[0].applied_delta === 0,
"direct-head NLL guard rejected coordinate mismatch");
assert(measurement.training_initial_nll_q20 === 833298369
  && measurement.training_final_nll_q20 === 833298369
  && measurement.guard_initial_nll_q20 === 428748538
  && measurement.guard_final_nll_q20 === 428748538
  && measurement.development_nll_delta_millibits === 0
  && measurement.source_development_teacher_forced_mean_target_rank === 2066
  && measurement.candidate_development_teacher_forced_mean_target_rank === 2066,
"direct-head NLL guard quality measurements mismatch");

const gates = development.gates;
assert(development.development_gate_passed === false
  && development.public_test_authorized === false
  && development.public_test_opened === false
  && development.hidden_panel_opened === false
  && gates.candidate_model_exact_rerun_replay === true
  && gates.training_trace_exact_rerun_replay === true
  && gates.source_model_was_a_candidate === true
  && gates.model_movement_required === false
  && gates.descent_steps_minimum === false
  && gates.training_nll_strictly_improves === false
  && gates.guard_nll_regression_q20_maximum === true
  && gates.frozen_parameters_unchanged === true
  && gates.every_rejected_round_is_atomic === true
  && gates.weight_saturation_maximum === true,
"direct-head NLL guard stop decision mismatch");
assert(development.candidate.sha256 === contract.source.artifact_sha256
  && development.replay_candidate.sha256 === contract.source.artifact_sha256
  && development.training.sha256 === development.replay_training.sha256,
"direct-head NLL guard exact rerun mismatch");

assert(runner.startsWith("#!/usr/bin/env bash\nset -euo pipefail\n"),
  "direct-head runner does not fail closed");
const developmentPosition = runner.indexOf(
  "node scripts/check-production-direct-head-nll-guard-development-v1.mjs",
);
const testPosition = runner.indexOf(
  "direct-head NLL guard: public test confirmation gate",
);
const openGenerationPosition = runner.indexOf(
  "direct-head NLL guard: authorized open-generation checks",
);
assert(developmentPosition >= 0
  && testPosition > developmentPosition
  && openGenerationPosition > testPosition
  && checker.includes("if (!passed) process.exitCode = 1;"),
"direct-head runner does not stop before downstream evaluation on development failure");

console.log(JSON.stringify({
  metrics: {
    candidate_coordinates_evaluated: measurement.candidates_evaluated,
    selected_output_weight_coordinate: rejected[0].output_weight_coordinate,
    proposal_nll_improvement_q20: rejected[0].train_nll_improvement_q20,
    guard_nll_regression_q20: -rejected[0].guard_nll_improvement_q20,
    guard_rejections: measurement.guard_rejections,
    descent_steps_applied: measurement.descent_steps,
    model_movement: 0,
    exact_model_rerun_replay: 1,
    exact_trace_rerun_replay: 1,
    frozen_parameters_unchanged: 1,
    zero_weight_saturation: 1,
    development_nll_delta_millibits: measurement.development_nll_delta_millibits,
    development_rank_delta:
      measurement.candidate_development_teacher_forced_mean_target_rank
        - measurement.source_development_teacher_forced_mean_target_rank,
    public_test_opened: 0,
    open_generation_opened: 0,
    hidden_panel_opened: 0,
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
