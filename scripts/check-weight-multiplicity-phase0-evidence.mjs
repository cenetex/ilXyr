#!/usr/bin/env node

import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDirectory = join(
  root,
  "experiments/weight-multiplicity/phase0",
);

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const fail = (message) => {
  throw new Error(message);
};

const checkRun = async (version) => {
  const summaryPath = join(evidenceDirectory, `frontier-v${version}-summary.json`);
  const compressedPath = join(evidenceDirectory, `frontier-v${version}.json.gz`);
  const summary = await readJson(summaryPath);
  const compressed = await readFile(compressedPath);
  const raw = gunzipSync(compressed);
  if (digest(compressed) !== summary.compressed_result_sha256)
    fail(`Version ${version} compressed digest mismatch`);
  if (digest(raw) !== summary.raw_result_sha256)
    fail(`Version ${version} raw digest mismatch`);
  const result = JSON.parse(raw);
  if (!result.binding || result.status === "running" || !result.completed_at)
    fail(`Version ${version} is not a completed binding result`);
  if (result.plan_sha256 !== summary.plan_sha256)
    fail(`Version ${version} plan digest mismatch`);
  if (result.oracle_executable_sha256 !== summary.oracle_executable_sha256)
    fail(`Version ${version} oracle digest mismatch`);
  if (result.cells.length !== summary.cells.total)
    fail(`Version ${version} cell count mismatch`);
  for (const status of ["pass", "incomplete_yield", "resource_fail"]) {
    const count = result.cells.filter((cell) => cell.status === status).length;
    if (count !== summary.cells[status])
      fail(`Version ${version} ${status} count mismatch`);
  }
  if (result.summary.oracle_attempts !== summary.oracle_attempts)
    fail(`Version ${version} attempt count mismatch`);
  if (result.summary.accepted_queries !== summary.accepted_queries)
    fail(`Version ${version} accepted-query count mismatch`);
  return { result, summary };
};

const version1 = await checkRun(1);
const version2 = await checkRun(2);

const planV1Bytes = await readFile(
  join(root, "examples/weight-multiplicity/phase0-frontier-plan.json"),
);
const planV2Path = join(
  root,
  "examples/weight-multiplicity/phase0-frontier-plan-v2.json",
);
const planV2Bytes = await readFile(planV2Path);
const planV2 = JSON.parse(planV2Bytes);
if (digest(planV1Bytes) !== version1.summary.plan_sha256)
  fail("Version 1 checked-in plan digest mismatch");
if (digest(planV2Bytes) !== version2.summary.plan_sha256)
  fail("Version 2 checked-in plan digest mismatch");
if (
  planV2.supersedes.plan_sha256 !== version1.summary.plan_sha256 ||
  planV2.supersedes.result_sha256 !== version1.summary.raw_result_sha256
)
  fail("Version 2 does not bind the sealed Version 1 predecessor");

const safeRectangle = version2.result.cells.filter(
  (cell) =>
    cell.cell.rank <=
      version2.summary.conservative_common_boundary.maximum_rank &&
    cell.cell.highest_weight_height <=
      version2.summary.conservative_common_boundary.maximum_highest_weight_height,
);
if (safeRectangle.some((cell) => cell.status === "resource_fail"))
  fail("Declared common boundary contains a resource failure");
const e8Height1 = version2.result.cells.find(
  (cell) => cell.cell.type === "E8" && cell.cell.highest_weight_height === 1,
);
if (e8Height1?.status !== "resource_fail")
  fail("Version 2 does not preserve the E8 height-1 boundary failure");
if (version2.result.parallelism.safe_parallel_workers !== 1)
  fail("Version 2 safe parallelism drifted from one worker");
if (
  version2.summary.decision !== "stop" ||
  version2.summary.phase_1.authorized ||
  version2.summary.phase_1.corpus_generated ||
  version2.summary.phase_1.models_trained
)
  fail("Phase 0 Stop or Phase 1 closure is not preserved");

process.stdout.write(
  `${JSON.stringify({
    status: "pass",
    sealed_runs: 2,
    verified_cells: version1.result.cells.length + version2.result.cells.length,
    v1_raw_sha256: version1.summary.raw_result_sha256,
    v2_raw_sha256: version2.summary.raw_result_sha256,
    decision: version2.summary.decision,
  })}\n`,
);
