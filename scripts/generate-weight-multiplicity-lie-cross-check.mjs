#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  describeType,
  exactWeylDimension,
  generateTargets,
  sha256,
  stableJson,
} from "./run-weight-multiplicity-phase05.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const parseArguments = (values) => {
  const options = {
    plan: "examples/weight-multiplicity/phase05-frontier-plan.json",
    representations:
      "examples/weight-multiplicity/phase05-representation-manifest.json",
    oracle: null,
    out: null,
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!["--plan", "--representations", "--oracle", "--out"].includes(value))
      throw new Error(`unknown argument: ${value}`);
    const next = values[++index];
    if (!next) throw new Error(`${value} requires a value`);
    options[{
      "--plan": "plan",
      "--representations": "representations",
      "--oracle": "oracle",
      "--out": "out",
    }[value]] = next;
  }
  if (!options.oracle || !options.out) throw new Error("--oracle and --out are required");
  return options;
};

const readRecord = async (path) => {
  const bytes = await readFile(path);
  return { bytes, value: JSON.parse(bytes.toString("utf8")) };
};

const compareRepresentations = (left, right) => {
  const leftDimension = BigInt(left.representation_dimension);
  const rightDimension = BigInt(right.representation_dimension);
  if (leftDimension !== rightDimension) return leftDimension < rightDimension ? -1 : 1;
  return left.highest_weight.join(",").localeCompare(right.highest_weight.join(","));
};

const chooseRepresentationPool = (representations) => {
  const ordered = [...representations].sort(compareRepresentations);
  const selected = new Map();
  for (const minimumHeight of [1, 2, 4, 8]) {
    const representation = ordered.find(
      (entry) => entry.highest_weight_height >= minimumHeight,
    );
    if (representation) selected.set(representation.id, representation);
  }
  for (const representation of ordered) {
    if (selected.size >= 4) break;
    selected.set(representation.id, representation);
  }
  return [...selected.values()];
};

const caseKey = (representation, target) =>
  `${representation.id}|${target.target_weight.join(",")}`;

const targetPriority = (target) => {
  const anchorOrder = new Map([[250, 0], [500, 1], [750, 2], [950, 3]]);
  const anchorPriority = anchorOrder.get(target.anchor_per_mille) ?? 4;
  const trajectoryPriority = target.trajectory === 0 ? 0 : target.trajectory === 3 ? 1 : 2;
  return [anchorPriority, trajectoryPriority, target.target_depth, target.generation_index];
};

const comparePriority = (left, right) => {
  for (let index = 0; index < left.length; index += 1)
    if (left[index] !== right[index]) return left[index] - right[index];
  return 0;
};

