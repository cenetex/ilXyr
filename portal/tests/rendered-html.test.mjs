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

test("server-renders the public ilXyr protocol index", async () => {
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
  assert.match(html, /<title>ilXyr — protocol index<\/title>/i);
  assert.match(html, /This public website is a read-only/);
  assert.match(html, /href="\/api\/status"/);
  assert.match(html, /href="\/api\/protocols"/);
  assert.match(html, /href="\/api\/experiments"/);
  assert.match(html, /href="\/api\/environments"/);
  assert.match(html, /href="\/api\/results"/);
  assert.match(html, /href="\/.well-known\/ilxyr.json"/);
  assert.match(html, /Known does not mean compatible/);
  assert.match(html, /No remote result has passed independent ilXyr verification/);
  assert.match(html, /There are no write or cloud-launch routes/);
  assert.match(html, /provider-neutral adapter boundary/);
  assert.match(html, /remote-package-verify/);
  assert.match(html, /remote-report-accept/);
  assert.doesNotMatch(html, /\/api\/proposals|proposal database/i);
});

test("public API returns only static protocol data", async () => {
  const expectedSchemas = new Map([
    ["/api", "ilxyr.public_api_index.v1"],
    ["/api/status", "ilxyr.public_status.v1"],
    ["/api/protocols", "ilxyr.public_protocol_index.v1"],
    ["/api/experiments", "ilxyr.public_experiment_index.v1"],
    ["/api/environments", "ilxyr.public_environment_index.v1"],
    ["/api/results", "ilxyr.public_verified_result_index.v1"],
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
  assert.ok(status.status.some((item) =>
    item.key === "provider_neutral_adapter_boundary" && item.value === "implemented_with_fake_node"
  ));
  assert.ok(status.status.some((item) =>
    item.key === "authenticated_network_report_intake" && item.value === "not_available"
  ));

  const environmentResponse = await request("/api/environments");
  const environmentIndex = await environmentResponse.json();
  assert.equal(environmentIndex.environments[0].state, "reference_candidate");
  assert.equal(environmentIndex.environments[0].compatibility, "not_yet_verified");
  assert.equal(environmentIndex.environments[0].manifest_ref, null);

  const resultsResponse = await request("/api/results");
  const results = await resultsResponse.json();
  assert.deepEqual(results.results, []);

  const imageOptimizerResponse = await request("/_vinext/image?url=%2Fog.png&w=640&q=75");
  assert.equal(imageOptimizerResponse.status, 404);
});

test("public deployment has no database or private proposal code", async () => {
  const [page, layout, styles, hosting, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /Public HTTP API/);
  assert.match(layout, /const title = "ilXyr — protocol index"/);
  assert.doesNotMatch(page, /className=/);
  assert.doesNotMatch(styles, /gradient|animation|box-shadow|border-radius/);
  assert.match(hosting, /"d1": null/);
  assert.doesNotMatch(packageJson, /drizzle|database|ilxyr-lab-portal/);

  await Promise.all([
    assert.rejects(access(new URL("../app/api/proposals/route.ts", import.meta.url))),
    assert.rejects(access(new URL("../db/index.ts", import.meta.url))),
    assert.rejects(access(new URL("../drizzle", import.meta.url))),
  ]);
});
