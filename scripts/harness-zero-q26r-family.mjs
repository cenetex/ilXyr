#!/usr/bin/env node

// Deterministic replay adapter for the published ZERO.4 Q2.6-R family result.
//
// This adapter never trains. It verifies the clean upstream result commit,
// re-derives the family aggregate from the three frozen seed results, re-runs
// the upstream per-seed checker against both complete attempt logs, and reports
// the frozen family decision. It is the evidence adapter for the
// `zero.q26r.family.decision.v1` retro registration.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const options = parseArgs(process.argv.slice(2));
verifyRepository(options.repo, options.commit, options.git);

const root = path.join(options.repo, "benchmarks", "zero4-q26r-v1");
const paths = {
  contract: path.join(root, "contract.json"),
  aggregate: path.join(root, "aggregate.json"),
  aggregateMarkdown: path.join(root, "AGGREGATE.md"),
  seed1Result: path.join(root, "seed1", "result.json"),
  seed1Attempts: path.join(root, "seed1", "optimizer-attempts.jsonl"),
  seed1Selection: path.join(root, "seed1", "selection.json"),
  seed3Result: path.join(root, "seed3", "result.json"),
  seed3Attempts: path.join(root, "seed3", "optimizer-attempts.jsonl"),
  seed3Selection: path.join(root, "seed3", "selection.json"),
  seed2Result: path.join(options.repo, "benchmarks", "zero4-q26-v1", "seed2", "result.json"),
  checker: path.join(options.repo, "scripts", "check_zero4_q26r.mjs"),
  aggregator: path.join(options.repo, "scripts", "aggregate_zero4_q26r.mjs"),
};
for (const [name, file] of Object.entries(paths)) {
  if (!fs.existsSync(file)) throw new Error(`ZERO q26r family replay is incomplete: missing ${name} artifact ${file}`);
}

// Re-derive the family aggregate from the frozen seed results. The aggregator is
// deterministic and rewrites aggregate.json/AGGREGATE.md; a byte-identical result
// keeps the repository clean and confirms the published aggregate.
const aggregated = spawnSync(options.node, [paths.aggregator, root], {
  cwd: options.repo,
  encoding: "utf8",
  env: {},
});
if (aggregated.error) throw aggregated.error;
if (aggregated.status !== 0) {
  throw new Error(`ZERO q26r aggregator exited ${aggregated.status}: ${aggregated.stderr || aggregated.stdout}`);
}
verifyRepository(options.repo, options.commit, options.git);

// Re-run the frozen per-seed checker over both complete attempt logs.
for (const [seed, attempts, result] of [
  [1, paths.seed1Attempts, paths.seed1Result],
  [3, paths.seed3Attempts, paths.seed3Result],
]) {
  const checked = spawnSync(options.node, [paths.checker, paths.contract, attempts, result], {
    cwd: options.repo,
    encoding: "utf8",
    env: {},
  });
  if (checked.error) throw checked.error;
  if (checked.status !== 0) {
    throw new Error(`ZERO q26r seed-${seed} checker exited ${checked.status}: ${checked.stderr || checked.stdout}`);
  }
}
verifyRepository(options.repo, options.commit, options.git);

const contract = readJson(paths.contract);
const aggregate = readJson(paths.aggregate);
const seed1 = readJson(paths.seed1Result);
const seed2 = readJson(paths.seed2Result);
const seed3 = readJson(paths.seed3Result);
const seed1Selection = readJson(paths.seed1Selection);
const seed3Selection = readJson(paths.seed3Selection);

const declaredSeeds = contract.declared_family_seeds;
const results = aggregate.results ?? {};
const goSeeds = declaredSeeds.filter((seed) => results[String(seed)]?.decision === "go");
const noGoSeeds = declaredSeeds.filter((seed) => results[String(seed)]?.decision === "no-go");

if (JSON.stringify(aggregate.declared_seeds) !== JSON.stringify(declaredSeeds)) {
  throw new Error("ZERO q26r aggregate declared seeds drifted");
}
if (JSON.stringify(aggregate.completed_seeds) !== JSON.stringify(declaredSeeds)) {
  throw new Error("ZERO q26r aggregate does not cover all three declared seeds");
}
if (aggregate.decision !== "go" || aggregate.promotion_eligible !== true) {
  throw new Error("ZERO q26r aggregate did not preserve the published family go");
}
if (goSeeds.length !== 3 || noGoSeeds.length !== 0) {
  throw new Error("ZERO q26r family decisions do not match the published all-go result");
}
if (aggregate.current_model !== "ZERO.4") {
  throw new Error("ZERO q26r aggregate did not promote ZERO.4");
}
if (aggregate.promoted_model?.sha256 !== contract.family_rule.promoted_model_sha256) {
  throw new Error("ZERO q26r promoted model is not the frozen seed-2 candidate");
}
if (seed2.seed !== 2 || seed2.decision !== "go") {
  throw new Error("ZERO q26r prior seed-2 diagnostic is missing its go");
}
if (seed2.artifacts?.quantizedSha256 !== contract.family_rule.promoted_model_sha256) {
  throw new Error("ZERO q26r prior seed-2 selected model drifted");
}
for (const [seed, result, selection] of [
  [1, seed1, seed1Selection],
  [3, seed3, seed3Selection],
]) {
  if (result.seed !== seed || result.decision !== "go") {
    throw new Error(`ZERO q26r seed ${seed} did not preserve its published go`);
  }
  if (result.promotion?.evaluatedOnceAtEnd !== true || result.promotion?.quantityPass !== true) {
    throw new Error(`ZERO q26r seed ${seed} promotion conjunction drifted`);
  }
  if (selection.promotion?.evaluatedOnceAtEnd !== true) {
    throw new Error(`ZERO q26r seed ${seed} did not evaluate the promotion split exactly once`);
  }
}

