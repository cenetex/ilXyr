import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemaFiles = {
  "ilxyr.transformers_execution_profile.v1": "transformers-execution-profile.schema.json",
  "ilxyr.representation_audit.v1": "representation-audit.schema.json",
};
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
let validators;

const getValidators = () => {
  validators ??= Promise.all(
    Object.entries(schemaFiles).map(async ([name, file]) => {
      const schema = JSON.parse(await readFile(join(root, "schemas", file), "utf8"));
      const ajv = new Ajv2020({ allErrors: true, strict: true });
      return [name, ajv.compile(schema)];
    }),
  ).then((entries) => new Map(entries));
  return validators;
};

const unique = (values, label) => {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must be unique`);
  }
};

const exactRef = (value, label) => {
  if (value?.startsWith("artifact://pending/")) {
    throw new Error(`${label} must resolve before freeze`);
  }
};

const boundDigest = (ref, sha256, label) => {
  const match = ref?.match(/^(?:artifact|blob):\/\/sha256\/([a-f0-9]{64})$/);
  if (match && sha256 !== null && match[1] !== sha256) {
    throw new Error(`${label} reference and digest must agree`);
  }
};

export const checkResearchProfile = async (record) => {
  const validate = (await getValidators()).get(record?.schema);
  if (!validate) throw new Error("Select a supported research profile schema");
  if (!validate(record)) {
    throw new Error(`Profile schema failed: ${JSON.stringify(validate.errors)}`);
  }

  if (record.schema === "ilxyr.transformers_execution_profile.v1") {
    const expected = `weight://huggingface/${record.model.repo_id}@${record.model.revision}`;
    if (record.model.weight_ref !== expected) {
      throw new Error("The model handle must match its repository and revision");
    }
    const runtime = record.runtime;
    if (runtime.compile.enabled !== (runtime.compile.backend !== null)) {
      throw new Error("Compile state and backend must agree");
    }
    if (runtime.use_cache === (runtime.cache_implementation === "disabled")) {
      throw new Error("Cache state and implementation must agree");
    }
    if (record.determinism.dataloader_workers === 0 && record.determinism.persistent_workers) {
      throw new Error("Persistent data-loader workers require a positive worker count");
    }
    const declaredSplits = new Set([record.data.train_split, record.data.validation_split]);
    if (record.sample.splits.some((split) => !declaredSplits.has(split))) {
      throw new Error("Every sampled split must be declared by the profile");
    }
    boundDigest(record.data.input_view_ref, record.data.input_view_sha256, "The input view");
    if (record.state === "frozen") {
      exactRef(record.data.input_view_ref, "The input view");
    }
    return record;
  }

  const splits = [record.inputs.fit_split, ...record.inputs.evaluation_splits];
  for (const split of splits) boundDigest(split.ref, split.sha256, `Input split ${split.id}`);
  boundDigest(record.capture.implementation_ref, record.capture.implementation_sha256, "Capture code");
  boundDigest(record.probe.implementation_ref, record.probe.implementation_sha256, "Probe code");
  unique(splits.map((split) => split.id), "Input split IDs");
  unique(splits.filter((split) => split.sha256 !== null).map((split) => split.sha256), "Input split hashes");
  unique(record.representations.map((item) => item.id), "Representation IDs");
  unique(record.metrics.map((metric) => metric.name), "Metric names");
  for (const category of ["overall", "group", "stability", "control"]) {
    if (!record.metrics.some((metric) => metric.category === category && metric.required)) {
      throw new Error(`A required ${category} metric must be present`);
    }
  }
  for (const metric of record.metrics) {
    if (metric.unit === "ppm" && (metric.threshold < 0 || metric.threshold > 1_000_000)) {
      throw new Error(`Metric ${metric.name} must use a threshold from 0 to 1000000 ppm`);
    }
  }
  for (const representation of record.representations) {
    boundDigest(representation.artifact_ref, representation.artifact_sha256, `Representation ${representation.id}`);
    if ((representation.artifact_ref === null) !== (representation.artifact_sha256 === null)) {
      throw new Error(`Representation ${representation.id} needs both artifact identity fields`);
    }
    if (representation.dimension !== null && record.controls.random_projection.dimensions.some(
      (dimension) => dimension > representation.dimension,
    )) {
      throw new Error(`Random projections must fit within ${representation.id}`);
    }
  }
  if (record.state === "frozen") {
    for (const split of splits) exactRef(split.ref, `Input split ${split.id}`);
    exactRef(record.capture.implementation_ref, "Capture code");
    exactRef(record.probe.implementation_ref, "Probe code");
  }
  return record;
};

const compare = {
  gt: (value, threshold) => value > threshold,
  gte: (value, threshold) => value >= threshold,
  lt: (value, threshold) => value < threshold,
  lte: (value, threshold) => value <= threshold,
};

export const classifyRepresentationAudit = async (record, measurements) => {
  await checkResearchProfile(record);
  if (record.schema !== "ilxyr.representation_audit.v1" || record.state !== "frozen") {
    throw new Error("Diagnostic classification requires a frozen representation audit");
  }
  if (!measurements || typeof measurements !== "object" || Array.isArray(measurements)) {
    throw new Error("Measurements must be a metric-name object");
  }
  const declared = new Set(record.metrics.map((metric) => metric.name));
  if (Object.keys(measurements).some((name) => !declared.has(name))) {
    throw new Error("Every supplied metric must be declared in the audit");
  }
  const failed = [];
  for (const metric of record.metrics) {
    const value = measurements[metric.name];
    if (!Object.hasOwn(measurements, metric.name) || !Number.isFinite(value)) {
      throw new Error(`Metric ${metric.name} requires a finite measurement`);
    }
    if (metric.unit === "ppm" && (value < 0 || value > 1_000_000)) {
      throw new Error(`Metric ${metric.name} must be from 0 to 1000000 ppm`);
    }
    if (metric.required && !compare[metric.operator](value, metric.threshold)) {
      failed.push(metric);
    }
  }
  const outcome = failed.some((metric) => metric.category === "control")
    ? "invalid_controls"
    : failed.some((metric) => metric.category === "overall")
      ? "insufficient_signal"
      : failed.length > 0 ? "localized_signal" : "stable_signal";
  return {
    audit_id: record.id,
    outcome,
    failed_metrics: failed.map((metric) => metric.name),
    next_allowed: record.decision_table[outcome].next_allowed,
    diagnostic_only: true,
  };
};

const main = async () => {
  const args = process.argv.slice(2);
  if (args.length < 1 || args.length > 2) {
    throw new Error("Usage: node scripts/research-profiles.mjs <profile.json> [measurements.json]");
  }
  const bytes = await readFile(resolve(args[0]));
  const record = JSON.parse(bytes.toString("utf8"));
  await checkResearchProfile(record);
  const result = {
    id: record.id,
    state: record.state,
    profile_sha256: digest(bytes),
    unresolved: record.unresolved,
    execution_authorized: false,
  };
  if (args[1]) {
    const measurementBytes = await readFile(resolve(args[1]));
    result.diagnostic = await classifyRepresentationAudit(
      record,
      JSON.parse(measurementBytes.toString("utf8")),
    );
    result.measurements_sha256 = digest(measurementBytes);
  }
  console.log(JSON.stringify(result, null, 2));
};

if (
  process.argv[1] &&
  await realpath(resolve(process.argv[1])) === await realpath(fileURLToPath(import.meta.url))
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
