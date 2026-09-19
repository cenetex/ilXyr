#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";

import {
  describeType,
  generateTargets,
  orderTargets,
  sha256,
  stableJson,
} from "./run-weight-multiplicity-phase05.mjs";

const parseArguments = (values) => {
  const options = {
    phase06Plan: null,
    sourcePlan: null,
    sourceManifest: null,
    frontier: null,
    correction: null,
    sealedZero: null,
    describerZero: null,
    legacyZeroRevision: null,
    out: null,
    selfTest: false,
  };
  const keys = {
    "--phase06-plan": "phase06Plan",
    "--source-plan": "sourcePlan",
    "--source-manifest": "sourceManifest",
    "--frontier": "frontier",
    "--correction": "correction",
    "--sealed-zero": "sealedZero",
    "--describer-zero": "describerZero",
    "--legacy-zero-revision": "legacyZeroRevision",
    "--out": "out",
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--self-test") options.selfTest = true;
    else {
      const key = keys[value];
      if (!key) throw new Error(`unknown argument: ${value}`);
      const next = values[++index];
      if (!next) throw new Error(`${value} requires a value`);
      options[key] = next;
    }
  }
  return options;
};

const canonicalType = (legacyType, mapping) =>
  mapping[legacyType] ?? legacyType;

const compareWeights = (left, right) => {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
};

const runRecords = (measurement) => [
  measurement.cold,
  measurement.binding,
  ...(measurement.replays ?? []),
  ...(measurement.sensitivities ?? []),
]
  .filter(Boolean)
  .flatMap((run) => run.records ?? []);

const deduplicatedOrder = (orderedTargets, idByTarget) => {
  const seen = new Set();
  const ids = [];
  for (const target of orderedTargets) {
    const key = target.target_weight.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    ids.push(idByTarget.get(key));
  }
  return ids;
};

