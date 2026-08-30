#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const map = readJson("docs/research-pathways.json");
const registry = readJson("docs/lab-registry.json");

assert(map.schema === "ilxyr.research_pathways.v1",
  "research pathway map schema mismatch");
assert(map.as_of >= registry.as_of,
  "research pathway map predates its lab registry source");

const nodes = new Map();
for (const node of map.nodes) {
  assert(!nodes.has(node.id), `duplicate research pathway node ${node.id}`);
  nodes.set(node.id, node);
  validateNode(node);
}

const edgeKeys = new Set();
for (const edge of map.edges) {
  assert(nodes.has(edge.from), `research pathway edge source is missing: ${edge.from}`);
  assert(nodes.has(edge.to), `research pathway edge target is missing: ${edge.to}`);
  assert(edge.from !== edge.to, `research pathway self-edge is invalid: ${edge.from}`);
  const key = `${edge.from}\0${edge.to}\0${edge.relation}`;
  assert(!edgeKeys.has(key), `duplicate research pathway edge ${edge.from} -> ${edge.to}`);
  edgeKeys.add(key);
}
assertAcyclic(map.nodes, map.edges);

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
  counts,
}));

function validateNode(node) {
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
