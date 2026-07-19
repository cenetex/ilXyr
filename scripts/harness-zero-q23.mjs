#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const options = parseArgs(process.argv.slice(2));
verifyRepository(options.repo, options.commit, options.git);

const root = path.join(options.repo, "benchmarks", "zero4-q23-v1");
const paths = {
  contract: path.join(root, "contract.json"),
  observerResult: path.join(root, "observer-seed2", "result.json"),
  observerAttempts: path.join(root, "observer-seed2", "optimizer-attempts.jsonl"),
  observerEvents: path.join(root, "observer-seed2", "events.jsonl"),
  results: path.join(root, "seed2", "RESULTS.md"),
  guardManifest: path.join(root, "seed2", "manifest.json"),
  guardSelection: path.join(root, "seed2", "selection.json"),
  guardAttempts: path.join(root, "seed2", "optimizer-attempts.jsonl"),
  guardEvents: path.join(root, "seed2", "events.jsonl"),
  checker: path.join(options.repo, "scripts", "check_zero4_q23.mjs"),
  driver: path.join(options.repo, "scripts", "train_zero4_q23.mjs"),
};
for (const [name, file] of Object.entries(paths)) {
  if (!fs.existsSync(file)) throw new Error(`ZERO q23 replay is incomplete: missing ${name} artifact ${file}`);
}

for (const attempts of [paths.observerAttempts, paths.guardAttempts]) {
  const replay = spawnSync(options.node, [paths.checker, paths.contract, attempts], {
    cwd: options.repo,
    encoding: "utf8",
    env: {},
  });
  if (replay.error) throw replay.error;
  if (replay.status !== 0) {
    throw new Error(`ZERO q23 checker exited ${replay.status}: ${replay.stderr || replay.stdout}`);
  }
}
verifyRepository(options.repo, options.commit, options.git);

const contract = readJson(paths.contract);
const observer = readJson(paths.observerResult);
const guard = readJson(paths.guardManifest);
const selection = readJson(paths.guardSelection);
const observerAttempts = readJsonLines(paths.observerAttempts);
const guardAttempts = readJsonLines(paths.guardAttempts);
const guardEvents = readJsonLines(paths.guardEvents);

assert(contract.schema === "zero.zero4_q23_contract.v1" && contract.diagnostic_seed === 2, "Q2.3 contract identity drifted");
assert(JSON.stringify(contract.sealed_replication_seeds) === "[1,3]", "Q2.3 replication seeds are not sealed");
assert(contract.guard.public_replay_ceiling === 0.02, "Q2.3 public replay ceiling drifted");
assert(observer.decision === "pass" && observer.learnedStateEquivalent === true, "Q2.3 observer mechanics did not pass");
assert(observer.promotionAccessed === false, "Q2.3 observer accessed promotion");
assert(observer.calibration.hardRelativeIncrease === 0.0025, "Q2.3 hard guard calibration drifted");
assert(guard.decision === "no-go" && guard.seed === 2 && guard.stage === "guard", "Q2.3 guarded decision drifted");
assert(guard.attempts === 200 && guard.committed === 200, "Q2.3 guarded attempt/commit count drifted");
assert(guard.selected === null, "Q2.3 unexpectedly selected a checkpoint");
assert(guard.promotion?.evaluatedOnceAtEnd === false, "Q2.3 unexpectedly evaluated promotion");
assert(selection.decision === "no-go" && selection.selected === null, "Q2.3 selection record drifted");
assert(observerAttempts.length === 200 && guardAttempts.length === 200, "Q2.3 attempt logs are incomplete");

const accepted = guardAttempts.filter((attempt) => attempt.decision === "accept").length;
const rejected = guardAttempts.filter((attempt) => attempt.decision === "reject").length;
const warningExceedances = guardAttempts.filter((attempt) => attempt.relative_probe_change > observer.calibration.warningRelativeIncrease).length;
const hardExceedances = guardAttempts.filter((attempt) => attempt.relative_probe_change > observer.calibration.hardRelativeIncrease).length;
const maximumLocalIncrease = Math.max(...guardAttempts.map((attempt) => attempt.relative_probe_change));
assert(accepted === 200 && rejected === 0, "Q2.3 local guard decision count drifted");
assert(warningExceedances === 5 && hardExceedances === 0, "Q2.3 guard-band exceedance count drifted");
assert(maximumLocalIncrease === guard.guardDiagnostics.maxRelativeProbeIncrease, "Q2.3 maximum local probe increase drifted");

