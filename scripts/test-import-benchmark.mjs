#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = await mkdtemp(join(tmpdir(), "ilxyr-import-benchmark-"));

try {
  const benchmark = join(temporaryRoot, "zero5-c43-v1");
  await mkdir(benchmark);
  await writeFile(join(benchmark, "contract.json"), JSON.stringify({
    schema: "zero.c43_experiment_contract.v1",
    experiment: "zero5-c43-v1",
    frozen_digest: "a".repeat(64),
  }));
  await writeFile(join(benchmark, "result.json"), JSON.stringify({
    schema: "zero.c43_public_result.v1",
    experiment: "zero5-c43-v1",
    status: "complete-no-go",
    training: { completed_updates: 28707 },
    validation: {
      candidate: {
        combined_nats_per_token: 2.0105,
        choice: { retrieval: { choice_accuracy: 0.537586548 } },
      },
    },
    decision: { outcome: "no-go", eligible_for_promotion: false },
  }));

  const outputPath = join(temporaryRoot, "record.json");
  const success = spawnSync(process.execPath, [
    join(root, "scripts/import-benchmark.mjs"),
    benchmark,
    "--out",
    outputPath,
  ], { encoding: "utf8" });
  assert.equal(success.status, 0, success.stderr);
  const record = JSON.parse(await readFile(outputPath, "utf8"));
  assert.equal(record.schema, "ilxyr.upstream_benchmark.v1");
  assert.equal(record.outcome.resolved_outcome, "no-go");
  assert.equal(record.outcome.metrics["training.completed_updates"], 28707);
  assert.equal(
    record.outcome.metrics["validation.candidate.choice.retrieval.choice_accuracy"],
    0.537586548,
  );

  const unknown = join(temporaryRoot, "unknown-zero-result");
  await mkdir(unknown);
  await writeFile(join(unknown, "contract.json"), JSON.stringify({ id: "unknown" }));
  await writeFile(join(unknown, "result.json"), JSON.stringify({
    schema: "zero.unknown.v1",
    metrics: { score: 1 },
  }));
  const rejected = spawnSync(process.execPath, [
    join(root, "scripts/import-benchmark.mjs"),
    unknown,
  ], { encoding: "utf8" });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /unsupported ZERO result schema/);

  console.log("Validated ZERO C4.3 import and fail-closed unknown-schema handling.");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
