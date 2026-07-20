#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const options = parseArgs(process.argv.slice(2));
const harnessPath = fs.realpathSync(fileURLToPath(import.meta.url));
assert(sha256(harnessPath) === options.harnessSha256, "Q2.6-R harness digest drifted");
assert([1, 3].includes(options.seed), "Q2.6-R harness authorizes only seeds 1 and 3");
verifyCleanRepository(options.repo, options.commit, options.git);

const baseContract = path.join(options.repo, "benchmarks", "zero4-q26-v1", "contract.json");
const replicationContract = path.join(options.repo, "benchmarks", "zero4-q26r-v1", "contract.json");
const output = path.join(options.repo, "benchmarks", "zero4-q26r-v1", `seed${options.seed}`);
const resultPath = path.join(output, "result.json");
const attemptsPath = path.join(output, "optimizer-attempts.jsonl");
const eventsPath = path.join(output, "events.jsonl");
const baseChecker = path.join(options.repo, "scripts", "check_zero4_q26.mjs");
const replicationChecker = path.join(options.repo, "scripts", "check_zero4_q26r.mjs");
const trainer = path.join(options.repo, "scripts", "train_zero4_q26.mjs");
const aggregator = path.join(options.repo, "scripts", "aggregate_zero4_q26r.mjs");
for (const file of [baseContract, replicationContract, baseChecker, replicationChecker, trainer, aggregator]) {
  if (!fs.existsSync(file)) throw new Error(`Q2.6-R source artifact is missing: ${file}`);
}
assert(sha256(baseContract) === "2fa40ace634c9fc737d6212f902b074685a7769628becf720cefe5f936e4ac80", "Q2.6 diagnostic contract drifted");
assert(sha256(replicationContract) === "f966485a209d21ef54b56601fb2d91ebcf318d4da646b5572c0a432996140318", "Q2.6-R contract drifted");
assert(sha256(baseChecker) === "85681beb4eed9f1ae632d7a258629727015baea62ed0415b7bdbab40a17ef269", "Q2.6 base checker drifted");
assert(sha256(replicationChecker) === "a32242a4bae7d22481d8739326552187f36bde070d3c4b05aba274530b84b1eb", "Q2.6-R checker drifted");
assert(sha256(trainer) === "8891760ad60d74ec796290d082849ddf2b6910c839cb0cb1b300e3b37f87bb90", "Q2.6-R trainer drifted");
assert(sha256(aggregator) === "0a4af7877a10dd99aac2a3005cd5c91ca151666cb0ff3ac75b7d8621b28b884b", "Q2.6-R aggregator drifted");
if (fs.existsSync(resultPath)) throw new Error(`Q2.6-R seed-${options.seed} result already exists; refusing duplicate execution`);

const executionPath = [path.dirname(options.node), "/usr/local/bin", "/usr/bin", "/bin"].join(":");
const run = spawnSync(options.make, ["zero4-q26r-train", `ZERO4_Q26R_SEED=${options.seed}`], {
  cwd: options.repo,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
  env: { PATH: executionPath },
});
if (run.stdout) process.stderr.write(run.stdout);
if (run.stderr) process.stderr.write(run.stderr);
if (run.error) throw run.error;
if (run.status !== 0) throw new Error(`Q2.6-R seed-${options.seed} training exited ${run.status}`);

for (const file of [resultPath, attemptsPath, eventsPath]) {
  if (!fs.existsSync(file)) throw new Error(`Q2.6-R execution is incomplete: ${file}`);
}
const checked = spawnSync(options.node, [replicationChecker, replicationContract, attemptsPath, resultPath], {
  cwd: options.repo,
  encoding: "utf8",
  env: {},
});
if (checked.error) throw checked.error;
if (checked.status !== 0) throw new Error(`Q2.6-R checker exited ${checked.status}: ${checked.stderr || checked.stdout}`);
verifyTrackedSource(options.repo, options.commit, options.git);

