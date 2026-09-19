import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const encode = (value) => `${JSON.stringify(value, null, 2)}\n`;
const ajv = new Ajv2020({ strict: true, allErrors: true });
const validators = {};
for (const [kind, name] of Object.entries({ verdict: "verdict", ledger: "negative-knowledge-ledger", report: "constraint-diff-report" }))
  validators[kind] = ajv.compile(JSON.parse(readFileSync(resolve(ROOT, `schemas/${name}.schema.json`))));

export function validate(kind, value) {
  const check = validators[kind];
  assert(check, "unknown constraint object kind");
  assert(check(value), `${kind} schema: ${ajv.errorsText(check.errors)}`);
  return value;
}

export function validateLedger(ledger) {
  validate("ledger", ledger);
  const seen = new Set();
  const replaced = new Set();
  for (const [index, entry] of ledger.entries.entries()) {
    assert.equal(entry.seq, index, "ledger sequence must be contiguous and ordered");
    assert(!seen.has(entry.verdict_id), "duplicate verdict identity");
    if (entry.supersedes_ref) {
      assert(seen.has(entry.supersedes_ref), "correction must refer to an earlier verdict");
      assert(!replaced.has(entry.supersedes_ref), "correction must follow the latest correction");
      replaced.add(entry.supersedes_ref);
    }
    seen.add(entry.verdict_id);
  }
  return { replaced, active: ledger.entries.filter((entry) => !replaced.has(entry.verdict_id)) };
}

const containedFile = (root, name) => {
  assert(typeof name === "string" && !isAbsolute(name), "evidence path must be relative");
  const file = realpathSync(resolve(root, name));
  const rel = relative(realpathSync(root), file);
  assert(rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), "evidence path escapes its root");
  return file;
};

export function verifyLedgerBindings(ledger, { root = ROOT, verdictDirectory = "examples/constraints" } = {}) {
  validateLedger(ledger);
  const verified = [];
  for (const entry of ledger.entries) {
    const name = `${entry.verdict_id.slice("verdict:".length)}.verdict.json`;
    const bytes = readFileSync(containedFile(resolve(root, verdictDirectory), name));
    const verdict = validate("verdict", JSON.parse(bytes));
    assert.equal(verdict.id, entry.verdict_id, "verdict identity differs");
    for (const key of ["experiment_id", "family", "seed", "outcome", "taxonomy", "mechanism_tags", "summary", "recorded_at_ms",
      "project", "evidence_kind", "source_outcome", "supersedes_ref", "lineage_note", "evidence_path", "evidence_ref"]) {
      // Original entries predate these optional bindings; check each declared field.
      if (key in entry) assert.deepEqual(verdict[key], entry[key], `verdict field differs: ${key}`);
    }
    if (entry.verdict_ref) assert.equal(entry.verdict_ref, `artifact://sha256/${digest(bytes)}`, "verdict digest differs");
    let evidenceStatus = "reference_only";
    if (verdict.evidence_path) {
      const evidence = readFileSync(containedFile(root, verdict.evidence_path));
      assert.equal(verdict.evidence_ref, `artifact://sha256/${digest(evidence)}`, "evidence digest differs");
      evidenceStatus = "local_digest_verified";
    }
    verified.push({ verdict_id: verdict.id, evidence_status: evidenceStatus });
  }
  return verified;
}

export function appendVerdicts(ledger, records) {
  validateLedger(ledger);
  assert(Array.isArray(records) && records.length > 0, "append needs verdict records");
  const next = structuredClone(ledger);
  for (const { bytes } of records) {
    const verdict = validate("verdict", JSON.parse(bytes));
    const entry = { seq: next.entries.length, verdict_id: verdict.id,
      verdict_ref: `artifact://sha256/${digest(bytes)}` };
    for (const key of ["experiment_id", "family", "seed", "outcome", "taxonomy", "mechanism_tags", "summary", "recorded_at_ms",
      "project", "evidence_kind", "source_outcome", "supersedes_ref", "lineage_note", "evidence_path", "evidence_ref"])
      if (key in verdict) entry[key] = structuredClone(verdict[key]);
    next.entries.push(entry);
  }
  validateLedger(next);
  assert.deepEqual(next.entries.slice(0, ledger.entries.length), ledger.entries, "append changed earlier records");
  return next;
}

export function generateConstraintDiff(ledger, experimentId, proposedTags, { generatedAtMs = Date.now(), proposedChange } = {}) {
  const { active, replaced } = validateLedger(ledger);
  assert(typeof experimentId === "string" && /^[A-Za-z0-9._:/-]+$/.test(experimentId), "invalid experiment identity");
  assert(Array.isArray(proposedTags) && proposedTags.length > 0, "proposed tags are required");
  assert.equal(new Set(proposedTags).size, proposedTags.length, "duplicate proposed tag");
  assert(proposedTags.every((tag) => typeof tag === "string" && /^[a-z][a-z0-9_-]*$/.test(tag)), "invalid proposed tag");
  const proposed = new Set(proposedTags);
  const matches = [];
  const taxonomyCounts = Object.fromEntries(["transfer", "interference", "measurement", "venue", "implementation"].map((key) => [key, 0]));
  for (const entry of active) {
    const matchedTags = entry.mechanism_tags.filter((tag) => proposed.has(tag));
    if (!matchedTags.length) continue;
    const match = { verdict_id: entry.verdict_id, experiment_id: entry.experiment_id,
      family: entry.family, outcome: entry.outcome, taxonomy: entry.taxonomy,
      matched_tags: matchedTags, verdict_summary: entry.summary,
      same_mechanism_tags: matchedTags.length === proposedTags.length && matchedTags.length === entry.mechanism_tags.length };
    for (const key of ["seed", "project", "evidence_kind", "source_outcome", "lineage_note", "verdict_ref", "evidence_ref", "evidence_path"])
      if (key in entry) match[key] = structuredClone(entry[key]);
    matches.push(match);
    taxonomyCounts[entry.taxonomy] += 1;
  }
  return validate("report", {
    schema: "ilxyr.constraint_diff_report.v1", report_id: `constraint-diff:${experimentId}`,
    experiment_id: experimentId, ledger_id: ledger.ledger_id,
    ledger_ref: `artifact://sha256/${digest(encode(ledger))}`, generated_at_ms: generatedAtMs,
    proposed_mechanism_tags: [...proposedTags], matches, taxonomy_counts: taxonomyCounts,
    superseded_entries: replaced.size, ...(proposedChange ? { proposed_change: proposedChange } : {}),
    summary: matches.length ? `${matches.length} prior results share these mechanism tags. Review their evidence and the required design changes.`
      : "This mechanism has an open evidence gap in the current ledger.",
    recommendation: matches.length ? "review" : "proceed",
  });
}
