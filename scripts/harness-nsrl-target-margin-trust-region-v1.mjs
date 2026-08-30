#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const options = parseArgs(process.argv.slice(2));
verifyRepository(options.repo, options.commit, options.git);

const files = {
  contract:
    "benchmarks/production-model-v1/p10m-target-margin-trust-region-v1-contract.json",
  preflight:
    "benchmarks/production-model-v1/p10m-target-margin-trust-region-v1-preflight.json",
  runner: "scripts/run-production-target-margin-trust-region-v1.sh",
  selector: "scripts/select-production-target-margin-trust-region-preflight-v1.mjs",
};
const expectedHashes = {
  contract: "e2dd108669787c077ab3da8085e3dfd011f250bd4abd586201b0f86183265be7",
  preflight: "e111e0f85a212f8990b1a9241f7c5f3d229c9676029cf8f502f306eee46b1010",
  runner: "3dd02fead117a7ac93c0ce775ceeaa9fcaf8dac8daac617d09988ef84185c56d",
  selector: "058de7062bd783999318f85bbd9072a4bea30c7efdc8a36f160d71bf883c2466",
};
for (const [name, relative] of Object.entries(files)) {
  assert(sha256(path.join(options.repo, relative)) === expectedHashes[name],
    `${name} artifact hash mismatch`);
}

const contract = readJson(options.repo, files.contract);
const preflight = readJson(options.repo, files.preflight);
const runner = fs.readFileSync(path.join(options.repo, files.runner), "utf8");
const selector = fs.readFileSync(path.join(options.repo, files.selector), "utf8");
assert(contract.schema === "nsrl.production_target_margin_trust_region_contract.v1",
  "target-margin trust-region contract schema mismatch");
assert(contract.implementation.support_commit
  === "7ebb756523a7057b2511eaf193ea950f0d0f50e8"
  && contract.authorization?.hidden_panel_access === false
  && contract.authorization?.paid_scaling === false
  && contract.authorization?.public_test_only_after_development_gate === true
  && contract.authorization?.open_generation_only_after_confirmation_gate === true,
"target-margin trust-region authority mismatch");
assert(preflight.schema
  === "nsrl.production_target_margin_trust_region_preflight_selection.v1"
  && preflight.contract.sha256 === expectedHashes.contract,
"target-margin trust-region evidence binding mismatch");
assert(preflight.preflight_passed === false
  && preflight.selected_feature_shift === null
  && preflight.passing_feature_shifts.length === 0
  && preflight.public_test_opened === false
  && preflight.hidden_panel_opened === false,
"target-margin trust-region stop decision mismatch");

const expectedTraceHashes = new Map([
  [13, "3b61918b784d5bc6cef3e1e08c8883ca920473deb3c36694119a581e485b14c3"],
  [14, "ce8f60663b9263f3780fbd5787c1f5ad286712859d65ba964d4a15b57f36dc84"],
  [15, "7d69404f5c90172fc21649d7e049b98f236f2c6d73965de9e6209b641fc3d5ee"],
]);
assert(preflight.candidates.length === 3,
  "target-margin trust-region candidate count mismatch");
for (const candidate of preflight.candidates) {
  assert(expectedTraceHashes.get(candidate.feature_shift) === candidate.trace.sha256,
    `feature shift ${candidate.feature_shift} trace hash mismatch`);
  assert(candidate.passed === false
    && candidate.window_schedule_rank_hash === "0xcb4d44618dbd7ff8"
    && candidate.descent_guard_window_rank_hash === "0xcd4717322d25781f"
    && candidate.guard_initial_nll_millibits === 407206
    && candidate.guard_final_nll_millibits === 407206,
  `feature shift ${candidate.feature_shift} frozen guard result mismatch`);
  assert(candidate.guard_initial_evaluation.mean_target_rank_x1000 === 2289312
    && candidate.guard_final_evaluation.mean_target_rank_x1000 === 2289312
    && candidate.guard_initial_evaluation.top10_hits === 1
    && candidate.guard_final_evaluation.top10_hits === 1,
  `feature shift ${candidate.feature_shift} frozen guard evaluation mismatch`);
  assert(candidate.gates.schedule_complete === true
    && candidate.gates.output_matrix_movement_minimum === false
    && candidate.gates.accepted_guard_batches_minimum === false
    && candidate.gates.frozen_parameters_unchanged === true
    && candidate.gates.output_bias_unchanged === true
    && candidate.gates.weight_saturation_maximum === true
    && candidate.gates.guard_nonworsening_invariant === true
    && candidate.gates.guard_disjoint_from_window_schedule === true
    && candidate.gates.guard_nll_strictly_improves === false,
  `feature shift ${candidate.feature_shift} frozen gate mismatch`);
}

assert(runner.startsWith("#!/usr/bin/env bash\nset -euo pipefail\n"),
  "target-margin runner does not fail closed");
const selectionPosition = runner.indexOf(
  "node scripts/select-production-target-margin-trust-region-preflight-v1.mjs",
);
const fullRunPosition = runner.indexOf(
  "target-margin trust region: uninterrupted full pilot",
);
const developmentPosition = runner.indexOf(
  "target-margin trust region: public development stop/go gate",
);
assert(selectionPosition >= 0
  && fullRunPosition > selectionPosition
  && developmentPosition > fullRunPosition
  && selector.includes("if (!result.preflight_passed) process.exitCode = 1;"),
"target-margin runner does not stop before downstream evaluation on preflight failure");

const candidates = preflight.candidates.length;
const evaluatedBatches = candidates * contract.preflight.optimizer_steps;
console.log(JSON.stringify({
  metrics: {
    feature_shift_candidates: candidates,
    passing_feature_shifts: preflight.passing_feature_shifts.length,
    guard_batches_evaluated: evaluatedBatches,
    guard_batches_accepted: 0,
    guard_batches_rejected: evaluatedBatches,
    guard_nll_delta_millibits: 0,
    output_matrix_movement_l1: 0,
    zero_weight_saturation: 1,
    update_schedule_hash_consistent: 1,
    guard_rank_hash_consistent: 1,
    full_run_started: 0,
    development_opened: 0,
    public_test_opened: 0,
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
