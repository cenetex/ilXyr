export type EvidenceFile = {
  bytes: number;
  media_type: string;
  path: string;
  sha256: string;
};

export type RegistryRecord = {
  txId: string;
  owner: string;
  publisherAddress?: string;
  publisherListed: boolean;
  publisherAuthentication?: "pass" | "fail" | "unknown" | "not_checked";
  bundleOwnerAuthentication?: "pass" | "fail" | "unknown" | "not_checked";
  provenanceError?: string;
  experimentId: string;
  evidenceRef: string;
  title: string;
  outcome: string;
  family?: string;
  blockHeight?: number;
  timestamp?: number;
  files: EvidenceFile[];
  manifestError?: string;
  source: "canonical-index" | "gateway" | "seed" | "ao";
};

export type ReadinessCheck = {
  label: string;
  pass: boolean;
};

export type AoProposal = {
  id: string;
  owner: string;
  revision: number;
  revision_message_id: string;
  predecessor_ref?: string;
  revisions: { revision: number; message_id: string; predecessor_ref?: string; addressed_review_id?: string; response?: string; created_at: number }[];
  resolutions?: Record<string, { review_id: string; reviewer: string; message_id: string; created_at: number }>;
  title: string;
  summary: string;
  hypothesis: string;
  family: "zero" | "solomon";
  baseline: string;
  dataset: string;
  metric: string;
  threshold: number;
  seeds: number[];
  compute_credits: number;
  evidence_level: string;
  export_policy: string;
  novelty: string;
  status: "review" | "candidate" | "blocked";
  created_at: number;
  frozen_at?: number;
  frozen_proposal_ref?: string;
  frozen_review_refs?: string[];
  readiness?: { score: number; promotable: boolean; checks: ReadinessCheck[] };
  reviews?: AoReview[];
  forecasts?: AoForecast[];
  funding?: AoFunding[];
};

export type AoReview = {
  id: string;
  reviewer: string;
  message_id: string;
  revision: number;
  proposal_ref: string;
  category: string;
  severity: "advisory" | "blocking" | "endorsement";
  comment: string;
  created_at: number;
};

export type AoForecast = {
  forecaster: string;
  probability: number;
  stake: number;
  rationale: string;
  created_at: number;
};

export type AoFunding = {
  funder: string;
  compute_credits: number;
  rationale: string;
  created_at: number;
};

export type AoSnapshot = {
  schema: "ilxyr.registry-state.v2";
  version: 2;
  process_id: string;
  owner: string;
  sequence: number;
  latest_index_tx?: string;
  proposals: AoProposal[];
  evidence: RegistryRecord[];
};

export type IndexEntry = {
  experiment_id: string;
  bundle_tx: string;
  evidence_ref: string;
  outcome: string;
  title?: string;
  owner?: string;
  family?: string;
};

export type CanonicalIndex = {
  schema: "ilxyr.index.v1";
  sequence: number;
  previous_index_tx: string | null;
  ledger_head: string;
  published_by: string;
  generated_at: string;
  experiments: IndexEntry[];
};
