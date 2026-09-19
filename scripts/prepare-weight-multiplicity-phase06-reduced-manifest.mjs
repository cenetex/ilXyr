#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";

const defaults = {
  source: "examples/weight-multiplicity/phase05-representation-manifest-v7.json",
  phase06Manifest: "examples/weight-multiplicity/phase06-persistent-lie-manifest-v1.json",
  phase06Plan: "examples/weight-multiplicity/phase06-persistent-lie-plan-v1.json",
  evidence: "experiments/weight-multiplicity/phase05/phase06-cloud-v1/results/phase06-evidence.json.gz",
  contract: "examples/weight-multiplicity/rev3-contract.json",
  governance: "examples/weight-multiplicity/phase06-lie-governance-v1.json",
  out: "examples/weight-multiplicity/phase06-reduced-corpus-manifest-v1.json",
};

const expectedHashes = {
  source: "7b4d83e01b3af05195bfe92d2c08d8d76da8a33b4ce83953df909e98dedf37ff",
  phase06Manifest: "59aafe3a3e06c685861fd73875cfc322faaa3a8e317111728ad5d3fb5bc15925",
  phase06Plan: "9bdcc7c965d88dd2041cdd56f0a47be03d813f623e818d7a35dc1aba0c43a405",
  evidence: "a14a111046806c55d5c2acbfb4768c1bf9161fc9c8ac2c149de953fa3bb16a21",
  evidenceUncompressed: "835fd2e492e284af514db111b55070ff36b6f5c85c2c63ef5fb0bfab7988cc1d",
  contract: "91dca2253e0289db792a9886dad85aa35c7522d345b2f60905f9bb4dfe735b06",
  governance: "d32edfbfe42dd0770c7724f255a314684bf2c3c6631429d9f0294d850ceaf36a",
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const parseArguments = (values) => {
  const options = { ...defaults, selfTest: false };
  const names = {
    "--source": "source",
    "--phase06-manifest": "phase06Manifest",
    "--phase06-plan": "phase06Plan",
    "--evidence": "evidence",
    "--contract": "contract",
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

const parseType = (type) => {
  const match = /^([A-G])(\d+)$/.exec(type);
  if (!match) throw new Error(`invalid Lie type: ${type}`);
  return { family: match[1], rank: Number(match[2]) };
};

const canonicalize = (representation) => {
  const { family, rank } = parseType(representation.type);
  let canonicalType = representation.type;
  let highestWeight = [...representation.highest_weight];
  let coordinateRule = "identity";
  if (family === "B" && rank === 2) {
    canonicalType = "B2";
    highestWeight = highestWeight.reverse();
    coordinateRule = "legacy_C2_orientation_to_canonical_B2_reverse_coordinates";
  } else if (family === "B" && rank >= 3) {
    canonicalType = `C${rank}`;
    coordinateRule = "legacy_B_label_is_canonical_C_coordinates_unchanged";
  } else if (family === "C" && rank >= 3) {
    canonicalType = `B${rank}`;
    coordinateRule = "legacy_C_label_is_canonical_B_coordinates_unchanged";
  }
  return {
    canonicalType,
    highestWeight,
    canonicalId: `${canonicalType}:${highestWeight.join(",")}`,
    coordinateRule,
  };
};

const roleFor = (type) => {
  if (["G2", "F4", "E6", "E7", "E8"].includes(type))
    return "held_out_exceptional";
  const { family, rank } = parseType(type);
  if ((family === "A" && rank <= 5) ||
      (family === "B" && rank >= 2 && rank <= 5) ||
      (family === "C" && rank >= 3 && rank <= 5) ||
      (family === "D" && rank >= 4 && rank <= 5))
    return "training_or_development";
  if ((family === "A" && rank >= 6 && rank <= 8) ||
      ((family === "B" || family === "C" || family === "D") && rank >= 6 && rank <= 8))
    return "held_out_classical";
  throw new Error(`type is outside the Revision 3 split: ${type}`);
};

const typeOrder = [
  "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8",
  "B2", "B3", "B4", "B5", "B6", "B7", "B8",
  "C3", "C4", "C5", "C6", "C7", "C8",
  "D4", "D5", "D6", "D7", "D8", "G2", "F4", "E6", "E7", "E8",
];
const typeIndex = new Map(typeOrder.map((type, index) => [type, index]));

const compareRepresentations = (left, right) =>
  typeIndex.get(left.canonical_type) - typeIndex.get(right.canonical_type) ||
  left.highest_weight_height - right.highest_weight_height ||
  (BigInt(left.representation_dimension) < BigInt(right.representation_dimension) ? -1 :
    BigInt(left.representation_dimension) > BigInt(right.representation_dimension) ? 1 : 0) ||
  left.canonical_id.localeCompare(right.canonical_id);

const histogram = (representations, field) => {
  const result = {};
  for (const representation of representations) {
    const key = String(representation[field]);
    result[key] = (result[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) =>
    Number(left) - Number(right)));
};

const maximumDimension = (representations) => representations.reduce(
  (best, item) => BigInt(item.representation_dimension) > BigInt(best.representation_dimension)
    ? item : best,
);

const ceilRatio = (threshold, before, after) =>
  Math.ceil((threshold * before) / after);

const selfTest = () => {
  const b2 = canonicalize({ type: "B2", highest_weight: [1, 0] });
  const b3 = canonicalize({ type: "B3", highest_weight: [1, 0, 2] });
  const c3 = canonicalize({ type: "C3", highest_weight: [1, 0, 2] });
  if (b2.canonicalId !== "B2:0,1" ||
      b3.canonicalId !== "C3:1,0,2" ||
      c3.canonicalId !== "B3:1,0,2")
    throw new Error("canonicalization self-test failed");
  if (ceilRatio(700, 38, 37) !== 719 ||
      ceilRatio(600, 38, 37) !== 617 ||
      ceilRatio(700, 33, 31) !== 746 ||
      ceilRatio(600, 33, 31) !== 639)
    throw new Error("exceptional threshold self-test failed");
  process.stdout.write(`${JSON.stringify({ status: "pass" })}\n`);
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.selfTest) {
    selfTest();
    return;
  }

  const paths = Object.fromEntries(Object.entries(options)
    .filter(([key]) => key !== "selfTest")
    .map(([key, value]) => [key, resolve(value)]));
  const [sourceBytes, phase06ManifestBytes, phase06PlanBytes, evidenceGzipBytes,
    contractBytes, governanceBytes] = await Promise.all([
    readFile(paths.source),
    readFile(paths.phase06Manifest),
    readFile(paths.phase06Plan),
    readFile(paths.evidence),
    readFile(paths.contract),
    readFile(paths.governance),
  ]);
  const evidenceBytes = gunzipSync(evidenceGzipBytes);
  for (const [name, bytes] of [
    ["source", sourceBytes],
    ["phase06Manifest", phase06ManifestBytes],
    ["phase06Plan", phase06PlanBytes],
    ["evidence", evidenceGzipBytes],
    ["contract", contractBytes],
    ["governance", governanceBytes],
  ]) {
    const actual = sha256(bytes);
    if (actual !== expectedHashes[name])
      throw new Error(`${name} hash mismatch: ${actual} != ${expectedHashes[name]}`);
  }
  if (sha256(evidenceBytes) !== expectedHashes.evidenceUncompressed)
    throw new Error("uncompressed evidence hash mismatch");

  const source = JSON.parse(sourceBytes);
  const phase06Manifest = JSON.parse(phase06ManifestBytes);
  const phase06Plan = JSON.parse(phase06PlanBytes);
  const evidence = JSON.parse(evidenceBytes);
  const contract = JSON.parse(contractBytes);
  const governance = JSON.parse(governanceBytes);
  if (source.representations.length !== 828 ||
      phase06Manifest.representations.length !== 256 ||
      evidence.representations.length !== 256)
    throw new Error("frozen representation counts drifted");
  if (evidence.decision !== "hold" || evidence.technical_resource_outcome !== "reduced_surface_only")
    throw new Error("Phase 0.6 outcome does not match the signed evidence");
  if (phase06Manifest.phase06_plan_sha256 !== sha256(phase06PlanBytes) ||
      evidence.identity.phase06_plan_sha256 !== sha256(phase06PlanBytes) ||
      evidence.identity.manifest_sha256 !== sha256(phase06ManifestBytes))
    throw new Error("Phase 0.6 plan, request manifest, and evidence identities do not bind");
  if (phase06Plan.lie.source_sha256 !== governance.scope.source_sha256 ||
      evidence.identity.lie_source_sha256 !== governance.scope.source_sha256 ||
      evidence.identity.lie_executable_sha256 !==
        governance.maintenance.supported_build_target.expected_executable_sha256)
    throw new Error("LiE source or executable identity does not match governance");
  if (phase06Plan.source.corrected_classifications.pass !== 572 ||
      phase06Plan.source.non_pass_representations !== 256)
    throw new Error("Phase 0.5 pass/non-pass partition drifted");
  if (governance.status !== "accepted_with_conditions" ||
      !governance.authorization.prepare_rescoped_manifest ||
      governance.authorization.generate_corpus)
    throw new Error("governance does not authorize manifest-only preparation");

  const canonicalSource = source.representations.map((representation) => {
    const mapped = canonicalize(representation);
    return {
      legacy_zero_id: representation.id,
      legacy_zero_type: representation.type,
      canonical_id: mapped.canonicalId,
      canonical_type: mapped.canonicalType,
      coordinate_rule: mapped.coordinateRule,
      rank: representation.rank,
      highest_weight: mapped.highestWeight,
      highest_weight_height: representation.highest_weight_height,
      representation_dimension: representation.representation_dimension,
      dimension_band: representation.dimension_band,
      revision3_role: roleFor(mapped.canonicalType),
    };
  });
  const sourceByCanonicalId = new Map(canonicalSource.map((item) => [item.canonical_id, item]));
  if (sourceByCanonicalId.size !== 828)
    throw new Error("canonical representation identifiers are not unique");

  const phase06Ids = new Set(phase06Manifest.representations.map((item) => item.canonical_id));
  const evidenceById = new Map(evidence.representations.map((item) => [item.canonical_id, item]));
  if (phase06Ids.size !== 256 || evidenceById.size !== 256 ||
      [...phase06Ids].some((id) => !evidenceById.has(id) || !sourceByCanonicalId.has(id)))
    throw new Error("Phase 0.6 roster does not bind to the full canonical source roster");

  const representations = canonicalSource.map((representation) => {
    const result = evidenceById.get(representation.canonical_id);
    let oracleEvidence;
    if (!result) {
      oracleEvidence = {
        status: "phase05_zero_pass_lie_preflight_required",
        zero_classification: "pass",
        phase06_lie_timed: false,
      };
    } else {
      oracleEvidence = {
        status: result.classification === "pass"
          ? "phase06_lie_pass"
          : "phase06_lie_excluded",
        zero_classification: phase06Manifest.representations.find(
          (item) => item.canonical_id === representation.canonical_id,
        )?.corrected_classification,
        phase06_lie_timed: true,
        lie_classification: result.classification,
        p95_query_ms: result.p95_query_ms,
        peak_incremental_worker_rss_bytes: result.peak_incremental_worker_rss_bytes,
      };
    }
    return { ...representation, oracle_evidence: oracleEvidence };
  }).sort(compareRepresentations);

  const excluded = representations.filter((item) =>
    item.oracle_evidence.status === "phase06_lie_excluded");
  const retained = representations.filter((item) =>
    item.oracle_evidence.status !== "phase06_lie_excluded");
  const directLiePass = retained.filter((item) =>
    item.oracle_evidence.status === "phase06_lie_pass");
  const preflight = retained.filter((item) =>
    item.oracle_evidence.status === "phase05_zero_pass_lie_preflight_required");
  if (excluded.length !== 3 || retained.length !== 825 ||
      directLiePass.length !== 253 || preflight.length !== 572)
    throw new Error("re-scoped classification counts drifted");

  const expectedExcluded = new Set([
    "E7:0,0,7,1,0,0,0",
    "E8:0,0,2,1,2,0,0,3",
    "E8:0,0,8,0,0,0,0,0",
  ]);
  if (excluded.some((item) => !expectedExcluded.delete(item.canonical_id)) || expectedExcluded.size)
    throw new Error("unexpected exclusion set");

  const perType = {};
  for (const type of typeOrder) {
    const originalRows = representations.filter((item) => item.canonical_type === type);
    const retainedRows = retained.filter((item) => item.canonical_type === type);
    const excludedRows = excluded.filter((item) => item.canonical_type === type);
    perType[type] = {
      source_representations: originalRows.length,
      retained_representations: retainedRows.length,
      phase06_lie_pass: retainedRows.filter((item) =>
        item.oracle_evidence.status === "phase06_lie_pass").length,
      lie_preflight_required: retainedRows.filter((item) =>
        item.oracle_evidence.status === "phase05_zero_pass_lie_preflight_required").length,
      excluded_representations: excludedRows.length,
      maximum_retained_dimension: maximumDimension(retainedRows).representation_dimension,
    };
  }

  const originalExceptionalGate = contract.gates.exceptional;
  const queriesPerExceptionalType = originalExceptionalGate.samples_per_type;
  if (queriesPerExceptionalType !== 500)
    throw new Error("Revision 3 exceptional query count drifted");
  const exceptionalGates = {};
  for (const type of ["G2", "F4", "E6", "E7", "E8"]) {
    const before = perType[type].source_representations;
    const after = perType[type].retained_representations;
    exceptionalGates[type] = {
      retained_representations: after,
      stratified_decision_queries: queriesPerExceptionalType,
      natural_record_queries: queriesPerExceptionalType,
      median_threshold_per_mille: ceilRatio(
        originalExceptionalGate.median_threshold_per_mille, before, after,
      ),
      every_seed_threshold_per_mille: ceilRatio(
        originalExceptionalGate.every_seed_threshold_per_mille, before, after,
      ),
      confidence_interval: originalExceptionalGate.confidence_interval,
      straddling_policy: originalExceptionalGate.straddling_policy,
    };
  }

  const shifts = {};
  for (const type of ["E7", "E8"]) {
    const beforeRows = representations.filter((item) => item.canonical_type === type);
    const afterRows = retained.filter((item) => item.canonical_type === type);
    const beforeMax = maximumDimension(beforeRows);
    const afterMax = maximumDimension(afterRows);
    const before = beforeRows.length;
    const after = afterRows.length;
    shifts[type] = {
      material: true,
      reason: "extreme_dimension_tail_removed",
      representations_before: before,
      representations_after: after,
      removed_fraction: `${before - after}/${before}`,
      expected_removed_queries_under_500_query_representation_uniform_reference:
        Number((queriesPerExceptionalType * (before - after) / before).toFixed(6)),
      height_histogram_before: histogram(beforeRows, "highest_weight_height"),
      height_histogram_after: histogram(afterRows, "highest_weight_height"),
      maximum_dimension_before: beforeMax.representation_dimension,
      maximum_dimension_before_id: beforeMax.canonical_id,
      maximum_dimension_after: afterMax.representation_dimension,
      maximum_dimension_after_id: afterMax.canonical_id,
      maximum_dimension_drop_factor_approx: (
        (Number(BigInt(beforeMax.representation_dimension)) /
          Number(BigInt(afterMax.representation_dimension))).toPrecision(10)
      ),
    };
  }

  const manifest = {
    schema: "ilxyr.weight_multiplicity_phase06_reduced_corpus_manifest.v1",
    status: "candidate_pending_client_approval_and_lie_preflight",
    prepared_date: "2026-08-31",
    authority: {
      allowed: "prepare_rescoped_manifest",
      not_allowed: ["corpus_generation", "model_training", "oracle_promotion"],
    },
    source_bindings: {
      phase05_representation_manifest_sha256: sha256(sourceBytes),
      phase06_request_manifest_sha256: sha256(phase06ManifestBytes),
      phase06_plan_sha256: sha256(phase06PlanBytes),
      phase06_evidence_gzip_sha256: sha256(evidenceGzipBytes),
      phase06_evidence_uncompressed_sha256: sha256(evidenceBytes),
      revision3_contract_sha256: sha256(contractBytes),
      lie_governance_sha256: sha256(governanceBytes),
    },
    oracle: {
      primary_candidate: "LiE 2.2.2 unmodified separate executable",
      differential_check: "Zero canonical naming build where a completed answer exists",
      accountable_owner: governance.maintenance.accountable_owner,
      supported_build_target: governance.maintenance.supported_build_target,
      no_active_upstream: true,
      no_security_patching: true,
    },
    canonicalization: {
      A_D_E_F_G: "identity",
      legacy_B3_B8: "canonical_C3_C8_coordinates_unchanged",
      legacy_C3_C8: "canonical_B3_B8_coordinates_unchanged",
      legacy_B2: "canonical_B2_reverse_coordinates_from_legacy_C2_orientation",
      preserve_both_labels_in_records: true,
    },
    summary: {
      source_representations: 828,
      retained_representations: 825,
      excluded_representations: 3,
      direct_phase06_lie_pass: 253,
      prior_zero_pass_requiring_lie_preflight: 572,
      per_canonical_type: perType,
    },
    pre_generation_gates: {
      client_manifest_approval: "pending",
      retained_representation_lie_preflight: {
        status: "required",
        representations: 572,
        request_construction: "Use the frozen Phase 0.5 32-target generator per representation, deduplicate exact targets, and retain the Phase 0.6 binding and replay orders.",
        execution: "Two complete passes through the same pinned persistent LiE 2.2.2 harness.",
        resource_gates: {
          per_query_limit_ms: 1000,
          global_p95_limit_ms: 1000,
          per_representation_p95_limit_ms: 1000,
          peak_incremental_worker_rss_limit_bytes: 2147483648
        },
        requirement: "Every representation must pass resource and replay gates before corpus generation; comparison with every available completed Zero answer is required.",
      },
      zero_lie_disagreement: "hold_and_investigate",
      source_modification: "return_to_client_counsel",
      corpus_generation_authorized: false,
    },
    exceptional_sampling: {
      decision_surface: {
        queries_per_type: queriesPerExceptionalType,
        strata: ["0", "1", "2-7", "8-31"],
        queries_per_stratum: queriesPerExceptionalType / 4,
        allocation: "representation_balanced_round_robin_with_rotating_stratum_start",
        target_rule: "exact oracle multiplicity in 0-31; values above 31 remain excluded from the decision gate",
      },
      natural_distribution_record: {
        queries_per_type: queriesPerExceptionalType,
        allocation: "representation_balanced_round_robin",
        decision_use: "reported_not_gated",
      },
      confidence: "representation-clustered 95% bootstrap interval with 10000 resamples",
      confidence_interval_straddles_threshold: "hold",
      threshold_derivation: "For a changed type, multiply the original Revision 3 threshold by source_count/retained_count and round up. This conservatively assigns zero accuracy to the excluded tail under a representation-uniform reference distribution.",
      per_type_gates: exceptionalGates,
      distribution_shift: shifts,
    },
    exclusions: excluded.map((item) => ({
      canonical_id: item.canonical_id,
      canonical_type: item.canonical_type,
      highest_weight: item.highest_weight,
      highest_weight_height: item.highest_weight_height,
      representation_dimension: item.representation_dimension,
      lie_classification: item.oracle_evidence.lie_classification,
      p95_query_ms: item.oracle_evidence.p95_query_ms,
      reason: "above_type_highest_tested_pass_and_failed_frozen_1_second_gate",
    })),
    representations: retained,
  };

  await writeFile(paths.out, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    status: manifest.status,
    out: paths.out,
    retained: retained.length,
    excluded: excluded.length,
    direct_lie_pass: directLiePass.length,
    lie_preflight_required: preflight.length,
    exceptional_gates: exceptionalGates,
  })}\n`);
};

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