const result = readJson(resultPath);
const attempts = readJsonLines(attemptsPath);
const events = readJsonLines(eventsPath);
assert(result.schema === "zero.zero4_q26_result.v1" && result.seed === options.seed, "Q2.6-R result identity drifted");
assert(["go", "no-go"].includes(result.decision), "Q2.6-R decision is invalid");
assert(result.stage === "cumulative-tangent" && result.guardBudget === 0.015, "Q2.6-R guard contract drifted");
assert(attempts.length > 0 && result.attempts === attempts.length, "Q2.6-R attempt log is incomplete");

const accepted = attempts.filter((attempt) => attempt.decision === "accept");
const rejected = attempts.filter((attempt) => attempt.decision === "reject");
assert(accepted.length === result.committed, "Q2.6-R committed count drifted");
for (const attempt of attempts) {
  assert(attempt.schema === "zero.optimizer_attempt.v4" && attempt.mode === "cumulative-tangent", "Q2.6-R attempt identity drifted");
  assert(attempt.backtrack_trials.length === attempt.backtrack_trial_count, "Q2.6-R trial log is incomplete");
  assert(attempt.backtrack_trial_count >= 1 && attempt.backtrack_trial_count <= 8, "Q2.6-R trial count is invalid");
  assert(Number.isFinite(attempt.cumulative_replay_gradient_norm) && attempt.cumulative_replay_gradient_norm > 0, "Q2.6-R replay gradient norm is invalid");
  for (let index = 0; index < attempt.backtrack_trials.length; ++index) {
    const trial = attempt.backtrack_trials[index];
    assert(trial.index === index && trial.scale === 2 ** -index, "Q2.6-R scale schedule drifted");
    assert(trial.ranges.length === 6 && new Set(trial.ranges.map((entry) => entry.replay_range)).size === 6, "Q2.6-R skipped a replay range");
    assert(typeof trial.projection_applied === "boolean", "Q2.6-R projection trigger is missing");
    for (const field of ["projection_coefficient", "projection_pre_dot", "projection_post_dot", "projection_removed_fraction"]) assert(Number.isFinite(trial[field]), `Q2.6-R ${field} is invalid`);
    if (trial.projection_applied) {
      assert(trial.projection_pre_dot > 0 && trial.projection_coefficient > 0, "Q2.6-R projected a non-conflicting trial");
      assert(Math.abs(trial.projection_post_dot) <= 1e-5 * (1 + Math.abs(trial.projection_pre_dot)), "Q2.6-R projected trial is not tangent");
      assert(trial.projection_removed_fraction > 0 && trial.projection_removed_fraction <= 1.00001, "Q2.6-R removed fraction is invalid");
    } else {
      assert(trial.projection_pre_dot <= 0 && trial.projection_coefficient === 0 && trial.projection_removed_fraction === 0, "Q2.6-R changed a non-conflicting trial");
    }
    if (index + 1 < attempt.backtrack_trials.length) assert(!Number.isFinite(trial.relative_change) || trial.relative_change > 0.015, "Q2.6-R skipped an earlier feasible trial");
  }
  const finalTrial = attempt.backtrack_trials.at(-1);
  if (attempt.decision === "accept") {
    assert(Number.isFinite(finalTrial.relative_change) && finalTrial.relative_change <= 0.015, "Q2.6-R accepted an infeasible trial");
    assert(attempt.accepted_scale === finalTrial.scale && attempt.rollback_digest === "0000000000000000", "Q2.6-R accepted state is inconsistent");
  } else {
    assert(attempt.backtrack_trial_count === 8 && attempt.accepted_scale === null, "Q2.6-R rejected before exhausting trials");
    assert(attempt.rollback_digest !== "0000000000000000", "Q2.6-R rejection lacks rollback proof");
  }
}