const traceKeys = [
  "attempt", "proposed_committed_update", "committed_update", "source_mask",
  "replay_range", "learning_rate", "probe_before", "probe_after",
  "relative_probe_change", "faculty_replay_gradient_cosine", "gradient_norm",
  "displacement_norm", "predicted_replay_drift", "fisher_weighted_drift",
  "decision", "rollback_digest",
];
for (let index = 0; index < observerAttempts.length; ++index) {
  for (const key of traceKeys) {
    assert(observerAttempts[index][key] === guardAttempts[index][key], `Q2.3 observer/guard trace differs at attempt ${index + 1} field ${key}`);
  }
}

const fullEvaluations = guardEvents.filter((event) => event.type === "full-evaluation");
assert(fullEvaluations.length === 2 && fullEvaluations[0].committed === 100 && fullEvaluations[1].committed === 200, "Q2.3 full-evaluation cadence drifted");
const final = fullEvaluations[1];
assert(final.quantityPass === true && final.feasible === false, "Q2.3 final public gate drifted");
assert(final.replayRegression === 0.026854690374003717, "Q2.3 replay result drifted");
assert(guardEvents.at(-1)?.type === "complete" && guardEvents.at(-1)?.decision === "no-go", "Q2.3 terminal event drifted");

console.log(JSON.stringify({
  metrics: {
    observer_mechanics_passed: 1,
    observer_learned_state_equivalent: 1,
    first_order_predictive_pearson: observer.predictiveValidity.pearson,
    guard_attempts: guard.attempts,
    guard_commits: guard.committed,
    guard_rejections: rejected,
    guard_warning_exceedances: warningExceedances,
    guard_hard_exceedances: hardExceedances,
    guard_budget: guard.guardBudget,
    max_local_replay_probe_increase: maximumLocalIncrease,
    observer_guard_trace_match: 1,
    quantity_operation_rate: final.rates.operation,
    quantity_exact_artifact_rate: final.rates.exact_artifact,
    public_replay_relative_regression: final.replayRegression,
    seed_passed: 0,
    promotion_evaluations: 0,
    replication_seeds_opened: 0,
  },
  source: {
    repository: options.repository,
    commit: options.commit,
    artifacts: [
      sourceArtifact(options.repo, "benchmarks/zero4-q23-v1/contract.json"),
      sourceArtifact(options.repo, "benchmarks/zero4-q23-v1/observer-seed2/result.json"),
      sourceArtifact(options.repo, "benchmarks/zero4-q23-v1/observer-seed2/optimizer-attempts.jsonl"),
      sourceArtifact(options.repo, "benchmarks/zero4-q23-v1/observer-seed2/events.jsonl"),
      sourceArtifact(options.repo, "benchmarks/zero4-q23-v1/seed2/RESULTS.md"),
      sourceArtifact(options.repo, "benchmarks/zero4-q23-v1/seed2/manifest.json"),
      sourceArtifact(options.repo, "benchmarks/zero4-q23-v1/seed2/selection.json"),
      sourceArtifact(options.repo, "benchmarks/zero4-q23-v1/seed2/optimizer-attempts.jsonl"),
      sourceArtifact(options.repo, "benchmarks/zero4-q23-v1/seed2/events.jsonl"),
      sourceArtifact(options.repo, "scripts/check_zero4_q23.mjs"),
      sourceArtifact(options.repo, "scripts/train_zero4_q23.mjs"),
    ],
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
  for (const key of ["repo", "repository", "commit", "git", "node"]) {
    if (!values.has(key)) throw new Error(`--${key} is required`);
  }
  return {
    repo: fs.realpathSync(path.resolve(values.get("repo"))),
    repository: values.get("repository"),
    commit: values.get("commit"),
    git: values.get("git"),
    node: values.get("node"),
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sourceArtifact(repo, relative) {
  return { path: relative, sha256: sha256(path.join(repo, relative)) };
}

function verifyRepository(repo, commit, git) {
  const head = command(git, ["-C", repo, "rev-parse", "HEAD"]).trim();
  if (head !== commit) throw new Error(`repository commit mismatch: ${head} != ${commit}`);
  const status = command(git, ["-C", repo, "status", "--porcelain"]);
  if (status.trim()) throw new Error("repository must be clean for deterministic replay");
}

function command(program, args) {
  const result = spawnSync(program, args, { encoding: "utf8", env: {} });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} exited ${result.status}: ${result.stderr}`);
  return result.stdout;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readJsonLines(file) {
  return fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
