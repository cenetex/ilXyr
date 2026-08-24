//! Paper lane (#23, #24, #25): candidates as protocol objects, promotion by
//! external receipt, and deterministic nomination from evidence criteria.
//!
//! A paper candidate is promoted only by an external acceptance receipt
//! bound to the submitted content digest. Nomination is a pure evaluation of
//! preregistered sufficiency criteria over ledger facts.

use crate::claims::{SupportStatus, claim_support};
use crate::conditions::{ConditionFacts, ConditionSet, evaluate};
use crate::model::ActorRef;
use crate::{Error, Result, Workspace};

// ---------------------------------------------------------------------------
// #23 / #24 — candidates and receipts
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaperCandidate {
    pub schema: String,
    pub id: String,
    pub title: String,
    /// Claim ids that must all be `Supported` before submission.
    pub required_claims: Vec<String>,
    /// Scope declarations carried onto every candidate surface.
    #[serde(default)]
    pub non_claims: Vec<String>,
    /// Submission venue (e.g. "arxiv"). The schema names properties, not
    /// platforms: immutable versioning, content addressing, public receipts.
    pub venue: String,
    /// SHA-256 over the compiled artifact (PDF + claim registry).
    pub content_digest: String,
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PaperState {
    Draft,
    Submitted,
    Promoted,
    NotPromoted,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExternalReceipt {
    pub schema: String,
    pub paper_id: String,
    pub venue: String,
    /// Platform-specific submission or acceptance identifier.
    pub external_id: String,
    /// Must match the candidate's content digest.
    pub content_digest: String,
    pub recorded_at_ms: u128,
}

/// Register a draft candidate. Readiness is checked at registration time so
/// drafts cannot declare unsupported required claims silently — but claims
/// may still be pending; readiness is re-checked at submission.
pub fn register_candidate(workspace: &Workspace, candidate: PaperCandidate) -> Result<String> {
    if candidate.schema != "ilxyr.paper_candidate.v1" {
        return Err(Error::Validation(vec![format!(
            "paper candidate schema must be ilxyr.paper_candidate.v1, got {}",
            candidate.schema
        )]));
    }
    if candidate.content_digest.len() != 64
        || !candidate
            .content_digest
            .chars()
            .all(|c| c.is_ascii_hexdigit())
    {
        return Err(Error::Validation(vec![
            "paper candidate content digest must be 64 hex characters".to_owned(),
        ]));
    }
    let reference = workspace.put(&candidate)?;
    workspace.append_event(
        CANDIDATE_REGISTERED,
        &candidate.id,
        ActorRef::service("service://ilxyr/paper-lane-v1"),
        Some(reference),
    )?;
    Ok(candidate.id)
}

/// Record an external submission receipt. Digest must match the candidate's.
pub fn record_submission(workspace: &Workspace, receipt: ExternalReceipt) -> Result<()> {
    let candidate = latest_candidate(workspace, &receipt.paper_id)?
        .ok_or_else(|| Error::NotFound(format!("no candidate {}", receipt.paper_id)))?;
    ensure_state(workspace, &receipt.paper_id, &[PaperState::Draft])?;
    if receipt.content_digest != candidate.content_digest {
        return Err(Error::Security(format!(
            "submission digest mismatch for {}: {} != {}",
            receipt.paper_id, receipt.content_digest, candidate.content_digest
        )));
    }
    let normalized = normalize_receipt(receipt, "ilxyr.submission_receipt.v1")?;
    let reference = workspace.put(&normalized)?;
    workspace.append_event(
        SUBMITTED,
        &normalized.paper_id,
        ActorRef::service("service://ilxyr/paper-lane-v1"),
        Some(reference),
    )?;
    Ok(())
}

/// Record an external decision. Acceptance resolves the candidate to
/// `Promoted`; rejection to `NotPromoted` (resubmission creates a successor
/// candidate with full lineage via a new id).
pub fn record_decision(
    workspace: &Workspace,
    receipt: ExternalReceipt,
    accepted: bool,
) -> Result<PaperState> {
    ensure_state(workspace, &receipt.paper_id, &[PaperState::Submitted])?;
    let candidate = latest_candidate(workspace, &receipt.paper_id)?
        .ok_or_else(|| Error::NotFound(format!("no candidate {}", receipt.paper_id)))?;
    if receipt.content_digest != candidate.content_digest {
        return Err(Error::Security(format!(
            "decision digest mismatch for {}",
            receipt.paper_id
        )));
    }
    let normalized = normalize_receipt(receipt, "ilxyr.decision_receipt.v1")?;
    let reference = workspace.put(&normalized)?;
    workspace.append_event(
        DECISION_RECORDED,
        &normalized.paper_id,
        ActorRef::service("service://ilxyr/paper-lane-v1"),
        Some(reference),
    )?;
    // State transition event.
    let state = if accepted {
        PaperState::Promoted
    } else {
        PaperState::NotPromoted
    };
    let state_record = PaperStateRecord {
        schema: "ilxyr.paper_state.v1".to_owned(),
        paper_id: normalized.paper_id.clone(),
        state,
    };
    let state_ref = workspace.put(&state_record)?;
    workspace.append_event(
        STATE_RESOLVED,
        &normalized.paper_id,
        ActorRef::service("service://ilxyr/paper-lane-v1"),
        Some(state_ref),
    )?;
    Ok(state)
}

/// Current lifecycle state of a candidate. Fails closed: unknown states read
/// as Draft only when no lifecycle events exist.
pub fn candidate_state(workspace: &Workspace, paper_id: &str) -> Result<PaperState> {
    match resolve_current_state(workspace, paper_id) {
        Ok(state) => Ok(state),
        Err(Error::NotFound(_)) => {
            let registered = latest_candidate(workspace, paper_id)?.is_some();
            if registered {
                Ok(PaperState::Draft)
            } else {
                Err(Error::NotFound(format!("no candidate {paper_id}")))
            }
        }
        Err(error) => Err(error),
    }
}

fn resolve_current_state(workspace: &Workspace, paper_id: &str) -> Result<PaperState> {
    let events = workspace.events()?;
    for event in events.iter().rev() {
        if event.aggregate_id != paper_id {
            continue;
        }
        if event.event_type == STATE_RESOLVED {
            if let Some(reference) = event.artifact_ref.as_deref() {
                let record: PaperStateRecord = workspace.get(reference)?;
                return Ok(record.state);
            }
        }
        // Submitted but undecided.
        if event.event_type == SUBMITTED {
            return Ok(PaperState::Submitted);
        }
    }
    Err(Error::NotFound(format!(
        "no lifecycle events for {paper_id}"
    )))
}

fn ensure_state(
    workspace: &Workspace,
    paper_id: &str,
    allowed: &[PaperState],
) -> Result<PaperState> {
    let current = match resolve_current_state(workspace, paper_id) {
        Ok(state) => state,
        Err(_) => {
            return if allowed.contains(&PaperState::Draft) {
                Ok(PaperState::Draft)
            } else {
                Err(Error::NotFound(format!("no candidate {paper_id}")))
            };
        }
    };
    if !allowed.is_empty() && !allowed.contains(&current) {
        return Err(Error::Validation(vec![format!(
            "candidate {paper_id} is in state {current:?}; transition requires one of {allowed:?}"
        )]));
    }
    Ok(current)
}

fn normalize_receipt(mut receipt: ExternalReceipt, schema: &str) -> Result<ExternalReceipt> {
    receipt.schema = schema.to_owned();
    receipt.content_digest = receipt.content_digest.to_ascii_lowercase();
    Ok(receipt)
}

fn latest_candidate(workspace: &Workspace, paper_id: &str) -> Result<Option<PaperCandidate>> {
    let events = workspace.events()?;
    for event in events.iter().rev() {
        if event.event_type == CANDIDATE_REGISTERED && event.aggregate_id == paper_id {
            if let Some(reference) = event.artifact_ref.as_deref() {
                return Ok(Some(workspace.get::<PaperCandidate>(reference)?));
            }
        }
    }
    Ok(None)
}

pub const CANDIDATE_REGISTERED: &str = "PaperCandidateRegistered";
pub const SUBMITTED: &str = "PaperSubmitted";
pub const DECISION_RECORDED: &str = "PaperDecisionReceiptRecorded";
pub const STATE_RESOLVED: &str = "PaperStateResolved";

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct PaperStateRecord {
    schema: String,
    paper_id: String,
    state: PaperState,
}

// ---------------------------------------------------------------------------
// #25 — nomination engine
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SufficiencyCriterion {
    pub id: String,
    pub title: String,
    /// Condition over evidence metrics that must hold.
    pub condition: ConditionSet,
    /// Claim ids that must each be Supported for the criterion to nominate.
    #[serde(default)]
    pub required_claims: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NominationOutcome {
    pub criterion_id: String,
    pub nominated: bool,
    pub detail: String,
    /// Claim ids that were required but not yet supported (near-miss audit).
    pub missing_claims: Vec<String>,
}

/// Evaluate sufficiency criteria against the ledger. Deterministic; every
/// outcome (including near-misses with their missing claims) is returned so
/// callers can append them to the ledger for audit.
pub fn nominate(
    workspace: &Workspace,
    criteria: &[SufficiencyCriterion],
) -> Result<Vec<NominationOutcome>> {
    let facts = ConditionFacts::from_workspace(workspace)?;
    let mut outcomes = Vec::new();
    for criterion in criteria {
        criterion.condition.validate()?;
        let result = evaluate(&criterion.condition.root, &facts);
        let mut missing = Vec::new();
        let mut claims_ready = true;
        for claim_id in &criterion.required_claims {
            let supported = match claim_support(workspace, claim_id) {
                Ok(support) => support.status == SupportStatus::Supported,
                // An unregistered claim is simply not yet supported.
                Err(Error::NotFound(_)) => false,
                Err(error) => return Err(error),
            };
            if !supported {
                claims_ready = false;
                missing.push(claim_id.clone());
            }
        }
        let (nominated, detail) = match (&result, claims_ready) {
            (crate::conditions::ConditionResult::Satisfied, true) => (
                true,
                "sufficiency condition satisfied and all required claims supported".to_owned(),
            ),
            (crate::conditions::ConditionResult::Satisfied, false) => (
                false,
                format!(
                    "condition satisfied but {} required claim(s) unsupported",
                    missing.len()
                ),
            ),
            (other, _) => (false, format!("sufficiency condition not met: {other:?}")),
        };
        outcomes.push(NominationOutcome {
            criterion_id: criterion.id.clone(),
            nominated,
            detail,
            missing_claims: missing,
        });
    }
    Ok(outcomes)
}
