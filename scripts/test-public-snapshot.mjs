import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSnapshotBytes, buildPublicSnapshot } from "./build-public-snapshot.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (path) => JSON.parse(await readFile(join(root, path), "utf8"));
const registryBytes = await readFile(join(root, "docs/lab-registry.json"));
const registry = JSON.parse(registryBytes.toString("utf8"));
const stored = await readJson("docs/public-snapshot-v1.json");
const inputs = {
  registry, registryBytes, registryCommit: stored.source.registry_commit,
  reportCommit: stored.results[0].source.match(/\/blob\/([a-f0-9]{40})\//)[1],
  generatedAt: stored.source.generated_at,
  acceptedReport: await readJson("experiments/cloud-launcher/diagnostic-v1/accepted-report.json"),
  executionReport: await readJson("experiments/cloud-launcher/diagnostic-v1/execution-report.json"),
  environment: await readJson("experiments/cloud-launcher/diagnostic-v1/environment.json"),
  profile: await readJson("executor/cenetex-public-v1/profile.json"),
};

assert.deepEqual(buildPublicSnapshot(inputs), stored);
assert.deepEqual(await readJson("portal/app/public-snapshot.json"), stored);
assert.equal(stored.freshness, Date.parse(stored.source.generated_at) > Date.parse(stored.source.stale_after) ? "stale" : "current_at_build");
assert.equal(stored.source.as_of, registry.as_of);
assert.ok(stored.experiments.some((item) => item.scientific_outcome === "no_go" && item.local_import_state === "pending_import"));
assert.ok(stored.experiments.some((item) => item.disclosure_state === "withheld" && item.scientific_outcome === "unknown"));
assert.ok(stored.experiments.some((item) => item.disclosure_state === "hash_only"));
assert.ok(stored.experiments.some((item) => item.execution_state === "blocked" && item.local_import_state === "not_started"));
assert.ok(stored.experiments.every((item) => item.ledger_binding === "not_checked"));

const changedRegistry = structuredClone(registry);
changedRegistry.experiments[0].outcome = "no_go";
const changed = buildPublicSnapshot({ ...inputs, registry: changedRegistry,
  registryBytes: Buffer.from(`${JSON.stringify(changedRegistry)}\n`) });
assert.notEqual(changed.source.registry_sha256, stored.source.registry_sha256);
assert.notDeepEqual(changed.experiments, stored.experiments);
assert.throws(() => assertSnapshotBytes(`${JSON.stringify(stored, null, 2)}\n`,
  `${JSON.stringify(changed, null, 2)}\n`), /snapshot is stale/);

const changedState = structuredClone(registry);
changedState.experiments.at(-1).state = "withheld";
const stateOutput = buildPublicSnapshot({ ...inputs, registry: changedState,
  registryBytes: Buffer.from(`${JSON.stringify(changedState)}\n`) });
assert.equal(stateOutput.experiments.at(-1).disclosure_state, "withheld");
assert.equal(stateOutput.experiments.at(-1).execution_state, "completed");
assert.notDeepEqual(stateOutput.experiments, stored.experiments);

const partial = buildPublicSnapshot({ ...inputs, permawebHealth: {
  scope: "configured-index-gateway-and-seeds", status: "partial",
  queriedAt: "2026-09-24T00:00:00Z",
  sources: [{ id: "canonical-index", status: "complete" },
    { id: "gateway", status: "partial", error: "page failed" }],
} });
assert.equal(partial.source_health[2].status, "partial");
assert.equal(partial.source_health[2].sources[1].error, "page failed");

const tamperedReport = structuredClone(inputs.acceptedReport);
tamperedReport.verified.run_ref = "artifact://sha256/" + "0".repeat(64);
assert.throws(() => buildPublicSnapshot({ ...inputs, acceptedReport: tamperedReport }), /source records disagree/);
console.log("Public snapshot source binding and state regressions passed.");
