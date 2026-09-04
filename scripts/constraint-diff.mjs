#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Design-time constraint-diff tool.
//
// Reads the negative-knowledge ledger and a proposed experiment's mechanism_tags,
// then produces a constraint-diff report that surfaces repeated failure patterns
// before the run starts — e.g. "this would be the 9th transfer failure".
//
// Usage:
//   node scripts/constraint-diff.mjs --ledger <path> --experiment-id <id> --tags tag1,tag2,...
//   node scripts/constraint-diff.mjs --self-test

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
}

function writeJson(obj, rel) {
  const out = path.join(root, rel);
  fs.writeFileSync(out, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

/**
 * Generate a constraint-diff report by matching proposed_mechanism_tags against
 * every entry in the negative-knowledge ledger.
 *
 * @param {object} ledger   - parsed negative-knowledge-ledger.v1 JSON
 * @param {string} experimentId
 * @param {string[]} proposedTags
 * @returns {object} constraint-diff-report.v1 JSON
 */
export function generateConstraintDiff(ledger, experimentId, proposedTags) {
  if (ledger.schema !== "ilxyr.negative_knowledge_ledger.v1") {
    throw new Error(`expected ilxyr.negative_knowledge_ledger.v1, got ${ledger.schema}`);
  }
  if (!Array.isArray(proposedTags) || proposedTags.length < 1) {
    throw new Error("proposed_mechanism_tags must be a non-empty array");
  }
  for (const tag of proposedTags) {
    if (!/^[a-z][a-z0-9_-]*$/.test(tag)) {
      throw new Error(`invalid mechanism_tag: '${tag}'`);
    }
  }

  const proposedSet = new Set(proposedTags);
  const matches = [];
  const taxonomyCounts = {
    transfer: 0,
    interference: 0,
    measurement: 0,
    venue: 0,
    implementation: 0,
  };

  for (const entry of ledger.entries) {
    const matchedTags = entry.mechanism_tags.filter((t) => proposedSet.has(t));
    if (matchedTags.length === 0) continue;

    taxonomyCounts[entry.taxonomy] += 1;

    matches.push({
      verdict_id: entry.verdict_id,
      experiment_id: entry.experiment_id,
      family: entry.family,
      ...(entry.seed !== undefined ? { seed: entry.seed } : {}),
      outcome: entry.outcome,
      taxonomy: entry.taxonomy,
      matched_tags: matchedTags,
      verdict_summary: entry.summary ?? "",
    });
  }

  // Determine recommendation
  let recommendation;
  if (matches.length === 0) {
    recommendation = "proceed";
  } else {
    // Check if any match shares ALL proposed tags (exact mechanism repetition)
    const exactRepeats = matches.filter(
      (m) => m.matched_tags.length === proposedTags.length,
    );
    recommendation = exactRepeats.length > 0 ? "blocked" : "review";
  }

  // Build summary
  const parts = [];
  if (matches.length === 0) {
    parts.push(
      "No registered negative-knowledge ledger entries share mechanism tags with this experiment.",
    );
  } else {
    const taxonomyEntries = Object.entries(taxonomyCounts).filter(
      ([, n]) => n > 0,
    );
    for (const [tax, n] of taxonomyEntries) {
      parts.push(`${n} prior ${tax} result${n > 1 ? "s" : ""}`);
    }
    parts.push(
      `match${matches.length > 1 ? "" : "es"} the proposed mechanism tags.`,
    );
  }

  return {
    schema: "ilxyr.constraint_diff_report.v1",
    report_id: `constraint-diff:${experimentId}`,
    experiment_id: experimentId,
    ledger_id: ledger.ledger_id,
    generated_at_ms: Date.now(),
    proposed_mechanism_tags: proposedTags,
    matches,
    taxonomy_counts: taxonomyCounts,
    summary: parts.join(" "),
    recommendation,
  };
}

// --- CLI / self-test ---

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ledger") args.ledger = argv[++i];
    else if (a === "--experiment-id") args.experimentId = argv[++i];
    else if (a === "--tags") args.tags = argv[++i].split(",");
    else if (a === "--output") args.output = argv[++i];
    else if (a === "--self-test") args.selfTest = true;
  }
  return args;
}

function selfTest() {
  const ledger = readJson("examples/constraints/negative-knowledge-ledger.v1.json");
  let pass = 0;

  // Test 1: proposed tags that match several replay-guard verdicts -> review
  const report1 = generateConstraintDiff(
    ledger,
    "zero.q27.seed2.permutation-guard.v1",
    ["replay-guard", "cumulative", "permutation", "quantity-gate"],
  );
  if (report1.recommendation !== "review")
    throw new Error(`expected review, got ${report1.recommendation}`);
  if (report1.matches.length !== 3)
    throw new Error(`expected 3 matches, got ${report1.matches.length}`);
  if (report1.taxonomy_counts.transfer !== 1)
    throw new Error(`expected 1 transfer, got ${report1.taxonomy_counts.transfer}`);
  if (report1.taxonomy_counts.interference !== 2)
    throw new Error(`expected 2 interference, got ${report1.taxonomy_counts.interference}`);
  pass++;

  // Test 2: novel tags with no matches -> proceed
  const report2 = generateConstraintDiff(
    ledger,
    "solomon.q30-newton-root-search.v1",
    ["newton-root-search", "symbolic-algebra"],
  );
  if (report2.recommendation !== "proceed")
    throw new Error(`expected proceed, got ${report2.recommendation}`);
  if (report2.matches.length !== 0)
    throw new Error(`expected 0 matches, got ${report2.matches.length}`);
  pass++;

  // Test 3: exact tag repeat -> blocked
  const report3 = generateConstraintDiff(
    ledger,
    "zero.q23-repeat.v1",
    ["replay-guard", "local-budget", "quantity-gate"],
  );
  if (report3.recommendation !== "blocked")
    throw new Error(`expected blocked, got ${report3.recommendation}`);
  if (report3.matches.length < 1)
    throw new Error(`expected at least 1 match, got ${report3.matches.length}`);
  pass++;

  // Test 4: nll-guard matches
  const report4 = generateConstraintDiff(
    ledger,
    "solomon.nsrl-repeat.v1",
    ["output-head-search", "nll-guard"],
  );
  if (report4.matches.length < 3)
    throw new Error(`expected at least 3 nll-guard matches, got ${report4.matches.length}`);
  pass++;

  console.log(`constraint-diff self-test: ${pass} tests passed.`);
}

const args = parseArgs(process.argv);

if (args.selfTest) {
  selfTest();
  process.exit(0);
}

if (!args.ledger || !args.experimentId || !args.tags) {
  console.error(
    "Usage: node scripts/constraint-diff.mjs --ledger <path> --experiment-id <id> --tags tag1,tag2,... [--output <path>] [--self-test]",
  );
  process.exit(1);
}

const ledger = JSON.parse(fs.readFileSync(args.ledger, "utf8"));
const report = generateConstraintDiff(ledger, args.experimentId, args.tags);

if (args.output) {
  fs.writeFileSync(args.output, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`Wrote constraint-diff report to ${args.output}`);
} else {
  console.log(JSON.stringify(report, null, 2));
}