const buildCasesForType = ({ type, representations, description, plan }) => {
  const cases = new Map();
  const generated = new Map(
    representations.map((representation) => [
      representation.id,
      generateTargets(representation, description, plan),
    ]),
  );
  const add = (representation, target, selectionReason) => {
    if (!target || target.target_depth <= 0) return;
    const key = caseKey(representation, target);
    if (cases.has(key)) return;
    cases.set(key, {
      id: `${type}:lie:${String(cases.size + 1).padStart(2, "0")}`,
      type,
      rank: representation.rank,
      representation_id: representation.id,
      representation_source: representation.cross_check_source ?? "frontier_manifest",
      highest_weight: representation.highest_weight,
      representation_dimension: representation.representation_dimension,
      target_weight: target.target_weight,
      target_depth: target.target_depth,
      target_status: target.target_status,
      source_anchor_per_mille: target.anchor_per_mille,
      source_trajectory: target.trajectory,
      selection_reason: selectionReason,
    });
  };

  if (type === "E7" || type === "E8") {
    const fundamentals = representations
      .filter((entry) => entry.highest_weight_height === 1)
      .sort((left, right) =>
        left.highest_weight.findIndex((value) => value === 1) -
        right.highest_weight.findIndex((value) => value === 1),
    );
    for (const representation of fundamentals) {
      const target = generated.get(representation.id)
        .filter((entry) => entry.target_depth > 0)
        .sort((left, right) =>
          left.target_depth - right.target_depth ||
          left.generation_index - right.generation_index,
        )[0];
      add(representation, target, "all_e7_e8_fundamentals_shallow_nontrivial");
    }
  }

  const initialPool = chooseRepresentationPool(representations);
  const orderedRepresentations = [
    ...initialPool,
    ...representations
      .filter((entry) => !initialPool.some((selected) => selected.id === entry.id))
      .sort(compareRepresentations),
  ];
  const candidates = orderedRepresentations.flatMap((representation) =>
    generated.get(representation.id).map((target) => ({ representation, target })),
  ).sort((left, right) => {
    const representationOrder = orderedRepresentations.findIndex(
      (entry) => entry.id === left.representation.id,
    ) - orderedRepresentations.findIndex((entry) => entry.id === right.representation.id);
    if (representationOrder !== 0) return representationOrder;
    return comparePriority(targetPriority(left.target), targetPriority(right.target));
  });
  for (const candidate of candidates) {
    if (cases.size >= 16) break;
    add(candidate.representation, candidate.target, "height_and_depth_stratified");
  }
  if (cases.size < plan.cross_check.minimum_cases_per_type)
    throw new Error(`${type} produced only ${cases.size} unique nontrivial cases`);
  return [...cases.values()];
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  const planPath = resolve(root, options.plan);
  const representationPath = resolve(root, options.representations);
  const oraclePath = resolve(options.oracle);
  const [planRecord, representationRecord, oracleBytes] = await Promise.all([
    readRecord(planPath),
    readRecord(representationPath),
    readFile(oraclePath),
  ]);
  const plan = planRecord.value;
  const representationManifest = representationRecord.value;
  if (representationManifest.plan_sha256 !== sha256(planRecord.bytes))
    throw new Error("representation manifest does not bind the plan");
  if (representationManifest.oracle_executable_sha256 !== sha256(oracleBytes))
    throw new Error("representation manifest does not bind the oracle executable");

  const cases = [];
  const perType = {};
  for (const type of Object.keys(representationManifest.summary.per_type)) {
    let representations = representationManifest.representations.filter(
      (entry) => entry.type === type,
    );
    const description = describeType(oraclePath, type);
    if (type === "A1") {
      const byId = new Map(representations.map((entry) => [entry.id, entry]));
      for (let height = plan.generator.candidate_envelope.minimum_highest_weight_height;
        height <= plan.generator.candidate_envelope.maximum_highest_weight_height;
        height += 1) {
        const id = `A1:${height}`;
        if (byId.has(id)) continue;
        byId.set(id, {
          id,
          type: "A1",
          rank: 1,
          highest_weight: [height],
          highest_weight_height: height,
          representation_dimension: exactWeylDimension([height], description).toString(),
          dimension_band: null,
          selection_reasons: ["cross_check_candidate_envelope_fill"],
          required_targets: [],
          cross_check_source: "candidate_envelope_fill",
        });
      }
      representations = [...byId.values()];
    }
    const selected = buildCasesForType({ type, representations, description, plan });
    cases.push(...selected);
    perType[type] = selected.length;
  }
  const result = {
    schema_version: 1,
    witness_version: 2,
    scope_revision: plan.scope_revision,
    purpose: "independent_correctness_witness",
    plan_sha256: sha256(planRecord.bytes),
    representation_manifest_sha256: sha256(representationRecord.bytes),
    zero_executable_sha256: sha256(oracleBytes),
    lie: {
      version: "2.2.2",
      source_url: "https://mirror.metanet.ch/sage/spkg/upstream/lie/lie-2.2.2.tar.gz",
      source_sha256: "c4d6f67fa17d2bc77c875a5b2ad2b42ffc5cadf30e7d1c64c097648ccb918b1e",
      production_dependency: false,
    },
    coordinate_mapping: {
      default: "identity",
      F4: [3, 2, 1, 0],
      E6: [0, 5, 1, 2, 3, 4],
      E7: [0, 6, 1, 2, 3, 4, 5],
      E8: [0, 7, 1, 2, 3, 4, 5, 6],
      meaning: "LiE_coordinate_i_equals_Zero_coordinate_at_list_i",
    },
    lie_type_mapping: {
      default: "same_type",
      B2: "C2",
      B3: "C3",
      B4: "C4",
      B5: "C5",
      B6: "C6",
      B7: "C7",
      B8: "C8",
      C3: "B3",
      C4: "B4",
      C5: "B5",
      C6: "B6",
      C7: "B7",
      C8: "B8",
      meaning: "Zero_Reasoner0_and_LiE_use_dual_Cartan_orientation_conventions",
    },
    selection: {
      minimum_cases_per_type: plan.cross_check.minimum_cases_per_type,
      target_cases_per_type: 16,
      all_e7_e8_fundamentals: true,
      only_nontrivial_positive_depth: true,
      general_pool: "smallest_dimension_representations_at_minimum_heights_1_2_4_8_then_dimension_fill",
      target_priority: "anchors_250_500_750_950_then_trajectory_0_then_3_then_remaining",
      a1_fill: "candidate_envelope_heights_1_through_8_because_the_frontier_roster_has_fewer_than_12_unique_nontrivial_queries",
    },
    cases,
    summary: { cases: cases.length, per_type: perType },
  };
  await writeFile(resolve(root, options.out), stableJson(result));
  console.log(JSON.stringify(result.summary));
};

await main();
