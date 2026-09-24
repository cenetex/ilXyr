import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { verifyCoreProof } from "../src/core-proof.ts";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object" ? `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`
    : JSON.stringify(value);

function fixture() {
  const listing = { experimentId: "toy.core.1", outcome: "no_go" };
  const run = { schema: "ilxyr.run.v1", experiment_id: listing.experimentId, id: "run:toy.core.1" };
  const runJson = canonical(run);
  const runRef = `artifact://sha256/${hash(runJson)}`;
  const evidence = { schema: "ilxyr.evidence.v1", experiment_id: listing.experimentId,
    run_ref: runRef, resolved_outcome: listing.outcome };
  const evidenceJson = canonical(evidence);
  listing.evidenceRef = `artifact://sha256/${hash(evidenceJson)}`;
  const actor = { id: "core", kind: "service" };
  const firstUnsigned = { schema: "ilxyr.event.v1", event_type: "RunRecorded", aggregate_id: listing.experimentId,
    actor, artifact_ref: runRef, occurred_at_ms: 1780000000000, previous_event: null };
  const first = { ...firstUnsigned, artifact_ref: runRef, event_hash: hash(canonical(firstUnsigned)) };
  delete first.previous_event;
  const secondUnsigned = { ...firstUnsigned, event_type: "EvidenceRecorded", artifact_ref: listing.evidenceRef,
    occurred_at_ms: 1780000000001, previous_event: first.event_hash };
  const second = { ...secondUnsigned, event_hash: hash(canonical(secondUnsigned)) };
  const bundle = { schema: "ilxyr.evidence_bundle.v1", evidence_ref: listing.evidenceRef,
    evidence_event_hash: second.event_hash, ledger_head: second.event_hash,
    evidence, run_ref: runRef, run };
  const bundleJson = canonical(bundle);
  const proof = { schema: "ilxyr.evidence_ledger_proof.v1", bundle_sha256: hash(bundleJson),
    bundle_json: bundleJson, evidence_json: evidenceJson, run_json: runJson,
    evidence_ref: listing.evidenceRef, evidence_event_hash: second.event_hash,
    ledger_head: second.event_hash, events: [first, second] };
  return { listing, proof };
}

test("event inclusion and artifact bytes require a separate head for ledger binding", async () => {
  const { listing, proof } = fixture();
  const unanchored = await verifyCoreProof(proof, listing);
  assert.equal(unanchored.chain, "pass");
  assert.equal(unanchored.ledgerBinding, "unknown");
  assert.equal((await verifyCoreProof(proof, listing, proof.ledger_head)).ledgerBinding, "pass");
  await assert.rejects(verifyCoreProof(proof, listing, "a".repeat(64)), /retained ledger head differs/);
});

test("substitution, changed outcomes, damaged artifacts and broken chains fail", async () => {
  const { listing, proof } = fixture();
  await assert.rejects(verifyCoreProof(proof, { ...listing, experimentId: "other" }), /identity/);
  await assert.rejects(verifyCoreProof(proof, { ...listing, outcome: "go" }), /outcome/);
  await assert.rejects(verifyCoreProof({ ...proof, evidence_json: proof.evidence_json.replace("no_go", "go") }, listing), /digest/);
  await assert.rejects(verifyCoreProof({ ...proof, events: [proof.events[1]] }, listing), /chain structure/);
  await assert.rejects(verifyCoreProof({ ...proof, events: [{ ...proof.events[0], event_hash: "b".repeat(64) }, proof.events[1]] }, listing), /digest/);
  await assert.rejects(verifyCoreProof({ ...proof, ledger_head: "c".repeat(64) }, listing), /identity|head/);
});
