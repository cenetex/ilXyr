import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderHomePage, renderProgramPage } from "./render-pages-snapshot.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const snapshot = JSON.parse(await readFile(join(root, "docs/public-snapshot-v1.json"), "utf8"));
const program = await readFile(join(root, "docs/program-registry.html"), "utf8");
const home = await readFile(join(root, "docs/index.html"), "utf8");

assert.equal(renderProgramPage(snapshot), program);
assert.equal(renderHomePage(home, snapshot), home);
assert.ok(program.includes(`source date ${snapshot.source.as_of}`));
assert.ok(program.includes(`Snapshot built ${snapshot.source.generated_at}`));
assert.match(program, /ZERO5-C5\.2-TARGETBRIDGE-AUX/);
assert.match(program, /Decision withheld/);
assert.match(program, /pending import/);
assert.match(program, /no go/);
assert.ok(home.includes(`source date ${snapshot.source.as_of}`));

const changed = structuredClone(snapshot);
changed.experiments[0].scientific_outcome = "no_go";
assert.notEqual(renderProgramPage(changed), program);
const changedStatus = structuredClone(snapshot);
changedStatus.experiments.at(-1).execution_state = "completed";
assert.notEqual(renderHomePage(home, changedStatus), home);
const changedDate = structuredClone(snapshot);
changedDate.source.as_of = new Date(Date.parse(`${snapshot.source.as_of}T00:00:00Z`) + 86400_000).toISOString().slice(0, 10);
assert.notEqual(renderProgramPage(changedDate), program);
assert.notEqual(renderHomePage(home, changedDate), home);
console.log("GitHub Pages source binding and state regressions passed.");