const metrics = {
  declared_seeds: declaredSeeds.length,
  completed_seeds: declaredSeeds.length,
  go_seeds: goSeeds.length,
  no_go_seeds: noGoSeeds.length,
  family_promotion_eligible: aggregate.promotion_eligible ? 1 : 0,
  seed1_committed_updates: seed1.committed,
  seed1_selected_update: seed1.selected?.committed ?? -1,
  seed1_operation_rate: seed1.selected?.rates?.operation ?? -1,
  seed1_exact_artifact_rate: seed1.selected?.rates?.exact_artifact ?? -1,
  seed1_replay_relative_regression: seed1.selected?.replayRegression ?? -1,
  seed1_max_committed_replay_increase: seed1.guardDiagnostics?.maxCommittedRelativeIncrease ?? -1,
  seed1_projected_trials: seed1.guardDiagnostics?.projectedTrials ?? -1,
  seed1_unprojected_trials: seed1.guardDiagnostics?.unprojectedTrials ?? -1,
  seed1_promotion_passed: seed1.promotion?.quantityPass ? 1 : 0,
  seed3_committed_updates: seed3.committed,
  seed3_selected_update: seed3.selected?.committed ?? -1,
  seed3_operation_rate: seed3.selected?.rates?.operation ?? -1,
  seed3_exact_artifact_rate: seed3.selected?.rates?.exact_artifact ?? -1,
  seed3_replay_relative_regression: seed3.selected?.replayRegression ?? -1,
  seed3_max_committed_replay_increase: seed3.guardDiagnostics?.maxCommittedRelativeIncrease ?? -1,
  seed3_projected_trials: seed3.guardDiagnostics?.projectedTrials ?? -1,
  seed3_unprojected_trials: seed3.guardDiagnostics?.unprojectedTrials ?? -1,
  seed3_promotion_passed: seed3.promotion?.quantityPass ? 1 : 0,
  seed2_committed_updates: seed2.committed,
  seed2_selected_update: seed2.selected?.committed ?? -1,
  seed2_operation_rate: seed2.selected?.rates?.operation ?? -1,
  seed2_exact_artifact_rate: seed2.selected?.rates?.exact_artifact ?? -1,
  seed2_replay_relative_regression: seed2.selected?.replayRegression ?? -1,
  promoted_model_matches_frozen_candidate:
    aggregate.promoted_model?.sha256 === contract.family_rule.promoted_model_sha256 ? 1 : 0,
  promotion_evaluations: [seed1, seed2, seed3].filter((result) => result.promotion?.evaluatedOnceAtEnd === true).length,
};
for (const [name, value] of Object.entries(metrics)) {
  if (!Number.isFinite(value)) throw new Error(`ZERO q26r metric ${name} is not a finite number`);
}

console.log(JSON.stringify({
  metrics,
  source: {
    repository: options.repository,
    commit: options.commit,
    artifacts: [
      sourceArtifact(options.repo, "benchmarks/zero4-q26r-v1/contract.json"),
      sourceArtifact(options.repo, "benchmarks/zero4-q26r-v1/aggregate.json"),
      sourceArtifact(options.repo, "benchmarks/zero4-q26r-v1/AGGREGATE.md"),
      sourceArtifact(options.repo, "benchmarks/zero4-q26r-v1/seed1/result.json"),
      sourceArtifact(options.repo, "benchmarks/zero4-q26r-v1/seed1/optimizer-attempts.jsonl"),
      sourceArtifact(options.repo, "benchmarks/zero4-q26r-v1/seed1/selection.json"),
      sourceArtifact(options.repo, "benchmarks/zero4-q26r-v1/seed3/result.json"),
      sourceArtifact(options.repo, "benchmarks/zero4-q26r-v1/seed3/optimizer-attempts.jsonl"),
      sourceArtifact(options.repo, "benchmarks/zero4-q26r-v1/seed3/selection.json"),
      sourceArtifact(options.repo, "benchmarks/zero4-q26-v1/seed2/result.json"),
      sourceArtifact(options.repo, "scripts/check_zero4_q26r.mjs"),
      sourceArtifact(options.repo, "scripts/aggregate_zero4_q26r.mjs"),
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

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}