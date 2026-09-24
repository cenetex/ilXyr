import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { verifyBundle } from "../scripts/verify-bundle.mjs";
import { bindManifest, checkFileResponse, MAX_FILE_BYTES, publicationUrl, readBounded, validateCanonicalIndex, validateManifest } from "../src/publication.ts";

const txId = "A".repeat(43);
const evidenceRef = `artifact://sha256/${"a".repeat(64)}`;
const content = Buffer.from("source evidence\n");
const file = { path: "results/source.json", bytes: content.length, media_type: "application/json",
  sha256: createHash("sha256").update(content).digest("hex") };
const manifest = { schema: "ilxyr.publication-manifest.v1", experiment_id: "test.experiment",
  evidence_ref: evidenceRef, files: [file] };
const gateway = "https://example.test";

function fetcher(view, body = content, status = 200) {
  return async (url) => {
    if (url === publicationUrl(gateway, txId)) return Response.json(view);
    if (url === publicationUrl(gateway, txId, file.path)) return new Response(body, { status });
    throw new Error(`unexpected URL ${url}`);
  };
}

test("browser and CLI accept the same bounded publication and exact bytes", async () => {
  const valid = validateManifest(manifest);
  assert.deepEqual(bindManifest(valid, manifest.experiment_id, evidenceRef), [file]);
  const browser = await checkFileResponse(new Response(content), file);
  const cli = await verifyBundle(txId, gateway, fetcher(manifest));
  assert.equal(browser.verified, true);
  assert.equal(cli.failed, 0);
  assert.equal(cli.files[0].status, "verified");
});

test("path normalization and malformed fields are rejected before URL construction", () => {
  for (const path of ["../secret", "./source", "/absolute", "x//y", "x\\y", "x/%2e%2e/y", "x/%2f/y", "x?y", "x#y"]) {
    assert.throws(() => publicationUrl(gateway, txId, path), /Invalid publication/);
    assert.throws(() => validateManifest({ ...manifest, files: [{ ...file, path }] }), /Invalid or duplicate/);
  }
  assert.throws(() => validateManifest({ ...manifest, schema: "unknown" }), /Unsupported/);
  assert.throws(() => validateManifest({ ...manifest, files: [file, file] }), /duplicate/);
  assert.throws(() => validateManifest({ ...manifest, files: [{ ...file, bytes: NaN }] }), /byte count/);
  assert.throws(() => validateManifest({ ...manifest, files: [{ ...file, sha256: file.sha256.toUpperCase() }] }), /SHA-256/);
  assert.throws(() => validateManifest({ ...manifest, files: [{ ...file, media_type: "bad type" }] }), /media type/);
  assert.throws(() => bindManifest(manifest, "other.experiment", evidenceRef), /identity differs/);
});

test("digest, byte count, missing file and oversized response remain distinct", async () => {
  const changed = Buffer.from("source evidencf\n");
  assert.equal((await checkFileResponse(new Response(changed), file)).reason, "hash");
  assert.equal((await checkFileResponse(new Response(content.subarray(0, -1)), file)).reason, "size");
  assert.equal((await verifyBundle(txId, gateway, fetcher(manifest, changed))).files[0].status, "hash");
  assert.equal((await verifyBundle(txId, gateway, fetcher(manifest, content.subarray(0, -1)))).files[0].status, "size");
  assert.equal((await verifyBundle(txId, gateway, fetcher(manifest, content, 404))).files[0].status, "failed");
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(5)); controller.close(); } });
  await assert.rejects(readBounded(new Response(stream), 4), /byte limit/);
  const largeHeader = new Response(content, { headers: { "content-length": String(MAX_FILE_BYTES + 1) } });
  await assert.rejects(checkFileResponse(largeHeader, file), /byte limit/);
  const oversizedFetch = async (url) => url === publicationUrl(gateway, txId) ? Response.json(manifest)
    : new Response(content, { headers: { "content-length": String(MAX_FILE_BYTES + 1) } });
  assert.equal((await verifyBundle(txId, gateway, oversizedFetch)).files[0].status, "failed");
  const malformed = { ...manifest, files: [{ ...file, path: "../secret" }] };
  await assert.rejects(verifyBundle(txId, gateway, fetcher(malformed)), /Invalid or duplicate/);
});

test("canonical listing fields are validated before hydration", async () => {
  const index = { schema: "ilxyr.index.v1", sequence: 1, previous_index_tx: null, ledger_head: "",
    published_by: `arweave://${txId}`, generated_at: "2026-09-24T00:00:00Z",
    experiments: [{ experiment_id: manifest.experiment_id, bundle_tx: txId, evidence_ref: evidenceRef, outcome: "no_go" }] };
  assert.equal(validateCanonicalIndex(index).experiments.length, 1);
  assert.throws(() => validateCanonicalIndex({ ...index, experiments: [...index.experiments, ...index.experiments] }), /duplicate/);
  assert.throws(() => validateCanonicalIndex({ ...index, experiments: [{ ...index.experiments[0], bundle_tx: "../bad" }] }), /entry/);
  const published = JSON.parse(await readFile(new URL("../public/ilxyr-index-v1.json", import.meta.url), "utf8"));
  assert.equal(validateCanonicalIndex(published).experiments.length, 7);
});

test("a published legacy manifest keeps its file list with reported metadata", async () => {
  const raw = await readFile(new URL("./fixtures/public-legacy-manifest.json", import.meta.url), "utf8");
  const published = validateManifest(JSON.parse(raw));
  assert.equal(published.schema, "lecore.qwen35-publication-manifest.v1");
  assert.equal(published.files.length, 60);
  assert.equal(published.ledger_verification.valid, true);
  assert.equal(published.resolved_outcome, "execution_failure");
});

test("record hydration keeps bound identity and renders a manifest failure", async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, appType: "custom" });
  const originalFetch = globalThis.fetch;
  try {
    const { hydrateRecord } = await server.ssrLoadModule("/src/arweave.ts");
    const { RecordDetail } = await server.ssrLoadModule("/src/App.tsx");
    const record = { txId, owner: txId, publisherListed: true, experimentId: manifest.experiment_id,
      evidenceRef, title: "Fixture", outcome: "no_go", files: [], source: "canonical-index" };
    globalThis.fetch = async () => Response.json({ ...manifest, experiment_id: "other.experiment" });
    const changed = await hydrateRecord(record);
    assert.equal(changed.experimentId, record.experimentId);
    assert.deepEqual(changed.files, []);
    assert.match(changed.manifestError, /identity differs/);
    const html = renderToStaticMarkup(React.createElement(RecordDetail, { record: changed, onClose() {} }));
    assert.match(html, /Publication manifest: Manifest identity differs/);
    globalThis.fetch = async () => Response.json(manifest);
    const valid = await hydrateRecord(record);
    assert.equal(valid.files.length, 1);
    assert.equal(valid.manifestError, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    await server.close();
  }
});
