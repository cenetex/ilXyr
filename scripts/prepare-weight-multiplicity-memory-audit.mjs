#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MEMORY_LIMIT_BYTES = 2147483648;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

const parseArguments = (values) => {
  const options = { mode: null, selfTest: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--self-test") options.selfTest = true;
    else if (["select", "compare"].includes(value) && options.mode === null)
      options.mode = value;
    else if (["--frontier", "--manifest", "--out", "--default", "--presized"].includes(value)) {
      const next = values[++index];
      if (!next) throw new Error(`${value} requires a value`);
      options[value.slice(2)] = next;
    } else throw new Error(`unknown argument: ${value}`);
  }
  return options;
};

const runsFor = (measurement) => [
  measurement.binding,
  ...(measurement.sensitivities ?? []),
].filter(Boolean);

const runMemoStats = (run) => ({
  rss_bytes: run.memory_bytes?.incremental_from_ready ?? null,
  memo_entries: run.memory_bytes?.maximum_memo_entries ?? 0,
  live_entry_bytes: run.memory_bytes?.maximum_live_entry_bytes ?? null,
  capacity_bytes: run.memory_bytes?.maximum_memo_capacity ?? 0,
  peak_allocated_bytes: run.memory_bytes?.maximum_memo_peak_allocated ?? 0,
  hard_timeout_progress: run.hard_timeout?.memo_progress ?? null,
});

const measurementMemoStats = (measurement) => {
  const runs = runsFor(measurement).map(runMemoStats);
  const numericMaximum = (key) => Math.max(
    0,
    ...runs.map((run) => run[key] ?? 0),
  );
  const progress = runs
    .map((run) => run.hard_timeout_progress)
    .filter(Boolean)
    .sort((left, right) =>
      (right.projected_simultaneous_bytes ?? 0) -
      (left.projected_simultaneous_bytes ?? 0),
    )[0] ?? null;
  const memoEntries = Math.max(
    numericMaximum("memo_entries"),
    progress?.memo_entries ?? 0,
  );
  const entryBytes = runs
    .map((run, index) => runsFor(measurement)[index]?.memo_configuration?.entry_bytes)
    .find((value) => Number.isFinite(value)) ?? null;
  const liveEntryBytes = entryBytes === null ? null : memoEntries * entryBytes;
  const rssBytes = numericMaximum("rss_bytes");
  return {
    rss_bytes: rssBytes,
    memo_entries: memoEntries,
    memo_entry_bytes: entryBytes,
    live_entry_bytes: liveEntryBytes,
    rss_to_live_entry_ratio:
      liveEntryBytes ? rssBytes / liveEntryBytes : null,
    capacity_bytes: numericMaximum("capacity_bytes"),
    peak_allocated_bytes: numericMaximum("peak_allocated_bytes"),
    hard_timeout_progress: progress,
  };
};

const isMemoryAffected = (measurement, limit = MEMORY_LIMIT_BYTES) => {
  if (measurement.boundary?.memory_pass === false) return true;
  return runsFor(measurement).some((run) =>
    (run.memory_bytes?.incremental_from_ready ?? 0) > limit ||
    (run.hard_timeout?.memo_progress?.projected_simultaneous_bytes ?? 0) > limit,
  );
};

const selectMeasurements = (frontier, limit = MEMORY_LIMIT_BYTES) => {
  const affected = frontier.measurements.filter((measurement) =>
    isMemoryAffected(measurement, limit),
  );
  const perType = new Map();
  for (const measurement of affected) {
    const type = measurement.representation.type;
    const current = perType.get(type);
    const candidateDimension = BigInt(measurement.representation.representation_dimension);
    const currentDimension = current
      ? BigInt(current.representation.representation_dimension)
      : null;
    if (
      !current ||
      candidateDimension < currentDimension ||
      (candidateDimension === currentDimension &&
        measurement.representation.id < current.representation.id)
    ) perType.set(type, measurement);
  }
  return [...perType.values()].sort((left, right) =>
    left.representation.type.localeCompare(right.representation.type, "en", { numeric: true }),
  );
};

const selectAudit = (frontier, manifest) => {
  const selectedMeasurements = selectMeasurements(frontier);
  const ids = new Set(selectedMeasurements.map((measurement) => measurement.representation.id));
  const representations = manifest.representations.filter((representation) => ids.has(representation.id));
  if (representations.length !== ids.size)
    throw new Error("frontier memory-audit selection is not present in the bound manifest");
  const perType = Object.fromEntries(
    representations.map((representation) => [representation.type, 1]),
  );
  return {
    ...manifest,
    scope_revision: `${manifest.scope_revision}-memory-policy-audit-v1`,
    selection: {
      ...manifest.selection,
      audit_derivation: {
        source: "default-policy binding frontier",
        rule: "smallest representation dimension with a memory-affected result per type",
        memory_limit_bytes: MEMORY_LIMIT_BYTES,
        selected_ids: representations.map((representation) => representation.id),
      },
    },
    representations,
    summary: { representations: representations.length, per_type: perType },
  };
};