const trials = attempts.flatMap((attempt) => attempt.backtrack_trials);
const finiteTrialIncreases = trials.map((trial) => trial.relative_change).filter(Number.isFinite);
const finiteCommittedIncreases = accepted.map((attempt) => attempt.cumulative_relative_change).filter(Number.isFinite);
const projected = trials.filter((trial) => trial.projection_applied);
const fullScaleCommits = accepted.filter((attempt) => attempt.accepted_scale === 1).length;
const backtrackedCommits = accepted.filter((attempt) => attempt.accepted_scale < 1).length;
const warningTrialExceedances = trials.filter((trial) => !Number.isFinite(trial.relative_change) || trial.relative_change > 0.01).length;
const hardTrialExceedances = trials.filter((trial) => !Number.isFinite(trial.relative_change) || trial.relative_change > 0.015).length;
const maxTrialIncrease = finiteTrialIncreases.length ? Math.max(...finiteTrialIncreases) : 0;
const maxCommittedIncrease = finiteCommittedIncreases.length ? Math.max(...finiteCommittedIncreases) : 0;
const maxTrialsUsed = Math.max(...attempts.map((attempt) => attempt.backtrack_trial_count));
const minAcceptedScale = accepted.length ? Math.min(...accepted.map((attempt) => attempt.accepted_scale)) : 0;
const maxRemovedFraction = projected.length ? Math.max(...projected.map((trial) => trial.projection_removed_fraction)) : 0;
const meanRemovedFraction = projected.length ? projected.reduce((sum, trial) => sum + trial.projection_removed_fraction, 0) / projected.length : 0;
const maxPreDot = projected.length ? Math.max(...projected.map((trial) => trial.projection_pre_dot)) : 0;
const maxAbsolutePostDot = projected.length ? Math.max(...projected.map((trial) => Math.abs(trial.projection_post_dot))) : 0;
const diagnostics = result.guardDiagnostics;
assert(diagnostics.fullScaleAccepted === fullScaleCommits && diagnostics.backtrackedAccepted === backtrackedCommits, "Q2.6-R commit diagnostics drifted");
assert(diagnostics.exhausted === rejected.length && diagnostics.trialEvaluations === trials.length, "Q2.6-R trial diagnostics drifted");
assert(diagnostics.maxTrialsUsed === maxTrialsUsed && diagnostics.minAcceptedScale === (accepted.length ? minAcceptedScale : null), "Q2.6-R scale diagnostics drifted");
assert(diagnostics.warningTrialExceedances === warningTrialExceedances && diagnostics.hardTrialExceedances === hardTrialExceedances, "Q2.6-R threshold diagnostics drifted");
assert(diagnostics.maxTrialRelativeIncrease === (finiteTrialIncreases.length ? maxTrialIncrease : null), "Q2.6-R maximum trial increase drifted");
assert(diagnostics.maxCommittedRelativeIncrease === (finiteCommittedIncreases.length ? maxCommittedIncrease : null), "Q2.6-R maximum committed increase drifted");
assert(diagnostics.projectedTrials === projected.length && diagnostics.projectedAccepted === accepted.filter((attempt) => attempt.projection_applied).length, "Q2.6-R projection counts drifted");
assert(diagnostics.unprojectedTrials === trials.length - projected.length, "Q2.6-R unprojected count drifted");
assert(diagnostics.maxProjectionRemovedFraction === maxRemovedFraction && diagnostics.meanProjectionRemovedFraction === meanRemovedFraction, "Q2.6-R removed-fraction diagnostics drifted");
assert(diagnostics.maxProjectionPreDot === maxPreDot && diagnostics.maxAbsoluteProjectionPostDot === maxAbsolutePostDot, "Q2.6-R tangent diagnostics drifted");

const publicEvents = events.filter((event) => event.type === "full-evaluation");
const feasible = publicEvents.filter((event) => event.feasible).length;
const promotionEvaluations = result.promotion?.evaluatedOnceAtEnd ? 1 : 0;
if (result.decision === "go") {
  assert(feasible > 0 && promotionEvaluations === 1 && result.promotion.quantityPass === true, "Q2.6-R go lacks conjunctive evidence");
} else if (result.selected === null) {
  assert(promotionEvaluations === 0, "Q2.6-R no-go opened promotion without public feasibility");
} else {
  assert(feasible > 0 && promotionEvaluations === 1 && result.promotion.quantityPass === false, "Q2.6-R promotion no-go is inconsistent");
}
assert(events.at(-1)?.type === "complete", "Q2.6-R terminal event is missing");

