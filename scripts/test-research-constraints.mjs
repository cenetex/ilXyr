import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, appendVerdicts, digest, encode, generateConstraintDiff, validateLedger, verifyLedgerBindings } from "./lib/research-constraints.mjs";

const read = (path) => JSON.parse(readFileSync(resolve(ROOT, path)));
const liveLedger = read("examples/constraints/negative-knowledge-ledger.v1.json");
assert(liveLedger.entries.length >= 18);
const ledger = { ...liveLedger, entries: liveLedger.entries.slice(0, 18) };
const original = structuredClone(ledger);
const bindings = verifyLedgerBindings(liveLedger);
assert.equal(bindings.length, liveLedger.entries.length);
assert(bindings.filter((row) => row.evidence_status === "local_digest_verified").length >= 8);

for (const project of ["reasoner", "solomon", "zero4", "feral", "weight-multiplicity"]) {
  const saved = read(`examples/constraints/research-step-5/${project}.json`);
  // These reports freeze the first eighteen entries. Future records extend the ledger.
  assert.deepEqual(generateConstraintDiff(ledger, saved.experiment_id, saved.proposed_mechanism_tags, {
    generatedAtMs: saved.generated_at_ms, proposedChange: saved.proposed_change,
  }), saved, `${project} design report differs from its bound ledger`);
}

for (const mutate of [
  (value) => { value.entries[1].seq = 0; },
  (value) => { value.entries[1].seq = 7; },
  (value) => { value.entries.reverse(); },
  (value) => { value.entries[1].verdict_id = value.entries[0].verdict_id; },
  (value) => { value.entries[0].supersedes_ref = value.entries[1].verdict_id; },
  (value) => { value.entries[0].outcome = "go"; },
]) {
  const changed = structuredClone(ledger);
  mutate(changed);
  assert.throws(() => validateLedger(changed));
}

const baseVerdict = read("examples/constraints/solomon.context-use-audit.v1.verdict.json");
const correction = { ...baseVerdict, id: "verdict:solomon.context-correction.test.v1",
  experiment_id: "solomon.context-correction.test.v1", supersedes_ref: baseVerdict.id,
  summary: "Corrected scope for the test fixture.", mechanism_tags: ["context-use"] };
const appended = appendVerdicts(ledger, [{ bytes: encode(correction) }]);
assert.deepEqual(ledger, original);
assert.deepEqual(appended.entries.slice(0, ledger.entries.length), original.entries);
assert.equal(appended.entries.at(-1).verdict_ref, `artifact://sha256/${digest(encode(correction))}`);
const report = generateConstraintDiff(appended, "solomon.next.v1", ["context-use"], {
  generatedAtMs: 1, proposedChange: "Use fresh documents and an integer bigram control.",
});
assert.equal(report.superseded_entries, 1);
assert.equal(report.matches.length, 1);
assert.equal(report.matches[0].verdict_id, correction.id);
assert.equal(report.matches[0].same_mechanism_tags, true);
assert.equal(report.recommendation, "review");
assert.equal(report.matches[0].evidence_ref, baseVerdict.evidence_ref);
assert.equal(report.ledger_ref, `artifact://sha256/${digest(encode(appended))}`);
assert.throws(() => appendVerdicts(appended, [{ bytes: encode(correction) }]));
assert.throws(() => appendVerdicts(appended, [{ bytes: encode({ ...correction, id: "verdict:second-correction" }) }]));
assert.throws(() => generateConstraintDiff(ledger, "next", ["context-use", "context-use"]));
assert.throws(() => generateConstraintDiff(ledger, "next", ["UPPER"]));
assert.throws(() => generateConstraintDiff(ledger, "", ["context-use"]));

const exact = generateConstraintDiff(ledger, "zero.q23.repeat", ["replay-guard", "local-budget", "quantity-gate"], { generatedAtMs: 1 });
assert(exact.matches.some((match) => match.same_mechanism_tags));
assert.equal(exact.recommendation, "review");
const subset = generateConstraintDiff(ledger, "zero.q23.subset", ["local-budget"], { generatedAtMs: 1 });
assert(subset.matches.every((match) => !match.same_mechanism_tags));
assert.equal(generateConstraintDiff(ledger, "new", ["newton-root-search"], { generatedAtMs: 1 }).recommendation, "proceed");
const semantic = generateConstraintDiff(ledger, "reasoner.next", ["semantic-transfer"], { generatedAtMs: 1 });
assert.equal(semantic.matches.length, 3);
assert.equal(semantic.taxonomy_counts.measurement, 2);
assert.equal(semantic.taxonomy_counts.transfer, 1);

const temporary = mkdtempSync(resolve(tmpdir(), "ilxyr-constraint-bindings-"));
try {
  const entry = structuredClone(ledger.entries.find((row) => row.verdict_id === baseVerdict.id));
  entry.seq = 0;
  const isolated = { ...ledger, entries: [entry] };
  const verdictPath = resolve(temporary, "examples/constraints/solomon.context-use-audit.v1.verdict.json");
  const evidencePath = resolve(temporary, baseVerdict.evidence_path);
  mkdirSync(dirname(verdictPath), { recursive: true });
  mkdirSync(dirname(evidencePath), { recursive: true });
  const verdictBytes = readFileSync(resolve(ROOT, "examples/constraints/solomon.context-use-audit.v1.verdict.json"));
  const evidenceBytes = readFileSync(resolve(ROOT, baseVerdict.evidence_path));
  writeFileSync(verdictPath, verdictBytes);
  writeFileSync(evidencePath, evidenceBytes);
  assert.equal(verifyLedgerBindings(isolated, { root: temporary })[0].evidence_status, "local_digest_verified");
  writeFileSync(evidencePath, "changed evidence");
  assert.throws(() => verifyLedgerBindings(isolated, { root: temporary }), /evidence digest differs/);
  writeFileSync(evidencePath, evidenceBytes);
  writeFileSync(verdictPath, encode({ ...baseVerdict, summary: "Changed verdict text." }));
  assert.throws(() => verifyLedgerBindings(isolated, { root: temporary }), /verdict field differs/);
  writeFileSync(verdictPath, verdictBytes);
  const changed = structuredClone(isolated);
  changed.entries[0].verdict_ref = `artifact://sha256/${"0".repeat(64)}`;
  assert.throws(() => verifyLedgerBindings(changed, { root: temporary }), /verdict digest differs/);
  const outside = { ...baseVerdict, evidence_path: "../outside.json" };
  delete isolated.entries[0].verdict_ref;
  delete isolated.entries[0].evidence_path;
  writeFileSync(verdictPath, encode(outside));
  assert.throws(() => verifyLedgerBindings(isolated, { root: temporary }));

  const output = resolve(temporary, "existing.json");
  writeFileSync(output, "preserved");
  const cli = spawnSync(process.execPath, [resolve(ROOT, "scripts/constraint-diff.mjs"),
    "--ledger", resolve(ROOT, "examples/constraints/negative-knowledge-ledger.v1.json"),
    "--experiment-id", "next", "--tags", "context-use", "--output", output], { encoding: "utf8" });
  assert.equal(cli.status, 1);
  assert.equal(readFileSync(output, "utf8"), "preserved");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

console.log("Constraint order, corrections, append history, evidence bindings, advisory matches, and CLI writes passed.");
