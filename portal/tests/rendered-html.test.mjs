import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function request(path = "/", init = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, init),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the interactive public ilXyr protocol index", async () => {
  const response = await request("/", { headers: { accept: "text/html" } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("strict-transport-security"), "max-age=31536000");
  assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  assert.match(response.headers.get("permissions-policy") ?? "", /camera=\(\)/);
  assert.match(response.headers.get("cache-control") ?? "", /s-maxage=300/);

  const html = await response.text();
  assert.match(html, /<title>ilXyr — Evidence before execution<\/title>/i);
  assert.match(html, /Evidence before/);
  assert.match(html, /each research claim has a test with rules set in advance/i);
  assert.match(html, /This snapshot/);
  assert.match(html, /The evidence shapes the next question/);
  assert.doesNotMatch(html, /keeps research work clear/i);
  assert.match(html, /Explore the system/);
  assert.match(html, /Read the/);
  assert.match(html, /public data/);
  assert.match(html, /zero5-c43-v1/);
  assert.match(html, /zero5-c52-targetbridge-v1/);
  assert.match(html, /Registry as of.*2026-09-01/);
  assert.match(html, /DATED SNAPSHOT/);
  assert.match(html, /<code>\/api\/status<\/code>/);
  assert.match(html, /<code>\/api\/protocols<\/code>/);
  assert.match(html, /<code>\/api\/experiments<\/code>/);
  assert.match(html, /<code>\/api\/environments<\/code>/);
  assert.match(html, /<code>\/api\/results<\/code>/);
  assert.match(html, /<code>\/\.well-known\/ilxyr.json<\/code>/);
  assert.match(html, /Clear stages/);
  assert.match(html, /cloud.launcher.diagnostic.v1/);
  assert.match(html, /Source reported.*success.*score.*0.82/);
  assert.match(html, /ZERO.4 promoted quantity line/);
  assert.match(html, /Compute approval happens inside ilXyr/);
  assert.match(html, /The reporting API is complete in the source code/);
  assert.match(html, /Public rollout will add TLS/);
  assert.match(html, /remote-package-verify/);
  assert.match(html, /remote-aws-preflight/);
  assert.match(html, /remote-aws-launch/);
  assert.match(html, /remote-report-accept/);
  assert.doesNotMatch(html, /\/api\/proposals|proposal database/i);
});

test("public API returns only static protocol data", async () => {
  const expectedSchemas = new Map([
    ["/api", "ilxyr.public_api_index.v1"],
    ["/api/status", "ilxyr.public_status.v2"],
    ["/api/protocols", "ilxyr.public_protocol_index.v1"],
    ["/api/experiments", "ilxyr.public_experiment_index.v2"],
    ["/api/environments", "ilxyr.public_environment_index.v2"],
    ["/api/results", "ilxyr.public_result_index.v2"],
    ["/.well-known/ilxyr.json", "ilxyr.discovery.v1"],
  ]);

  for (const [path, schema] of expectedSchemas) {
    const response = await request(path, { headers: { accept: "application/json" } });
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i, path);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff", path);
    const body = await response.json();
    assert.equal(body.schema, schema, path);
    assert.doesNotMatch(JSON.stringify(body), /owner_id|reviewer_id|proposal_id|authenticated-user/i);
  }

  for (const path of expectedSchemas.keys()) {
    const writeResponse = await request(path, { method: "POST" });
    assert.equal(writeResponse.status, 405, path);
    assert.equal(writeResponse.headers.get("allow"), "GET, HEAD", path);
    assert.equal(await writeResponse.text(), "", path);
  }

  const headResponse = await request("/api/status", { method: "HEAD" });
  assert.equal(headResponse.status, 200);
  assert.equal(await headResponse.text(), "");

  const discoveryResponse = await request("/.well-known/ilxyr.json");
  const discovery = await discoveryResponse.json();
  assert.equal(discovery.reporting.status, "not_available");
  assert.equal(discovery.reporting.endpoint, null);

  const statusResponse = await request("/api/status");
  const status = await statusResponse.json();
  assert.equal(status.source.as_of, "2026-09-01");
  assert.equal(status.freshness, "stale");
  assert.ok(status.status.some((item) => item.key === "active_experiment" && item.value === "none"));
  assert.ok(status.source_health.some((item) => item.id === "permaweb-discovery" && item.status === "not_checked"));

  const environmentResponse = await request("/api/environments");
  const environmentIndex = await environmentResponse.json();
  assert.equal(environmentIndex.environments[0].state, "reference_candidate");
  assert.equal(environmentIndex.environments[0].compatibility, "not_yet_verified");
  assert.equal(environmentIndex.environments[0].manifest_ref, null);

  const resultsResponse = await request("/api/results");
  const results = await resultsResponse.json();
  assert.equal(results.results.length, 1);
  assert.equal(results.results[0].experiment_id, "cloud.launcher.diagnostic.v1");
  assert.equal(results.results[0].outcome, "success");
  assert.equal(results.results[0].score, 0.82);
  assert.equal(results.results[0].verification_state, "source_reported_acceptance");
  assert.equal(results.results[0].ledger_binding, "not_checked");

  const experimentsResponse = await request("/api/experiments");
  const experimentIndex = await experimentsResponse.json();
  assert.equal(experimentIndex.experiments.length, 12);
  assert.ok(experimentIndex.experiments.some((item) => item.scientific_outcome === "no_go"));
  assert.ok(experimentIndex.experiments.some((item) => item.disclosure_state === "withheld"));
  assert.ok(experimentIndex.experiments.some((item) => item.execution_state === "blocked"));

  const imageOptimizerResponse = await request("/_vinext/image?url=%2Fog.png&w=640&q=75");
  assert.equal(imageOptimizerResponse.status, 404);
});

test("public deployment is interactive without adding private state", async () => {
  const [page, portal, layout, styles, hosting, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ProtocolPortal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /publicRoutes/);
  assert.match(portal, /useState/);
  assert.match(portal, /fetch\(activeRoute/);
  assert.match(portal, /Use these endpoints to read public JSON/);
  assert.match(layout, /const title = "ilXyr — Evidence before execution"/);
  assert.match(styles, /\.api-console/);
  assert.match(hosting, /"d1": null/);
  assert.doesNotMatch(packageJson, /drizzle|database|ilxyr-lab-portal/);

  await Promise.all([
    assert.rejects(access(new URL("../app/api/proposals/route.ts", import.meta.url))),
    assert.rejects(access(new URL("../db/index.ts", import.meta.url))),
    assert.rejects(access(new URL("../drizzle", import.meta.url))),
  ]);
});
