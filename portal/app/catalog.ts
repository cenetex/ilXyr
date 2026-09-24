export const repository = "https://github.com/cenetex/ilXyr";
export const guide = "https://cenetex.github.io/ilXyr";
export const remoteProtocolCommit = "d246dcaa06669f7db1479c85bbbd6310f613f4a3";
export const cloudDiagnosticCommit = "b6fdbd6c5f6fcda11839009ce2cbb527f0ac9b82";

export const publicRoutes = [
  { method: "GET", path: "/.well-known/ilxyr.json", description: "discover the public protocol and reporting status" },
  { method: "GET", path: "/api", description: "list public API routes" },
  { method: "GET", path: "/api/status", description: "read dated registry status and source health" },
  { method: "GET", path: "/api/protocols", description: "list protocol documents and command line calls" },
  { method: "GET", path: "/api/experiments", description: "list published experiments and decisions" },
  { method: "GET", path: "/api/environments", description: "list known execution environments and compatibility state" },
  { method: "GET", path: "/api/results", description: "list published acceptance records and their check states" },
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
      "remote-aws-stage <environment.json> <job-package.json> <aws-config.json>",
      "remote-aws-preflight <environment.json> <job-package.json> <aws-config.json>",
      "remote-aws-launch <workspace> <aws-config.json> <authorization-id>",
      "remote-aws-observe <workspace> <aws-config.json> <authorization-id>",
      "remote-aws-collect <workspace> <aws-config.json> <authorization-id>",
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
    url: `${repository}/blob/main/docs/decisions/0006-digest-bound-cloud-executor.md`,
  },
  {
    id: "remote-reporting-decision",
    title: "remote reporting and well-known executors",
    url: `${repository}/blob/${remoteProtocolCommit}/docs/decisions/0007-remote-reporting-and-well-known-executors.md`,
  },
  {
    id: "cloud-launcher-diagnostic",
    title: "first AWS cloud launcher result",
    url: `${repository}/blob/${cloudDiagnosticCommit}/docs/experiments/CLOUD-LAUNCHER-DIAGNOSTIC.md`,
  },
  { id: "schemas", title: "JSON schemas", url: `${repository}/tree/main/schemas` },
  { id: "security", title: "security boundary", url: `${repository}/blob/main/docs/SECURITY.md` },
  {
    id: "interoperability",
    title: "interoperability and attestations",
    url: `${repository}/blob/main/docs/INTEROPERABILITY.md`,
  },
] as const;

export const discovery = {
  schema: "ilxyr.discovery.v1",
  service: "ilXyr public protocol index",
  canonical_url: "https://ilxyr.cenetex.com",
  public_api: "https://ilxyr.cenetex.com/api",
  environments: "https://ilxyr.cenetex.com/api/environments",
  results: "https://ilxyr.cenetex.com/api/results",
  reporting: {
    protocol: "ilxyr.execution_report.v1",
    status: "not_available",
    endpoint: null,
    note: "The reporting API is implemented. Public deployment will add TLS, production trust roots, monitoring, backups, and recovery.",
  },
} as const;
