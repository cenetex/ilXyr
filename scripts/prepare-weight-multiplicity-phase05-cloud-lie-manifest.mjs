#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { sha256, stableJson } from "./run-weight-multiplicity-phase05.mjs";

const parseArguments = (values) => {
  const options = { auditPlan: null, sourceManifest: null, zero: null, out: null };
  const keys = {
    "--audit-plan": "auditPlan",
    "--source-manifest": "sourceManifest",
    "--zero": "zero",
    "--out": "out",
  };
  for (let index = 0; index < values.length; index += 1) {
    const key = keys[values[index]];
    if (!key) throw new Error(`unknown argument: ${values[index]}`);
    const next = values[++index];
    if (!next) throw new Error(`${values[index - 1]} requires a value`);
    options[key] = next;
  }
  if (Object.values(options).some((value) => value === null))
    throw new Error("--audit-plan, --source-manifest, --zero, and --out are required");
  return options;
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  const [auditBytes, sourceBytes, zeroBytes] = await Promise.all([
    readFile(resolve(options.auditPlan)),
    readFile(resolve(options.sourceManifest)),
    readFile(resolve(options.zero)),
  ]);
  const audit = JSON.parse(auditBytes.toString("utf8"));
  const source = JSON.parse(sourceBytes.toString("utf8"));
  if (sha256(sourceBytes) !== audit.bindings.lie_case_manifest_sha256)
    throw new Error("LiE case manifest does not match the corrective audit binding");
  if (sha256(zeroBytes) !== audit.bindings.oracle_executable_sha256)
    throw new Error("Zero executable does not match the corrective audit binding");
  if (
    source.cases.length !== audit.lie_cross_check.cases ||
    Object.values(source.summary.per_type).some(
      (count) => count !== audit.lie_cross_check.cases_per_type,
    )
  )
    throw new Error("LiE witness case coverage drifted");
  const result = {
    ...source,
    witness_version: 5,
    purpose: "independent_correctness_witness_for_exact_phase05_cloud_executable",
    zero_executable_sha256: sha256(zeroBytes),
    source_case_manifest_sha256: sha256(sourceBytes),
    cloud_execution_binding: {
      prior_run_id: audit.bindings.prior_cloud_run_id,
      oracle_source_revision: audit.bindings.oracle_source_revision,
      oracle_executable_sha256: audit.bindings.oracle_executable_sha256,
    },
  };
  await writeFile(resolve(options.out), stableJson(result));
  process.stdout.write(
    stableJson({
      witness_version: result.witness_version,
      cases: result.cases.length,
      zero_executable_sha256: result.zero_executable_sha256,
      source_case_manifest_sha256: result.source_case_manifest_sha256,
    }),
  );
};

await main();
