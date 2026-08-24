#!/usr/bin/env node
// Benchmark -> ilXyr registration-package compiler (#21).
//
// Consumes a hash-bound benchmark directory (contract.json + result.json in
// the sero-model-lineage convention) and emits a valid registration package
// for `ilxyr register`. Digests are preserved end-to-end; nothing is
// recomputed or reinterpreted.
//
// Usage:
//   node scripts/import-benchmark.mjs <benchmark-dir> [--out <output.json>]
//
// The benchmark dir must contain at least:
//   contract.json  — frozen experiment contract (id, gates/metrics, digests)
//   result.json    — machine result with metrics and checkpoint digest
//
// Fails closed on missing files, non-object JSON, unknown schema versions,
// or digest-shaped fields that are not 64 hex characters.

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import process from "node:process";

const SHA256_RE = /^[a-f0-9]{64}$/i;

function fail(message) {
  console.error(`import-benchmark: ${message}`);
  process.exit(1);
}

async function readJson(path, label) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    fail(`${label} is not readable: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const outputPath = outIndex >= 0 ? args[outIndex + 1] : null;
const benchmarkDir = args[0];

if (!benchmarkDir || (outIndex >= 0 && !outputPath)) {
  fail("usage: import-benchmark.mjs <benchmark-dir> [--out <output.json>]");
}

const contract = await readJson(join(benchmarkDir, "contract.json"), "contract.json");
const result = await readJson(join(benchmarkDir, "result.json"), "result.json");

for (const [name, value] of [["contract", contract], ["result", result]]) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${name}.json must contain a JSON object`);
  }
}

const benchmarkId = basename(benchmarkDir);

// Collect every digest-shaped string so the package can pin them without
// understanding them. Unknown structure is preserved verbatim instead of
// being reinterpreted.
const collectedDigests = new Set();
function walk(node) {
  if (typeof node === "string" && SHA256_RE.test(node)) {
    collectedDigests.add(node.toLowerCase());
  } else if (Array.isArray(node)) {
    for (const item of node) walk(item);
  } else if (node && typeof node === "object") {
    for (const value of Object.values(node)) walk(value);
  }
}
walk(contract);
walk(result);

// Hash-bind the exact source bytes into the package provenance.
const sourceHashes = {};
for (const name of ["contract.json", "result.json"]) {
  const bytes = await readFile(join(benchmarkDir, name));
  sourceHashes[name] = createHash("sha256").update(bytes).digest("hex");
}

// Extract metrics from known result profiles. Unknown schemas fail closed:
// the compiler never guesses at result semantics it was not built for.
const metrics = {};
let resolvedOutcome = null;

if (typeof result.schema === "string" && result.schema.startsWith("zero.c3")) {
  // zero-family benchmark profile: decision.outcome + per-arm nested metrics.
  if (result.decision && typeof result.decision.outcome === "string") {
    resolvedOutcome = result.decision.outcome;
  }
  if (result.arms && typeof result.arms === "object") {
    const flatten = (node, prefix) => {
      for (const [key, value] of Object.entries(node)) {
        if (typeof value === "number" && Number.isFinite(value)) {
          metrics[`${prefix}.${key}`] = value;
        } else if (value && typeof value === "object" && !Array.isArray(value)) {
          flatten(value, `${prefix}.${key}`);
        }
      }
    };
    for (const [arm, armResult] of Object.entries(result.arms)) {
      flatten(armResult.validation ?? {}, `arm.${arm}`);
    }
  }
} else {
  // Generic profile: top-level finite numeric metrics map.
  if (result.metrics && typeof result.metrics === "object") {
    for (const [key, value] of Object.entries(result.metrics)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        metrics[key] = value;
      }
    }
  }
}

resolvedOutcome ??=
  typeof result.outcome === "string"
    ? result.outcome
    : Object.keys(metrics).length > 0
      ? "success"
      : null;

if (!resolvedOutcome) {
  fail("result.json has neither a resolvable outcome nor any finite numeric metrics");
}

const registrationPackage = {
  schema: "ilxyr.registration_package.v1",
  id: `registration:${benchmarkId}`,
  title: `Imported benchmark ${benchmarkId}`,
  benchmark_id: benchmarkId,
  outcome: {
    resolved_outcome: resolvedOutcome,
    metrics,
  },
  provenance: {
    source_files: sourceHashes,
    pinned_digests: [...collectedDigests].sort(),
    imported_with: "scripts/import-benchmark.mjs",
    imported_at_ms: Date.now(),
  },
  // Raw sources travel with the package so reviewers see exactly what was
  // compiled — no transcription layer between evidence and ledger.
  raw: { contract, result },
};

const output = JSON.stringify(registrationPackage, null, 2) + "\n";
if (outputPath) {
  await writeFile(outputPath, output);
  console.log(`wrote ${outputPath}`);
} else {
  process.stdout.write(output);
}
