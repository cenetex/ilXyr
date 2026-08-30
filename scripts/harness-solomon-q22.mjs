#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const options = parseArgs(process.argv.slice(2));
const harnessPath = fs.realpathSync(fileURLToPath(import.meta.url));
assert(sha256(harnessPath) === options.harnessSha256, "Solomon Q22 harness digest drifted");
verifyCleanRepository(options.nsrlRepo, options.nsrlCommit, options.git);
verifyCleanRepository(options.zeroRepo, options.zeroCommit, options.git);

const nsrlFiles = new Map([
  ["benchmarks/q22-shared-task-v1/manifest.tsv", "8bc20345afea89735b742139b7c78942812b025605c034b59736b4f7458545a5"],
  ["benchmarks/q22-solomon-prospective-v1/contract.json", "b3b2e2d2648802ac99395c0d1110207409f240cc5e4b83d8c89186c36238ccc0"],
  ["crates/nsrl-eval/src/q22.rs", "05f057a8217190709ff5965ea3e8d488a15770b8b84d7d216efaf36ce24f5135"],
  ["crates/nsrl-train/src/bin/nsrl-q22-proposer.rs", "2bf5350717679210f694c4453d70882e39130a5b3965f169692705d78f7a849e"],
  ["scripts/run-q22-solomon-prospective.mjs", "631e95705577854381b8d8c10aa63b426c52a4beb067054403c72dbaa1ed7726"],
]);
const zeroFiles = new Map([
  ["benchmarks/zero4-q22-shared-task-v1/manifest.json", "2f8145e5111a887dd05c23dc7a9781133acaf359b2ae168e250b4cf1ec68407c"],
  ["scripts/generate_zero4_q2.mjs", "de34a72d158127fd12cad86a353b81aad7b3790090d839a359be1766405f2ded"],
  ["scripts/materialize_zero4_q22_shared_task.mjs", "dde58f4d77b861d9e51ea323c8f6e664ffa4ed95cb7ccebde7a2233ec3174d9f"],
]);
verifyFiles(options.nsrlRepo, nsrlFiles, "NSRL");
verifyFiles(options.zeroRepo, zeroFiles, "Zero");

const work = fs.mkdtempSync(path.join(os.tmpdir(), "ilxyr-solomon-q22-"));
const generated = path.join(work, "generated");
const evidence = path.join(work, "evidence");
const generator = path.join(options.zeroRepo, "scripts/generate_zero4_q2.mjs");
const materializer = path.join(options.zeroRepo, "scripts/materialize_zero4_q22_shared_task.mjs");
const runner = path.join(options.nsrlRepo, "scripts/run-q22-solomon-prospective.mjs");
const manifest = path.join(options.nsrlRepo, "benchmarks/q22-shared-task-v1/manifest.tsv");

run(options.node, [generator, "--out", generated, "--quantity", "10000", "--seed", "5", "--request-mode", "operation"], options.zeroRepo, 60, "generate Zero Q22");
run(options.node, [materializer, generated], options.zeroRepo, 60, "materialize shared training set");
const train = path.join(generated, "quantity-request.train.jsonl");
const evaluation = path.join(generated, "quantity-request.promotion.tsv");
assert(sha256(train) === "815fac312664f49eaaa33942828ffa1511fd81091ccd88d47b4480b6c27a5fa4", "Q22 training hash drifted");

const replay = run(options.node, [
  runner,
  "--manifest", manifest,
  "--train-dataset", train,
  "--eval", evaluation,
  "--out-dir", evidence,
  "--cargo", options.cargo,
], options.nsrlRepo, 600, "run Solomon Q22");
const terminal = JSON.parse(replay.trim().split("\n").filter(Boolean).at(-1));
const resultPath = path.join(evidence, "result.json");
assert(fs.existsSync(resultPath), "Solomon Q22 result is missing");
const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
assert(result.schema === "nsrl.q22_solomon_prospective_result.v1", "Solomon Q22 result schema drifted");
assert(result.eval_sha256 === "9270ea2b72af90235407bd7924a0864b8eba35b2969e1657ed1c15bf04449519", "Solomon Q22 evaluation hash drifted");
assert(result.seeds.length === 3 && result.seeds.map((row) => row.seed).join(",") === "1,2,3", "Solomon Q22 seed evidence is incomplete");
const sourceMetrics = {
  minimum_operation_exact_rate_ppm: result.minimum_operation_exact_rate_ppm,
  mean_operation_exact_rate_ppm: result.mean_operation_exact_rate_ppm,
  all_seed_agreement_rate_ppm: result.all_seed_agreement_rate_ppm,
  family_passed: result.family_passed ? 1 : 0,
};
assert(JSON.stringify(terminal.metrics) === JSON.stringify(sourceMetrics), "Solomon Q22 metric envelope drifted");
verifyTrackedSource(options.nsrlRepo, options.nsrlCommit, options.git);
verifyTrackedSource(options.zeroRepo, options.zeroCommit, options.git);

