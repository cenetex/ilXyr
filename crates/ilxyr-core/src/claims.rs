//! Claim compiler and program-level synthesis.
//!
//! The recording layer (`graph`, `workflow`, `autonomy`) records claims, evidence,
//! and certificates immutably. This module is the missing synthesis layer: it
//! evaluates every recorded [`Certificate`] against its [`Evidence`] to derive a
//! mechanical [`SupportStatus`] for each [`ClaimNode`], tracks freshness, and
//! rolls the whole ledger up into a [`ProgramOverview`].
//!
//! The predicate evaluator reuses [`crate::autonomy::certificate_matches`] so
//! that the synthesis layer can never disagree with the admission-time
//! certificate check.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::autonomy::{CERTIFICATE_RECORDED_EVENT, certificate_matches};
use crate::graph::{CLAIM_REGISTERED, EVIDENCE_RECORDED, EXPERIMENT_COMPILED};
use crate::huggingface::HUGGING_FACE_MODEL_REGISTERED;
use crate::model::ResearchEvent;
use crate::{
    Certificate, CertificatePredicate, ClaimNode, ComparisonOperator, CompiledExperiment, Error,
    Evidence, EvidenceLane, HuggingFaceModel, ModelFamily, Result, Workspace, artifacts_for,
    claim_status, registered_claim,
};

/// Mechanical support state for a claim, derived from recorded certificates.
///
/// Order of precedence when aggregating multiple certificates:
/// `Contradicted` beats `Stale` beats `Underpowered` beats `Supported`.
/// A claim with no certificates over its evidence is `Missing`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SupportStatus {
    /// At least one certificate's predicate holds over recorded evidence, and
    /// none are contradicted or stale.
    Supported,
    /// At least one certificate's predicate does not hold.
    Contradicted,
    /// Certificates exist and none are contradicted, but the claim lists more
    /// evidence than has certificates (partial coverage).
    Underpowered,
    /// No certificates have been recorded over the claim's evidence.
    Missing,
    /// The freshness prerequisite artifact was recorded after the supporting
    /// evidence, so the support is stale relative to a refreshed result.
    Stale,
}

impl SupportStatus {
    /// Rank for aggregation: lower wins.
    fn rank(&self) -> u8 {
        match self {
            Self::Contradicted => 0,
            Self::Stale => 1,
            Self::Underpowered => 2,
            Self::Missing => 3,
            Self::Supported => 4,
        }
    }
}

/// Per-certificate evaluation against its recorded evidence.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CertificateSupport {
    pub certificate_id: String,
    pub status: SupportStatus,
    pub evidence_ref: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metric: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub observed_value: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub threshold: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operator: Option<ComparisonOperator>,
}

/// The derived support state for a single claim.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClaimSupport {
    pub schema: String,
    pub claim_id: String,
    pub statement: String,
    pub status: SupportStatus,
    pub certificates: Vec<CertificateSupport>,
    pub spine_eligible: bool,
    pub shared_task_bound: bool,
    pub independent_replications: usize,
    /// The strongest evidence lane observed across supporting evidence.
    pub lane: EvidenceLane,
}

/// A paper's scope contract: what it claims, and what it does not claim.
///
/// `non_claims` are scope declarations. A supported claim whose statement
/// contains a non_claim phrase is a scope violation, surfaced in
/// [`ProgramOverview::scope_violations`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaperContract {
    pub schema: String,
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub non_claims: Vec<String>,
    /// Claim ids the paper asserts as required for submission.
    #[serde(default)]
    pub required_claims: Vec<String>,
}

/// One model entry in the program overview.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelEntry {
    pub model_ref: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub family: Option<ModelFamily>,
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parameter_count: Option<u64>,
}

/// One experiment entry in the program overview.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExperimentEntry {
    pub experiment_id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub family: Option<ModelFamily>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shared_task_ref: Option<String>,
    pub compiled: bool,
    pub admitted: bool,
    pub completed: bool,
    pub evidence_recorded: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_outcome: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_metric: Option<String>,
    #[serde(default)]
    pub metrics: BTreeMap<String, f64>,
}

