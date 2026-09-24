import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import luaparse from "luaparse";
import { validateIndex } from "../scripts/index-lib.mjs";

const source = await readFile(new URL("../ao/ilxyr-registry.lua", import.meta.url), "utf8");

test("AO registry process parses as Lua 5.3", () => {
  assert.doesNotThrow(() => luaparse.parse(source, { luaVersion: "5.3" }));
});

test("AO registry process contains every guarded lifecycle action", () => {
  for (const action of ["Propose", "Review", "Address-Review", "Resolve-Review", "Promote", "Forecast", "Fund", "Publish-Evidence", "Index-Snapshot", "Set-Index-Tx"]) {
    assert.match(source, new RegExp(`hasMatchingTag\\(\"Action\", \"${action}\"\\)`));
  }
  assert.match(source, /A proposer cannot review their own contract/);
  assert.match(source, /Only the original reviewer can resolve this feedback/);
  assert.match(source, /The proposer cannot forecast their own experiment/);
  assert.match(source, /Index sequence must advance by exactly one/);
});

test("AO registry keeps published evidence immutable and emits complete index metadata", () => {
  assert.match(source, /if Evidence\[data\.experiment_id\] then return fail\(msg, "This experiment already has evidence\. It cannot be replaced"\) end/);
  assert.match(source, /generated_at = data\.generated_at/);
  assert.match(source, /if msg\.From ~= RegistryOwner then return fail\(msg, "Only the registry owner can make this change"\) end/);
});

test("AO transitions reject malformed entries and emit a validator-clean successor", () => {
  const lua = ["lua5.3", "lua", "texlua"].find((name) => spawnSync(name, ["-v"], { encoding: "utf8" }).status === 0);
  assert.ok(lua, "Lua 5.3 runtime is required for AO state-transition tests");
  const harness = fileURLToPath(new URL("./ao-index-contract.lua", import.meta.url));
  const processFile = fileURLToPath(new URL("../ao/ilxyr-registry.lua", import.meta.url));
  const snapshots = JSON.parse(execFileSync(lua, [harness, processFile], { encoding: "utf8" }));
  assert.equal(snapshots.length, 2);
  for (const snapshot of snapshots) assert.deepEqual(validateIndex(snapshot), []);
});

test("AO revisions bind reviews to exact predecessors and require fresh review", () => {
  const lua = ["lua5.3", "lua", "texlua"].find((name) => spawnSync(name, ["-v"], { encoding: "utf8" }).status === 0);
  assert.ok(lua, "Lua 5.3 runtime is required for AO state-transition tests");
  const harness = fileURLToPath(new URL("./ao-proposal-revisions.lua", import.meta.url));
  const processFile = fileURLToPath(new URL("../ao/ilxyr-registry.lua", import.meta.url));
  assert.equal(execFileSync(lua, [harness, processFile], { encoding: "utf8" }), "ok");
});
