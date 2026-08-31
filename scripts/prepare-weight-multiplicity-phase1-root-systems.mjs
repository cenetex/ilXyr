#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

const parseArguments = (values) => {
  const options = {
    manifest: resolve(
      root,
      "examples/weight-multiplicity/phase06-reduced-corpus-manifest-v1.json",
    ),
    zero: null,
    zeroCommit: null,
    out: resolve(
      root,
      "examples/weight-multiplicity/phase1-root-systems-v1.json",
    ),
    selfTest: false,
  };
  const names = {
    "--manifest": "manifest",
    "--zero": "zero",
    "--zero-commit": "zeroCommit",
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

const validateDescription = (description, type) => {
  if (description.type !== type) throw new Error(`Zero described ${description.type}, expected ${type}`);
  if (!Number.isInteger(description.rank) || description.rank < 1)
    throw new Error(`invalid rank for ${type}`);
  if (description.cartan.length !== description.rank ||
      description.cartan.some((row) => row.length !== description.rank))
    throw new Error(`invalid Cartan matrix for ${type}`);
  if (!Array.isArray(description.positive_roots) || description.positive_roots.length === 0 ||
      description.positive_roots.some((entry) => entry.length !== description.rank))
    throw new Error(`invalid positive roots for ${type}`);
};

const selfTest = () => {
  validateDescription({
    type: "A2",
    rank: 2,
    cartan: [[2, -1], [-1, 2]],
    symmetrizer: [1, 1],
    positive_roots: [[1, 0], [0, 1], [1, 1]],
  }, "A2");
  process.stdout.write(`${JSON.stringify({ status: "pass" })}\n`);
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.selfTest) return selfTest();
  for (const name of ["zero", "zeroCommit"])
    if (!options[name]) throw new Error(`--${name === "zeroCommit" ? "zero-commit" : name} is required`);

  const manifestBytes = await readFile(resolve(options.manifest));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const types = [...new Set(
    manifest.representations.map((entry) => entry.canonical_type),
  )].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const systems = {};
  for (const type of types) {
    const description = JSON.parse(execFileSync(
      resolve(options.zero),
      ["describe", type],
      { encoding: "utf8" },
    ));
    validateDescription(description, type);
    systems[type] = {
      rank: description.rank,
      cartan: description.cartan,
      symmetrizer: description.symmetrizer,
      positive_roots: description.positive_roots,
    };
  }
  const output = {
    schema: "ilxyr.weight_multiplicity_phase1_root_systems.v1",
    zero_source_commit: options.zeroCommit,
    zero_executable_sha256: sha256(await readFile(resolve(options.zero))),
    reduced_manifest_sha256: sha256(manifestBytes),
    canonical_types: types,
    systems,
  };
  await writeFile(resolve(options.out), stableJson(output));
  process.stdout.write(`${JSON.stringify({
    status: "complete",
    output: resolve(options.out),
    sha256: sha256(Buffer.from(stableJson(output))),
    types: types.length,
  })}\n`);
};

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
