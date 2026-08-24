use std::collections::BTreeSet;

use serde::{Deserialize, Serialize, de::DeserializeOwned};

use crate::{
    ActorRef, Error, Evidence, ExperimentStatus, Result, VerificationReport, Workspace,
    experiment_status, store::now_ms,
};

const FAMILY_REGISTERED: &str = "ExperimentFamilyRegistered";
const FAMILY_SETTLED: &str = "ExperimentFamilySettled";
const EVIDENCE_RECORDED: &str = "EvidenceRecorded";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ExperimentFamilyMember {
    pub experiment_id: String,
    pub seed: u64,
    pub required_outcome: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PriorFamilyOutcome {
    pub experiment_id: String,
    pub seed: u64,
    pub resolved_outcome: String,
    pub required_outcome: String,
    pub result_ref: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ExperimentFamilyContract {
    pub schema: String,
    pub id: String,
    pub title: String,
    pub members: Vec<ExperimentFamilyMember>,
    #[serde(default)]
    pub prior_outcomes: Vec<PriorFamilyOutcome>,
    pub run_all: bool,
    pub success_outcome: String,
    pub failure_outcome: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub promotion_candidate: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FamilyMemberPhase {
    NotFrozen,
    Frozen,
    Ready,
    Rejected,
    Running,
    NeedsAttention,
    Settled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FamilyMemberStatus {
    pub experiment_id: String,
    pub seed: u64,
    pub required_outcome: String,
    pub phase: FamilyMemberPhase,
    pub forecasts: usize,
    pub total_stake: u64,
    pub funded_compute_credits: u64,
    pub admitted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_outcome: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub passed: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct FamilyMemberSettlement {
    pub experiment_id: String,
    pub seed: u64,
    pub required_outcome: String,
    pub resolved_outcome: String,
    pub evidence_ref: String,
    pub passed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ExperimentFamilySettlement {
    pub schema: String,
    pub family_id: String,
    pub members: Vec<FamilyMemberSettlement>,
    pub prior_outcomes: Vec<PriorFamilyOutcome>,
    pub resolved_outcome: String,
    pub promotion_eligible: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub promotion_candidate: Option<String>,
    pub settled_at_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExperimentFamilyStatus {
    pub family_id: String,
    pub title: String,
    pub run_all: bool,
    pub members: Vec<FamilyMemberStatus>,
    pub prior_outcomes: Vec<PriorFamilyOutcome>,
    pub all_members_frozen: bool,
    pub all_members_admitted: bool,
    pub all_runs_terminal: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub projected_outcome: Option<String>,
    pub promotion_eligible: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latest_settlement: Option<ExperimentFamilySettlement>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SettledFamilyReport {
    pub settlement: ExperimentFamilySettlement,
    pub ledger: VerificationReport,
}

pub fn register_experiment_family(
    workspace: &Workspace,
    contract: ExperimentFamilyContract,
) -> Result<String> {
    validate_contract(&contract)?;
    if let Some(event) = workspace.latest_event(FAMILY_REGISTERED, &contract.id)? {
        let artifact_ref = required_artifact(FAMILY_REGISTERED, event.artifact_ref)?;
        let existing: ExperimentFamilyContract = workspace.get(&artifact_ref)?;
        if Workspace::digest(&existing)? != Workspace::digest(&contract)? {
            return Err(Error::Conflict(format!(
                "experiment family {} is already registered with different content",
                contract.id
            )));
        }
        return Ok(artifact_ref);
    }

    let artifact_ref = workspace.put(&contract)?;
    workspace.append_event(
        FAMILY_REGISTERED,
        &contract.id,
        ActorRef::service("service://ilxyr/family-v1"),
        Some(artifact_ref.clone()),
    )?;
    Ok(artifact_ref)
}

pub fn registered_experiment_family(
    workspace: &Workspace,
    family_id: &str,
) -> Result<ExperimentFamilyContract> {
    latest_typed(workspace, FAMILY_REGISTERED, family_id)?
        .ok_or_else(|| Error::NotFound(format!("experiment family {family_id}")))
}

pub fn experiment_family_status(
    workspace: &Workspace,
    family_id: &str,
) -> Result<ExperimentFamilyStatus> {
    let contract = registered_experiment_family(workspace, family_id)?;
    let mut members = Vec::with_capacity(contract.members.len());
    for member in &contract.members {
        let status = match experiment_status(workspace, &member.experiment_id) {
            Ok(status) => status_from_experiment(member, status),
            Err(Error::NotFound(_)) => FamilyMemberStatus {
                experiment_id: member.experiment_id.clone(),
                seed: member.seed,
                required_outcome: member.required_outcome.clone(),
                phase: FamilyMemberPhase::NotFrozen,
                forecasts: 0,
                total_stake: 0,
                funded_compute_credits: 0,
                admitted: false,
                resolved_outcome: None,
                passed: None,
            },
            Err(error) => return Err(error),
        };
        members.push(status);
    }

    let all_members_frozen = members
        .iter()
        .all(|member| member.phase != FamilyMemberPhase::NotFrozen);
    let all_members_admitted = members.iter().all(|member| member.admitted);
    let all_runs_terminal = members
        .iter()
        .all(|member| member.phase == FamilyMemberPhase::Settled);
    let projected_outcome = all_runs_terminal.then(|| derived_outcome(&contract, &members));
    let promotion_eligible = projected_outcome.as_deref() == Some(&contract.success_outcome);
    let latest_settlement = latest_typed(workspace, FAMILY_SETTLED, family_id)?;

    Ok(ExperimentFamilyStatus {
        family_id: contract.id,
        title: contract.title,
        run_all: contract.run_all,
        members,
        prior_outcomes: contract.prior_outcomes,
        all_members_frozen,
        all_members_admitted,
        all_runs_terminal,
        projected_outcome,
        promotion_eligible,
        latest_settlement,
    })
}

pub fn settle_experiment_family(
    workspace: &Workspace,
    family_id: &str,
) -> Result<SettledFamilyReport> {
    if let Some(settlement) = latest_typed(workspace, FAMILY_SETTLED, family_id)? {
        return Ok(SettledFamilyReport {
            settlement,
            ledger: workspace.verify()?,
        });
    }

    let contract = registered_experiment_family(workspace, family_id)?;
    let status = experiment_family_status(workspace, family_id)?;
    if !status.all_runs_terminal {
        return Err(Error::Conflict(format!(
            "experiment family {family_id} cannot settle until every declared run has evidence"
        )));
    }

    let mut members = Vec::with_capacity(contract.members.len());
    for member in &contract.members {
        let event = workspace
            .latest_event(EVIDENCE_RECORDED, &member.experiment_id)?
            .ok_or_else(|| Error::NotFound(format!("evidence for {}", member.experiment_id)))?;
        let evidence_ref = required_artifact(EVIDENCE_RECORDED, event.artifact_ref)?;
        let evidence: Evidence = workspace.get(&evidence_ref)?;
        members.push(FamilyMemberSettlement {
            experiment_id: member.experiment_id.clone(),
            seed: member.seed,
            required_outcome: member.required_outcome.clone(),
            passed: evidence.resolved_outcome == member.required_outcome,
            resolved_outcome: evidence.resolved_outcome,
            evidence_ref,
        });
    }

    let all_passed = members.iter().all(|member| member.passed)
        && contract
            .prior_outcomes
            .iter()
            .all(|prior| prior.resolved_outcome == prior.required_outcome);
    let resolved_outcome = if all_passed {
        contract.success_outcome.clone()
    } else {
        contract.failure_outcome.clone()
    };
    let promotion_eligible = resolved_outcome == contract.success_outcome;
    let settlement = ExperimentFamilySettlement {
        schema: "ilxyr.experiment_family_settlement.v1".to_owned(),
        family_id: contract.id.clone(),
        members,
        prior_outcomes: contract.prior_outcomes.clone(),
        resolved_outcome,
        promotion_eligible,
        promotion_candidate: contract.promotion_candidate,
        settled_at_ms: now_ms()?,
    };
    let artifact_ref = workspace.put(&settlement)?;
    workspace.append_event(
        FAMILY_SETTLED,
        &contract.id,
        ActorRef::service("service://ilxyr/family-settlement-v1"),
        Some(artifact_ref),
    )?;

    Ok(SettledFamilyReport {
        settlement,
        ledger: workspace.verify()?,
    })
}

fn status_from_experiment(
    member: &ExperimentFamilyMember,
    status: ExperimentStatus,
) -> FamilyMemberStatus {
    let admitted = status
        .latest_admission
        .as_ref()
        .is_some_and(|decision| decision.accepted);
    let (phase, resolved_outcome, passed) = if let Some(evidence) = status.latest_evidence {
        let passed = evidence.resolved_outcome == member.required_outcome;
        (
            FamilyMemberPhase::Settled,
            Some(evidence.resolved_outcome),
            Some(passed),
        )
    } else if status.latest_run.is_some() {
        (FamilyMemberPhase::NeedsAttention, None, None)
    } else if status.execution_started {
        (FamilyMemberPhase::Running, None, None)
    } else if admitted {
        (FamilyMemberPhase::Ready, None, None)
    } else if status.latest_admission.is_some() {
        (FamilyMemberPhase::Rejected, None, None)
    } else {
        (FamilyMemberPhase::Frozen, None, None)
    };

    FamilyMemberStatus {
        experiment_id: member.experiment_id.clone(),
        seed: member.seed,
        required_outcome: member.required_outcome.clone(),
        phase,
        forecasts: status.forecasts,
        total_stake: status.total_stake,
        funded_compute_credits: status.funded_compute_credits,
        admitted,
        resolved_outcome,
        passed,
    }
}

fn derived_outcome(contract: &ExperimentFamilyContract, members: &[FamilyMemberStatus]) -> String {
    let all_passed = members.iter().all(|member| member.passed == Some(true))
        && contract
            .prior_outcomes
            .iter()
            .all(|prior| prior.resolved_outcome == prior.required_outcome);
    if all_passed {
        contract.success_outcome.clone()
    } else {
        contract.failure_outcome.clone()
    }
}

fn validate_contract(contract: &ExperimentFamilyContract) -> Result<()> {
    let mut errors = Vec::new();
    if contract.schema != "ilxyr.experiment_family.v1" {
        errors.push("family.schema must be ilxyr.experiment_family.v1".to_owned());
    }
    if contract.id.trim().is_empty() {
        errors.push("family.id must not be empty".to_owned());
    }
    if contract.title.trim().is_empty() {
        errors.push("family.title must not be empty".to_owned());
    }
    if contract.members.is_empty() {
        errors.push("family.members must not be empty".to_owned());
    }
    if contract.success_outcome.trim().is_empty()
        || contract.failure_outcome.trim().is_empty()
        || contract.success_outcome == contract.failure_outcome
    {
        errors
            .push("family success and failure outcomes must be distinct and non-empty".to_owned());
    }
    if contract
        .promotion_candidate
        .as_ref()
        .is_some_and(|candidate| candidate.trim().is_empty())
    {
        errors.push("family.promotion_candidate must not be empty when present".to_owned());
    }

    let mut experiment_ids = BTreeSet::new();
    let mut seeds = BTreeSet::new();
    for member in &contract.members {
        validate_member(
            &member.experiment_id,
            member.seed,
            &member.required_outcome,
            &mut experiment_ids,
            &mut seeds,
            &mut errors,
        );
    }
    for prior in &contract.prior_outcomes {
        validate_member(
            &prior.experiment_id,
            prior.seed,
            &prior.required_outcome,
            &mut experiment_ids,
            &mut seeds,
            &mut errors,
        );
        if prior.resolved_outcome.trim().is_empty() {
            errors.push(format!(
                "prior outcome for seed {} must declare a resolved outcome",
                prior.seed
            ));
        }
        if !valid_artifact_ref(&prior.result_ref) {
            errors.push(format!(
                "prior outcome for seed {} must bind a SHA-256 artifact reference",
                prior.seed
            ));
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(Error::Validation(errors))
    }
}

fn valid_artifact_ref(reference: &str) -> bool {
    reference
        .strip_prefix("artifact://sha256/")
        .is_some_and(|digest| {
            digest.len() == 64
                && digest
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        })
}

fn validate_member(
    experiment_id: &str,
    seed: u64,
    required_outcome: &str,
    experiment_ids: &mut BTreeSet<String>,
    seeds: &mut BTreeSet<u64>,
    errors: &mut Vec<String>,
) {
    if experiment_id.trim().is_empty() {
        errors.push(format!(
            "family member for seed {seed} has an empty experiment id"
        ));
    } else if !experiment_ids.insert(experiment_id.to_owned()) {
        errors.push(format!("duplicate family experiment id {experiment_id}"));
    }
    if !seeds.insert(seed) {
        errors.push(format!("duplicate family seed {seed}"));
    }
    if required_outcome.trim().is_empty() {
        errors.push(format!(
            "family member {experiment_id} has an empty required outcome"
        ));
    }
}

fn latest_typed<T: DeserializeOwned>(
    workspace: &Workspace,
    event_type: &str,
    aggregate_id: &str,
) -> Result<Option<T>> {
    workspace
        .latest_event(event_type, aggregate_id)?
        .map(|event| {
            let artifact_ref = required_artifact(event_type, event.artifact_ref)?;
            workspace.get(&artifact_ref)
        })
        .transpose()
}

fn required_artifact(event_type: &str, artifact_ref: Option<String>) -> Result<String> {
    artifact_ref.ok_or_else(|| Error::Conflict(format!("{event_type} event has no artifact")))
}
