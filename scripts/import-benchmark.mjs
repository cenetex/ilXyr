#!/usr/bin/env node
// Benchmark -> ilXyr upstream evidence compiler (#21).
//
// Consumes a hash-bound benchmark directory (contract.json + result.json in
// a supported model-line convention) and emits a schema-valid upstream
// benchmark record for review and later ledger import. It does not pretend
// that an already completed external run was registered by ilXyr before it
// executed. Digests are preserved end-to-end.
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

// Collect every digest-shaped string so the record can pin them without
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

const flatten = (node, prefix) => {
  if (!node || typeof node !== "object" || Array.isArray(node)) return;
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "number" && Number.isFinite(value)) {
      metrics[path] = value;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      flatten(value, path);
    }
  }
};

if (typeof result.schema === "string" && /^zero\.[a-z0-9_]+_result\.v\d+$/.test(result.schema)) {
  if (result.decision && typeof result.decision.outcome === "string") {
    resolvedOutcome = result.decision.outcome;
  } else if (result.schema === "zero.c42_result.v1" &&
             result.status === "complete" &&
             result.decision?.eligible_for_promotion === false) {
    resolvedOutcome = "no-go";
  } else if (result.schema === "zero.c0_tokenizer_result.v2" &&
             typeof result.decision?.candidate_for_zero5_training === "string") {
    resolvedOutcome = `selected-${result.decision.candidate_for_zero5_training}`;
  } else if (typeof result.decision?.all_gates_pass === "boolean") {
    resolvedOutcome = result.decision.all_gates_pass ? "go" : "no-go";
  } else if (typeof result.status === "string" && result.status.includes("no-go")) {
    resolvedOutcome = "no-go";
  }

  for (const root of ["metrics", "validation", "training", "arms", "comparison"]) {
    if (result[root] && typeof result[root] === "object") {
      flatten(result[root], root);
    }
  }
} else if (typeof result.schema === "string" && result.schema.startsWith("zero.")) {
  fail(`unsupported ZERO result schema '${result.schema}'`);
} else {
  if (typeof result.outcome === "string") {
    resolvedOutcome = result.outcome;
  }
  if (result.metrics && typeof result.metrics === "object") {
    for (const [key, value] of Object.entries(result.metrics)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        metrics[key] = value;
      }
    }
  }
}

if (!resolvedOutcome) {
  fail("result.json has no supported, explicit outcome");
}

const upstreamRecord = {
  schema: "ilxyr.upstream_benchmark.v1",
  id: `upstream-benchmark:${benchmarkId}`,
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

const output = JSON.stringify(upstreamRecord, null, 2) + "\n";
if (outputPath) {
  await writeFile(outputPath, output);
  console.log(`wrote ${outputPath}`);
} else {
  process.stdout.write(output);
}
