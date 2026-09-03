import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import Ajv2020 from "ajv/dist/2020.js";

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const plan = read("examples/feral-7b/feral-7b-calibration-plan.json");
const schema = read("schemas/feral-calibration-plan.schema.json");
const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
assert.ok(validate(plan), JSON.stringify(validate.errors));
assert.equal(sha("examples/feral-7b/feral-7b-calibration-config.toml"), plan.inputs.config_sha256);
assert.equal(sha("examples/corpus/feral-7b-s3-materialization.json"), plan.inputs.receipt_sha256);
assert.equal(Math.ceil(plan.sample.population_examples * plan.sample.fraction), plan.sample.selected_examples);
assert.ok(plan.budget.hourly_compute_usd * plan.budget.max_instance_seconds / 3600 <= plan.budget.max_compute_usd);
for (const key of Object.keys(plan.approval).filter((key) => key.endsWith("_authorized"))) {
  const changed = structuredClone(plan);
  changed.approval[key] = true;
  assert.equal(validate(changed), false);
}
const receipt = read("examples/corpus/feral-7b-s3-materialization.json");
assert.equal(receipt.corpus_ref, plan.inputs.corpus_ref);
assert.equal(receipt.objects.length, 9);
assert.equal(receipt.objects.find((item) => item.path === "release.json").sha256, plan.inputs.manifest_sha256);
for (const file of ["package", "run-instance", "user-data"]) {
  const result = spawnSync("bash", ["-n", `scripts/aws/feral-7b-calibration-${file}.sh`], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

const temporary = mkdtempSync(join(tmpdir(), "feral-launch-test-"));
try {
  const marker = join(temporary, "aws-called");
  writeFileSync(join(temporary, "aws"), "#!/bin/bash\nprintf '%s\\n' \"$@\" > \"$FERAL_TEST_MARKER\"\nif [[ \" $* \" == *\" --dry-run \"* ]]; then echo DryRunOperation >&2; exit 255; fi\necho i-test\n", { mode: 0o755 });
  const env = {
    ...process.env,
    PATH: `${temporary}:${process.env.PATH}`,
    FERAL_TEST_MARKER: marker,
    FERAL_SUBNET_ID: "subnet-123abc",
    FERAL_SECURITY_GROUP_ID: "sg-123abc",
    FERAL_PACKAGE_SHA256: "a".repeat(64),
    FERAL_PACKAGE_KEY: `packages/${"a".repeat(64)}.tar.gz`,
    FERAL_PACKAGE_VERSION: "frozen-version",
    FERAL_ILXYR_COMMIT: "b".repeat(40),
    FERAL_PLAN_SHA256: "c".repeat(64),
    FERAL_CONFIG_SHA256: plan.inputs.config_sha256,
    FERAL_USER_DATA_SHA256: sha("scripts/aws/feral-7b-calibration-user-data.sh"),
    FERAL_RUN_ID: "20260902T000000Z",
    FERAL_LAUNCH_EPOCH: "1788307200",
  };
  const run = (mode, extra = {}) => spawnSync("bash", ["scripts/aws/feral-7b-calibration-run-instance.sh", mode], { env: { ...env, ...extra }, encoding: "utf8" });
  assert.equal(run("launch").status, 1);
  assert.equal(existsSync(marker), false);
  assert.equal(run("launch", { FERAL_APPROVAL_ID: "feral-7b-calibration-test", FERAL_APPROVED_PACKAGE_SHA256: "d".repeat(64), FERAL_APPROVED_MAX_USD: "7" }).status, 1);
  assert.equal(existsSync(marker), false);
  const dry = run("dry-run");
  assert.equal(dry.status, 0, dry.stderr);
  const fixedSubnetArgs = readFileSync(marker, "utf8");
  for (const value of ["--dry-run", "g6e.2xlarge", "ami-0d3378afe7683c867", "HttpTokens=required", "Encrypted=true", "terminate", "--network-interfaces", "SubnetId=subnet-123abc"]) assert.ok(fixedSubnetArgs.includes(value));
  const automatic = run("dry-run", { FERAL_SUBNET_ID: "auto" });
  assert.equal(automatic.status, 0, automatic.stderr);
  const automaticArgs = readFileSync(marker, "utf8");
  for (const value of ["--dry-run", "--security-group-ids", "sg-123abc"]) assert.ok(automaticArgs.includes(value));
  for (const value of ["--network-interfaces", "SubnetId="]) assert.equal(automaticArgs.includes(value), false);
  assert.equal(run("dry-run", { FERAL_SUBNET_ID: "automatic" }).status, 1);
  assert.equal(run("launch", { FERAL_APPROVAL_ID: "feral-7b-calibration-test", FERAL_APPROVED_PACKAGE_SHA256: "a".repeat(64), FERAL_APPROVED_MAX_USD: "7" }).status, 0);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
console.log("FERAL calibration bindings, budget, shell syntax, and launch approval checks passed.");
