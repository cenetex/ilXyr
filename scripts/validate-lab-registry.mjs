#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const registry = JSON.parse(await readFile(join(root, "docs/lab-registry.json"), "utf8"));
const errors = [];

const fail = (message) => errors.push(message);
const indexById = (items, label) => {
  const index = new Map();
  for (const item of items) {
    if (index.has(item.id)) fail(`${label} id is duplicated: ${item.id}`);
    index.set(item.id, item);
  }
  return index;
};

const repositories = indexById(registry.repositories, "repository");
const artifacts = indexById(registry.artifacts, "artifact");
const modelLines = indexById(registry.model_lines, "model line");
const experiments = indexById(registry.experiments, "experiment");

for (const artifact of registry.artifacts) {
  if (!repositories.has(artifact.repository_id)) {
    fail(`${artifact.id} refers to missing repository ${artifact.repository_id}`);
  }
}

for (const experiment of registry.experiments) {
  if (!modelLines.has(experiment.model_line_id)) {
    fail(`${experiment.id} refers to missing model line ${experiment.model_line_id}`);
  }
  if (!repositories.has(experiment.source.repository_id)) {
    fail(`${experiment.id} refers to missing repository ${experiment.source.repository_id}`);
  }
  for (const input of experiment.inputs) {
    if (!artifacts.has(input)) fail(`${experiment.id} refers to missing input ${input}`);
  }
  for (const dependency of experiment.depends_on) {
    if (!experiments.has(dependency)) {
      fail(`${experiment.id} refers to missing experiment dependency ${dependency}`);
    }
  }
  if (experiment.state === "completed" &&
      !experiment.source.result_sha256 &&
      !experiment.source.private_result_sha256) {
    fail(`${experiment.id} is complete without a public or private result digest`);
  }
  if (experiment.state !== "completed" && experiment.outcome) {
    fail(`${experiment.id} has an outcome before completion`);
  }
  if (experiment.evidence.ilxyr_recorded && experiment.evidence.classification !== "native") {
    fail(`${experiment.id} is marked ilXyr-recorded but classified as external`);
  }
  if (!experiment.evidence.ilxyr_recorded && experiment.evidence.classification === "native") {
    fail(`${experiment.id} is classified native without an ilXyr record`);
  }
}

const activeExperimentId = registry.governance.active_experiment;
const activeExperiment = activeExperimentId ? experiments.get(activeExperimentId) : null;
const executableExperiments = registry.experiments.filter((experiment) =>
  ["authorized", "running"].includes(experiment.state));
if (activeExperimentId && !activeExperiment) {
  fail(`governance active experiment is missing: ${activeExperimentId}`);
} else if (activeExperiment && !["authorized", "running"].includes(activeExperiment.state)) {
  fail(`governance active experiment is not authorized or running: ${activeExperiment.id}`);
}
if (!activeExperimentId && executableExperiments.length > 0) {
  fail("governance has no active experiment but executable experiments remain");
}
if (activeExperimentId &&
    (executableExperiments.length !== 1 || executableExperiments[0].id !== activeExperimentId)) {
  fail("governance must name the only authorized or running experiment");
}

const activeModelLines = registry.model_lines.filter((line) => line.state === "active_research");
if (activeModelLines.length !== 1) {
  fail(`expected one active research model line, found ${activeModelLines.length}`);
} else if (activeModelLines[0].active_experiment !== registry.governance.active_experiment) {
  fail("active model line and governance disagree about the active experiment");
}

const visiting = new Set();
const visited = new Set();
function visit(id) {
  if (visiting.has(id)) {
    fail(`experiment dependency cycle includes ${id}`);
    return;
  }
  if (visited.has(id)) return;
  visiting.add(id);
  for (const dependency of experiments.get(id)?.depends_on ?? []) visit(dependency);
  visiting.delete(id);
  visited.add(id);
}
for (const id of experiments.keys()) visit(id);

if (activeExperiment && activeExperiment.depends_on.length === 0) {
  fail(`${activeExperiment.id} must name its completed control`);
} else if (activeExperiment) {
  for (const dependency of activeExperiment.depends_on) {
    if (experiments.get(dependency)?.state !== "completed") {
      fail(`${activeExperiment.id} depends on incomplete control ${dependency}`);
    }
  }
}

if (errors.length > 0) {
  console.error(`Lab registry validation failed with ${errors.length} error(s):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

const completed = registry.experiments.filter((experiment) => experiment.state === "completed").length;
const external = registry.experiments.filter((experiment) => !experiment.evidence.ilxyr_recorded).length;
console.log(`Validated ${registry.experiments.length} decisions, ${registry.artifacts.length} inputs, ${completed} completed experiments, and ${external} non-native records.`);
