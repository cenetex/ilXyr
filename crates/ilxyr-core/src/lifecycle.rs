//! Run intent semantics (#20), sealed test-split digests (#22), and
//! contingent preregistration branches (#18).
//!
//! All three extend the lifecycle with additive event types per
//! docs/LEDGER-VERSIONING.md rule 3: unknown event types fail closed in
//! older readers, never silently ignored.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::conditions::{ConditionFacts, ConditionSet, evaluate};
use crate::model::{ActorRef, GateCheck};
use crate::{Error, Result, Workspace, validation, workflow};

const ADMISSION_DECIDED: &str = "AdmissionDecided";
const EXECUTION_STARTED: &str = "ExecutionStarted";
const EXPERIMENT_COMPLETED: &str = "ExperimentCompleted";

// ---------------------------------------------------------------------------
// #20 — exploratory vs confirmatory intent
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunIntent {
    Exploratory,
    Confirmatory,
}

impl RunIntent {
    pub fn declare(
        workspace: &Workspace,
        experiment_id: &str,
        intent: RunIntent,
    ) -> Result<String> {
        workflow::experiment_status(workspace, experiment_id)?;
        let events = workspace.events()?;
        ensure_prospective_declaration(&events, experiment_id, INTENT_DECLARED, "run intent")?;
        let record = IntentDeclaration {
            schema: "ilxyr.intent_declaration.v1".to_owned(),
            experiment_id: experiment_id.to_owned(),
            intent,
        };
        let reference = workspace.put(&record)?;
        workspace.append_event(
            INTENT_DECLARED,
            experiment_id,
            ActorRef::service("service://ilxyr/intent-v1"),
            Some(reference.clone()),
        )?;
        Ok(reference)
    }