const compareFrontiers = (defaultFrontier, presizedFrontier) => {
  const defaults = new Map(
    defaultFrontier.measurements.map((measurement) => [measurement.representation.id, measurement]),
  );
  const cells = presizedFrontier.measurements.map((presized) => {
    const baseline = defaults.get(presized.representation.id);
    if (!baseline) throw new Error(`presized cell ${presized.representation.id} has no default result`);
    const defaultStats = measurementMemoStats(baseline);
    const presizedStats = measurementMemoStats(presized);
    return {
      representation: presized.representation,
      default_classification: baseline.classification,
      presized_classification: presized.classification,
      default: defaultStats,
      presized: presizedStats,
      memory_boundary_moved:
        defaultStats.rss_bytes > MEMORY_LIMIT_BYTES &&
        presizedStats.rss_bytes <= MEMORY_LIMIT_BYTES,
      remains_over_memory_limit: presizedStats.rss_bytes > MEMORY_LIMIT_BYTES,
    };
  });
  return {
    schema: "ilxyr.weight_multiplicity_memory_policy_comparison.v1",
    evidence_status: "diagnostic_allocator_policy_audit",
    memory_limit_bytes: MEMORY_LIMIT_BYTES,
    default_oracle_executable_sha256: defaultFrontier.oracle_executable_sha256,
    presized_oracle_executable_sha256: presizedFrontier.oracle_executable_sha256,
    same_oracle_executable:
      defaultFrontier.oracle_executable_sha256 === presizedFrontier.oracle_executable_sha256,
    selection_rule: "smallest memory-affected representation dimension per type",
    cells,
    summary: {
      cells: cells.length,
      boundaries_moved: cells.filter((cell) => cell.memory_boundary_moved).length,
      remain_over_limit: cells.filter((cell) => cell.remains_over_memory_limit).length,
    },
    conclusion:
      cells.some((cell) => cell.memory_boundary_moved)
        ? "memory frontier is allocation-policy-dependent"
        : "no tested memory boundary moved under the presized policy",
  };
};

const readJsonWithDigest = async (path) => {
  const bytes = await readFile(resolve(path));
  return { digest: sha256(bytes), value: JSON.parse(bytes.toString("utf8")) };
};

const selfTest = () => {
  const measurement = (id, type, dimension, rss, memoryPass) => ({
    representation: { id, type, representation_dimension: dimension },
    boundary: { memory_pass: memoryPass },
    binding: {
      memo_configuration: { entry_bytes: 164 },
      memory_bytes: {
        incremental_from_ready: rss,
        maximum_memo_entries: 100,
        maximum_live_entry_bytes: 16400,
        maximum_memo_capacity: 32768,
        maximum_memo_peak_allocated: 49152,
      },
    },
    sensitivities: [],
  });
  const frontier = {
    measurements: [
      measurement("A8:large", "A8", "1000", MEMORY_LIMIT_BYTES + 1, false),
      measurement("A8:small", "A8", "10", MEMORY_LIMIT_BYTES + 1, false),
      measurement("B8:pass", "B8", "1", 1, true),
    ],
  };
  const selected = selectMeasurements(frontier);
  if (selected.length !== 1 || selected[0].representation.id !== "A8:small")
    throw new Error("memory-audit selection self-test failed");
  const stats = measurementMemoStats(frontier.measurements[0]);
  if (stats.live_entry_bytes !== 16400 || stats.rss_to_live_entry_ratio === null)
    throw new Error("memo-ratio self-test failed");
  process.stdout.write(JSON.stringify({ status: "pass", selection: true, memo_ratio: true }) + "\n");
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.selfTest) return selfTest();
  if (options.mode === "select") {
    if (!options.frontier || !options.manifest || !options.out)
      throw new Error("select requires --frontier, --manifest, and --out");
    const frontier = await readJsonWithDigest(options.frontier);
    const manifest = await readJsonWithDigest(options.manifest);
    const audit = selectAudit(frontier.value, manifest.value);
    audit.audit_derivation = {
      frontier_sha256: frontier.digest,
      parent_manifest_sha256: manifest.digest,
    };
    await writeFile(resolve(options.out), stableJson(audit));
    process.stdout.write(JSON.stringify(audit.summary) + "\n");
    return;
  }
  if (options.mode === "compare") {
    if (!options.default || !options.presized || !options.out)
      throw new Error("compare requires --default, --presized, and --out");
    const defaultFrontier = await readJsonWithDigest(options.default);
    const presizedFrontier = await readJsonWithDigest(options.presized);
    const comparison = compareFrontiers(defaultFrontier.value, presizedFrontier.value);
    comparison.default_result_sha256 = defaultFrontier.digest;
    comparison.presized_result_sha256 = presizedFrontier.digest;
    await writeFile(resolve(options.out), stableJson(comparison));
    process.stdout.write(JSON.stringify(comparison.summary) + "\n");
    return;
  }
  throw new Error("select or compare mode is required");
};

export { compareFrontiers, isMemoryAffected, measurementMemoStats, selectAudit };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
