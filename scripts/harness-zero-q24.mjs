#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const options = parseArgs(process.argv.slice(2));
const harnessPath = fs.realpathSync(fileURLToPath(import.meta.url));
assert(sha256(harnessPath) === options.harnessSha256, "Q2.4 harness digest drifted");
verifyCleanRepository(options.repo, options.commit, options.git);

const contract = path.join(options.repo, "benchmarks", "zero4-q24-v1", "contract.json");
const output = path.join(options.repo, "benchmarks", "zero4-q24-v1", "seed2");
const resultPath = path.join(output, "result.json");
const attemptsPath = path.join(output, "optimizer-attempts.jsonl");
const eventsPath = path.join(output, "events.jsonl");
const checker = path.join(options.repo, "scripts", "check_zero4_q24.mjs");
for (const file of [contract, checker, path.join(options.repo, "scripts", "train_zero4_q24.mjs")]) {
  if (!fs.existsSync(file)) throw new Error(`Q2.4 source artifact is missing: ${file}`);
}
if (fs.existsSync(resultPath)) throw new Error("Q2.4 seed-2 result already exists; refusing duplicate execution");

const executionPath = [path.dirname(options.node), "/usr/local/bin", "/usr/bin", "/bin"].join(":");
const run = spawnSync(options.make, ["zero4-q24-train", "ZERO4_Q24_SEED=2"], {
  cwd: options.repo,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
  env: { PATH: executionPath },
});
if (run.stdout) process.stderr.write(run.stdout);
if (run.stderr) process.stderr.write(run.stderr);
if (run.error) throw run.error;
if (run.status !== 0) throw new Error(`Q2.4 training exited ${run.status}`);

for (const file of [resultPath, attemptsPath, eventsPath]) {
  if (!fs.existsSync(file)) throw new Error(`Q2.4 execution is incomplete: ${file}`);
}
const checked = spawnSync(options.node, [checker, contract, attemptsPath], {
  cwd: options.repo,
  encoding: "utf8",
  env: {},
});
if (checked.error) throw checked.error;
if (checked.status !== 0) throw new Error(`Q2.4 checker exited ${checked.status}: ${checked.stderr || checked.stdout}`);
verifyTrackedSource(options.repo, options.commit, options.git);

const result = readJson(resultPath);
const attempts = readJsonLines(attemptsPath);
const events = readJsonLines(eventsPath);
assert(result.schema === "zero.zero4_q24_result.v1" && result.seed === 2, "Q2.4 result identity drifted");
assert(["go", "no-go"].includes(result.decision), "Q2.4 decision is invalid");
assert(result.stage === "cumulative-guard", "Q2.4 guard mode drifted");
assert(attempts.length > 0, "Q2.4 attempt log is empty");
assert(result.attempts === attempts.length, "Q2.4 attempt log is incomplete");
assert(result.guardBudget === 0.015, "Q2.4 guard budget drifted");
const accepted = attempts.filter((attempt) => attempt.decision === "accept").length;
const rejected = attempts.filter((attempt) => attempt.decision === "reject").length;
assert(accepted === result.committed && accepted + rejected === result.attempts, "Q2.4 decision counts drifted");
assert(attempts.every((attempt) => attempt.cumulative_ranges.length === 6), "Q2.4 skipped a replay range");
const violates = (attempt, threshold) =>
  !Number.isFinite(attempt.cumulative_relative_change) || attempt.cumulative_relative_change > threshold;
const warningExceedances = attempts.filter((attempt) => violates(attempt, 0.01)).length;
const hardExceedances = attempts.filter((attempt) => violates(attempt, 0.015)).length;
const finiteIncreases = attempts
  .map((attempt) => attempt.cumulative_relative_change)
  .filter(Number.isFinite);
const maxIncrease = finiteIncreases.length > 0 ? Math.max(...finiteIncreases) : 0;
assert(rejected === hardExceedances, "Q2.4 rejection count does not match hard exceedances");
const publicEvents = events.filter((event) => event.type === "full-evaluation");
const feasible = publicEvents.filter((event) => event.feasible).length;
const promotionEvaluations = result.promotion?.evaluatedOnceAtEnd ? 1 : 0;
if (result.decision === "go") {
  assert(feasible > 0 && promotionEvaluations === 1 && result.promotion.quantityPass === true, "Q2.4 go lacks conjunctive evidence");
} else {
  assert(result.selected === null && promotionEvaluations === 0, "Q2.4 no-go opened promotion or selected a model");
}
assert(events.at(-1)?.type === "complete", "Q2.4 terminal event is missing");

console.log(JSON.stringify({
  metrics: {
    seed_passed: result.decision === "go" ? 1 : 0,
    optimizer_attempts: result.attempts,
    committed_updates: result.committed,
    rejected_candidates: rejected,
    warning_exceedances: warningExceedances,
    hard_exceedances: hardExceedances,
    max_cumulative_replay_increase: maxIncrease,
    public_checkpoint_count: publicEvents.length,
    jointly_feasible_checkpoint_count: feasible,
    promotion_evaluations: promotionEvaluations,
    replication_seeds_opened: 0
  },
  source: {
    repository: options.repository,
    commit: options.commit,
    artifacts: [
      sourceArtifact(options.repo, "benchmarks/zero4-q24-v1/contract.json"),
      sourceArtifact(options.repo, "benchmarks/zero4-q24-v1/seed2/RESULTS.md"),
      sourceArtifact(options.repo, "benchmarks/zero4-q24-v1/seed2/result.json"),
      sourceArtifact(options.repo, "benchmarks/zero4-q24-v1/seed2/optimizer-attempts.jsonl"),
      sourceArtifact(options.repo, "benchmarks/zero4-q24-v1/seed2/events.jsonl"),
      sourceArtifact(options.repo, "scripts/check_zero4_q24.mjs"),
      sourceArtifact(options.repo, "scripts/train_zero4_q24.mjs")
    ]
  }
}));

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) throw new Error(`invalid argument ${argv[index] ?? "<missing>"}`);
    values.set(argv[index].slice(2), argv[index + 1]);
  }
  for (const key of ["repo", "repository", "commit", "git", "make", "node", "harness-sha256"]) if (!values.has(key)) throw new Error(`--${key} is required`);
  return { repo: fs.realpathSync(path.resolve(values.get("repo"))), repository: values.get("repository"), commit: values.get("commit"), git: values.get("git"), make: values.get("make"), node: values.get("node"), harnessSha256: values.get("harness-sha256") };
}

function assert(condition, message) { if (!condition) throw new Error(message); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function readJsonLines(file) { return fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse); }
function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function sourceArtifact(repo, relative) { return { path: relative, sha256: sha256(path.join(repo, relative)) }; }
function command(program, args) {
  const result = spawnSync(program, args, { encoding: "utf8", env: {} });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} exited ${result.status}: ${result.stderr}`);
  return result.stdout;
}
function verifyCleanRepository(repo, commit, git) {
  verifyTrackedSource(repo, commit, git);
  if (command(git, ["-C", repo, "status", "--porcelain"]).trim()) throw new Error("repository must be clean before prospective execution");
}
function verifyTrackedSource(repo, commit, git) {
  const head = command(git, ["-C", repo, "rev-parse", "HEAD"]).trim();
  if (head !== commit) throw new Error(`repository commit mismatch: ${head} != ${commit}`);
  const diff = spawnSync(git, ["-C", repo, "diff", "--quiet", "--exit-code"], { env: {} });
  if (diff.error) throw diff.error;
  if (diff.status !== 0) throw new Error("tracked source changed during Q2.4 execution");
}
