#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const options = parseArgs(process.argv.slice(2));
verifyRepository(options.repo, options.commit, options.git);

const files = {
  contract: "benchmarks/production-model-v1/p10m-target-margin-head-v1-contract.json",
  preflight: "benchmarks/production-model-v1/p10m-target-margin-head-v1-preflight.json",
  development: "benchmarks/production-model-v1/p10m-target-margin-head-v1-development-gate.json",
};
const contract = readJson(options.repo, files.contract);
const preflight = readJson(options.repo, files.preflight);
const development = readJson(options.repo, files.development);

assert(contract.schema === "nsrl.production_target_margin_contract.v1",
  "target-margin contract schema mismatch");
assert(contract.authorization?.hidden_panel_access === false
  && contract.authorization?.paid_scaling === false,
"target-margin contract opened an unauthorized boundary");
assert(preflight.schema === "nsrl.production_target_margin_preflight_selection.v1"
  && preflight.preflight_passed === true
  && preflight.selected_feature_shift === 14
  && preflight.candidates.length === 3
  && preflight.candidates.every(candidate => candidate.passed === true),
"target-margin preflight result mismatch");
assert(development.schema === "nsrl.production_target_margin_development_gate.v1"
  && development.contract.sha256 === sha256(path.join(options.repo, files.contract))
  && development.preflight.sha256 === sha256(path.join(options.repo, files.preflight)),
"target-margin evidence binding mismatch");
assert(development.development_gate_passed === false
  && development.public_test_authorized === false
  && development.hidden_panel_opened === false,
"target-margin development stop decision mismatch");
assert(development.gates.candidate_model_exact_restart_replay === true
  && development.gates.optimizer_state_exact_restart_replay === true
  && development.gates.frozen_parameters_unchanged === true
  && development.gates.output_bias_unchanged === true
  && development.gates.weight_saturation_maximum === true,
"target-margin integrity or numeric-health evidence mismatch");
assert(development.gates.training_mean_target_rank_improvement_per_mille_minimum === false
  && development.gates.training_top5_hits_strictly_improve === false
  && development.gates.training_top10_hits_strictly_improve === false
  && development.gates.development_nll_regression_per_mille_maximum === false,
"target-margin failed quality gates mismatch");

const metrics = development.measurements;
assert(metrics.selected_feature_shift === 14
  && metrics.training_rank_improvement_per_mille === -910
  && metrics.development_nll_delta_millibits === 2004452
  && metrics.development_nll_regression_per_mille === 308,
"target-margin frozen metrics mismatch");

console.log(JSON.stringify({
  metrics: {
    selected_feature_shift: metrics.selected_feature_shift,
    preflight_candidates_passed: preflight.candidates.filter(candidate => candidate.passed).length,
    training_rank_improvement_per_mille: metrics.training_rank_improvement_per_mille,
    training_top10_delta:
      metrics.training_final_top10_hits - metrics.training_initial_top10_hits,
    development_nll_delta_millibits: metrics.development_nll_delta_millibits,
    development_nll_regression_per_mille: metrics.development_nll_regression_per_mille,
    model_exact_replay: Number(development.gates.candidate_model_exact_restart_replay),
    optimizer_exact_replay: Number(development.gates.optimizer_state_exact_restart_replay),
    zero_weight_saturation: Number(development.gates.weight_saturation_maximum),
    development_gate_passed: Number(development.development_gate_passed),
    public_test_authorized: Number(development.public_test_authorized),
    hidden_panel_opened: Number(development.hidden_panel_opened),
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
