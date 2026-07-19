import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemaDirectory = join(root, "schemas");

const fixtures = {
  "calibration-record.schema.json": ["examples/schema/calibration-record.json"],
  "certificate.schema.json": ["examples/schema/certificate.json"],
  "contribution.schema.json": [
    "examples/toy/hypothesis.json",
    "examples/toy/foundation.json",
    "examples/toy/engineering-review.json",
    "examples/toy/experiment-design.json",
  ],
  "epoch-budget.schema.json": ["examples/schema/epoch-budget.json"],
  "evidence.schema.json": ["examples/schema/evidence.json"],
  "experiment.schema.json": ["examples/toy/experiment.json"],
  "forecast.schema.json": [
    "examples/toy/forecast-model.json",
    "examples/toy/forecast-human.json",
  ],
  "funding.schema.json": [
    "examples/toy/funding-a.json",
    "examples/toy/funding-b.json",
  ],
  "replication-contract.schema.json": ["examples/schema/replication-contract.json"],
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
};

const readJson = async (relativePath) =>
  JSON.parse(await readFile(join(root, relativePath), "utf8"));

const schemaNames = (await readdir(schemaDirectory))
  .filter((name) => name.endsWith(".json"))
  .sort();
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validators = new Map();

for (const schemaName of schemaNames) {
  if (!fixtures[schemaName]) {
    throw new Error(`schema ${schemaName} has no positive fixture`);
  }
  const schema = await readJson(`schemas/${schemaName}`);
  validators.set(schemaName, ajv.compile(schema));
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

const evidence = await readJson("examples/schema/evidence.json");
delete evidence.authority;
expectInvalid("evidence.schema.json", "evidence without authority", evidence);

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

console.log(
  `Validated ${schemaNames.length} Draft 2020-12 schemas, ${positiveCount} positive fixtures, and 10 rejection fixtures.`,
);
