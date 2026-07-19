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
    pub lineage: ResearchLineage,
    pub baseline: String,
    #[serde(default)]
    pub datasets: Vec<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CompiledExperiment {
    pub schema: String,
    pub spec: ExperimentSpec,
    pub source_digest: String,
    pub resolved_lineage: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shared_task_ref: Option<String>,
    pub evidence_authority: GroundingAuthority,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_attestation: Option<SourceSnapshot>,
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
