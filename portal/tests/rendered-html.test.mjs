import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
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

test("server-renders the ilXyr protocol index", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>ilXyr — protocol index<\/title>/i);
  assert.match(html, /This website is an index/);
  assert.match(html, /GET \/api\/proposals/);
  assert.match(html, /Command line API/);
  assert.match(html, /Cloud executor protocol \(not implemented\)/);
  assert.match(html, /normal frontier and a presized-memory audit/);
  assert.match(html, /Experimental protocols and results/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("keeps the site plain and declares durable storage", async () => {
  const [page, layout, styles, hosting, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /HTTP API/);
  assert.match(layout, /const title = "ilXyr — protocol index"/);
  assert.doesNotMatch(page, /className=/);
  assert.doesNotMatch(styles, /gradient|animation|box-shadow|border-radius/);
  assert.match(hosting, /"d1": "DB"/);
  assert.match(packageJson, /"name": "ilxyr-lab-portal"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});
