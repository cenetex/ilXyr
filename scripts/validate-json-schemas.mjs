import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemaDirectory = join(root, "schemas");

const fixtures = {
  "calibration-record.schema.json": ["examples/schema/calibration-record.json"],
  "condition.schema.json": ["examples/schema/condition.json"],
  "certificate.schema.json": ["examples/schema/certificate.json"],
  "claim-status.schema.json": ["examples/schema/claim-status.json"],
  "claim.schema.json": ["examples/schema/claim.json"],
  "claim-support.schema.json": [],
  "contribution.schema.json": [
    "examples/toy/hypothesis.json",
    "examples/toy/foundation.json",
    "examples/toy/engineering-review.json",
    "examples/toy/experiment-design.json",
  ],
  "epoch-budget.schema.json": ["examples/schema/epoch-budget.json"],
  "evidence-bundle.schema.json": ["examples/schema/evidence-bundle.json"],
  "evidence-graph-edge.schema.json": [
    "examples/schema/evidence-graph-edge.json",
  ],
  "evidence.schema.json": ["examples/schema/evidence.json"],
  "executor-attestation.schema.json": [
    "examples/schema/executor-attestation.json",
  ],
  "experiment.schema.json": ["examples/toy/experiment.json"],
  "external-registration-receipt.schema.json": [
    "examples/schema/external-registration-receipt.json",
  ],
  "family-manifest.schema.json": [
    "examples/experiments/zero-q26r/family.json",
  ],
  "forecast.schema.json": [
    "examples/toy/forecast-model.json",
    "examples/toy/forecast-human.json",
  ],
  "funding.schema.json": [
    "examples/toy/funding-a.json",
    "examples/toy/funding-b.json",
  ],
  "huggingface-model.schema.json": [
    "examples/schema/huggingface-model.json",
  ],
  "nsrl-gate-evidence.schema.json": [
    "examples/nsrl/p10m-v10-context-gate.json",
    "examples/nsrl/p10m-v10-generation-gate.json",
    "examples/nsrl/p10m-v10-integrity-gate.json",
    "examples/nsrl/p10m-v10-learning-gate.json",
    "examples/nsrl/p10m-v10-numeric-health-gate.json",
    "examples/nsrl/p10m-v10-provenance-gate.json",
    "examples/nsrl/p10m-v10-serving-gate.json",
  ],
  "nsrl-registration.schema.json": [
    "examples/nsrl/p10m-v10-registration.json",
  ],
  "paper-contract.schema.json": ["examples/schema/paper-contract.json"],
  "program-overview.schema.json": [],
  "replication-contract.schema.json": ["examples/schema/replication-contract.json"],
  "replication-settlement.schema.json": [
    "examples/schema/replication-settlement.json",
  ],
  "registration-package.schema.json": [
    "examples/schema/registration-package.json",
  ],
  "retro-registration.schema.json": [
    "examples/schema/retro-registration.json",
    "examples/families/solomon-successor-v2.retro.json",
    "examples/families/zero-q22r-multiseed.retro.json",
    "examples/families/zero-q22r-seed2.retro.json",
    "examples/families/zero-q23-seed2.retro.json",
  ],
  "sandbox-run.schema.json": ["examples/schema/sandbox-run.json"],
  "sandbox-spec.schema.json": ["examples/schema/sandbox-spec.json"],
  "shared-task.schema.json": ["examples/schema/shared-task.json"],
  "trusted-attestation-key.schema.json": [
    "examples/schema/trusted-attestation-key.json",
  ],
};

const readJson = async (relativePath) =>
  JSON.parse(await readFile(join(root, relativePath), "utf8"));

const schemaNames = (await readdir(schemaDirectory))
  .filter((name) => name.endsWith(".json"))
  .sort();
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validators = new Map();
const schemas = new Map();

for (const schemaName of schemaNames) {
  if (!fixtures[schemaName]) {
    throw new Error(`schema ${schemaName} has no positive fixture`);
  }
  const schema = await readJson(`schemas/${schemaName}`);
  schemas.set(schemaName, schema);
  ajv.addSchema(schema);
}

for (const [schemaName, schema] of schemas) {
  const validate = ajv.getSchema(schema.$id);
  if (!validate) {
    throw new Error(`schema ${schemaName} did not compile`);
  }
  validators.set(schemaName, validate);
}

let positiveCount = 0;
for (const [schemaName, fixturePaths] of Object.entries(fixtures)) {
  const validate = validators.get(schemaName);
  if (!validate) {
    throw new Error(`fixture mapping refers to missing schema ${schemaName}`);
  }
  for (const fixturePath of fixturePaths) {
    const value = await readJson(fixturePath);
    if (!validate(value)) {
      throw new Error(
        `${fixturePath} failed ${schemaName}: ${JSON.stringify(validate.errors)}`,
      );
    }
    positiveCount += 1;
  }
}

