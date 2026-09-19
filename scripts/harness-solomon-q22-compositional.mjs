#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const options = parseArgs(process.argv.slice(2));
const harnessPath = fs.realpathSync(fileURLToPath(import.meta.url));
assert(sha256(harnessPath) === options.harnessSha256, "Solomon Q22 compositional harness digest drifted");
verifyCleanRepository(options.nsrlRepo, options.nsrlCommit, options.git);
verifyCleanRepository(options.zeroRepo, options.zeroCommit, options.git);

const nsrlFiles = new Map([
  ["benchmarks/q22-compositional-shared-task-v1/manifest.tsv", "51f06ae293f338a27c1bbcc4fb52d66cffc5a7727b15998fa606b1a073ee8e21"],
  ["benchmarks/q22-compositional-solomon-prospective-v1/contract.json", "f5fdd260ae7e7ef2fdab85bb4aaf0aaebb2716015b3e8026a677aaf8fa8d0ae4"],
  ["crates/nsrl-eval/src/lib.rs", "a84d470b39c13945078dfe169baf8be1ee8f77e24517a6adaf72e381cefe29e6"],
  ["crates/nsrl-eval/src/q22_compositional.rs", "ab224c965a352882eeebb0bff7f8f7393759a6f3c35be1d4493952ce9691dc46"],
  ["crates/nsrl-eval/src/bin/nsrl-q22-compositional-eval.rs", "e6d4b54a0bc8b546f8630443d8e0bf67dc770cb2a7b4f2095415ae67ac35bf61"],
  ["crates/nsrl-train/src/bin/nsrl-q22-compositional-proposer.rs", "8caa5121b9bd2a2c64db378cb207eef15974a174baa32e6d9ab7d70afd9fbdef"],
  ["scripts/run-q22-compositional-solomon-prospective.mjs", "2cf2a578ad093a78c4e224dff7d009472ef43435ac26856ba6af29e1df9f88c4"],
]);
const zeroFiles = new Map([
  ["benchmarks/zero4-q22-compositional-shared-task-v1/manifest.json", "8d7196afc3a80f89998a272dd689d309df9db2e0ac9202cbe3a2f41b9390c1ee"],
  ["scripts/generate_q22_compositional_routing.mjs", "2600635c99199f9840c0c7cb0db50e62437e139672cd871bf0b9b2fb082429b0"],
  ["scripts/check_q22_compositional_shared_task.mjs", "c8a21add7d905c1c605c972e1ad703accd829c9633f72d7bf8ebb6648481a605"],
  ["quantity_request_eval.c", "1627c00a2a49846170b8ee49160ac55ae02e1f4f687397f3e46641e271537902"],
]);
verifyFiles(options.nsrlRepo, nsrlFiles, "NSRL");
verifyFiles(options.zeroRepo, zeroFiles, "Zero");

const work = fs.mkdtempSync(path.join(os.tmpdir(), "ilxyr-solomon-q22-compositional-"));
const generated = path.join(work, "generated");
const evidence = path.join(work, "evidence");
const generator = path.join(options.zeroRepo, "scripts/generate_q22_compositional_routing.mjs");
const runner = path.join(options.nsrlRepo, "scripts/run-q22-compositional-solomon-prospective.mjs");
const manifest = path.join(options.nsrlRepo, "benchmarks/q22-compositional-shared-task-v1/manifest.tsv");

run(options.node, [
  generator,
  "--out", generated,
  "--train", "10000",
  "--eval", "1000",
  "--seed", "23",
], options.zeroRepo, 60, "generate Zero Q22 compositional surface");
const train = path.join(generated, "quantity-composition.train.jsonl");
const evaluation = path.join(generated, "quantity-composition.promotion.tsv");
assert(sha256(train) === "1f997d174ea1e3f3675612e24ecced15f8145abd29819e532b2f890f36245e8f", "Q22 compositional training hash drifted");
assert(sha256(evaluation) === "42902d61d9edc2ceb5a33875deddbdd9e9b523b06fb1aa13a22249acbf2983fe", "Q22 compositional evaluation hash drifted");

const replay = run(options.node, [
  runner,
  "--manifest", manifest,
  "--train-dataset", train,
  "--eval", evaluation,
  "--out-dir", evidence,
  "--cargo", options.cargo,
], options.nsrlRepo, 600, "run Solomon Q22 compositional experiment");
const terminal = JSON.parse(replay.trim().split("\n").filter(Boolean).at(-1));
const resultPath = path.join(evidence, "result.json");
assert(fs.existsSync(resultPath), "Solomon Q22 compositional result is missing");
const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
assert(result.schema === "nsrl.q22_compositional_solomon_prospective_result.v1", "Solomon Q22 compositional result schema drifted");
assert(result.eval_sha256 === "42902d61d9edc2ceb5a33875deddbdd9e9b523b06fb1aa13a22249acbf2983fe", "Solomon Q22 compositional evaluation hash drifted");
assert(result.seeds.length === 3 && result.seeds.map((row) => row.seed).join(",") === "1,2,3", "Solomon Q22 compositional seed evidence is incomplete");
const sourceMetrics = {
  minimum_operation_exact_rate_ppm: result.minimum_operation_exact_rate_ppm,
  minimum_per_class_exact_rate_ppm: result.minimum_per_class_exact_rate_ppm,
  mean_operation_exact_rate_ppm: result.mean_operation_exact_rate_ppm,
  all_seed_agreement_rate_ppm: result.all_seed_agreement_rate_ppm,
  family_passed: result.family_passed ? 1 : 0,
};
assert(JSON.stringify(terminal.metrics) === JSON.stringify(sourceMetrics), "Solomon Q22 compositional metric envelope drifted");
verifyTrackedSource(options.nsrlRepo, options.nsrlCommit, options.git);
verifyTrackedSource(options.zeroRepo, options.zeroCommit, options.git);

process.stderr.write(`Evidence directory: ${evidence}\n`);
console.log(JSON.stringify({
  metrics: {
    family_gate_ppm: result.family_passed ? 1000000 : 0,
    minimum_operation_exact_rate_ppm: result.minimum_operation_exact_rate_ppm,
    minimum_per_class_exact_rate_ppm: result.minimum_per_class_exact_rate_ppm,
    all_seed_agreement_rate_ppm: result.all_seed_agreement_rate_ppm,
  },
  source: {
    repository: options.nsrlRepository,
    commit: options.nsrlCommit,
    artifacts: [
      ...[...nsrlFiles.keys()].map((relative) => sourceArtifact(options.nsrlRepo, relative)),
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
  for (const key of ["nsrl-repo", "nsrl-repository", "nsrl-commit", "zero-repo", "zero-commit", "git", "node", "cargo", "harness-sha256"]) {
    if (!values.has(key)) throw new Error(`--${key} is required`);
  }
  return {
    nsrlRepo: fs.realpathSync(path.resolve(values.get("nsrl-repo"))),
    nsrlRepository: values.get("nsrl-repository"),
    nsrlCommit: values.get("nsrl-commit"),
    zeroRepo: fs.realpathSync(path.resolve(values.get("zero-repo"))),
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
