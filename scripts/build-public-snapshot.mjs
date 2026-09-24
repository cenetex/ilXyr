#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = join(root, "docs/lab-registry.json");
const reportPath = join(root, "experiments/cloud-launcher/diagnostic-v1/accepted-report.json");
const executionPath = join(root, "experiments/cloud-launcher/diagnostic-v1/execution-report.json");
const environmentPath = join(root, "experiments/cloud-launcher/diagnostic-v1/environment.json");
const profilePath = join(root, "executor/cenetex-public-v1/profile.json");
const snapshotPath = join(root, "docs/public-snapshot-v1.json");
const portalPath = join(root, "portal/app/public-snapshot.json");
const repository = "https://github.com/cenetex/ilXyr";
const FRESH_DAYS = 14;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

export function assertSnapshotBytes(actual, expected) {
  requireValue(actual === expected, "Public snapshot is stale; regenerate it");
}

function isoDay(value) {
  requireValue(/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)), "Invalid registry as_of");
  return `${value}T00:00:00.000Z`;
}

export function buildPublicSnapshot({ registry, registryBytes, registryCommit, reportCommit, generatedAt,
  acceptedReport, executionReport, environment, profile, permawebHealth = null }) {
  requireValue(registry.schema === "ilxyr.lab_registry.v1" && Array.isArray(registry.experiments) &&
    Array.isArray(registry.model_lines), "Invalid lab registry");
  requireValue(/^[a-f0-9]{40}$/.test(registryCommit), "Registry commit is required");
  requireValue(/^[a-f0-9]{40}$/.test(reportCommit), "Report commit is required");
  requireValue(Number.isFinite(Date.parse(generatedAt)), "Invalid generation time");
  if (permawebHealth) {
    requireValue(permawebHealth.scope === "configured-index-gateway-and-seeds" &&
      ["complete", "partial", "unavailable", "empty"].includes(permawebHealth.status) &&
      Number.isFinite(Date.parse(permawebHealth.queriedAt)) &&
      Array.isArray(permawebHealth.sources), "Invalid permaweb source-health input");
  }
  const asOf = isoDay(registry.as_of);
  const staleAfter = new Date(Date.parse(asOf) + FRESH_DAYS * 86400_000).toISOString();
  const hasAcceptedReport = acceptedReport?.schema === "ilxyr.accepted_remote_report.v1";
  if (hasAcceptedReport) {
    requireValue(acceptedReport.verified?.schema === "ilxyr.verified_execution_report.v1" &&
      executionReport?.schema === "ilxyr.execution_report.v1" &&
      acceptedReport.experiment_id === executionReport.run?.experiment_id &&
      acceptedReport.verified.run_ref === executionReport.run_ref &&
      acceptedReport.verified.environment_ref === executionReport.environment_ref &&
      acceptedReport.resolved_outcome === "success" &&
      environment?.id === "environment://cenetex/cloud-launcher-diagnostic/v1" &&
      profile?.schema === "ilxyr.public_environment_candidate.v1",
    "Diagnostic source records disagree");
  }
  const result = hasAcceptedReport ? {
    id: `result:${acceptedReport.experiment_id}`,
    experiment_id: acceptedReport.experiment_id,
    run_ref: acceptedReport.verified.run_ref,
    environment_ref: acceptedReport.verified.environment_ref,
    verification_summary_ref: acceptedReport.report_ref,
    outcome: acceptedReport.resolved_outcome,
    score: executionReport.run.metrics.score,
    execution_state: "completed",
    disclosure_state: "public",
    ledger_binding: "not_checked",
    verification_state: "source_reported_acceptance",
    source: `${repository}/blob/${reportCommit}/experiments/cloud-launcher/diagnostic-v1/accepted-report.json`,
  } : null;
  const experiments = registry.experiments.map((item) => ({
    id: item.id,
    title: item.display_name,
    model_line_id: item.model_line_id,
    scientific_outcome: item.outcome ?? "unknown",
    execution_state: item.state === "withheld" ? "completed" : item.state,
    disclosure_state: item.state === "withheld" || item.evidence.classification === "private_withheld" ? "withheld" :
      item.evidence.classification === "external_private_hash" ? "hash_only" : "public",
    lifecycle_state: item.state,
    evidence_maturity: item.evidence.classification,
    local_import_state: item.state === "blocked" ? "not_started" :
      item.state === "withheld" ? "withheld" :
        item.evidence.ilxyr_recorded ? "recorded" :
          item.state === "completed" ? "pending_import" : "not_started",
    ledger_binding: "not_checked",
    publisher_authentication: "not_checked",
    file_integrity: "not_checked",
    ilxyr_recorded: item.evidence.ilxyr_recorded,
    summary: item.summary,
    source_revision: item.source.observed_revision,
    source_repository: item.source.repository_id,
    url: `${repository}/blob/${registryCommit}/docs/lab-registry.json`,
  }));
  const environments = [
    { id: profile.id, operator: profile.operator, state: profile.state,
      compatibility: profile.compatibility, weight_classes: profile.weight_classes,
      network_modes: profile.network_modes, export_policies: profile.export_policies,
      manifest_ref: profile.accepted_manifest_ref, conformance_ref: profile.accepted_conformance_ref,
      verified_results: profile.verified_results,
      source: `${repository}/blob/${registryCommit}/executor/cenetex-public-v1/profile.json`,
      note: profile.limitations.join("; ") },
    { id: environment.id, operator: environment.operator.id, state: "accepted_diagnostic_report",
      compatibility: "source_reported", weight_classes: environment.capabilities.weight_classes,
      network_modes: environment.capabilities.network_modes,
      export_policies: environment.capabilities.export_policies,
      manifest_ref: null, conformance_ref: null, verified_results: result ? 1 : 0,
      source: `${repository}/blob/${reportCommit}/experiments/cloud-launcher/diagnostic-v1/environment.json`,
      note: "The public source contains one accepted diagnostic report." },
  ];
  const modelLines = registry.model_lines.map((line) => ({ id: line.id, title: line.title,
    family: line.family, state: line.state, promotion_state: line.promotion_state,
    active_experiment: line.active_experiment ?? null, summary: line.summary }));
  return {
    schema: "ilxyr.public_snapshot.v1",
    source: { registry_path: "docs/lab-registry.json", registry_sha256: sha256(registryBytes),
      registry_commit: registryCommit, as_of: registry.as_of, generated_at: generatedAt,
      stale_after: staleAfter, freshness_rule_days: FRESH_DAYS },
    source_health: [
      { id: "lab-registry", status: "complete", as_of: registry.as_of },
      { id: "diagnostic-accepted-report", status: hasAcceptedReport ? "complete" : "unavailable",
        as_of: hasAcceptedReport ? new Date(acceptedReport.accepted_at_ms).toISOString() : null },
      permawebHealth ? { id: "permaweb-discovery", status: permawebHealth.status,
        as_of: permawebHealth.queriedAt, sources: permawebHealth.sources } :
        { id: "permaweb-discovery", status: "not_checked", as_of: null },
    ],
    freshness: Date.parse(generatedAt) > Date.parse(staleAfter) ? "stale" : "current_at_build",
    governance: { active_experiment: registry.governance.active_experiment,
      system_of_record: registry.governance.system_of_record },
    model_lines: modelLines,
    experiments,
    environments,
    results: result ? [result] : [],
  };
}

