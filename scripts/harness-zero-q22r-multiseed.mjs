#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const options = parseArgs(process.argv.slice(2));
verifyRepository(options.repo, options.commit, options.git);

const root = path.join(options.repo, "benchmarks", "zero4-q22r-v1");
const paths = {
  aggregateMarkdown: path.join(root, "AGGREGATE.md"),
  aggregate: path.join(root, "aggregate.json"),
  seed1Manifest: path.join(root, "seed1", "manifest.json"),
  seed1Selection: path.join(root, "seed1", "selection.json"),
  seed2Manifest: path.join(root, "seed2", "manifest.json"),
  seed3Manifest: path.join(root, "seed3", "manifest.json"),
  seed3Selection: path.join(root, "seed3", "selection.json"),
  checker: path.join(options.repo, "scripts", "aggregate_zero4_q22r.mjs"),
};
for (const [name, file] of Object.entries(paths)) {
  if (!fs.existsSync(file)) throw new Error(`ZERO q22r multi-seed replay is incomplete: missing ${name} artifact ${file}`);
}

const replay = spawnSync(options.node, [paths.checker, root], {
  cwd: options.repo,
  encoding: "utf8",
  env: {},
});
if (replay.error) throw replay.error;
if (replay.status !== 0) {
  throw new Error(`ZERO q22r aggregate checker exited ${replay.status}: ${replay.stderr || replay.stdout}`);
}
verifyRepository(options.repo, options.commit, options.git);

const aggregate = readJson(paths.aggregate);
const manifests = [1, 2, 3].map((seed) => readJson(paths[`seed${seed}Manifest`]));
if (aggregate.decision !== "no-go" || aggregate.promotion_eligible !== false) {
  throw new Error("ZERO q22r aggregate did not preserve the published family no-go");
}
if (JSON.stringify(aggregate.declared_seeds) !== "[1,2,3]" || JSON.stringify(aggregate.completed_seeds) !== "[1,2,3]") {
  throw new Error("ZERO q22r aggregate does not cover all three declared seeds");
}
if (manifests.map((manifest) => manifest.decision).join(",") !== "no-go,go,no-go") {
  throw new Error("ZERO q22r seed decisions do not match the published one-go/two-no-go result");
}

const failed = [
  { seed: 1, manifest: manifests[0], selection: readJson(paths.seed1Selection) },
  { seed: 3, manifest: manifests[2], selection: readJson(paths.seed3Selection) },
];
for (const { seed, manifest, selection } of failed) {
  if (manifest.promotion_eligible !== false || selection.selected !== null) {
    throw new Error(`ZERO q22r seed ${seed} unexpectedly selected a promotable checkpoint`);
  }
  if (selection.stoppedReason !== "replay exceeded 2% on two consecutive full evaluations") {
    throw new Error(`ZERO q22r seed ${seed} stop reason drifted`);
  }
  if (selection.promotion?.evaluatedOnceAtEnd !== false) {
    throw new Error(`ZERO q22r seed ${seed} unexpectedly evaluated the promotion split`);
  }
}

const result = aggregate.results;
console.log(JSON.stringify({
  metrics: {
    completed_seeds: aggregate.completed_seeds.length,
    go_seeds: Object.values(result).filter((item) => item.decision === "go").length,
    no_go_seeds: Object.values(result).filter((item) => item.decision === "no-go").length,
    family_promotion_eligible: aggregate.promotion_eligible ? 1 : 0,
    seed1_operation_rate: result["1"].operation_rate,
    seed1_exact_artifact_rate: result["1"].exact_artifact_rate,
    seed1_replay_relative_regression: result["1"].replay_relative_regression,
    seed2_operation_rate: result["2"].operation_rate,
    seed2_exact_artifact_rate: result["2"].exact_artifact_rate,
    seed2_replay_relative_regression: result["2"].replay_relative_regression,
    seed3_operation_rate: result["3"].operation_rate,
    seed3_exact_artifact_rate: result["3"].exact_artifact_rate,
    seed3_replay_relative_regression: result["3"].replay_relative_regression,
    failed_seed_promotion_evaluations: failed.filter(({ selection }) => selection.promotion?.evaluatedOnceAtEnd).length,
  },
  source: {
    repository: options.repository,
    commit: options.commit,
    artifacts: [
      sourceArtifact(options.repo, "benchmarks/zero4-q22r-v1/AGGREGATE.md"),
      sourceArtifact(options.repo, "benchmarks/zero4-q22r-v1/aggregate.json"),
      sourceArtifact(options.repo, "benchmarks/zero4-q22r-v1/seed1/manifest.json"),
      sourceArtifact(options.repo, "benchmarks/zero4-q22r-v1/seed1/selection.json"),
      sourceArtifact(options.repo, "benchmarks/zero4-q22r-v1/seed2/manifest.json"),
      sourceArtifact(options.repo, "benchmarks/zero4-q22r-v1/seed3/manifest.json"),
      sourceArtifact(options.repo, "benchmarks/zero4-q22r-v1/seed3/selection.json"),
      sourceArtifact(options.repo, "scripts/aggregate_zero4_q22r.mjs"),
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
