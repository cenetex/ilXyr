#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const options = parseArgs(process.argv.slice(2));
verifyRepository(options.repo, options.commit, options.git);
const runner = path.join(options.repo, "scripts", "run-integer-transformer-successor-v2.mjs");
if (!fs.existsSync(runner)) throw new Error(`missing Solomon successor-v2 runner ${runner}`);
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ilxyr-solomon-successor-v2-"));
const toolPath = [
  path.dirname(options.cargo),
  path.dirname(options.python),
  path.dirname(options.node),
  "/usr/bin",
  "/bin",
].join(path.delimiter);
const replay = spawnSync(options.node, [runner, "--check", "--out-dir", out], {
  cwd: options.repo,
  encoding: "utf8",
  env: {
    PATH: toolPath,
    OPENBLAS_NUM_THREADS: "1",
    OMP_NUM_THREADS: "1",
    CARGO: options.cargo,
    PYTHON: options.python,
  },
});
if (replay.error) throw replay.error;
if (replay.status !== 0) {
  throw new Error(`Solomon successor-v2 replay exited ${replay.status}: ${replay.stderr || replay.stdout}`);
}
const lines = replay.stdout.trim().split("\n").filter(Boolean);
const terminal = JSON.parse(lines.at(-1));
if (terminal.valid !== true || terminal.promoted !== true || terminal.targets !== 5896) {
  throw new Error("Solomon successor-v2 replay did not pass its frozen checker");
}
const evidence = JSON.parse(fs.readFileSync(path.join(out, "evidence.json"), "utf8"));
const systems = new Map(evidence.systems.map((system) => [system.system, system]));
for (const name of ["transformer-only", "uniform", "retrieval", "byte-ngram", "float-transformer"]) {
  if (!systems.has(name)) throw new Error(`Solomon evidence omitted ${name}`);
}
console.log(JSON.stringify({
  metrics: {
    transformer_nll_millibits: systems.get("transformer-only").total_nll_millibits,
    uniform_nll_millibits: systems.get("uniform").total_nll_millibits,
    retrieval_nll_millibits: systems.get("retrieval").total_nll_millibits,
    byte_ngram_nll_millibits: systems.get("byte-ngram").total_nll_millibits,
    float_transformer_nll_millibits: systems.get("float-transformer").total_nll_millibits,
    zero_probability_windows: systems.get("transformer-only").zero_probability_windows,
    targets: terminal.targets,
    promoted: 1,
  },
  source: {
    repository: options.repository,
    commit: options.commit,
    artifacts: [
      sourceArtifact(options.repo, "benchmarks/integer-transformer-proof-v1/successor-v2-manifest.tsv"),
      sourceArtifact(options.repo, "benchmarks/integer-transformer-proof-v1/successor-v2-evidence.json"),
      sourceArtifact(options.repo, "scripts/run-integer-transformer-successor-v2.mjs"),
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
  for (const key of ["repo", "repository", "commit", "git", "node", "python", "cargo"]) {
    if (!values.has(key)) throw new Error(`--${key} is required`);
  }
  return {
    repo: path.resolve(values.get("repo")),
    repository: values.get("repository"),
    commit: values.get("commit"),
    git: values.get("git"),
    node: values.get("node"),
    python: values.get("python"),
    cargo: values.get("cargo"),
  };
}

function sourceArtifact(repo, relative) {
  return {
    path: relative,
    sha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(repo, relative))).digest("hex"),
  };
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