async function main() {
  const check = process.argv.includes("--check");
  const bytes = await readFile(registryPath);
  const registry = JSON.parse(bytes.toString("utf8"));
  const acceptedReport = JSON.parse(await readFile(reportPath, "utf8"));
  const executionReport = JSON.parse(await readFile(executionPath, "utf8"));
  const environment = JSON.parse(await readFile(environmentPath, "utf8"));
  const profile = JSON.parse(await readFile(profilePath, "utf8"));
  const registryCommit = execFileSync("git", ["log", "-1", "--format=%H", "--", "docs/lab-registry.json"],
    { cwd: root, encoding: "utf8" }).trim();
  const reportCommit = execFileSync("git", ["log", "-1", "--format=%H", "--", "experiments/cloud-launcher/diagnostic-v1/accepted-report.json"],
    { cwd: root, encoding: "utf8" }).trim();
  const existing = check ? JSON.parse(await readFile(snapshotPath, "utf8")) : null;
  const generatedAt = existing?.source?.generated_at || new Date().toISOString();
  const snapshot = buildPublicSnapshot({ registry, registryBytes: bytes, registryCommit, reportCommit,
    generatedAt, acceptedReport, executionReport, environment, profile });
  const output = `${JSON.stringify(snapshot, null, 2)}\n`;
  if (check) {
    for (const path of [snapshotPath, portalPath]) {
      try {
        assertSnapshotBytes(await readFile(path, "utf8"), output);
      } catch (error) {
        throw new Error(`${path}: ${error.message}`);
      }
    }
    console.log(`Public snapshot matches registry ${snapshot.source.registry_sha256}`);
  } else {
    await Promise.all([writeFile(snapshotPath, output), writeFile(portalPath, output)]);
    console.log(`Wrote public snapshot for registry ${snapshot.source.registry_sha256}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
