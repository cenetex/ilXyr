import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const owner = "I5Z-EnOhkasZjtaMu9IbSVK3duWSecQpZ0lnKFEjjRg";
const evidenceRef = `artifact://sha256/${"a".repeat(64)}`;
const tx = (number) => String(number).padStart(43, "A");
const emptyIndex = { schema: "ilxyr.index.v1", sequence: 1, previous_index_tx: null,
  ledger_head: "", published_by: `arweave://${owner}`, generated_at: "2026-09-20T00:00:00Z", experiments: [] };

function node(number, tagged = true) {
  return { id: tx(number), owner: { address: owner }, block: { height: number, timestamp: 1780000000 + number },
    tags: tagged ? [{ name: "Experiment-Id", value: `test.${number}` },
      { name: "Evidence-Ref", value: evidenceRef }] : [] };
}

function page(nodes, hasNextPage, cursor = undefined) {
  return { data: { transactions: { pageInfo: { hasNextPage },
    edges: nodes.map((item, index) => ({ node: item, cursor: index === nodes.length - 1 && cursor !== undefined ? cursor : item.id })) } } };
}

test("registry pagination reports exact configured-source coverage and keeps partial results", async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, appType: "custom" });
  const oldFetch = globalThis.fetch;
  const oldDocument = globalThis.document;
  try {
    const { config } = await server.ssrLoadModule("/src/config.ts");
    const { loadRegistry, MAX_GATEWAY_PAGES } = await server.ssrLoadModule("/src/arweave.ts");
    config.indexTx = "";
    config.seedTransactions = [];
    globalThis.document = { baseURI: "https://example.test/" };
    let index = emptyIndex;
    let indexFailure = false;
    let pages = () => page([], false);
    let seedFailure = false;
    const afters = [];
    globalThis.fetch = async (url, options = {}) => {
      if (url.endsWith("/ilxyr-index-v1.json")) {
        if (indexFailure) return new Response(null, { status: 503 });
        return Response.json(index);
      }
      if (url.endsWith("/graphql")) {
        const request = JSON.parse(options.body);
        if (request.variables.id) return Response.json({ data: { transaction: seedFailure ? null : node(999) } });
        afters.push(request.variables.after);
        const result = pages(request.variables.after);
        return result instanceof Response ? result : Response.json(result);
      }
      const id = url.split("/").at(-1);
      return Response.json({ schema: "ilxyr.publication-manifest.v1", experiment_id: `test.${Number(id.replace(/^A+/, ""))}`,
        evidence_ref: evidenceRef, files: [] });
    };

    const firstPage = Array.from({ length: 100 }, (_, index) => node(index + 1));
    pages = (after) => after === null ? page(firstPage, true, "cursor-100") : page([node(101)], false);
    let found = await loadRegistry();
    assert.deepEqual(afters, [null, "cursor-100"]);
    assert.equal(found.status, "complete");
    assert.equal(found.records.length, 101);
    assert.equal(found.sources.find((source) => source.id === "gateway").scanned, 101);
    assert.equal(found.sources.find((source) => source.id === "canonical-index").indexedAt, emptyIndex.generated_at);

    indexFailure = true;
    pages = () => page([node(1)], false);
    found = await loadRegistry();
    assert.equal(found.status, "partial");
    assert.equal(found.records.length, 1);
    assert.equal(found.sources[0].status, "unavailable");
    assert.match(found.sources[0].error, /503/);

    indexFailure = false;
    pages = (after) => after === null ? page(firstPage, true, "cursor-100") : new Response(null, { status: 502 });
    found = await loadRegistry();
    assert.equal(found.status, "partial");
    assert.equal(found.records.length, 100);
    assert.equal(found.sources[1].continuation, "cursor-100");
    assert.match(found.sources[1].error, /502/);

    pages = (after) => after === null ? page(firstPage, true, "cursor-100") : page([node(101)], true, "cursor-100");
    found = await loadRegistry();
    assert.equal(found.records.length, 100);
    assert.match(found.sources[1].error, /repeated a cursor/);
    pages = (after) => after === null ? page(firstPage, true, "cursor-100") : page([node(101)], true, "");
    found = await loadRegistry();
    assert.equal(found.records.length, 100);
    assert.match(found.sources[1].error, /omitted a continuation cursor/);

    let capPage = 0;
    pages = () => page(Array.from({ length: 100 }, (_, index) => node(index + 1, false)), true, `cursor-${++capPage}`);
    found = await loadRegistry();
    assert.equal(found.status, "partial");
    assert.equal(found.sources[1].capReached, true);
    assert.equal(found.sources[1].scanned, MAX_GATEWAY_PAGES * 100);
    assert.equal(capPage, MAX_GATEWAY_PAGES);

    pages = () => page([], false);
    config.seedTransactions = [tx(999)];
    seedFailure = true;
    found = await loadRegistry();
    assert.equal(found.status, "partial");
    assert.equal(found.records.length, 0);
    assert.equal(found.sources[2].status, "unavailable");
    assert.match(found.sources[2].error, /was not indexed/);

    config.seedTransactions = [];
    seedFailure = false;
    found = await loadRegistry();
    assert.equal(found.status, "empty");
    assert.equal(found.records.length, 0);

    index = { ...emptyIndex, experiments: [{ experiment_id: "test.1", bundle_tx: tx(999),
      evidence_ref: evidenceRef, outcome: "no_go", owner }] };
    pages = () => page([node(1)], false);
    found = await loadRegistry();
    assert.equal(found.records.length, 1);
    assert.equal(found.observations.length, 2);
    assert.deepEqual(found.records[0].observedSources, ["canonical-index", "gateway"]);
    assert.equal(found.records[0].identityConflicts.length, 1);
  } finally {
    globalThis.fetch = oldFetch;
    globalThis.document = oldDocument;
    await server.close();
  }
});
