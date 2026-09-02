export const repository = "https://github.com/cenetex/ilXyr";
export const guide = "https://cenetex.github.io/ilXyr";
export const remoteProtocolCommit = "d246dcaa06669f7db1479c85bbbd6310f613f4a3";

export const publicRoutes = [
  { method: "GET", path: "/.well-known/ilxyr.json", description: "discover the public protocol and reporting status" },
  { method: "GET", path: "/api", description: "list public API routes" },
  { method: "GET", path: "/api/status", description: "read executor and compute status" },
  { method: "GET", path: "/api/protocols", description: "list protocol documents and command line calls" },
  { method: "GET", path: "/api/experiments", description: "list published experiments and decisions" },
  { method: "GET", path: "/api/environments", description: "list known execution environments and compatibility state" },
  { method: "GET", path: "/api/results", description: "list independently verified remote results" },
] as const;

export const siteStatus = [
  { key: "local_executor", value: "available_for_public_weight_experiments" },
  { key: "remote_report_verifier", value: "implemented" },
  { key: "provider_neutral_adapter_boundary", value: "implemented_with_fake_node" },
  { key: "local_single_writer_report_intake", value: "implemented" },
  { key: "general_cloud_launcher", value: "roadmap" },
  { key: "authenticated_network_report_intake", value: "implemented_not_deployed" },
  { key: "paid_cloud_experiment_work", value: "not_launched" },
  { key: "protected_weight_execution", value: "not_available" },
  { key: "mutable_cloud_checkouts", value: "not_accepted_as_reproducible_jobs" },
] as const;

export const cliGroups = [
  {
    name: "proposal",
    calls: [
      "proposal-submit <workspace> <proposal.json>",
      "proposal-review <workspace> <review.json>",
      "proposal-freeze <workspace> <proposal-id>",
      "proposal-package <workspace> <proposal-id> <contributions.json> <experiment.json>",
      "proposal-compile <workspace> <proposal-id>",
      "proposal-status <workspace> <proposal-id>",
    ],
  },
  {
    name: "experiment",
    calls: [
      "contribute <workspace> <contribution.json>",
      "compile <workspace> <experiment.json>",
      "forecast <workspace> <forecast.json>",
      "fund <workspace> <funding.json>",
      "admit <workspace> <experiment-id>",
      "run <workspace> <experiment-id> --execute",
      "status <workspace> <experiment-id>",
      "export-evidence <workspace> <evidence-ref> <native|ro-crate|in-toto|mlflow>",
      "verify <workspace>",
    ],
  },
  {
    name: "family",
    calls: [
      "family freeze <workspace> <family-manifest.json>",
      "family check <workspace> <family-manifest.json>",
      "family run <workspace> <family-manifest.json> --execute",
      "family settle <workspace> <family-manifest.json>",
    ],
  },
  {
    name: "attestation and policy",
    calls: [
      "trust-attestation-key <workspace> <service-id> <key-id> <public-key-base64>",
      "attest <workspace> <run-ref> <dsse-envelope.json>",
      "trust-key <workspace> <human-id> <key-id> <public-key-base64>",
      "budget-payload <budget.json>",
      "budget-register <workspace> <signed-budget.json>",
      "allocate <workspace> <budget-id> <experiment-id>...",
      "authorize <workspace> <budget-id> <experiment-id>",
      "run-auto <workspace> <budget-id> <experiment-id>",
      "executor-environment-verify <environment.json>",
      "executor-package-verify <environment.json> <job-package.json>",
      "execution-report-verify <environment.json> <job-package.json> <trusted-keys.json> <execution-report.json>",
      "remote-package-verify <workspace> <environment.json> <job-package.json>",
      "remote-authorize <workspace> <environment.json> <job-package.json> <budget-id> <authorization-id> <expires-at-ms>",
      "remote-report-accept <workspace> <execution-report.json>",
    ],
  },
  {
    name: "external and model inputs",
    calls: [
      "preregister-package <workspace> <experiment-id>",
      "preregister-record <workspace> <receipt.json>",
      "shared-task-register <workspace> <shared-task.json>",
      "huggingface-import <workspace> <repo-id> [commit-sha]",
      "huggingface-register <workspace> <model.json>",
      "huggingface-show <workspace> <model-ref>",
      "nsrl-register <workspace> <registration.json> <source-root> --execute",
      "nsrl-show <workspace> <model-ref>",
      "nsrl-gate-record <workspace> <gate-evidence.json> <evidence-root>",
      "nsrl-status <workspace> <model-ref>",
      "retro <workspace> <retro-registration.json> --execute",
    ],
  },
  {
    name: "evidence graph and research loop",
    calls: [
      "tournament-register <workspace> <tournament.json>",
      "tournament-settle <workspace> <tournament-id>",
      "loop-cycle <workspace> <budget-id> <cycle.json>",
      "sandbox <workspace> <budget-id> <sandbox-spec.json>",
      "certify <workspace> <certificate.json>",
      "claim-register <workspace> <claim.json>",
      "edge-record <workspace> <edge.json>",
      "replication-register <workspace> <contract.json>",
      "replication-allocate <workspace> <budget-id> <contract-ref>",
      "replication-settle <workspace> <contract-ref> <evidence-ref>",
      "claim-status <workspace> <claim-id>",
      "claim-support <workspace> <claim-id>",
      "program-status <workspace> [paper-contract.json]",
      "calibration <workspace> <actor-handle>",
    ],
  },
] as const;

