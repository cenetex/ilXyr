#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const map = readJson("docs/research-pathways.json");
const registry = readJson("docs/lab-registry.json");

assert(map.schema === "ilxyr.research_pathways.v2",
  "research pathway map schema mismatch");
assert(map.as_of >= registry.as_of,
  "research pathway map predates its lab registry source");

const factorSpaces = new Map();
for (const space of map.factor_spaces) {
  assert(!factorSpaces.has(space.lineage),
    `duplicate factor space for lineage ${space.lineage}`);
  assert(/^[A-Z][A-Z0-9]*$/.test(space.track),
    `factor space ${space.lineage} has an invalid track`);
  assert(space.axes.length > 0 && space.axes.every(axis => /^[a-z][a-z0-9_]*$/.test(axis)),
    `factor space ${space.lineage} has invalid axes`);
  assert(new Set(space.axes).size === space.axes.length,
    `factor space ${space.lineage} contains duplicate axes`);
  factorSpaces.set(space.lineage, space);
}

const nodes = new Map();
const coordinateKeys = new Set();
const coordinateSlugs = new Set();
for (const node of map.nodes) {
  assert(!nodes.has(node.id), `duplicate research pathway node ${node.id}`);
  nodes.set(node.id, node);
  validateNode(node);

  const coordinateKey = JSON.stringify([
    node.lineage,
    node.coordinate.track,
    node.coordinate.parts,
  ]);
  assert(!coordinateKeys.has(coordinateKey),
    `duplicate research coordinate ${formatCoordinate(node.coordinate)} in ${node.lineage}`);
  coordinateKeys.add(coordinateKey);

  const slugKey = `${node.lineage}\0${node.coordinate.slug}`;
  assert(!coordinateSlugs.has(slugKey),
    `duplicate research coordinate slug ${node.coordinate.slug} in ${node.lineage}`);
  coordinateSlugs.add(slugKey);
}
for (const lineage of factorSpaces.keys()) {
  assert(map.nodes.some(node => node.lineage === lineage),
    `factor space ${lineage} has no research pathway nodes`);
}
const legacyC31 = nodes.get("zero5-c31-v1");
assert(JSON.stringify(legacyC31?.coordinate.parts) === JSON.stringify([3, 1])
    && legacyC31.coordinate.slug === "c3_1",
  "legacy zero5-c31-v1 must resolve explicitly to C[3,1] and c3_1");

const edgeKeys = new Set();
for (const edge of map.edges) {
  assert(nodes.has(edge.from), `research pathway edge source is missing: ${edge.from}`);
  assert(nodes.has(edge.to), `research pathway edge target is missing: ${edge.to}`);
  assert(edge.from !== edge.to, `research pathway self-edge is invalid: ${edge.from}`);
  const source = nodes.get(edge.from);
  const target = nodes.get(edge.to);
  if (source.lineage === target.lineage) {
    const changedFactors = Object.keys(source.factor_state)
      .filter(axis => source.factor_state[axis] !== target.factor_state[axis]);
    assert(changedFactors.length > 0,
      `research pathway edge ${edge.from} -> ${edge.to} changes no factors`);
  }
  const key = `${edge.from}\0${edge.to}\0${edge.relation}`;
  assert(!edgeKeys.has(key), `duplicate research pathway edge ${edge.from} -> ${edge.to}`);
  edgeKeys.add(key);
}
assertAcyclic(map.nodes, map.edges);
testCoordinateValidation();

const registryBindings = sourceBindings("lab_registry_experiment");
const expectedRegistry = new Map(registry.experiments.map(experiment => [
  experiment.id,
  experiment,
]));
assertExactCoverage(registryBindings, [...expectedRegistry.keys()], "lab registry experiment");
for (const [recordId, binding] of registryBindings) {
  const experiment = expectedRegistry.get(recordId);
  assert(binding.node.id === recordId,
    `lab registry experiment ${recordId} must keep its canonical node id`);
  const expectedExecution = experiment.state === "blocked" ? "not_run" : "completed";
  assert(binding.node.execution_status === expectedExecution,
    `lab registry execution state mismatch for ${recordId}`);
  const expectedOutcome = experiment.outcome === "no_go"
    ? "negative"
    : ["pass", "selected"].includes(experiment.outcome)
      ? "positive"
      : "unknown";
  assert(binding.node.scientific_outcome === expectedOutcome,
    `lab registry scientific outcome mismatch for ${recordId}`);
  const expectedEvidence = {
    external_public: "external_public",
    external_private_hash: "external_private_hash",
    private_withheld: "private_withheld",
    native: "native",
  }[experiment.evidence.classification];
  assert(binding.node.evidence_status === expectedEvidence,
    `lab registry evidence state mismatch for ${recordId}`);
  const expectedDisclosure = experiment.evidence.classification === "private_withheld"
    ? "withheld"
    : experiment.evidence.classification === "external_private_hash"
      ? "private_hash"
      : "public";
  assert(binding.node.disclosure_status === expectedDisclosure,
    `lab registry disclosure state mismatch for ${recordId}`);
}