/// A derived research overview: the program as it stands in the ledger today.
///
/// Every field is derived from recorded events; nothing here is hand-authored
/// prose. This is the nerve center's statement of record.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProgramOverview {
    pub schema: String,
    pub generated_at_ms: u128,
    pub claims: Vec<ClaimSupport>,
    pub experiments: Vec<ExperimentEntry>,
    pub models: Vec<ModelEntry>,
    #[serde(default)]
    pub non_claims: Vec<String>,
    #[serde(default)]
    pub scope_violations: Vec<String>,
    pub status_counts: BTreeMap<String, usize>,
}

/// Evaluate a single certificate against recorded evidence.
///
/// For `Metric` predicates this is a pure comparison. For `ExecutionFailure`
/// this reuses the admission-time [`certificate_matches`] check, which reads
/// the run record from the workspace.
pub fn evaluate_certificate(
    workspace: &Workspace,
    certificate: &Certificate,
    evidence: &Evidence,
) -> Result<SupportStatus> {
    let holds = certificate_matches(workspace, certificate, evidence)?;
    Ok(if holds {
        SupportStatus::Supported
    } else {
        SupportStatus::Contradicted
    })
}

/// Derive the mechanical support state for a claim.
///
/// Gathers every certificate recorded over the claim's `evidence_refs`,
/// evaluates each, and aggregates. Also carries the passive `spine_eligible`
/// flag from [`claim_status`] so callers get one object.
pub fn claim_support(workspace: &Workspace, claim_id: &str) -> Result<ClaimSupport> {
    let claim = registered_claim(workspace, claim_id)?;
    let status = claim_status(workspace, claim_id)?;
    let all_certificates = artifacts_for::<Certificate>(workspace, CERTIFICATE_RECORDED_EVENT)?;
    let claim_evidence: std::collections::BTreeSet<&String> = claim.evidence_refs.iter().collect();
    let relevant: Vec<&Certificate> = all_certificates
        .iter()
        .filter(|cert| claim_evidence.contains(&cert.evidence_ref))
        .collect();

    let mut per_cert: Vec<CertificateSupport> = Vec::new();
    let mut best_lane = EvidenceLane::Sandbox;
    for evidence_ref in &claim.evidence_refs {
        let evidence: Evidence = workspace.get(evidence_ref)?;
        best_lane = stronger_lane(best_lane, evidence.lane.clone());
    }

    // Freshness: if the claim declares a prerequisite artifact recorded after
    // its supporting evidence, the whole claim is stale.
    let mut stale = false;
    if let Some(prerequisite) = &claim.freshness_prerequisite {
        let evidence_event =
            event_for_artifact(workspace, EVIDENCE_RECORDED, &claim.evidence_refs)?;
        let prereq_event = event_for_artifact_single(workspace, prerequisite)?;
        if let (Some(ev), Some(pr)) = (evidence_event, prereq_event) {
            stale = pr.occurred_at_ms > ev.occurred_at_ms;
        }
    }

    if relevant.is_empty() {
        per_cert.push(CertificateSupport {
            certificate_id: String::new(),
            status: SupportStatus::Missing,
            evidence_ref: String::new(),
            metric: None,
            observed_value: None,
            threshold: None,
            operator: None,
        });
    } else {
        for cert in &relevant {
            let evidence: Evidence = workspace.get(&cert.evidence_ref)?;
            let mut status = evaluate_certificate(workspace, cert, &evidence)?;
            if stale && status == SupportStatus::Supported {
                status = SupportStatus::Stale;
            }
            let (metric, observed, threshold, operator) = match &cert.predicate {
                CertificatePredicate::Metric {
                    metric,
                    operator,
                    threshold,
                } => (
                    Some(metric.clone()),
                    evidence.metrics.get(metric).copied(),
                    Some(*threshold),
                    Some(operator.clone()),
                ),
                CertificatePredicate::ExecutionFailure => (None, None, None, None),
            };
            per_cert.push(CertificateSupport {
                certificate_id: cert.id.clone(),
                status,
                evidence_ref: cert.evidence_ref.clone(),
                metric,
                observed_value: observed,
                threshold,
                operator,
            });
        }
    }

    let aggregate = if relevant.is_empty() {
        SupportStatus::Missing
    } else {
        let covered = relevant.len();
        let listed = claim.evidence_refs.len();
        let worst_rank = per_cert
            .iter()
            .map(|c| c.status.rank())
            .min()
            .unwrap_or(SupportStatus::Missing.rank());
        let worst_status = per_cert
            .iter()
            .find(|c| c.status.rank() == worst_rank)
            .map(|c| c.status.clone())
            .unwrap_or(SupportStatus::Missing);
        if worst_status == SupportStatus::Supported && covered < listed {
            SupportStatus::Underpowered
        } else {
            worst_status
        }
    };

    Ok(ClaimSupport {
        schema: "ilxyr.claim_support.v1".to_owned(),
        claim_id: claim.id.clone(),
        statement: claim.statement.clone(),
        status: aggregate,
        certificates: per_cert,
        spine_eligible: status.spine_eligible,
        shared_task_bound: status.shared_task_bound,
        independent_replications: status.independent_replications,
        lane: best_lane,
    })
}