    /// Resolve the declared intent of an experiment. Undeclared experiments
    /// default to `Exploratory`: only explicitly declared confirmatory runs
    /// may back confirming claims (fail-closed for claim support).
    pub fn resolve(workspace: &Workspace, experiment_id: &str) -> Result<RunIntent> {
        let events = workspace.events()?;
        let mut declaration = None;
        let boundary = first_experiment_boundary(&events, experiment_id);
        for (index, event) in events.iter().enumerate() {
            if event.event_type == INTENT_DECLARED && event.aggregate_id == experiment_id {
                if declaration.is_some() {
                    return Err(Error::Conflict(format!(
                        "experiment {experiment_id} has more than one run intent declaration"
                    )));
                }
                if boundary.is_some_and(|boundary| index >= boundary) {
                    return Err(Error::Conflict(format!(
                        "run intent for {experiment_id} was declared after admission or execution"
                    )));
                }
                let reference = event.artifact_ref.as_deref().ok_or_else(|| {
                    Error::Conflict(format!(
                        "run intent for {experiment_id} has no artifact reference"
                    ))
                })?;
                declaration = Some(workspace.get::<IntentDeclaration>(reference)?);
            }
        }
        Ok(declaration
            .map(|declaration| declaration.intent)
            .unwrap_or(RunIntent::Exploratory))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntentDeclaration {
    pub schema: String,
    pub experiment_id: String,
    pub intent: RunIntent,
}

pub const INTENT_DECLARED: &str = "IntentDeclared";

// ---------------------------------------------------------------------------
// #22 — sealed test-split digests with settlement-time release
// ---------------------------------------------------------------------------

/// Declare that an experiment's evaluation depends on a sealed artifact with
/// the given SHA-256 digest. While sealed, execution is refused.
pub fn seal_test_digest(
    workspace: &Workspace,
    experiment_id: &str,
    digest: &str,
) -> Result<String> {
    workflow::experiment_status(workspace, experiment_id)?;
    let digest = normalize_digest(digest)?;
    let events = workspace.events()?;
    if events.iter().any(|event| {
        event.aggregate_id == experiment_id
            && matches!(
                event.event_type.as_str(),
                EXECUTION_STARTED | EXPERIMENT_COMPLETED
            )
    }) {
        return Err(Error::Conflict(format!(
            "test digest for {experiment_id} must be sealed before execution"
        )));
    }
    if events
        .iter()
        .any(|event| event.event_type == TEST_DIGEST_SEALED && event.aggregate_id == experiment_id)
    {
        return Err(Error::Conflict(format!(
            "test digest for {experiment_id} is already sealed and cannot be replaced"
        )));
    }
    let record = SealedDigest {
        schema: "ilxyr.sealed_digest.v1".to_owned(),
        experiment_id: experiment_id.to_owned(),
        digest,
    };
    let reference = workspace.put(&record)?;
    workspace.append_event(
        TEST_DIGEST_SEALED,
        experiment_id,
        ActorRef::service("service://ilxyr/sealing-v1"),
        Some(reference.clone()),
    )?;
    Ok(reference)
}

/// Release a previously sealed test digest. The release event records who
/// authorized it; the digest itself stays on the sealed record.
pub fn release_test_digest(
    workspace: &Workspace,
    experiment_id: &str,
    authorizer: &ActorRef,
) -> Result<String> {
    validation::actor_ref(authorizer)?;
    let events = workspace.events()?;
    if events.iter().any(|event| {
        event.aggregate_id == experiment_id
            && matches!(
                event.event_type.as_str(),
                EXECUTION_STARTED | EXPERIMENT_COMPLETED
            )
    }) {
        return Err(Error::Conflict(format!(
            "test digest for {experiment_id} must be released before execution"
        )));
    }
    match test_access_state(&events, experiment_id)? {
        TestAccessState::Sealed(reference) => {
            workspace.append_event(
                TEST_DIGEST_RELEASED,
                experiment_id,
                authorizer.clone(),
                Some(reference),
            )?;
            Ok(format!("released:{experiment_id}"))
        }
        TestAccessState::Released => Err(Error::Conflict(format!(
            "test digest for {experiment_id} is already released"
        ))),
        TestAccessState::Unsealed => Err(Error::NotFound(format!(
            "no sealed digest registered for {experiment_id}"
        ))),
    }
}

/// Guard used by run admission/execution: refuses to run while a sealed
/// digest is unreleased. Fails closed on any ambiguity.
pub fn ensure_test_access_allowed(workspace: &Workspace, experiment_id: &str) -> Result<()> {
    let events = workspace.events()?;
    match test_access_state(&events, experiment_id)? {
        TestAccessState::Sealed(_) => Err(Error::Security(format!(
            "test split for {experiment_id} is sealed; release it at settlement before evaluating"
        ))),
        TestAccessState::Unsealed | TestAccessState::Released => Ok(()),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SealedDigest {
    pub schema: String,
    pub experiment_id: String,
    /// Hex-encoded SHA-256 of the sealed test artifact.
    pub digest: String,
}

pub const TEST_DIGEST_SEALED: &str = "TestDigestSealed";
pub const TEST_DIGEST_RELEASED: &str = "TestDigestReleased";

enum TestAccessState {
    Unsealed,
    Sealed(String),
    Released,
}

fn test_access_state(
    events: &[crate::model::ResearchEvent],
    experiment_id: &str,
) -> Result<TestAccessState> {
    let mut state = TestAccessState::Unsealed;
    for event in events
        .iter()
        .filter(|event| event.aggregate_id == experiment_id)
    {
        match event.event_type.as_str() {
            TEST_DIGEST_SEALED => {
                if !matches!(state, TestAccessState::Unsealed) {
                    return Err(Error::Conflict(format!(
                        "test digest history for {experiment_id} contains more than one seal"
                    )));
                }
                let reference = event.artifact_ref.clone().ok_or_else(|| {
                    Error::Conflict(format!(
                        "sealed digest for {experiment_id} has no artifact reference"
                    ))
                })?;
                state = TestAccessState::Sealed(reference);
            }
            TEST_DIGEST_RELEASED => {
                let TestAccessState::Sealed(seal_ref) = &state else {
                    return Err(Error::Conflict(format!(
                        "test digest history for {experiment_id} contains an unmatched release"
                    )));
                };
                if event.artifact_ref.as_deref() != Some(seal_ref.as_str()) {
                    return Err(Error::Conflict(format!(
                        "test digest release for {experiment_id} does not match its seal"
                    )));
                }
                state = TestAccessState::Released;
            }
            _ => {}
        }
    }
    Ok(state)
}

fn ensure_prospective_declaration(
    events: &[crate::model::ResearchEvent],
    experiment_id: &str,
    event_type: &str,
    label: &str,
) -> Result<()> {
    if events
        .iter()
        .any(|event| event.event_type == event_type && event.aggregate_id == experiment_id)
    {
        return Err(Error::Conflict(format!(
            "{label} for {experiment_id} is already frozen"
        )));
    }
    if first_experiment_boundary(events, experiment_id).is_some() {
        return Err(Error::Conflict(format!(
            "{label} for {experiment_id} must be frozen before admission or execution"
        )));
    }
    Ok(())
}

fn first_experiment_boundary(
    events: &[crate::model::ResearchEvent],
    experiment_id: &str,
) -> Option<usize> {
    events.iter().position(|event| {
        event.aggregate_id == experiment_id
            && matches!(
                event.event_type.as_str(),
                ADMISSION_DECIDED | EXECUTION_STARTED | EXPERIMENT_COMPLETED
            )
    })
}

fn normalize_digest(digest: &str) -> Result<String> {
    let lowered = digest.trim().to_ascii_lowercase();
    if lowered.len() != 64 || !lowered.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(Error::Validation(vec![format!(
            "sealed digest must be 64 hex characters, got {digest:?}"
        )]));
    }
    Ok(lowered)
}

// ---------------------------------------------------------------------------
// #18 — contingent preregistration branches
// ---------------------------------------------------------------------------

/// One pre-committed branch: activates when its condition evaluates satisfied
/// against the parent's settled facts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BranchDefinition {
    pub id: String,
    pub condition: ConditionSet,
    /// Reference to the pre-frozen child experiment specification artifact.
    pub child_spec_ref: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BranchPlan {
    pub schema: String,
    pub id: String,
    pub parent_experiment_id: String,
    pub branches: Vec<BranchDefinition>,
}

/// Activation outcome for one branch after parent settlement.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BranchActivation {
    pub branch_id: String,
    pub activated: bool,
    pub detail: String,
}

/// Register a frozen branch plan against a parent experiment. The whole plan
/// is hash-bound now; activation later is deterministic evaluation only.
pub fn register_branch_plan(workspace: &Workspace, plan: BranchPlan) -> Result<String> {
    if plan.schema != "ilxyr.branch_plan.v1" {
        return Err(Error::Validation(vec![format!(
            "branch plan schema must be ilxyr.branch_plan.v1, got {}",
            plan.schema
        )]));
    }
    if plan.branches.is_empty() {
        return Err(Error::Validation(vec![
            "branch plan must contain at least one branch".to_owned(),
        ]));
    }
    let mut seen = std::collections::BTreeSet::new();
    for branch in &plan.branches {
        branch.condition.validate()?;
        if !seen.insert(branch.id.clone()) {
            return Err(Error::Validation(vec![format!(
                "duplicate branch id {}",
                branch.id
            )]));
        }
    }
    let reference = workspace.put(&plan)?;
    workspace.append_event(
        BRANCH_PLAN_REGISTERED,
        &plan.parent_experiment_id,
        ActorRef::service("service://ilxyr/branching-v1"),
        Some(reference),
    )?;
    Ok(plan.id)
}

/// Deterministically activate branches whose conditions are satisfied by the
/// current ledger facts. Every evaluation result is appended as an event so
/// near-misses are auditable (#25 shares this property). Idempotent: already-
/// activated branch ids are skipped.
pub fn activate_branches(
    workspace: &Workspace,
    parent_experiment_id: &str,
) -> Result<Vec<BranchActivation>> {
    let plan = latest_branch_plan(workspace, parent_experiment_id)?
        .ok_or_else(|| Error::NotFound(format!("no branch plan for {parent_experiment_id}")))?;

    let events = workspace.events()?;
    let mut already_activated: std::collections::BTreeSet<String> =
        std::collections::BTreeSet::new();
    for event in &events {
        if event.event_type == BRANCH_ACTIVATED && event.aggregate_id == parent_experiment_id {
            if let Some(reference) = event.artifact_ref.as_deref() {
                let activation: BranchActivatedRecord = workspace.get(reference)?;
                already_activated.insert(activation.branch_id);
            }
        }
    }

    let facts = ConditionFacts::from_workspace(workspace)?;
    let mut outcomes = Vec::new();
    for branch in &plan.branches {
        if already_activated.contains(&branch.id) {
            outcomes.push(BranchActivation {
                branch_id: branch.id.clone(),
                activated: true,
                detail: "already activated (idempotent replay)".to_owned(),
            });
            continue;
        }
        let result = evaluate(&branch.condition.root, &facts);
        let (activated, detail) = match &result {
            crate::conditions::ConditionResult::Satisfied => {
                (true, "condition satisfied; child authorized".to_owned())
            }
            crate::conditions::ConditionResult::Unsatisfied { reason, .. } => {
                (false, format!("condition unsatisfied: {reason}"))
            }
            crate::conditions::ConditionResult::Unresolvable { key, .. } => (
                false,
                format!("condition unresolvable (fail-closed): {key}"),
            ),
        };
        let record = BranchActivatedRecord {
            schema: "ilxyr.branch_activated.v1".to_owned(),
            plan_id: plan.id.clone(),
            branch_id: branch.id.clone(),
            child_spec_ref: branch.child_spec_ref.clone(),
            activated,
            detail: detail.clone(),
        };
        let reference = workspace.put(&record)?;
        workspace.append_event(
            BRANCH_ACTIVATED,
            parent_experiment_id,
            ActorRef::service("service://ilxyr/branching-v1"),
            Some(reference),
        )?;
        outcomes.push(BranchActivation {
            branch_id: branch.id.clone(),
            activated,
            detail,
        });
    }
    Ok(outcomes)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BranchActivatedRecord {
    pub schema: String,
    pub plan_id: String,
    pub branch_id: String,
    pub child_spec_ref: String,
    pub activated: bool,
    pub detail: String,
}

pub const BRANCH_PLAN_REGISTERED: &str = "BranchPlanRegistered";
pub const BRANCH_ACTIVATED: &str = "BranchActivated";

fn latest_branch_plan(
    workspace: &Workspace,
    parent_experiment_id: &str,
) -> Result<Option<BranchPlan>> {
    let events = workspace.events()?;
    let mut latest = None;
    for event in &events {
        if event.event_type == BRANCH_PLAN_REGISTERED && event.aggregate_id == parent_experiment_id
        {
            if let Some(reference) = event.artifact_ref.as_deref() {
                latest = Some(workspace.get::<BranchPlan>(reference)?);
            }
        }
    }
    Ok(latest)
}

/// Facts extension point for future claim-graph predicates: currently metrics
/// only. Kept public so #25 can compose identically.
pub type FactTable = BTreeMap<String, BTreeMap<String, f64>>;

/// Convenience gate-check conversion so branch evaluations surface uniformly.
#[must_use]
pub fn activations_as_checks(activations: &[BranchActivation]) -> Vec<GateCheck> {
    activations
        .iter()
        .map(|activation| GateCheck {
            gate: format!("branch:{}", activation.branch_id),
            passed: activation.activated,
            detail: activation.detail.clone(),
        })
        .collect()
}