const expectInvalid = (schemaName, label, value) => {
  const validate = validators.get(schemaName);
  if (validate(value)) {
    throw new Error(`${label} unexpectedly passed ${schemaName}`);
  }
};

const modelContribution = await readJson("examples/toy/foundation.json");
delete modelContribution.actor.model_ref;
expectInvalid(
  "contribution.schema.json",
  "model contribution without model_ref",
  modelContribution,
);

const mismatchedActor = await readJson("examples/toy/engineering-review.json");
mismatchedActor.actor.id = "service://toy/not-a-human";
expectInvalid(
  "contribution.schema.json",
  "human actor with service identity",
  mismatchedActor,
);

const certificate = await readJson("examples/schema/certificate.json");
delete certificate.domain;
expectInvalid("certificate.schema.json", "certificate without domain", certificate);

const replication = await readJson("examples/schema/replication-contract.json");
delete replication.agreement_threshold;
expectInvalid(
  "replication-contract.schema.json",
  "combined replication without agreement threshold",
  replication,
);

const claimStatus = await readJson("examples/schema/claim-status.json");
claimStatus.spine_eligible = true;
expectInvalid(
  "claim-status.schema.json",
  "spine-eligible claim without risk and independent replication",
  claimStatus,
);

const unboundClaimStatus = await readJson("examples/schema/claim-status.json");
unboundClaimStatus.shared_task_bound = false;
expectInvalid(
  "claim-status.schema.json",
  "unbound status that retains a shared-task reference",
  unboundClaimStatus,
);

const evidence = await readJson("examples/schema/evidence.json");
delete evidence.authority;
expectInvalid("evidence.schema.json", "evidence without authority", evidence);

const evidenceBundle = await readJson("examples/schema/evidence-bundle.json");
evidenceBundle.cold_replayable = true;
expectInvalid(
  "evidence-bundle.schema.json",
  "cold-replayable bundle without retro evidence and source attestation",
  evidenceBundle,
);

const registrationReceipt = await readJson(
  "examples/schema/external-registration-receipt.json",
);
delete registrationReceipt.doi;
expectInvalid(
  "external-registration-receipt.schema.json",
  "public registration receipt without DOI",
  registrationReceipt,
);

const executorAttestation = await readJson(
  "examples/schema/executor-attestation.json",
);
executorAttestation.verified_key_ids = [];
expectInvalid(
  "executor-attestation.schema.json",
  "executor attestation without a verified key",
  executorAttestation,
);

const budget = await readJson("examples/schema/epoch-budget.json");
delete budget.per_executable_caps["/bin/echo"].network;
expectInvalid("epoch-budget.schema.json", "executable cap without network policy", budget);

const budgetWithoutArguments = await readJson("examples/schema/epoch-budget.json");
delete budgetWithoutArguments.per_executable_caps["/bin/echo"].allowed_argument_sets;
expectInvalid(
  "epoch-budget.schema.json",
  "executable cap without an argument allowlist",
  budgetWithoutArguments,
);

const sandboxSpec = await readJson("examples/schema/sandbox-spec.json");
sandboxSpec.authority.scope.seeds = [];
expectInvalid("sandbox-spec.schema.json", "sandbox authority without seeds", sandboxSpec);

const retro = await readJson("examples/schema/retro-registration.json");
retro.authority.level = "review";
expectInvalid(
  "retro-registration.schema.json",
  "retro-registration with review authority",
  retro,
);

const sharedTask = await readJson("examples/schema/shared-task.json");
sharedTask.family_bindings[1].family = "zero";
expectInvalid(
  "shared-task.schema.json",
  "shared task without both family bindings",
  sharedTask,
);

const huggingFaceModel = await readJson(
  "examples/schema/huggingface-model.json",
);
huggingFaceModel.revision = "main";
expectInvalid(
  "huggingface-model.schema.json",
  "Hugging Face model with mutable revision",
  huggingFaceModel,
);

const nsrlRegistration = await readJson(
  "examples/nsrl/p10m-v10-registration.json",
);
nsrlRegistration.checkpoint.source.commit = "main";
expectInvalid(
  "nsrl-registration.schema.json",
  "NSRL checkpoint with mutable source revision",
  nsrlRegistration,
);

const nsrlGate = await readJson(
  "examples/nsrl/p10m-v10-generation-gate.json",
);
nsrlGate.outcome = "unopened";
expectInvalid(
  "nsrl-gate-evidence.schema.json",
  "NSRL gate evidence with an unsettled outcome",
  nsrlGate,
);

console.log(
  `Validated ${schemaNames.length} Draft 2020-12 schemas, ${positiveCount} positive fixtures, and 18 rejection fixtures.`,
);