/// Derive the full research overview from the ledger.
///
/// Walks every registered claim, compiled experiment, and registered Hugging
/// Face model, and folds them into a single [`ProgramOverview`]. If a
/// [`PaperContract`] is provided, its `non_claims` are checked against supported
/// claim statements for scope violations.
pub fn program_status(
    workspace: &Workspace,
    paper: Option<&PaperContract>,
) -> Result<ProgramOverview> {
    let claims = artifacts_for::<ClaimNode>(workspace, CLAIM_REGISTERED)?;
    let mut claim_supports = Vec::with_capacity(claims.len());
    for claim in &claims {
        claim_supports.push(claim_support(workspace, &claim.id)?);
    }

    let experiments = experiment_entries(workspace)?;
    let models = model_entries(workspace)?;

    let mut status_counts = BTreeMap::new();
    for cs in &claim_supports {
        let key = match cs.status {
            SupportStatus::Supported => "supported",
            SupportStatus::Contradicted => "contradicted",
            SupportStatus::Underpowered => "underpowered",
            SupportStatus::Missing => "missing",
            SupportStatus::Stale => "stale",
        };
        *status_counts.entry(key.to_owned()).or_insert(0) += 1;
    }

    let (non_claims, scope_violations) = match paper {
        Some(contract) => {
            let mut violations = Vec::new();
            for cs in &claim_supports {
                if cs.status == SupportStatus::Supported {
                    for non_claim in &contract.non_claims {
                        if !non_claim.is_empty()
                            && statement_matches_scope(&cs.statement, non_claim)
                        {
                            violations.push(format!(
                                "supported claim {} falls under non_claim: {}",
                                cs.claim_id, non_claim
                            ));
                        }
                    }
                }
            }
            (contract.non_claims.clone(), violations)
        }
        None => (Vec::new(), Vec::new()),
    };

    Ok(ProgramOverview {
        schema: "ilxyr.program_overview.v1".to_owned(),
        generated_at_ms: crate::store::now_ms()?,
        claims: claim_supports,
        experiments,
        models,
        non_claims,
        scope_violations,
        status_counts,
    })
}

/// Load a [`PaperContract`] from a JSON file path.
pub fn load_paper_contract(path: &std::path::Path) -> Result<PaperContract> {
    let bytes = std::fs::read(path).map_err(|error| {
        Error::Validation(vec![format!(
            "could not read paper contract {}: {error}",
            path.display()
        )])
    })?;
    let contract: PaperContract = serde_json::from_slice(&bytes).map_err(Error::from)?;
    if contract.schema != "ilxyr.paper_contract.v1" {
        return Err(Error::Validation(vec![format!(
            "paper contract schema must be ilxyr.paper_contract.v1, got {}",
            contract.schema
        )]));
    }
    Ok(contract)
}

