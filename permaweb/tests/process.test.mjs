import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import luaparse from "luaparse";

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