const selfTest = () => {
  const mapping = { B3: "C3", C3: "B3" };
  if (canonicalType("B3", mapping) !== "C3" ||
      canonicalType("A3", mapping) !== "A3")
    throw new Error("canonical family mapping self-test failed");
  const targets = [
    { generation_index: 0, target_weight: [1] },
    { generation_index: 1, target_weight: [1] },
    { generation_index: 2, target_weight: [0] },
  ];
  const ids = new Map([["1", "r1"], ["0", "r0"]]);
  if (deduplicatedOrder(targets, ids).join(",") !== "r1,r0")
    throw new Error("request deduplication self-test failed");
  process.stdout.write(`${JSON.stringify({ status: "pass" })}\n`);
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.selfTest) {
    selfTest();
    return;
  }
  for (const [key, value] of Object.entries(options)) {
    if (key !== "selfTest" && value === null)
      throw new Error(`missing required option: ${key}`);
  }

  const paths = Object.fromEntries(
    [
      "phase06Plan",
      "sourcePlan",
      "sourceManifest",
      "frontier",
      "correction",
      "sealedZero",
      "describerZero",
      "out",
    ].map((key) => [key, resolve(options[key])]),
  );
  const [
    phase06PlanBytes,
    sourcePlanBytes,
    sourceManifestBytes,
    frontierCompressedBytes,
    correctionBytes,
    sealedZeroBytes,
    describerZeroBytes,
  ] = await Promise.all([
    readFile(paths.phase06Plan),
    readFile(paths.sourcePlan),
    readFile(paths.sourceManifest),
    readFile(paths.frontier),
    readFile(paths.correction),
    readFile(paths.sealedZero),
    readFile(paths.describerZero),
  ]);
  const phase06Plan = JSON.parse(phase06PlanBytes.toString("utf8"));
  const sourcePlan = JSON.parse(sourcePlanBytes.toString("utf8"));
  const sourceManifest = JSON.parse(sourceManifestBytes.toString("utf8"));
  const frontier = JSON.parse(gunzipSync(frontierCompressedBytes).toString("utf8"));
  const correction = JSON.parse(correctionBytes.toString("utf8"));
  const expected = phase06Plan.source;

  const bindings = [
    ["frontier plan", sha256(sourcePlanBytes), expected.frontier_plan_sha256],
    ["representation manifest", sha256(sourceManifestBytes), expected.representation_manifest_sha256],
    ["frontier gzip", sha256(frontierCompressedBytes), expected.frontier_gzip_sha256],
    ["exactness correction", sha256(correctionBytes), expected.exactness_correction_sha256],
    ["sealed Zero executable", sha256(sealedZeroBytes), expected.legacy_zero_executable_sha256],
  ];
  for (const [name, actual, wanted] of bindings) {
    if (actual !== wanted)
      throw new Error(`${name} hash mismatch: ${actual} != ${wanted}`);
  }
  if (options.legacyZeroRevision !== expected.legacy_zero_source_revision)
    throw new Error("legacy Zero source revision does not match the frozen plan");
  if (frontier.plan_sha256 !== expected.frontier_plan_sha256 ||
      frontier.manifest_sha256 !== expected.representation_manifest_sha256 ||
      frontier.oracle_executable_sha256 !== expected.legacy_zero_executable_sha256)
    throw new Error("frontier embedded identity does not match Phase 0.6 bindings");
  if (sourceManifest.plan_sha256 !== expected.frontier_plan_sha256 ||
      sourceManifest.representations.length !== frontier.measurements.length)
    throw new Error("source manifest and frontier roster do not match");

  const correctionById = new Map(
    correction.changes.map((entry) => [entry.representation_id, entry]),
  );
  const correctedCounts = {};
  for (const measurement of frontier.measurements) {
    const classification = correctionById.get(measurement.representation.id)
      ?.corrected_classification ?? measurement.classification;
    correctedCounts[classification] = (correctedCounts[classification] ?? 0) + 1;
  }
  if (JSON.stringify(correctedCounts) !==
      JSON.stringify(expected.corrected_classifications))
    throw new Error(`corrected classification counts drifted: ${JSON.stringify(correctedCounts)}`);

  const sourceRepresentationById = new Map(
    sourceManifest.representations.map((representation) => [representation.id, representation]),
  );
  const descriptionByType = new Map();
  const representations = [];
  const requestById = new Map();
  const bindingOrder = [];
  const replayOrder = [];
  const stressRequestIds = [];
  let rawRequests = 0;
  let nextRequest = 1;

  for (const measurement of frontier.measurements) {
    const correctionEntry = correctionById.get(measurement.representation.id);
    const correctedClassification =
      correctionEntry?.corrected_classification ?? measurement.classification;
    if (correctedClassification === "pass") continue;
    const sourceRepresentation = sourceRepresentationById.get(
      measurement.representation.id,
    );
    if (!sourceRepresentation ||
        JSON.stringify(sourceRepresentation) !==
          JSON.stringify(measurement.representation))
      throw new Error(`representation drift for ${measurement.representation.id}`);
    let description = descriptionByType.get(sourceRepresentation.type);
    if (!description) {
      description = describeType(paths.describerZero, sourceRepresentation.type);
      descriptionByType.set(sourceRepresentation.type, description);
    }
    const generatedTargets = generateTargets(
      sourceRepresentation,
      description,
      sourcePlan,
    );
    if (generatedTargets.length !== expected.raw_requests_per_representation)
      throw new Error(`target count drift for ${sourceRepresentation.id}`);
    rawRequests += generatedTargets.length;

    const generatedByIndex = new Map(
      generatedTargets.map((target) => [target.generation_index, target]),
    );
    const observedByTarget = new Map();
    for (const record of runRecords(measurement)) {
      const generated = generatedByIndex.get(record.generation_index);
      if (!generated ||
          compareWeights(generated.target_weight, record.target_weight) !== 0 ||
          generated.target_depth !== record.target_depth ||
          generated.target_status !== record.target_status)
        throw new Error(
          `observed target does not match frozen generation for ${sourceRepresentation.id}`,
        );
      if (record.multiplicity === undefined || record.multiplicity === null)
        continue;
      const key = record.target_weight.join(",");
      const observation = observedByTarget.get(key) ?? {
        multiplicities: new Set(),
        records: 0,
        responseHashes: new Set(),
      };
      observation.multiplicities.add(String(record.multiplicity));
      observation.records += 1;
      if (record.response) observation.responseHashes.add(sha256(record.response));
      observedByTarget.set(key, observation);
    }

    const uniqueByTarget = new Map();
    for (const target of generatedTargets) {
      const key = target.target_weight.join(",");
      const entry = uniqueByTarget.get(key) ?? {
        target,
        generationIndices: [],
        sources: new Set(),
      };
      if (entry.target.target_depth !== target.target_depth ||
          entry.target.target_status !== target.target_status ||
          entry.target.dominant_target_key !== target.dominant_target_key)
        throw new Error(`duplicate target metadata drift for ${sourceRepresentation.id}`);
      entry.generationIndices.push(target.generation_index);
      entry.sources.add(target.source);
      uniqueByTarget.set(key, entry);
    }

    const legacyType = sourceRepresentation.type;
    const publicType = canonicalType(
      legacyType,
      phase06Plan.canonical_names.legacy_to_canonical,
    );
    const representationRequests = [];
    const idByTarget = new Map();
    for (const [targetKey, entry] of uniqueByTarget) {
      const observation = observedByTarget.get(targetKey);
      if (observation && observation.multiplicities.size !== 1)
        throw new Error(`historical Zero disagreement for ${sourceRepresentation.id}:${targetKey}`);
      const requestId = `r${String(nextRequest++).padStart(5, "0")}`;
      const request = {
        id: requestId,
        legacy_zero_type: legacyType,
        canonical_type: publicType,
        canonical_representation_id:
          `${publicType}:${sourceRepresentation.highest_weight.join(",")}`,
        highest_weight: sourceRepresentation.highest_weight,
        target_weight: entry.target.target_weight,
        target_depth: entry.target.target_depth,
        target_status: entry.target.target_status,
        dominant_target_key: entry.target.dominant_target_key,
        source_generation_indices: entry.generationIndices,
        sources: [...entry.sources].sort(),
        historical_zero: observation
          ? {
              status: "available",
              multiplicity: [...observation.multiplicities][0],
              observation_records: observation.records,
              distinct_response_sha256s: [...observation.responseHashes].sort(),
            }
          : { status: "unavailable", reason: "no_completed_historical_response" },
      };
      requestById.set(requestId, request);
      representationRequests.push(requestId);
      idByTarget.set(targetKey, requestId);
    }
    const orderedBinding = deduplicatedOrder(
      orderTargets(generatedTargets, phase06Plan.lie.binding_order),
      idByTarget,
    );
    const orderedReplay = deduplicatedOrder(
      orderTargets(generatedTargets, phase06Plan.lie.replay_order),
      idByTarget,
    );
    bindingOrder.push(...orderedBinding);
    replayOrder.push(...orderedReplay);
    const stress = [...representationRequests]
      .map((requestId) => requestById.get(requestId))
      .sort((left, right) =>
        right.target_depth - left.target_depth ||
        (left.target_status === right.target_status
          ? compareWeights(left.target_weight, right.target_weight)
          : left.target_status === "non_dominant" ? -1 : 1),
      )[0];
    stressRequestIds.push(stress.id);
    representations.push({
      legacy_zero_id: sourceRepresentation.id,
      legacy_zero_type: legacyType,
      canonical_id: `${publicType}:${sourceRepresentation.highest_weight.join(",")}`,
      canonical_type: publicType,
      rank: sourceRepresentation.rank,
      highest_weight: sourceRepresentation.highest_weight,
      highest_weight_height: sourceRepresentation.highest_weight_height,
      representation_dimension: sourceRepresentation.representation_dimension,
      dimension_band: sourceRepresentation.dimension_band,
      prior_classification: measurement.classification,
      corrected_classification: correctedClassification,
      exactness_correction: correctionEntry ?? null,
      generated_targets_sha256: sha256(stableJson(generatedTargets)),
      raw_requests: generatedTargets.length,
      unique_requests: representationRequests.length,
      request_ids: representationRequests,
      binding_order_request_ids: orderedBinding,
      replay_order_request_ids: orderedReplay,
      stress_request_id: stress.id,
    });
  }

  if (representations.length !== expected.non_pass_representations ||
      rawRequests !== expected.raw_request_maximum ||
      bindingOrder.length !== requestById.size ||
      replayOrder.length !== requestById.size ||
      stressRequestIds.length !== representations.length)
    throw new Error("frozen Phase 0.6 surface count drifted");
  const requests = [...requestById.values()];
  const historicalAvailable = requests.filter(
    (request) => request.historical_zero.status === "available",
  ).length;
  const perCanonicalType = {};
  for (const representation of representations) {
    const summary = perCanonicalType[representation.canonical_type] ?? {
      representations: 0,
      unique_requests: 0,
    };
    summary.representations += 1;
    summary.unique_requests += representation.unique_requests;
    perCanonicalType[representation.canonical_type] = summary;
  }
  const result = {
    schema: "ilxyr.weight_multiplicity_phase06_manifest.v1",
    status: "frozen_pre_run",
    phase06_plan_sha256: sha256(phase06PlanBytes),
    source_bindings: {
      launch_run_id: expected.launch_run_id,
      collection_run_id: expected.collection_run_id,
      frontier_gzip_sha256: sha256(frontierCompressedBytes),
      frontier_plan_sha256: sha256(sourcePlanBytes),
      representation_manifest_sha256: sha256(sourceManifestBytes),
      exactness_correction_sha256: sha256(correctionBytes),
      sealed_zero_executable_sha256: sha256(sealedZeroBytes),
      legacy_zero_source_revision: options.legacyZeroRevision,
      local_describer_executable_sha256: sha256(describerZeroBytes),
    },
    mapping: {
      legacy_to_canonical: phase06Plan.canonical_names.legacy_to_canonical,
      coordinate_mapping: phase06Plan.lie.coordinate_mapping,
    },
    orders: {
      binding: phase06Plan.lie.binding_order,
      replay: phase06Plan.lie.replay_order,
      binding_request_ids: bindingOrder,
      replay_request_ids: replayOrder,
      stress_request_ids: stressRequestIds,
    },
    representations,
    requests,
    summary: {
      representations: representations.length,
      raw_requests: rawRequests,
      unique_requests: requests.length,
      historical_zero_available: historicalAvailable,
      historical_zero_unavailable: requests.length - historicalAvailable,
      differential_coverage_fraction: `${historicalAvailable}/${requests.length}`,
      stress_requests: stressRequestIds.length,
      per_canonical_type: perCanonicalType,
    },
    closures: phase06Plan.closures,
  };
  await writeFile(paths.out, stableJson(result));
  process.stdout.write(stableJson({
    status: result.status,
    manifest_sha256: sha256(stableJson(result)),
    summary: result.summary,
  }));
};

await main();