const retroDirectory = absolute("examples/families");
const retroFiles = fs.readdirSync(retroDirectory)
  .filter(name => name.endsWith(".retro.json"))
  .sort()
  .map(name => `examples/families/${name}`);
const expectedRetro = new Map(retroFiles.map(relative => {
  const registration = readJson(relative);
  return [registration.id, relative];
}));
const retroBindings = sourceBindings("retro_registration");
assertExactCoverage(retroBindings, [...expectedRetro.keys()], "retro registration");
for (const [recordId, binding] of retroBindings) {
  assert(binding.source.path === expectedRetro.get(recordId),
    `retro registration path mismatch for ${recordId}`);
}

const experimentFiles = fs.readdirSync(absolute("docs/experiments"))
  .filter(name => /^EXP-[0-9]{3}\.md$/.test(name))
  .sort()
  .map(name => `docs/experiments/${name}`);
const experimentBindings = map.nodes.flatMap(node => node.sources
  .filter(source => source.kind === "experiment_record"
    && /^docs\/experiments\/EXP-[0-9]{3}\.md$/.test(source.path))
  .map(source => ({node, source})));
assertExactPathCoverage(experimentBindings, experimentFiles, "numbered experiment record");

const counts = map.nodes.reduce((result, node) => {
  result.execution[node.execution_status] = (result.execution[node.execution_status] || 0) + 1;
  result.outcomes[node.scientific_outcome]
    = (result.outcomes[node.scientific_outcome] || 0) + 1;
  result.lifecycle[node.lifecycle_status]
    = (result.lifecycle[node.lifecycle_status] || 0) + 1;
  return result;
}, {execution: {}, outcomes: {}, lifecycle: {}});

console.log(JSON.stringify({
  nodes: map.nodes.length,
  edges: map.edges.length,
  covered_lab_registry_experiments: registryBindings.size,
  covered_retro_registrations: retroBindings.size,
  covered_numbered_experiment_records: experimentBindings.length,
  factor_spaces: factorSpaces.size,
  integer_coordinates: coordinateKeys.size,
  counts,
}));

function validateNode(node) {
  validateCoordinate(node);

  const claimOutcomes = new Set(node.claim_results.map(result => result.outcome));
  if (node.scientific_outcome === "positive") {
    assert(claimOutcomes.has("positive") && !claimOutcomes.has("negative"),
      `${node.id} positive outcome is inconsistent with its claims`);
  } else if (node.scientific_outcome === "negative") {
    assert(claimOutcomes.has("negative") && !claimOutcomes.has("positive"),
      `${node.id} negative outcome is inconsistent with its claims`);
  } else if (node.scientific_outcome === "mixed") {
    assert(claimOutcomes.has("positive") && claimOutcomes.has("negative"),
      `${node.id} mixed outcome needs positive and negative claims`);
  } else {
    assert([...claimOutcomes].every(outcome => outcome === "unknown"),
      `${node.id} unknown outcome cannot contain a settled claim`);
  }

  if (node.execution_status === "not_run") {
    assert(node.lifecycle_status === "blocked" || node.lifecycle_status === "open",
      `${node.id} not-run pathway must be blocked or open`);
  }
  if (node.lifecycle_status === "blocked") {
    assert(node.execution_status === "not_run" && node.blockers?.length > 0,
      `${node.id} blocked pathway has an invalid execution state`);
  }
  if (node.lifecycle_status === "open" && node.execution_status === "not_run") {
    assert(node.scientific_outcome === "unknown" && !node.blockers?.length,
      `${node.id} open not-run pathway must be an unblocked question`);
  }
  if (node.lifecycle_status === "promoted") {
    assert(node.execution_status === "completed"
      && node.scientific_outcome === "positive",
    `${node.id} promoted pathway is not a completed positive result`);
  }
  if (node.lifecycle_status === "terminal_private") {
    assert(node.execution_status === "completed"
      && node.disclosure_status === "withheld"
      && node.scientific_outcome === "unknown",
    `${node.id} terminal-private pathway leaks or misstates its result`);
  }
  if (node.disclosure_status === "withheld") {
    assert(node.lifecycle_status === "terminal_private",
      `${node.id} withheld pathway is not terminal-private`);
  }

  for (const source of node.sources) {
    assert(!path.isAbsolute(source.path), `${node.id} source path must be repository-relative`);
    const resolved = absolute(source.path);
    assert(resolved.startsWith(`${root}${path.sep}`),
      `${node.id} source path escapes the repository`);
    assert(fs.statSync(resolved).isFile(), `${node.id} source file is missing: ${source.path}`);
    assert(source.record_id,
      `${node.id} source binding must name the exact record it covers`);
  }
}