console.log(JSON.stringify({
  metrics: {
    operation_exact_rate_ppm: result.minimum_operation_exact_rate_ppm,
  },
  source: {
    repository: options.nsrlRepository,
    commit: options.nsrlCommit,
    artifacts: [
      ...[...nsrlFiles.keys()].map((relative) => sourceArtifact(options.nsrlRepo, relative)),
      ...[...zeroFiles.keys()].map((relative) => ({
        repository: options.zeroRepository,
        ...sourceArtifact(options.zeroRepo, relative),
      })),
      { path: "result.json", sha256: sha256(resultPath) },
      { path: "models-frozen.json", sha256: sha256(path.join(evidence, "models-frozen.json")) },
    ],
  },
}));

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) throw new Error(`invalid argument ${argv[index] ?? "<missing>"}`);
    values.set(argv[index].slice(2), argv[index + 1]);
  }
  for (const key of ["nsrl-repo", "nsrl-repository", "nsrl-commit", "zero-repo", "zero-repository", "zero-commit", "git", "node", "cargo", "harness-sha256"]) {
    if (!values.has(key)) throw new Error(`--${key} is required`);
  }
  return {
    nsrlRepo: fs.realpathSync(path.resolve(values.get("nsrl-repo"))),
    nsrlRepository: values.get("nsrl-repository"),
    nsrlCommit: values.get("nsrl-commit"),
    zeroRepo: fs.realpathSync(path.resolve(values.get("zero-repo"))),
    zeroRepository: values.get("zero-repository"),
    zeroCommit: values.get("zero-commit"),
    git: values.get("git"),
    node: values.get("node"),
    cargo: values.get("cargo"),
    harnessSha256: values.get("harness-sha256"),
  };
}

function run(program, args, cwd, timeoutSeconds, label) {
  const result = spawnSync(program, args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutSeconds * 1000,
    maxBuffer: 64 * 1024 * 1024,
    env: { PATH: [path.dirname(program), path.dirname(options.cargo), "/usr/bin", "/bin"].join(path.delimiter) },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} exited ${result.status}: ${result.stderr || result.stdout}`);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.stdout;
}

function verifyFiles(repo, files, label) {
  for (const [relative, expected] of files) {
    const file = path.join(repo, relative);
    assert(fs.existsSync(file), `${label} source artifact is missing: ${relative}`);
    assert(sha256(file) === expected, `${label} source artifact drifted: ${relative}`);
  }
}

function verifyCleanRepository(repo, commit, git) {
  verifyTrackedSource(repo, commit, git);
  if (command(git, ["-C", repo, "status", "--porcelain"]).trim()) throw new Error(`repository must be clean: ${repo}`);
}

function verifyTrackedSource(repo, commit, git) {
  const head = command(git, ["-C", repo, "rev-parse", "HEAD"]).trim();
  if (head !== commit) throw new Error(`repository commit mismatch: ${head} != ${commit}`);
  const diff = spawnSync(git, ["-C", repo, "diff", "--quiet", "--exit-code"], { env: {} });
  if (diff.error) throw diff.error;
  if (diff.status !== 0) throw new Error(`tracked source changed: ${repo}`);
}

function command(program, args) {
  const result = spawnSync(program, args, { encoding: "utf8", env: {} });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} exited ${result.status}: ${result.stderr}`);
  return result.stdout;
}

function sourceArtifact(repo, relative) {
  return { path: relative, sha256: sha256(path.join(repo, relative)) };
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
