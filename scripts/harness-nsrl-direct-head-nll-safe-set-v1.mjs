#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const options = parseArgs(process.argv.slice(2));
verifyRepository(options.repo, options.commit, options.git);

const files = {
  contract:
    "benchmarks/production-model-v1/p10m-direct-head-nll-safe-set-v1-contract.json",
  training:
    "benchmarks/production-model-v1/p10m-direct-head-nll-safe-set-v1-training-gate.json",
  runner: "scripts/run-production-direct-head-nll-safe-set-v1.sh",
  checker: "scripts/check-production-direct-head-nll-safe-set-training-v1.mjs",
};
const expectedHashes = {
  contract: "fcac9263a4c5366a0ed05034f87a4c0f5c15e40469e18b31ee275e91da5be404",
  training: "3c97f55120f1d2cf4ebd1f48eaa570d05f3b41ee927323bd0687d2f6d36c17f8",
  runner: "5936075d4e9eb9b594512a094d80b5cee2b0ed009b88a3e2894033bbad11fb4c",
  checker: "a4c90511cb943208f043ba0622afb7c68b267c3844b62ecacfcfe777646b9ebc",
};
for (const [name, relative] of Object.entries(files)) {
  assert(sha256(path.join(options.repo, relative)) === expectedHashes[name],
    `${name} artifact hash mismatch`);
}

const contract = readJson(options.repo, files.contract);
const training = readJson(options.repo, files.training);
const runner = fs.readFileSync(path.join(options.repo, files.runner), "utf8");
const checker = fs.readFileSync(path.join(options.repo, files.checker), "utf8");
assert(contract.schema === "nsrl.production_direct_head_nll_safe_set_contract.v1",
  "direct-head NLL safe-set contract schema mismatch");
assert(contract.implementation.support_commit
  === "af4f76496b2f6b8add0075e19925391896674e58"
  && contract.implementation.direction_set.join(",") === "-1,1"
  && contract.training.train_windows === 64
  && contract.training.guard_windows === 32
  && contract.training.candidates_per_round === 8
  && contract.training.max_rounds === 8
  && contract.training.require_guard_nll_nonworsening === true
  && contract.training.exact_safe_set_selection === true
  && contract.authorization?.hidden_panel_access === false
  && contract.authorization?.paid_scaling === false
  && contract.authorization?.public_development_only_after_training_gate === true
  && contract.authorization?.public_test_only_after_development_gate === true
  && contract.authorization?.open_generation_only_after_confirmation_gate === true,
"direct-head NLL safe-set authority mismatch");
assert(training.schema
  === "nsrl.production_direct_head_nll_safe_set_training_gate.v1"
  && training.contract.sha256 === expectedHashes.contract,
"direct-head NLL safe-set evidence binding mismatch");

const measurement = training.measurements;
const rejected = measurement.guard_rejected_directions;
assert(JSON.stringify(measurement.training_documents) === "[0]"
  && JSON.stringify(measurement.guard_documents) === "[1]"
  && measurement.training_guard_document_overlap.length === 0
  && measurement.ranked_coordinates_evaluated === 8
  && measurement.exact_directions_evaluated === 16
  && measurement.exact_safe_candidates === 0
  && measurement.exact_guard_rejections === 8
  && measurement.descent_steps === 0
  && measurement.round_weight_saturation_count === 0,
"direct-head NLL safe-set training measurements mismatch");
const expectedRejected = [
  [8303, 1, 61290, -601],
  [8310, -1, 57061, -963],
  [8445, 1, 57212, -586],
  [8335, -1, 57210, -586],
  [8428, 1, 57145, -583],
  [8377, 1, 57211, -578],
  [8263, 1, 48929, -666],
  [8431, -1, 53069, -582],
];
assert(rejected.length === expectedRejected.length
  && rejected.every((candidate, index) =>
    candidate.round === 0
      && candidate.parameter_group === "output_weight"
      && candidate.local_coordinate === candidate.global_coordinate
      && JSON.stringify([
        candidate.global_coordinate,
        candidate.proposed_delta,
        candidate.train_nll_improvement_q20,
        candidate.guard_nll_improvement_q20,
      ]) === JSON.stringify(expectedRejected[index])),
"direct-head NLL safe-set rejected direction mismatch");
assert(measurement.training_initial_nll_q20 === 833298369
  && measurement.training_final_nll_q20 === 833298369
  && measurement.guard_initial_nll_q20 === 428748538
  && measurement.guard_final_nll_q20 === 428748538
  && measurement.guard_initial_mistakes === 32
  && measurement.guard_final_mistakes === 32
  && measurement.selected_moves.length === 0,
"direct-head NLL safe-set quality measurements mismatch");

