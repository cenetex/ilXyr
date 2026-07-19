#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const options = parseArgs(process.argv.slice(2));
verifyRepository(options.repo, options.commit, options.git);

const resultDirectory = path.join(
  options.repo,
  "benchmarks",
  "zero4-q22r-v1",
  `seed${options.seed}`,
);
const paths = {
  manifest: path.join(resultDirectory, "manifest.json"),
  requests: path.join(resultDirectory, `seed${options.seed}-promotion.json`),
  baseline: path.join(resultDirectory, "replay-baseline.log"),
  replay: path.join(resultDirectory, `seed${options.seed}-selected-replay.log`),
  model: path.join(resultDirectory, "selected.litq8"),
  selection: path.join(resultDirectory, "selection.json"),
  evaluator: path.join(options.repo, "scripts", "evaluate_zero4_q2.mjs"),
};
for (const [name, file] of Object.entries(paths)) {
  if (!fs.existsSync(file)) throw new Error(`ZERO q22r replay is incomplete: missing ${name} artifact ${file}`);
}

const published = readJson(paths.manifest);
if (published.design?.seed !== options.seed) throw new Error("ZERO q22r seed binding mismatch");
if (published.model?.sha256 !== sha256(paths.model)) throw new Error("ZERO q22r model SHA-256 mismatch");

const out = fs.mkdtempSync(path.join(os.tmpdir(), `ilxyr-zero-q22r-seed${options.seed}-`));
const replay = spawnSync(options.node, [
  paths.evaluator,
  "--requests", paths.requests,
  "--baseline", paths.baseline,
  "--replay", paths.replay,
  "--model", paths.model,
  "--steps", "100",
  "--seed", String(options.seed),
  "--experiment", "q22r",
  "--mode", "operation",
  "--request-share", "0",
  "--selection", paths.selection,
  "--out", out,
], { cwd: options.repo, encoding: "utf8", env: {} });
if (replay.error) throw replay.error;
if (replay.status !== 0) {
  throw new Error(`ZERO q22r evaluator exited ${replay.status}: ${replay.stderr || replay.stdout}`);
}
const result = readJson(path.join(out, "manifest.json"));
if (result.decision !== "go" || !Object.values(result.gates ?? {}).every(Boolean)) {
  throw new Error("ZERO q22r replay did not pass every frozen gate");
}
console.log(JSON.stringify({
  metrics: {
    exact_request_rate: result.rates.exact_request,
    exact_artifact_rate: result.rates.exact_artifact,
    replay_relative_regression: result.replay.relative_regression,
    rejected_state_mutations: result.quantity.rejected_state_mutations,
    seed_passed: 1,
  },
  source: {
    repository: options.repository,
    commit: options.commit,
    artifacts: [
      sourceArtifact(options.repo, `benchmarks/zero4-q22r-v1/seed${options.seed}/manifest.json`),
      sourceArtifact(options.repo, `benchmarks/zero4-q22r-v1/seed${options.seed}/seed${options.seed}-promotion.json`),
      sourceArtifact(options.repo, `benchmarks/zero4-q22r-v1/seed${options.seed}/selection.json`),
      sourceArtifact(options.repo, `benchmarks/zero4-q22r-v1/seed${options.seed}/selected.litq8`),
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
  for (const key of ["repo", "repository", "commit", "git", "node", "seed"]) {
    if (!values.has(key)) throw new Error(`--${key} is required`);
  }
  const seed = Number(values.get("seed"));
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error("--seed must be a non-negative integer");
  return {
    repo: path.resolve(values.get("repo")),
    repository: values.get("repository"),
    commit: values.get("commit"),
    git: values.get("git"),
    node: values.get("node"),
    seed,
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