export const protocolDocuments = [
  { id: "protocol-v1", title: "research protocol v1", url: `${repository}/blob/main/docs/PROTOCOL.md` },
  { id: "program", title: "research program", url: `${repository}/blob/main/docs/PROGRAM.md` },
  { id: "roadmap", title: "roadmap", url: `${repository}/blob/main/docs/ROADMAP.md` },
  {
    id: "cloud-executor-decision",
    title: "digest-bound cloud executor decision",
    url: `${repository}/blob/582dc88d702982ec2568ce02cd6f9a72f4fbacb1/docs/decisions/0006-digest-bound-cloud-executor.md`,
  },
  {
    id: "remote-reporting-decision",
    title: "remote reporting and well-known executors",
    url: `${repository}/blob/${remoteProtocolCommit}/docs/decisions/0007-remote-reporting-and-well-known-executors.md`,
  },
  { id: "schemas", title: "JSON schemas", url: `${repository}/tree/main/schemas` },
  { id: "security", title: "security boundary", url: `${repository}/blob/main/docs/SECURITY.md` },
  {
    id: "interoperability",
    title: "interoperability and attestations",
    url: `${repository}/blob/main/docs/INTEROPERABILITY.md`,
  },
] as const;

export const executionEnvironments = [
  {
    id: "environment://cenetex/public-v1",
    operator: "Cenetex",
    state: "reference_candidate",
    compatibility: "not_yet_verified",
    weight_classes: ["public"],
    network_modes: ["denied"],
    export_policies: ["metrics_only"],
    manifest_ref: null,
    conformance_ref: null,
    verified_results: 0,
    source: `${repository}/tree/${remoteProtocolCommit}/executor/cenetex-public-v1`,
    note: "Open reference profile; build artifacts and independent conformance are still pending.",
  },
] as const;

export type VerifiedExecutionResult = {
  id: string;
  experiment_id: string;
  run_ref: string;
  environment_ref: string;
  verification_summary_ref: string;
};

export const verifiedExecutionResults: readonly VerifiedExecutionResult[] = [];

export const discovery = {
  schema: "ilxyr.discovery.v1",
  service: "ilXyr public protocol index",
  canonical_url: "https://ilxyr.cenetex.com",
  public_api: "https://ilxyr.cenetex.com/api",
  environments: "https://ilxyr.cenetex.com/api/environments",
  verified_results: "https://ilxyr.cenetex.com/api/results",
  reporting: {
    protocol: "ilxyr.execution_report.v1",
    status: "not_available",
    endpoint: null,
    note: "The reporting API is implemented. Public deployment will add TLS, production trust roots, monitoring, backups, and recovery.",
  },
} as const;

export const experiments = [
  { id: "EXP-001", title: "Q2.3 local replay guard", status: "no-go", url: `${guide}/experiments/exp-001.html` },
  { id: "EXP-002", title: "Q2.4 cumulative replay guard", status: "no-go", url: `${guide}/experiments/exp-002.html` },
  { id: "EXP-003", title: "Q2.5 deterministic backtracking", status: "no-go", url: `${guide}/experiments/exp-003.html` },
  { id: "EXP-004", title: "Q2.6 replay-tangent projection", status: "go", url: `${guide}/experiments/exp-004.html` },
  {
    id: "EXP-005",
    title: "Q2.6 family replication",
    status: "verified upstream; local import pending",
    url: `${guide}/experiments/exp-005.html`,
  },
  { id: "EXP-006", title: "Holo HRR attention at T=512", status: "settled proxy result", url: `${guide}/experiments/exp-006.html` },
  { id: "EXP-007", title: "Zero to Solomon Q22 bridge", status: "go", url: `${guide}/experiments/exp-007.html` },
  {
    id: "EXP-008",
    title: "shortcut-resistant Q22 routing",
    status: "no-go",
    url: `${guide}/experiments/exp-008.html`,
  },
  {
    id: "REASONER-3.9",
    title: "active compositional law induction",
    status: "active research line",
    url: `${guide}/REASONER-LINE.html`,
  },
  {
    id: "NSRL-P10M-PILOT",
    title: "NSRL p10m managed pilot",
    status: "continue-experimental",
    url: `${repository}/blob/main/docs/experiments/NSRL-P10M-PILOT.md`,
  },
  {
    id: "WEIGHT-MULTIPLICITY-PHASE0",
    title: "weight multiplicity Phase 0",
    status: "diagnostic record",
    url: `${repository}/blob/main/docs/experiments/WEIGHT-MULTIPLICITY-PHASE0-DECISION.md`,
  },
] as const;