const gates = training.gates;
assert(training.training_gate_passed === false
  && training.public_development_authorized === false
  && training.public_development_opened === false
  && training.public_test_opened === false
  && training.open_generation_opened === false
  && training.hidden_panel_opened === false
  && gates.candidate_model_exact_rerun_replay === true
  && gates.training_trace_exact_rerun_replay === true
  && gates.source_model_was_a_candidate === true
  && gates.model_movement_required === false
  && gates.descent_steps_minimum === false
  && gates.training_nll_strictly_improves === false
  && gates.guard_nll_regression_q20_maximum === true
  && gates.guard_mistakes_must_not_increase === true
  && gates.frozen_parameters_unchanged === true
  && gates.weight_saturation_maximum === true
  && gates.every_direction_trace_must_be_consistent === true
  && gates.only_safe_candidates_may_be_selected === true
  && gates.selected_candidate_must_be_best_safe_candidate === true
  && gates.empty_safe_set_must_select_source === true,
"direct-head NLL safe-set stop decision mismatch");
assert(training.candidate.sha256 === contract.source.artifact_sha256
  && training.replay_candidate.sha256 === contract.source.artifact_sha256
  && training.training.sha256 === training.replay_training.sha256,
"direct-head NLL safe-set exact rerun mismatch");

assert(runner.startsWith("#!/usr/bin/env bash\nset -euo pipefail\n"),
  "direct-head safe-set runner does not fail closed");
const trainingPosition = runner.indexOf(
  "node scripts/check-production-direct-head-nll-safe-set-training-v1.mjs",
);
const developmentPosition = runner.indexOf(
  "direct-head NLL safe set: public development stop/go gate",
);
const testPosition = runner.indexOf(
  "direct-head NLL safe set: public test confirmation gate",
);
const openGenerationPosition = runner.indexOf(
  "direct-head NLL safe set: authorized open-generation checks",
);
assert(trainingPosition >= 0
  && developmentPosition > trainingPosition
  && testPosition > developmentPosition
  && openGenerationPosition > testPosition
  && checker.includes("if (!passed) process.exitCode = 1;"),
"direct-head safe-set runner does not stop before downstream evaluation on training failure");

const proposalImprovements = rejected.map(
  candidate => candidate.train_nll_improvement_q20,
);
const guardRegressions = rejected.map(
  candidate => -candidate.guard_nll_improvement_q20,
);
console.log(JSON.stringify({
  metrics: {
    candidate_coordinates_evaluated: measurement.ranked_coordinates_evaluated,
    exact_directions_evaluated: measurement.exact_directions_evaluated,
    proposal_descent_directions: rejected.length,
    safe_candidates: measurement.exact_safe_candidates,
    guard_rejected_directions: measurement.exact_guard_rejections,
    maximum_proposal_nll_improvement_q20: Math.max(...proposalImprovements),
    minimum_guard_nll_regression_q20: Math.min(...guardRegressions),
    maximum_guard_nll_regression_q20: Math.max(...guardRegressions),
    descent_steps_applied: measurement.descent_steps,
    model_movement: 0,
    exact_model_rerun_replay: 1,
    exact_trace_rerun_replay: 1,
    frozen_parameters_unchanged: 1,
    zero_weight_saturation: 1,
    public_development_opened: 0,
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