const sourcePaths = [
  "benchmarks/zero4-q26-v1/contract.json",
  "benchmarks/zero4-q26-v1/seed2/result.json",
  "benchmarks/zero4-q26-v1/seed2/selected.litq8",
  "benchmarks/zero4-q26r-v1/contract.json",
  `benchmarks/zero4-q26r-v1/seed${options.seed}/RESULTS.md`,
  `benchmarks/zero4-q26r-v1/seed${options.seed}/result.json`,
  `benchmarks/zero4-q26r-v1/seed${options.seed}/optimizer-attempts.jsonl`,
  `benchmarks/zero4-q26r-v1/seed${options.seed}/events.jsonl`,
  "scripts/check_zero4_q26.mjs",
  "scripts/check_zero4_q26r.mjs",
  "scripts/train_zero4_q26.mjs",
  "scripts/aggregate_zero4_q26r.mjs",
];
if (result.decision === "go") sourcePaths.push(`benchmarks/zero4-q26r-v1/seed${options.seed}/selected.litq8`);
console.log(JSON.stringify({
  metrics: {
    replication_seed: options.seed,
    seed_passed: result.decision === "go" ? 1 : 0,
    optimizer_attempts: result.attempts,
    committed_updates: result.committed,
    rejected_outer_attempts: rejected.length,
    full_scale_commits: fullScaleCommits,
    backtracked_commits: backtrackedCommits,
    trial_evaluations: trials.length,
    max_trials_used: maxTrialsUsed,
    min_accepted_scale: minAcceptedScale,
    warning_trial_exceedances: warningTrialExceedances,
    hard_trial_exceedances: hardTrialExceedances,
    max_trial_replay_increase: maxTrialIncrease,
    max_committed_replay_increase: maxCommittedIncrease,
    projected_trials: projected.length,
    projected_commits: accepted.filter((attempt) => attempt.projection_applied).length,
    unprojected_trials: trials.length - projected.length,
    max_projection_removed_fraction: maxRemovedFraction,
    mean_projection_removed_fraction: meanRemovedFraction,
    max_projection_pre_dot: maxPreDot,
    max_absolute_projection_post_dot: maxAbsolutePostDot,
    public_checkpoint_count: publicEvents.length,
    jointly_feasible_checkpoint_count: feasible,
    promotion_evaluations: promotionEvaluations,
  },
  source: {
    repository: options.repository,
    commit: options.commit,
    artifacts: sourcePaths.map((relative) => sourceArtifact(options.repo, relative)),
  },
}));

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) throw new Error(`invalid argument ${argv[index] ?? "<missing>"}`);
    values.set(argv[index].slice(2), argv[index + 1]);
  }
  for (const key of ["repo", "repository", "commit", "git", "make", "node", "harness-sha256", "seed"]) if (!values.has(key)) throw new Error(`--${key} is required`);
  return { repo: fs.realpathSync(path.resolve(values.get("repo"))), repository: values.get("repository"), commit: values.get("commit"), git: values.get("git"), make: values.get("make"), node: values.get("node"), harnessSha256: values.get("harness-sha256"), seed: Number(values.get("seed")) };
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
  if (command(git, ["-C", repo, "status", "--porcelain"]).trim()) throw new Error("repository must be clean before prospective Q2.6-R execution");
}
function verifyTrackedSource(repo, commit, git) {
  const head = command(git, ["-C", repo, "rev-parse", "HEAD"]).trim();
  if (head !== commit) throw new Error(`repository commit mismatch: ${head} != ${commit}`);
  const diff = spawnSync(git, ["-C", repo, "diff", "--quiet", "--exit-code"], { env: {} });
  if (diff.error) throw diff.error;
  if (diff.status !== 0) throw new Error("tracked source changed during Q2.6-R execution");
}
