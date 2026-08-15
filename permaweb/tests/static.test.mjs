import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

test("build output is a gateway-portable static dApp", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>ilXyr — Permanent Experiment Registry<\/title>/);
  assert.match(html, /src="\.\/assets\//);
  assert.match(html, /href="\.\/assets\//);
  assert.doesNotMatch(html, /localhost|\/api\//);
  const files = await readdir(new URL("../dist/", import.meta.url));
  assert.ok(files.includes("og.png"));
  assert.ok(files.includes("manifest.webmanifest"));
  assert.ok(files.includes("ilxyr-index-v1.json"));
  const index = JSON.parse(await readFile(new URL("../dist/ilxyr-index-v1.json", import.meta.url), "utf8"));
  assert.equal(index.schema, "ilxyr.index.v1");
  assert.equal(index.sequence, 1);
  assert.equal(index.experiments.length, 7);
  assert.equal(index.experiments.filter((entry) => entry.outcome === "accepted").length, 2);
});