fn experiment_entries(workspace: &Workspace) -> Result<Vec<ExperimentEntry>> {
    let compiled = artifacts_for::<CompiledExperiment>(workspace, EXPERIMENT_COMPILED)?;
    let evidence = artifacts_for::<Evidence>(workspace, EVIDENCE_RECORDED)?;
    let mut entries = Vec::with_capacity(compiled.len());
    for exp in &compiled {
        let id = exp.spec.id.clone();
        let admitted = workspace.latest_event("AdmissionDecided", &id)?.is_some();
        let completed = workspace
            .latest_event("ExperimentCompleted", &id)?
            .is_some();
        let evidence_for_exp = evidence.iter().find(|e| e.experiment_id == id);
        let evidence_recorded = evidence_for_exp.is_some();
        let resolved_outcome = evidence_for_exp.map(|e| e.resolved_outcome.clone());
        let metrics = evidence_for_exp
            .map(|e| e.metrics.clone())
            .unwrap_or_default();
        let primary_metric = Some(exp.spec.outcome_contract.primary_metric.clone());
        entries.push(ExperimentEntry {
            experiment_id: id,
            title: exp.spec.title.clone(),
            family: exp.spec.family.clone(),
            shared_task_ref: exp.shared_task_ref.clone(),
            compiled: true,
            admitted,
            completed,
            evidence_recorded,
            resolved_outcome,
            primary_metric,
            metrics,
        });
    }
    Ok(entries)
}

fn model_entries(workspace: &Workspace) -> Result<Vec<ModelEntry>> {
    let models = artifacts_for::<HuggingFaceModel>(workspace, HUGGING_FACE_MODEL_REGISTERED)?;
    Ok(models
        .iter()
        .map(|m| ModelEntry {
            model_ref: m.model_ref.clone(),
            family: None,
            source: format!("huggingface:{}", m.repo_id),
            parameter_count: m.parameter_count,
        })
        .collect())
}

/// Find the event that recorded a given artifact for a given event type, or
/// fall back to scanning all events for the artifact_ref.
fn event_for_artifact(
    workspace: &Workspace,
    event_type: &str,
    artifact_refs: &[String],
) -> Result<Option<ResearchEvent>> {
    let events = workspace.events()?;
    // Prefer the named event type whose aggregate matches; otherwise scan by
    // artifact_ref across all event types.
    for ev in events.iter().rev() {
        if ev.event_type == event_type
            && artifact_refs
                .iter()
                .any(|r| ev.artifact_ref.as_deref() == Some(r.as_str()))
        {
            return Ok(Some(ev.clone()));
        }
    }
    for ev in events.iter().rev() {
        if let Some(ref a) = ev.artifact_ref {
            if artifact_refs.iter().any(|r| r == a) {
                return Ok(Some(ev.clone()));
            }
        }
    }
    Ok(None)
}

/// Find the most recent event that recorded a specific artifact ref.
fn event_for_artifact_single(
    workspace: &Workspace,
    artifact_ref: &str,
) -> Result<Option<ResearchEvent>> {
    let events = workspace.events()?;
    for ev in events.iter().rev() {
        if ev.artifact_ref.as_deref() == Some(artifact_ref) {
            return Ok(Some(ev.clone()));
        }
    }
    Ok(None)
}

fn stronger_lane(a: EvidenceLane, b: EvidenceLane) -> EvidenceLane {
    fn rank(l: &EvidenceLane) -> u8 {
        match l {
            EvidenceLane::Promoted => 2,
            EvidenceLane::Retro => 1,
            EvidenceLane::Sandbox => 0,
        }
    }
    if rank(&b) > rank(&a) { b } else { a }
}

/// Case-insensitive substring test for scope checking.
fn statement_matches_scope(statement: &str, non_claim: &str) -> bool {
    statement.to_lowercase().contains(&non_claim.to_lowercase())
}
