import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildIndex, validateIndex, validateSuccessor } from "../scripts/index-lib.mjs";

const entries = JSON.parse(await readFile(new URL("../fixtures/index-entries.json", import.meta.url), "utf8"));
const publisher = "I5Z-EnOhkasZjtaMu9IbSVK3duWSecQpZ0lnKFEjjRg";

test("builds a deterministic canonical index", () => {
  const input = { sequence: 1, publisher, generatedAt: "2026-08-12T00:00:00.000Z", experiments: entries };
  const first = buildIndex(input);
  const second = buildIndex(input);
  assert.equal(first.sha256, second.sha256);
  assert.equal(first.index.schema, "ilxyr.index.v1");
  assert.deepEqual(validateIndex(first.index), []);
});

test("rejects duplicate experiment identities", () => {
  assert.throws(() => buildIndex({
    sequence: 1,
    publisher,
    generatedAt: "2026-08-12T00:00:00.000Z",
    experiments: [entries[0], { ...entries[0], bundle_tx: "A".repeat(43) }],
  }), /duplicate experiment_id/);
});

test("requires successors to preserve existing experiment entries", () => {
  const previous = buildIndex({ sequence: 1, publisher, generatedAt: "2026-08-12T00:00:00.000Z", experiments: entries }).index;
  const next = buildIndex({
    sequence: 2,
    previousIndexTx: "P".repeat(43),
    publisher,
    generatedAt: "2026-08-13T00:00:00.000Z",
    experiments: [{ ...entries[0], outcome: "go" }],
  }).index;
  assert.match(validateSuccessor(previous, next).join("\n"), /immutable experiment entry changed/);

  const removed = buildIndex({
    sequence: 2,
    previousIndexTx: "P".repeat(43),
    publisher,
    generatedAt: "2026-08-13T00:00:00.000Z",
    experiments: [],
  }).index;
  assert.match(validateSuccessor(previous, removed).join("\n"), /immutable experiment entry removed/);
});
