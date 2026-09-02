import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { checkResearchProfile, classifyRepresentationAudit } from "./research-profiles.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (path) => JSON.parse(await readFile(join(root, path), "utf8"));
const files = [
  "examples/feral-7b/transformers-base-profile.json",
  "examples/feral-7b/transformers-calibration-profile.json",
  "examples/diagnostics/exp-008-representation-audit.json",
  "examples/diagnostics/nsrl-p10m-representation-audit.json",
  "examples/diagnostics/reasoner-4-representation-audit.json",
];
const records = await Promise.all(files.map(readJson));
for (const record of records) await checkResearchProfile(record);

const freezeTransformersFixture = (source) => {
  const record = structuredClone(source);
  record.state = "frozen";
  record.unresolved = [];
  record.implementation.config_sha256 = "a".repeat(64);
  record.software.python = "3.12.9";
  record.environment.executor_environment_ref = "environment://test/synthetic";
  record.environment.image.digest = `sha256:${"b".repeat(64)}`;
  record.environment.hardware = {
    accelerator: "synthetic-test-device", count: 1, driver_version: "test-driver", runtime_version: "test-runtime",
  };
  record.runtime.device_map = "cuda:0";
  record.data.input_view_ref = `artifact://sha256/${"c".repeat(64)}`;
  record.data.input_view_sha256 = "c".repeat(64);
  record.data.chat_template_sha256 = "d".repeat(64);
  if (record.trainer) {
    record.trainer.optimizer = "adamw_torch";
    record.trainer.scheduler = "linear";
  }
  if (record.generation) record.generation.resolved_config_sha256 = "e".repeat(64);
  return record;
};
const frozenBase = freezeTransformersFixture(records[0]);
const frozenTraining = freezeTransformersFixture(records[1]);
await checkResearchProfile(frozenBase);
await checkResearchProfile(frozenTraining);

const rejectMutation = async (source, mutate, message) => {
  const record = structuredClone(source);
  mutate(record);
  await assert.rejects(checkResearchProfile(record), message);
};
await rejectMutation(records[1], (record) => { record.state = "frozen"; }, /schema failed/);
await rejectMutation(frozenTraining, (record) => { record.model.revision = "main"; }, /schema failed/);
await rejectMutation(frozenTraining, (record) => { record.software.python = ">=3.11"; }, /schema failed/);
await rejectMutation(frozenTraining, (record) => { record.model.repo_id = "wrong/model"; }, /handle must match/);
await rejectMutation(frozenTraining, (record) => { record.trainer.eval_on_start = false; }, /schema failed/);
await rejectMutation(frozenTraining, (record) => { record.execution_authorized = true; }, /schema failed/);
await rejectMutation(frozenTraining, (record) => { record.runtime.compile.enabled = true; }, /Compile state/);
await rejectMutation(frozenTraining, (record) => { record.runtime.cache_implementation = "dynamic"; }, /Cache state/);
await rejectMutation(frozenBase, (record) => { record.determinism.persistent_workers = true; }, /positive worker count/);
await rejectMutation(frozenBase, (record) => { record.adapter = frozenTraining.adapter; }, /schema failed/);
await rejectMutation(frozenBase, (record) => { record.generation.resolved_config_sha256 = null; }, /schema failed/);
await rejectMutation(frozenTraining, (record) => { record.data.input_view_sha256 = "f".repeat(64); }, /reference and digest/);

const audit = structuredClone(records[2]);
audit.state = "frozen";
audit.unresolved = [];
audit.execution_profile_ref = "profile://test/synthetic-probe";
audit.execution_profile_sha256 = "f".repeat(64);
audit.capture.implementation_ref = `artifact://sha256/${"a".repeat(64)}`;
audit.capture.implementation_sha256 = "a".repeat(64);
audit.probe.implementation_ref = `artifact://sha256/${"b".repeat(64)}`;
audit.probe.implementation_sha256 = "b".repeat(64);
audit.inputs.evaluation_splits[1].sha256 = "c".repeat(64);
audit.inputs.evaluation_splits[1].ref = `artifact://sha256/${"c".repeat(64)}`;
await checkResearchProfile(audit);

const atThreshold = Object.fromEntries(audit.metrics.map((metric) => [metric.name, metric.threshold]));
assert.equal((await classifyRepresentationAudit(audit, atThreshold)).outcome, "stable_signal");
assert.equal((await classifyRepresentationAudit(audit, {
  ...atThreshold, worst_operation_accuracy: 649999,
})).outcome, "localized_signal");
assert.equal((await classifyRepresentationAudit(audit, {
  ...atThreshold, cross_seed_prediction_agreement: 899999,
})).outcome, "localized_signal");
assert.equal((await classifyRepresentationAudit(audit, {
  ...atThreshold, overall_operation_accuracy: 799999,
})).outcome, "insufficient_signal");
assert.equal((await classifyRepresentationAudit(audit, {
  ...atThreshold, label_shuffle_accuracy: 300001,
})).outcome, "invalid_controls");
await assert.rejects(classifyRepresentationAudit(records[2], atThreshold), /requires a frozen/);
await assert.rejects(classifyRepresentationAudit(audit, {}), /finite measurement/);
await assert.rejects(classifyRepresentationAudit(audit, {
  ...atThreshold, overall_operation_accuracy: NaN,
}), /finite measurement/);
await assert.rejects(classifyRepresentationAudit(audit, {
  ...atThreshold, overall_operation_accuracy: 1000001,
}), /0 to 1000000/);
await assert.rejects(classifyRepresentationAudit(audit, {
  ...atThreshold, surprise_metric: 1,
}), /must be declared/);
await rejectMutation(audit, (record) => { record.metrics.push(record.metrics[0]); }, /must be unique/);
await rejectMutation(audit, (record) => { record.metrics[0].category = "group"; }, /required overall/);
await rejectMutation(audit, (record) => {
  record.inputs.evaluation_splits[0].sha256 = record.inputs.fit_split.sha256;
  record.inputs.evaluation_splits[0].ref = record.inputs.fit_split.ref;
}, /hashes must be unique/);
await rejectMutation(audit, (record) => { record.probe.implementation_sha256 = "d".repeat(64); }, /reference and digest/);
await rejectMutation(audit, (record) => { record.execution_profile_sha256 = null; }, /schema failed/);
await rejectMutation(audit, (record) => { record.inputs.evaluation_splits[0].ref = "artifact://pending/panel"; }, /resolve before freeze/);
await rejectMutation(audit, (record) => { record.invariants.source_model_updates = true; }, /schema failed/);
await rejectMutation(audit, (record) => { record.controls.label_shuffle.within_group = true; }, /schema failed/);
await rejectMutation(audit, (record) => { record.controls.random_projection.dimensions = [8193]; }, /must fit within/);
await rejectMutation(audit, (record) => { record.representations[0].artifact_ref = "artifact://test/features"; }, /both artifact identity/);

const cliDirectory = await mkdtemp(join(tmpdir(), "ilxyr-profile-cli-"));
try {
  const alias = join(cliDirectory, "profile-check.mjs");
  await symlink(join(root, "scripts/research-profiles.mjs"), alias);
  const output = execFileSync(process.execPath, [alias, join(root, files[0])], { encoding: "utf8" });
  assert.equal(JSON.parse(output).id, records[0].id);
} finally {
  await rm(cliDirectory, { recursive: true });
}

console.log("Validated five research drafts, three synthetic frozen fixtures, and diagnostic outcome and rejection checks.");