function validateCoordinate(node) {
  const factorSpace = factorSpaces.get(node.lineage);
  assert(factorSpace, `${node.id} has no factor space for lineage ${node.lineage}`);
  assert(node.coordinate, `${node.id} has no research coordinate`);
  assert(node.factor_state, `${node.id} has no factor vector`);
  assert(node.coordinate.track === factorSpace.track,
    `${node.id} coordinate track must be ${factorSpace.track}`);
  assert(node.coordinate.parts.length > 0
      && node.coordinate.parts.every(part => Number.isSafeInteger(part) && part >= 0),
    `${node.id} coordinate parts must be non-negative safe integers`);
  const expectedSlug = `${node.coordinate.track.toLowerCase()}${node.coordinate.parts.join("_")}`;
  assert(node.coordinate.slug === expectedSlug,
    `${node.id} coordinate slug must be ${expectedSlug}`);
  assert(Number.isSafeInteger(node.record_revision) && node.record_revision > 0,
    `${node.id} record revision must be a positive safe integer`);

  const expectedFactors = [...factorSpace.axes].sort();
  const observedFactors = Object.keys(node.factor_state).sort();
  assert(JSON.stringify(observedFactors) === JSON.stringify(expectedFactors),
    `${node.id} factor state must contain exactly ${expectedFactors.join(",")}`);
  assert(Object.values(node.factor_state)
    .every(value => Number.isSafeInteger(value) && value >= 0),
    `${node.id} factor state values must be non-negative safe integers`);
}

function formatCoordinate(coordinate) {
  return `${coordinate.track}[${coordinate.parts.join(",")}]`;
}

function testCoordinateValidation() {
  const sample = structuredClone(map.nodes.find(node => node.coordinate.parts.length > 1));

  const ambiguousSlug = structuredClone(sample);
  ambiguousSlug.coordinate.slug = `${sample.coordinate.track.toLowerCase()}${sample.coordinate.parts.join("")}`;
  assertThrows(() => validateCoordinate(ambiguousSlug),
    "coordinate validator accepted a delimiter-free slug");

  const missingFactor = structuredClone(sample);
  delete missingFactor.factor_state[Object.keys(missingFactor.factor_state)[0]];
  assertThrows(() => validateCoordinate(missingFactor),
    "coordinate validator accepted an incomplete factor vector");

  const decimalPart = structuredClone(sample);
  decimalPart.coordinate.parts[0] += 0.5;
  assertThrows(() => validateCoordinate(decimalPart),
    "coordinate validator accepted a non-integer coordinate");
}

function assertThrows(callback, message) {
  try {
    callback();
  } catch {
    return;
  }
  throw new Error(message);
}

function sourceBindings(kind) {
  const result = new Map();
  for (const node of map.nodes) {
    for (const source of node.sources.filter(candidate => candidate.kind === kind)) {
      assert(!result.has(source.record_id),
        `${kind} ${source.record_id} is mapped more than once`);
      result.set(source.record_id, {node, source});
    }
  }
  return result;
}

function assertExactCoverage(actual, expectedIds, label) {
  const expected = [...expectedIds].sort();
  const observed = [...actual.keys()].sort();
  assert(JSON.stringify(observed) === JSON.stringify(expected),
    `${label} coverage mismatch: expected ${expected.join(",")}; observed ${observed.join(",")}`);
}

function assertExactPathCoverage(bindings, expectedPaths, label) {
  const observed = bindings.map(binding => binding.source.path).sort();
  const expected = [...expectedPaths].sort();
  assert(new Set(observed).size === observed.length,
    `${label} is mapped more than once`);
  assert(JSON.stringify(observed) === JSON.stringify(expected),
    `${label} coverage mismatch: expected ${expected.join(",")}; observed ${observed.join(",")}`);
}

function assertAcyclic(nodeList, edges) {
  const outgoing = new Map(nodeList.map(node => [node.id, []]));
  const incoming = new Map(nodeList.map(node => [node.id, 0]));
  for (const edge of edges) {
    outgoing.get(edge.from).push(edge.to);
    incoming.set(edge.to, incoming.get(edge.to) + 1);
  }
  const ready = [...incoming].filter(([, count]) => count === 0).map(([id]) => id);
  let visited = 0;
  while (ready.length > 0) {
    const id = ready.pop();
    visited += 1;
    for (const target of outgoing.get(id)) {
      incoming.set(target, incoming.get(target) - 1);
      if (incoming.get(target) === 0) ready.push(target);
    }
  }
  assert(visited === nodeList.length, "research pathway graph contains a cycle");
}

function absolute(relative) {
  return path.resolve(root, relative);
}

function readJson(relative) {
  return JSON.parse(fs.readFileSync(absolute(relative), "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
