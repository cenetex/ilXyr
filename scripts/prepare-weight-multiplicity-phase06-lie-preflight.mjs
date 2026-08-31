#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";

const defaults = {
  plan: "examples/weight-multiplicity/phase06-lie-preflight-plan-v1.json",
  reducedManifest: "examples/weight-multiplicity/phase06-reduced-corpus-manifest-v1.json",
  frontier: "experiments/weight-multiplicity/phase05/session-frontier-v7.json.gz",
  frontierPlan: "examples/weight-multiplicity/phase05-frontier-plan-v7.json",
  sourceManifest: "examples/weight-multiplicity/phase05-representation-manifest-v7.json",
  phase06Plan: "examples/weight-multiplicity/phase06-persistent-lie-plan-v1.json",
  phase06Manifest: "examples/weight-multiplicity/phase06-persistent-lie-manifest-v1.json",
  phase06Evidence: "experiments/weight-multiplicity/phase05/phase06-cloud-v1/results/phase06-evidence.json.gz",
  governance: "examples/weight-multiplicity/phase06-lie-governance-v1.json",
  out: "examples/weight-multiplicity/phase06-lie-preflight-manifest-v1.json.gz",
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

const parseArguments = (values) => {
  const options = { ...defaults, selfTest: false };
  const names = {
    "--plan": "plan",
    "--reduced-manifest": "reducedManifest",
    "--frontier": "frontier",
    "--frontier-plan": "frontierPlan",
    "--source-manifest": "sourceManifest",
    "--phase06-plan": "phase06Plan",
    "--phase06-manifest": "phase06Manifest",
    "--phase06-evidence": "phase06Evidence",
    "--governance": "governance",
    "--out": "out",
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--self-test") options.selfTest = true;
    else {
      const name = names[value];
      if (!name) throw new Error(`unknown argument: ${value}`);
      const next = values[++index];
      if (!next) throw new Error(`${value} requires a value`);
      options[name] = next;
    }
  }
  return options;
};

const compareWeights = (left, right) => {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
};

const canonicalizeWeight = (weight, legacyType) =>
  legacyType === "B2" ? [...weight].reverse() : [...weight];

const canonicalType = (legacyType, mapping) => mapping[legacyType] ?? legacyType;

const runRecords = (measurement) => [
  measurement.cold,
  measurement.binding,
  ...(measurement.sensitivities ?? []),
  ...(measurement.replays ?? []),
].filter(Boolean).flatMap((run) => run.records ?? []);

const targetProjection = (record, legacyType) => ({
  generation_index: record.generation_index,
  source: record.source,
  target_weight: canonicalizeWeight(record.target_weight, legacyType),
  target_depth: record.target_depth,
  target_status: record.target_status,
  dominant_target_key: canonicalizeWeight(
    record.dominant_target_key.split(",").map(Number),
    legacyType,
  ).join(","),
});

const orderedTargets = (targets, order) => {
  if (order === "seeded_generation_order")
    return [...targets].sort((left, right) =>
      left.generation_index - right.generation_index);
  if (order !== "ascending_depth_dominant_first_lexicographic")
    throw new Error(`unsupported order: ${order}`);
  return [...targets].sort((left, right) =>
    left.target_depth - right.target_depth ||
    (left.target_status === right.target_status
      ? compareWeights(left.target_weight, right.target_weight)
      : left.target_status === "dominant" ? -1 : 1));
};

const deduplicatedOrder = (targets, idByTarget) => {
  const seen = new Set();
  const ids = [];
  for (const target of targets) {
    const key = target.target_weight.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    ids.push(idByTarget.get(key));
  }
  return ids;
};

const selfTest = () => {
  if (canonicalizeWeight([1, 0], "B2").join(",") !== "0,1" ||
      canonicalizeWeight([-2, 1], "B2").join(",") !== "1,-2" ||
      canonicalType("B3", { B3: "C3" }) !== "C3")
    throw new Error("canonicalization self-test failed");
  const targets = [
    { generation_index: 0, target_weight: [1] },
    { generation_index: 1, target_weight: [1] },
    { generation_index: 2, target_weight: [0] },
  ];
  const ids = new Map([["1", "p1"], ["0", "p0"]]);
  if (deduplicatedOrder(targets, ids).join(",") !== "p1,p0")
    throw new Error("deduplication self-test failed");
  process.stdout.write(`${JSON.stringify({ status: "pass" })}\n`);
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.selfTest) {
    selfTest();
    return;
  }
  const paths = Object.fromEntries(Object.entries(options)
    .filter(([name]) => name !== "selfTest")
    .map(([name, value]) => [name, resolve(value)]));
  const [planBytes, reducedBytes, frontierGzipBytes, frontierPlanBytes,
    sourceManifestBytes, phase06PlanBytes, phase06ManifestBytes,
    phase06EvidenceGzipBytes, governanceBytes] = await Promise.all([
    readFile(paths.plan),
    readFile(paths.reducedManifest),
    readFile(paths.frontier),
    readFile(paths.frontierPlan),
    readFile(paths.sourceManifest),
    readFile(paths.phase06Plan),
    readFile(paths.phase06Manifest),
    readFile(paths.phase06Evidence),
    readFile(paths.governance),
  ]);
  const plan = JSON.parse(planBytes);
  const reduced = JSON.parse(reducedBytes);
  const frontier = JSON.parse(gunzipSync(frontierGzipBytes));
  const sourceManifest = JSON.parse(sourceManifestBytes);
  const governance = JSON.parse(governanceBytes);
  const expected = plan.source;
  for (const [name, bytes, wanted] of [
    ["Phase 0.5 frontier", frontierGzipBytes, expected.phase05_frontier_gzip_sha256],
    ["Phase 0.5 frontier plan", frontierPlanBytes, expected.phase05_frontier_plan_sha256],
    ["Phase 0.5 representation manifest", sourceManifestBytes, expected.phase05_representation_manifest_sha256],
    ["Phase 0.6 plan", phase06PlanBytes, expected.phase06_plan_sha256],
    ["Phase 0.6 request manifest", phase06ManifestBytes, expected.phase06_manifest_sha256],
    ["Phase 0.6 evidence", phase06EvidenceGzipBytes, expected.phase06_evidence_gzip_sha256],
    ["reduced manifest", reducedBytes, expected.reduced_manifest_sha256],
    ["governance", governanceBytes, expected.governance_sha256],
  ]) {
    const actual = sha256(bytes);
    if (actual !== wanted) throw new Error(`${name} hash mismatch: ${actual} != ${wanted}`);
  }
  if (frontier.plan_sha256 !== expected.phase05_frontier_plan_sha256 ||
      frontier.manifest_sha256 !== expected.phase05_representation_manifest_sha256)
    throw new Error("Phase 0.5 frontier embedded identity does not match");
  if (governance.status !== "accepted_with_conditions" ||
      governance.maintenance.accountable_owner !== plan.governance.accountable_owner)
    throw new Error("accepted governance record does not match the preflight plan");
  if (reduced.pre_generation_gates.corpus_generation_authorized ||
      plan.closures.corpus_generation_authorized ||
      plan.closures.model_training_authorized)
    throw new Error("preflight must keep corpus generation and model training closed");

  const preflightRows = reduced.representations.filter((entry) =>
    entry.oracle_evidence.status === "phase05_zero_pass_lie_preflight_required");
  if (preflightRows.length !== expected.authorized_representations)
    throw new Error("authorized preflight roster count drifted");
  const measurementByLegacyId = new Map(frontier.measurements.map(
    (measurement) => [measurement.representation.id, measurement],
  ));
  const sourceByLegacyId = new Map(sourceManifest.representations.map(
    (representation) => [representation.id, representation],
  ));
  const requests = [];
  const representations = [];
  const bindingRequestIds = [];
  const replayRequestIds = [];
  const stressRequestIds = [];
  let rawRequests = 0;
  let nextRequest = 1;

  for (const reducedRow of preflightRows) {
    const measurement = measurementByLegacyId.get(reducedRow.legacy_zero_id);
    const sourceRepresentation = sourceByLegacyId.get(reducedRow.legacy_zero_id);
    if (!measurement || !sourceRepresentation || measurement.classification !== "pass")
      throw new Error(`missing Phase 0.5 pass evidence for ${reducedRow.legacy_zero_id}`);
    if (JSON.stringify(measurement.representation) !== JSON.stringify(sourceRepresentation))
      throw new Error(`source representation drift for ${reducedRow.legacy_zero_id}`);
    const expectedCanonicalType = canonicalType(
      sourceRepresentation.type,
      plan.canonical_names.legacy_to_canonical,
    );
    const expectedHighestWeight = canonicalizeWeight(
      sourceRepresentation.highest_weight,
      sourceRepresentation.type,
    );
    if (reducedRow.canonical_type !== expectedCanonicalType ||
        reducedRow.highest_weight.join(",") !== expectedHighestWeight.join(",") ||
        reducedRow.canonical_id !== `${expectedCanonicalType}:${expectedHighestWeight.join(",")}`)
      throw new Error(`canonical representation drift for ${reducedRow.legacy_zero_id}`);

    const allRecords = runRecords(measurement);
    const recordsByGeneration = new Map();
    for (const record of allRecords) {
      const projection = targetProjection(record, sourceRepresentation.type);
      const key = stableJson(projection);
      const entry = recordsByGeneration.get(record.generation_index) ?? {
        projection,
        projectionKey: key,
        multiplicities: new Set(),
        responseHashes: new Set(),
        observations: 0,
      };
      if (entry.projectionKey !== key)
        throw new Error(`target drift at generation ${record.generation_index} for ${reducedRow.legacy_zero_id}`);
      if (record.multiplicity !== undefined && record.multiplicity !== null) {
        entry.multiplicities.add(String(record.multiplicity));
        entry.observations += 1;
      }
      if (record.response_sha256) entry.responseHashes.add(record.response_sha256);
      recordsByGeneration.set(record.generation_index, entry);
    }
    if (recordsByGeneration.size !== expected.raw_requests_per_representation ||
        [...recordsByGeneration.keys()].some((index) => index < 0 || index >= 32))
      throw new Error(`frozen target count drift for ${reducedRow.legacy_zero_id}`);
    const generatedTargets = [...recordsByGeneration.values()]
      .map((entry) => entry.projection)
      .sort((left, right) => left.generation_index - right.generation_index);
    rawRequests += generatedTargets.length;

    const unique = new Map();
    for (const target of generatedTargets) {
      const key = target.target_weight.join(",");
      const generationEvidence = recordsByGeneration.get(target.generation_index);
      if (generationEvidence.multiplicities.size !== 1)
        throw new Error(`historical multiplicity disagreement for ${reducedRow.legacy_zero_id}:${key}`);
      const entry = unique.get(key) ?? {
        target,
        generationIndices: [],
        sources: new Set(),
        multiplicities: new Set(),
        responseHashes: new Set(),
        observations: 0,
      };
      if (entry.target.target_depth !== target.target_depth ||
          entry.target.target_status !== target.target_status ||
          entry.target.dominant_target_key !== target.dominant_target_key)
        throw new Error(`duplicate target metadata drift for ${reducedRow.legacy_zero_id}:${key}`);
      entry.generationIndices.push(target.generation_index);
      entry.sources.add(target.source);
      for (const value of generationEvidence.multiplicities) entry.multiplicities.add(value);
      for (const value of generationEvidence.responseHashes) entry.responseHashes.add(value);
      entry.observations += generationEvidence.observations;
      unique.set(key, entry);
    }

    const representationRequestIds = [];
    const idByTarget = new Map();
    for (const [targetKey, entry] of unique) {
      if (entry.multiplicities.size !== 1)
        throw new Error(`deduplicated historical disagreement for ${reducedRow.canonical_id}:${targetKey}`);
      const requestId = `p${String(nextRequest++).padStart(5, "0")}`;
      requests.push({
        id: requestId,
        legacy_zero_type: sourceRepresentation.type,
        canonical_type: reducedRow.canonical_type,
        canonical_representation_id: reducedRow.canonical_id,
        highest_weight: reducedRow.highest_weight,
        target_weight: entry.target.target_weight,
        target_depth: entry.target.target_depth,
        target_status: entry.target.target_status,
        dominant_target_key: entry.target.dominant_target_key,
        source_generation_indices: entry.generationIndices,
        sources: [...entry.sources].sort(),
        historical_zero: {
          status: "available",
          multiplicity: [...entry.multiplicities][0],
          observation_records: entry.observations,
          distinct_response_sha256s: [...entry.responseHashes].sort(),
        },
      });
      representationRequestIds.push(requestId);
      idByTarget.set(targetKey, requestId);
    }
    const binding = deduplicatedOrder(
      orderedTargets(generatedTargets, plan.lie.binding_order),
      idByTarget,
    );
    const replay = deduplicatedOrder(
      orderedTargets(generatedTargets, plan.lie.replay_order),
      idByTarget,
    );
    bindingRequestIds.push(...binding);
    replayRequestIds.push(...replay);
    const requestById = new Map(requests.map((request) => [request.id, request]));
    const stress = [...representationRequestIds]
      .map((requestId) => requestById.get(requestId))
      .sort((left, right) =>
        right.target_depth - left.target_depth ||
        (left.target_status === right.target_status
          ? compareWeights(left.target_weight, right.target_weight)
          : left.target_status === "non_dominant" ? -1 : 1))[0];
    stressRequestIds.push(stress.id);
    representations.push({
      legacy_zero_id: reducedRow.legacy_zero_id,
      legacy_zero_type: reducedRow.legacy_zero_type,
      canonical_id: reducedRow.canonical_id,
      canonical_type: reducedRow.canonical_type,
      coordinate_rule: reducedRow.coordinate_rule,
      rank: reducedRow.rank,
      highest_weight: reducedRow.highest_weight,
      highest_weight_height: reducedRow.highest_weight_height,
      representation_dimension: reducedRow.representation_dimension,
      dimension_band: reducedRow.dimension_band,
      revision3_role: reducedRow.revision3_role,
      phase05_classification: measurement.classification,
      generated_targets_sha256: sha256(stableJson(generatedTargets)),
      raw_requests: generatedTargets.length,
      unique_requests: representationRequestIds.length,
      request_ids: representationRequestIds,
      binding_order_request_ids: binding,
      replay_order_request_ids: replay,
      stress_request_id: stress.id,
    });
  }

  if (rawRequests !== expected.raw_request_maximum ||
      requests.length !== expected.expected_unique_requests ||
      bindingRequestIds.length !== requests.length ||
      replayRequestIds.length !== requests.length ||
      stressRequestIds.length !== representations.length)
    throw new Error("preflight surface counts drifted");
  const historicalAvailable = requests.filter(
    (request) => request.historical_zero.status === "available").length;
  if (historicalAvailable !== expected.expected_historical_zero_available)
    throw new Error("historical Zero coverage drifted");

  const perCanonicalType = {};
  for (const representation of representations) {
    const entry = perCanonicalType[representation.canonical_type] ?? {
      representations: 0,
      unique_requests: 0,
    };
    entry.representations += 1;
    entry.unique_requests += representation.unique_requests;
    perCanonicalType[representation.canonical_type] = entry;
  }
  const result = {
    schema: "ilxyr.weight_multiplicity_phase06_lie_preflight_manifest.v1",
    status: "frozen_authorized_preflight",
    phase06_plan_sha256: sha256(planBytes),
    source_bindings: {
      phase05_frontier_gzip_sha256: sha256(frontierGzipBytes),
      phase05_frontier_plan_sha256: sha256(frontierPlanBytes),
      phase05_representation_manifest_sha256: sha256(sourceManifestBytes),
      phase06_plan_sha256: sha256(phase06PlanBytes),
      phase06_manifest_sha256: sha256(phase06ManifestBytes),
      phase06_evidence_gzip_sha256: sha256(phase06EvidenceGzipBytes),
      reduced_manifest_sha256: sha256(reducedBytes),
      governance_sha256: sha256(governanceBytes),
    },
    mapping: {
      legacy_to_canonical: plan.canonical_names.legacy_to_canonical,
      legacy_B2_coordinate_rule: plan.canonical_names.legacy_B2_coordinate_rule,
      coordinate_mapping: plan.lie.coordinate_mapping,
    },
    orders: {
      binding: plan.lie.binding_order,
      replay: plan.lie.replay_order,
      binding_request_ids: bindingRequestIds,
      replay_request_ids: replayRequestIds,
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
    closures: plan.closures,
  };
  const serialized = stableJson(result);
  const outputBytes = paths.out.endsWith(".gz")
    ? gzipSync(Buffer.from(serialized), { level: 9 })
    : Buffer.from(serialized);
  await writeFile(paths.out, outputBytes);
  process.stdout.write(stableJson({
    status: result.status,
    plan_sha256: sha256(planBytes),
    manifest_sha256: sha256(outputBytes),
    manifest_uncompressed_sha256: sha256(serialized),
    summary: result.summary,
  }));
};

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
