import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const approved = "I5Z-EnOhkasZjtaMu9IbSVK3duWSecQpZ0lnKFEjjRg";
const indexTx = "X".repeat(43);
const bundleTx = "C".repeat(43);
const claimedBundleOwner = "B".repeat(43);
const actualBundleOwner = "E".repeat(43);
const experimentId = "test.index-owner";
const evidenceRef = `artifact://sha256/${"a".repeat(64)}`;
const index = { schema: "ilxyr.index.v1", sequence: 1, previous_index_tx: null,
  ledger_head: "", published_by: `arweave://${approved}`, generated_at: "2026-09-24T00:00:00Z",
  experiments: [{ experiment_id: experimentId, bundle_tx: bundleTx, evidence_ref: evidenceRef,
    outcome: "no_go", owner: claimedBundleOwner }] };
const manifest = { schema: "ilxyr.publication-manifest.v1", experiment_id: experimentId,
  evidence_ref: evidenceRef, files: [] };

function metadata(id, owner) {
  return { id, owner: { address: owner }, tags: [], block: { height: 1, timestamp: 1 } };
}

test("index publisher and bundle owner need independent gateway metadata", async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, appType: "custom" });
  const oldFetch = globalThis.fetch;
  const oldDocument = globalThis.document;
  try {
    const { config } = await server.ssrLoadModule("/src/config.ts");
    const { loadCanonicalIndex, loadRegistry } = await server.ssrLoadModule("/src/arweave.ts");
    const { recordTrust } = await server.ssrLoadModule("/src/trust.ts");
    config.indexTx = indexTx;
    config.seedTransactions = [];
    globalThis.document = { baseURI: "https://example.test/" };
    let indexOwner = approved;
    let bundleOwner = claimedBundleOwner;
    let missingIndex = false;
    let missingBundle = false;
    let gatewayRows = [];
    globalThis.fetch = async (url, options = {}) => {
      if (url.endsWith(`/${indexTx}`) || url.endsWith("/ilxyr-index-v1.json")) return Response.json(index);
      if (url.endsWith(`/${bundleTx}`)) return Response.json(manifest);
      if (url.endsWith("/graphql")) {
        const request = JSON.parse(options.body);
        const id = request.variables?.id;
        if (!id) return Response.json({ data: { transactions: { pageInfo: { hasNextPage: false }, edges: gatewayRows.map((node) => ({ node, cursor: node.id })) } } });
        return Response.json({ data: { transaction: (id === indexTx && missingIndex) || (id === bundleTx && missingBundle) ? null
          : metadata(id, id === indexTx ? indexOwner : bundleOwner) } });
      }
      throw new Error(`unexpected request ${url}`);
    };

    let [record] = await loadCanonicalIndex();
    assert.equal(record.publisherAuthentication, "pass");
    assert.equal(record.publisherListed, true);
    assert.equal(record.bundleOwnerAuthentication, "pass");
    assert.equal(recordTrust(record, {}).publisherAllowlist, "pass");

    gatewayRows = [{ ...metadata("Z".repeat(43), approved), tags: [
      { name: "Experiment-Id", value: experimentId }, { name: "Evidence-Ref", value: evidenceRef },
    ] }];
    let [resolved] = (await loadRegistry()).records;
    assert.equal(resolved.source, "canonical-index");
    assert.match(resolved.provenanceError, /Gateway record conflicts/);
    gatewayRows = [];

    indexOwner = "D".repeat(43);
    bundleOwner = actualBundleOwner;
    [record] = await loadCanonicalIndex();
    assert.equal(record.publisherAuthentication, "fail");
    assert.equal(record.publisherListed, false);
    assert.equal(record.bundleOwnerAuthentication, "fail");
    assert.equal(record.owner, actualBundleOwner);
    assert.match(record.provenanceError, /Index publisher differs/);
    assert.match(record.provenanceError, /Bundle owner differs/);
    assert.equal(recordTrust(record, {}).publisherAllowlist, "unknown");

    missingBundle = true;
    [record] = await loadCanonicalIndex();
    assert.equal(record.bundleOwnerAuthentication, "unknown");
    missingBundle = false;

    missingIndex = true;
    [record] = await loadCanonicalIndex();
    assert.equal(record.publisherAuthentication, "unknown");
    assert.equal(record.publisherListed, false);

    config.indexTx = "";
    [record] = await loadCanonicalIndex();
    assert.equal(record.publisherAuthentication, "not_checked");
    assert.match(record.provenanceError, /Bundled local index/);

    config.indexTx = indexTx;
    missingIndex = false;
    gatewayRows = [{ ...metadata(bundleTx, approved), tags: [
      { name: "Experiment-Id", value: experimentId }, { name: "Evidence-Ref", value: evidenceRef },
    ] }];
    [resolved] = (await loadRegistry()).records;
    assert.equal(resolved.source, "gateway");
    assert.equal(resolved.publisherAuthentication, "pass");
    assert.match(resolved.provenanceError, /Index publisher differs/);
  } finally {
    globalThis.fetch = oldFetch;
    globalThis.document = oldDocument;
    await server.close();
  }
});
