use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ActorKind {
    Human,
    Model,
    Service,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ActorRef {
    pub id: String,
    pub kind: ActorKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_ref: Option<String>,
}

impl ActorRef {
    #[must_use]
    pub fn service(id: &str) -> Self {
        Self {
            id: id.to_owned(),
            kind: ActorKind::Service,
            model_ref: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContributionStage {
    Hypothesis,
    MathematicalFoundation,
    EngineeringReview,
    ExperimentDesign,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchContribution {
    pub schema: String,
    pub id: String,
    pub stage: ContributionStage,
    pub actor: ActorRef,
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub input_refs: Vec<String>,
    #[serde(default)]
    pub claims: Vec<String>,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ResearchLineage {
    pub hypothesis: String,
    pub mathematical_foundation: String,
    pub engineering_review: String,
    pub experiment_design: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct MetricSpec {
    pub name: String,
    pub unit: String,
    pub description: String,
    /// Declared answer-token budget for this task (issue #17), when the
    /// metric measures an answer-bearing task. Additive, default `None`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer_token_budget: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum ModelFamily {
    Zero,
    Solomon,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ArtifactBinding {
    pub handle: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct FamilyTaskBinding {
    pub family: ModelFamily,
    pub encoding: String,
    pub verifier: String,
    pub designated_proposer: ActorRef,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub implementation: Option<SourceSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SharedTaskContract {
    pub schema: String,
    pub id: String,
    pub title: String,
    pub dataset: ArtifactBinding,
    pub eval_set: ArtifactBinding,
    pub metrics: Vec<MetricSpec>,
    pub seeds: Vec<u64>,
    pub family_bindings: Vec<FamilyTaskBinding>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ComparisonOperator {
    Gt,
    Gte,
    Lt,
    Lte,
    Eq,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuthorityLevel {
    ExactCheck,
    DeterministicReplay,
    CorpusProxy,
    Review,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct AuthorityScope {
    pub seeds: Vec<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eval_set: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub coverage: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AuthorityProvenance {
    pub artifact_hashes: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_lineage: Option<String>,
    pub checker: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct GroundingAuthority {
    pub level: AuthorityLevel,
    pub scope: AuthorityScope,
    pub provenance: AuthorityProvenance,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceLane {
    Sandbox,
    Promoted,
    Retro,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum OutcomePredicate {
    Metric {
        metric: String,
        operator: ComparisonOperator,
        threshold: f64,
    },
    ExecutionFailure,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OutcomeDefinition {
    pub id: String,
    pub description: String,
    pub predicate: OutcomePredicate,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OutcomeContract {
    pub primary_metric: String,
    pub success_outcome: String,
    pub outcomes: Vec<OutcomeDefinition>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NetworkPolicy {
    Open,
    Denied,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExecutionSpec {
    pub executor: String,
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub timeout_seconds: u64,
    pub max_cost_credits: u64,
    pub network: NetworkPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FundingPolicy {
    pub required_compute_credits: u64,
    pub minimum_forecasters: usize,
    pub minimum_total_stake: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WeightClass {
    Public,
    Internal,
    Restricted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CodePolicy {
    Arbitrary,
    ApprovedImageOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExportPolicy {
    Artifacts,
    MetricsOnly,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RegistrationProvider {
    Osf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RegistrationVisibility {
    Public,
    Embargoed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RegistrationRequirement {
    pub provider: RegistrationProvider,
    pub visibility: RegistrationVisibility,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SecurityPolicy {
    pub weight_class: WeightClass,
    pub code_policy: CodePolicy,
    pub export_policy: ExportPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExperimentSpec {
    pub schema: String,
    pub id: String,
    pub title: String,
    pub hypothesis: String,
    pub rationale: String,
    pub proposer: ActorRef,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub family: Option<ModelFamily>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shared_task_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preregistration: Option<RegistrationRequirement>,
    pub lineage: ResearchLineage,
    pub baseline: String,
    #[serde(default)]
    pub datasets: Vec<String>,
    /// Optional immutable corpus release refs keyed by the dataset handles above.
    /// When present, compilation resolves every handle and rejects registry drift.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub dataset_bindings: BTreeMap<String, String>,
    #[serde(default)]
    pub models: Vec<String>,
    pub metrics: Vec<MetricSpec>,
    pub seeds: Vec<u64>,
    pub outcome_contract: OutcomeContract,
    pub execution: ExecutionSpec,
    pub funding: FundingPolicy,
    pub security: SecurityPolicy,
    pub evidence_authority: GroundingAuthority,
    pub expected_outputs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ExperimentProposal {
    pub schema: String,
    pub id: String,
    pub revision: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub predecessor_ref: Option<String>,
    pub experiment_id: String,
    pub proposer: ActorRef,
    pub title: String,
    pub summary: String,
    pub hypothesis: String,
    pub novelty: String,
    pub family: ModelFamily,
    pub baseline: String,
    pub datasets: Vec<String>,
    pub primary_metric: String,
    pub success_operator: ComparisonOperator,
    pub success_threshold: f64,
    pub seeds: Vec<u64>,
    pub compute_credits: u64,
    pub evidence_level: AuthorityLevel,
    pub export_policy: ExportPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProposalReviewSeverity {
    Advisory,
    Blocking,
    Endorsement,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReview {
    pub schema: String,
    pub id: String,
    pub proposal_id: String,
    pub proposal_ref: String,
    pub reviewer: ActorRef,
    pub category: String,
    pub severity: ProposalReviewSeverity,
    pub comment: String,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct FrozenProposalCandidate {
    pub schema: String,
    pub id: String,
    pub proposal_id: String,
    pub proposal_ref: String,
    pub revision: u64,
    pub proposer: ActorRef,
    pub review_refs: Vec<String>,
    pub frozen_at_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProposalContributionPackage {
    pub schema: String,
    pub id: String,
    pub proposal_id: String,
    pub proposal_ref: String,
    pub candidate_ref: String,
    pub review_refs: Vec<String>,
    pub contributions: Vec<ResearchContribution>,
    pub experiment: ExperimentSpec,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProposalCompilation {
    pub schema: String,
    pub id: String,
    pub proposal_id: String,
    pub package_ref: String,
    pub contribution_refs: BTreeMap<String, String>,
    pub compiled_ref: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProposalReadinessCheck {
    pub check: String,
    pub passed: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProposalStatus {
    pub proposal_id: String,
    pub current_ref: String,
    pub revision: u64,
    pub frozen: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub candidate_ref: Option<String>,
    pub current_review_refs: Vec<String>,
    pub packaged: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package_ref: Option<String>,
    pub compiled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compiled_ref: Option<String>,
    pub readiness: Vec<ProposalReadinessCheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CompiledExperiment {
    pub schema: String,
    pub spec: ExperimentSpec,
    pub source_digest: String,
    pub resolved_lineage: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub resolved_datasets: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shared_task_ref: Option<String>,
    pub evidence_authority: GroundingAuthority,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegistrationPackage {
    pub schema: String,
    pub id: String,
    pub experiment_id: String,
    pub compiled_ref: String,
    pub compiled: CompiledExperiment,
    pub requirement: RegistrationRequirement,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExternalRegistrationReceipt {
    pub schema: String,
    pub id: String,
    pub experiment_id: String,
    pub provider: RegistrationProvider,
    pub visibility: RegistrationVisibility,
    pub package_ref: String,
    pub registration_id: String,
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doi: Option<String>,
    pub registered_by: ActorRef,
    pub registered_at_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrustedAttestationKey {
    pub schema: String,
    pub key_id: String,
    pub executor: ActorRef,
    pub algorithm: String,
    pub public_key: String,
    pub trusted_at_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DsseSignature {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keyid: Option<String>,
    pub sig: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DsseEnvelope {
    pub payload_type: String,
    pub payload: String,
    pub signatures: Vec<DsseSignature>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExecutorAttestation {
    pub schema: String,
    pub id: String,
    pub run_ref: String,
    pub envelope: DsseEnvelope,
    pub statement: Value,
    pub predicate_type: String,
    pub verified_key_ids: Vec<String>,
    pub recorded_at_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClaimNode {
    pub schema: String,
    pub id: String,
    pub statement: String,
    pub evidence_refs: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shared_task_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub freshness_prerequisite: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh_command: Option<String>,
    pub created_by: ActorRef,
    pub created_at_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceRelation {
    Supports,
    Contradicts,
    Replicates,
    DependsOn,
    Supersedes,
    Subsumes,
    DerivedFrom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvidenceGraphEdge {
    pub schema: String,
    pub id: String,
    pub source: String,
    pub target: String,
    pub relation: EvidenceRelation,
    pub asserted_by: ActorRef,
    pub asserted_at_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReplicationKind {
    Capability,
    ComputationalEquivalence,
    Both,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReplicationContract {
    pub schema: String,
    pub id: String,
    pub target_claim: String,
    pub reference_evidence_ref: String,
    pub replication_experiment_id: String,
    pub kind: ReplicationKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tolerances: Option<BTreeMap<String, f64>>,
    pub eval_set: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agreement_metric: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agreement_threshold: Option<f64>,
    pub declared_by: ActorRef,
    pub declared_at_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IndependenceAssessment {
    pub shared_artifacts: Vec<String>,
    pub distinct_checker: bool,
    pub distinct_model_lineage: bool,
    pub independent: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReplicationSettlement {
    pub schema: String,
    pub id: String,
    pub contract_ref: String,
    pub target_claim: String,
    pub reference_evidence_ref: String,
    pub replication_evidence_ref: String,
    pub capability_passed: bool,
    pub equivalence_passed: bool,
    pub forward_risked: bool,
    pub independence: IndependenceAssessment,
    pub succeeded: bool,
    pub settled_at_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClaimStatus {
    pub schema: String,
    pub claim: ClaimNode,
    pub edges: Vec<EvidenceGraphEdge>,
    pub replications: Vec<ReplicationSettlement>,
    pub shared_task_bound: bool,
    pub prospectively_risked: bool,
    pub cold_replayable: bool,
    pub independent_replications: usize,
    pub spine_eligible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ExternalArtifact {
    pub path: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SourceSnapshot {
    pub repository: String,
    pub commit: String,
    pub artifacts: Vec<ExternalArtifact>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ReplayCommand {
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub timeout_seconds: u64,
    pub network: NetworkPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct RetroRegistrationSpec {
    pub schema: String,
    pub id: String,
    pub claim: String,
    pub family: ModelFamily,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shared_task_id: Option<String>,
    pub source: SourceSnapshot,
    pub metrics: Vec<MetricSpec>,
    pub seeds: Vec<u64>,
    pub replay: ReplayCommand,
    pub authority: GroundingAuthority,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RetroRegistration {
    pub schema: String,
    pub id: String,
    pub claim: String,
    pub family: ModelFamily,
    pub plan_ref: String,
    pub run_ref: String,
    pub evidence_ref: String,
    pub grounded: bool,
    pub forecast_risked: bool,
    pub registered_at_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CompletedRetroRegistration {
    pub run: RunRecord,
    pub evidence: Evidence,
    pub registration: RetroRegistration,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LoopCycle {
    pub schema: String,
    pub contributions: Vec<ResearchContribution>,
    pub experiment: ExperimentSpec,
    pub forecasts: Vec<Forecast>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LoopCycleResult {
    pub experiment_id: String,
    pub compiled_ref: String,
    pub forecast_refs: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allocation: Option<AllocationReport>,
    pub completed: CompletedExperiment,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Forecast {
    pub schema: String,
    pub id: String,
    pub experiment_id: String,
    pub forecaster: ActorRef,
    pub probabilities: BTreeMap<String, f64>,
    pub stake: u64,
    pub rationale: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FundingCommitment {
    pub schema: String,
    pub id: String,
    pub experiment_id: String,
    pub funder: ActorRef,
    pub compute_credits: u64,
    pub rationale: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GateCheck {
    pub gate: String,
    pub passed: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AdmissionDecision {
    pub schema: String,
    pub experiment_id: String,
    pub accepted: bool,
    pub checks: Vec<GateCheck>,
    pub decided_at_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunRecord {
    pub schema: String,
    pub id: String,
    pub experiment_id: String,
    pub started_at_ms: u128,
    pub completed_at_ms: u128,
    pub exit_code: i32,
    pub timed_out: bool,
    pub stdout: String,
    pub stderr: String,
    pub output_truncated: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_error: Option<String>,
    pub metrics: BTreeMap<String, f64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub artifacts: Vec<RunOutputArtifact>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_attestation: Option<SourceSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RunOutputArtifact {
    pub name: String,
    pub uri: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub media_type: String,
    pub provider_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct OciJobDispatch {
    pub schema: String,
    pub id: String,
    pub experiment_id: String,
    pub compiled_ref: String,
    pub executor: ActorRef,
    pub provider_job_ref: String,
    pub idempotency_key: String,
    pub materializations: BTreeMap<String, String>,
    pub dispatched_at_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct OciJobCompletion {
    pub schema: String,
    pub id: String,
    pub dispatch_ref: String,
    pub executor: ActorRef,
    pub exit_code: i32,
    pub timed_out: bool,
    pub metrics: BTreeMap<String, f64>,
    #[serde(default)]
    pub artifacts: Vec<RunOutputArtifact>,
    pub completed_at_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Evidence {
    pub schema: String,
    pub id: String,
    pub experiment_id: String,
    pub run_ref: String,
    pub resolved_outcome: String,
    pub metrics: BTreeMap<String, f64>,
    pub recorded_at_ms: u128,
    pub authority: GroundingAuthority,
    pub lane: EvidenceLane,
    /// Recorded per-task answer-token masses (issue #17). Additive.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer_token_mass: Option<BTreeMap<String, u64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CertificatePredicate {
    Metric {
        metric: String,
        operator: ComparisonOperator,
        threshold: f64,
    },
    ExecutionFailure,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CertificateDomain {
    Enumerated {
        values: Vec<Value>,
    },
    DecidableFragment {
        fragment: String,
        declaration: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CheckerRef {
    pub id: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Certificate {
    pub schema: String,
    pub id: String,
    pub evidence_ref: String,
    pub predicate: CertificatePredicate,
    pub domain: CertificateDomain,
    pub checker: CheckerRef,
    pub checked_artifacts: Vec<String>,
    pub issued_at_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ForecastSettlement {
    pub schema: String,
    pub forecast_id: String,
    pub experiment_id: String,
    pub resolved_outcome: String,
    pub brier_score: f64,
    pub stake: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CalibrationRecord {
    pub schema: String,
    pub handle: String,
    pub forecasts_settled: usize,
    pub reliability: f64,
    pub resolution: f64,
    pub brier_score: f64,
    pub uncertainty: f64,
    pub probationary: bool,
    pub last_settlement_at_ms: u128,
    pub forecast_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CompletedExperiment {
    pub run: RunRecord,
    pub evidence: Evidence,
    pub settlements: Vec<ForecastSettlement>,
    pub calibrations: Vec<CalibrationRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrustedPolicyKey {
    pub schema: String,
    pub key_id: String,
    pub owner: ActorRef,
    pub public_key: String,
    pub trusted_at_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PolicySignature {
    pub algorithm: String,
    pub key_id: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExecutableCap {
    pub per_run_credits: u64,
    pub per_epoch_credits: u64,
    pub network: NetworkPolicy,
    pub allowed_argument_sets: Vec<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BaselineRule {
    pub operator: ComparisonOperator,
    pub threshold: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AcknowledgementThresholds {
    pub new_executable: bool,
    pub network_beyond_policy: bool,
    pub cumulative_spend_pct: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EpochBudget {
    pub schema: String,
    pub id: String,
    pub epoch: u64,
    pub total_compute_credits: u64,
    pub replication_reserve_pct: f64,
    pub per_executable_caps: BTreeMap<String, ExecutableCap>,
    pub allowlisted_executables: Vec<String>,
    pub promoted_metrics: Vec<String>,
    pub baselines: BTreeMap<String, BaselineRule>,
    pub acknowledgement_thresholds: AcknowledgementThresholds,
    pub signed_by: String,
    pub signed_at_ms: u128,
    pub signature: PolicySignature,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AllocationKind {
    Promoted,
    Sandbox,
    Replication,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AllocationRecord {
    pub schema: String,
    pub id: String,
    pub budget_id: String,
    pub experiment_id: String,
    pub executable: String,
    pub compute_credits: u64,
    pub kind: AllocationKind,
    pub allocated_at_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AllocationDecision {
    pub experiment_id: String,
    pub disagreement: f64,
    pub priority: f64,
    pub compute_credits: u64,
    pub allocated: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AllocationReport {
    pub budget_id: String,
    pub allocated_compute_credits: u64,
    pub decisions: Vec<AllocationDecision>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunAuthorization {
    pub budget_id: String,
    pub experiment_id: String,
    pub unattended: bool,
    pub acknowledgement_reasons: Vec<String>,
    pub allocated_compute_credits: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SandboxSpec {
    pub schema: String,
    pub id: String,
    pub experiment_id: String,
    pub executable: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub timeout_seconds: u64,
    pub cost_credits: u64,
    pub network: NetworkPolicy,
    pub metrics: Vec<MetricSpec>,
    pub authority: GroundingAuthority,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SandboxRun {
    pub schema: String,
    pub id: String,
    pub sandbox_id: String,
    pub experiment_id: String,
    pub budget_id: String,
    pub executable: String,
    pub args: Vec<String>,
    pub cost_credits: u64,
    pub started_at_ms: u128,
    pub completed_at_ms: u128,
    pub exit_code: i32,
    pub timed_out: bool,
    pub stdout: String,
    pub stderr: String,
    pub output_truncated: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_error: Option<String>,
    pub metrics: BTreeMap<String, f64>,
    pub authority: GroundingAuthority,
    pub previous_event: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PromotionEligibility {
    pub sandbox_id: String,
    pub evidence_ref: String,
    pub budget_id: String,
    pub authority_sufficient: bool,
    pub passed_metrics: Vec<String>,
    pub eligible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CompletedSandbox {
    pub run: SandboxRun,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence: Option<Evidence>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub promotion: Option<PromotionEligibility>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchEvent {
    pub schema: String,
    pub event_type: String,
    pub aggregate_id: String,
    pub actor: ActorRef,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artifact_ref: Option<String>,
    pub occurred_at_ms: u128,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_event: Option<String>,
    pub event_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VerificationReport {
    pub objects_checked: usize,
    #[serde(default)]
    pub blobs_checked: usize,
    pub events_checked: usize,
    pub valid: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExperimentStatus {
    pub experiment_id: String,
    pub compiled_ref: String,
    pub forecasts: usize,
    pub total_stake: u64,
    pub funding_commitments: usize,
    pub funded_compute_credits: u64,
    pub latest_admission: Option<AdmissionDecision>,
    pub execution_started: bool,
    pub latest_run: Option<RunRecord>,
    pub latest_evidence: Option<Evidence>,
}
