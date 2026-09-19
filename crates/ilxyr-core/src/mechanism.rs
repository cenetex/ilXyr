//! Mechanism forecasts (#19): directional predictions over declared
//! condition expressions, settled from ledger facts independently of the
//! experiment's terminal outcome.
//!
//! A mechanism forecast attaches a [`ConditionSet`] artifact reference to a
//! forecast. Settlement resolves it by evaluating the condition against the
//! current ledger facts: satisfied = correct, otherwise incorrect. This is
//! deliberately independent of whether the parent experiment's conjunctive
//! gate passed — a no-go experiment can still resolve a mechanism forecast.

use crate::conditions::{ConditionFacts, ConditionSet, evaluate};
use crate::model::{ActorRef, AdmissionDecision, ComparisonOperator, Forecast, ResearchEvent};
use crate::{Error, Result, Workspace, workflow};

/// Settlement record for a mechanism forecast.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MechanismSettlement {
    pub schema: String,
    pub forecast_id: String,
    pub condition_set_id: String,
    /// "correct" or "incorrect" — never unresolvable; unevaluable facts are
    /// fail-closed to "incorrect" at evaluation time.
    pub resolved_outcome: String,
    pub detail: String,
    pub settled_at_ms: u128,
}

/// Attach a mechanism condition set to an already-submitted outcome forecast.
///
/// The condition set is stored as a first-class artifact so the prediction is
/// hash-bound before any run completes.
pub fn attach_mechanism_condition(
    workspace: &Workspace,
    forecast_id: &str,
    condition_set: ConditionSet,
) -> Result<String> {
    condition_set.validate()?;
    if condition_set.schema != crate::conditions::CONDITION_SCHEMA {
        return Err(Error::Validation(vec![format!(
            "condition set schema must be {}, got {}",
            crate::conditions::CONDITION_SCHEMA,
            condition_set.schema
        )]));
    }
    let events = workspace.events()?;
    let (forecast, _) = submitted_forecast(workspace, &events, forecast_id)?;
    workflow::ensure_inputs_open(workspace, &forecast.experiment_id)?;
    if events.iter().any(|event| {
        event.event_type == MECHANISM_CONDITION_ATTACHED && event.aggregate_id == forecast_id
    }) {
        return Err(Error::Conflict(format!(
            "mechanism condition for forecast {forecast_id} is already frozen"
        )));
    }
    let reference = workspace.put(&condition_set)?;
    workspace.append_event(
        MECHANISM_CONDITION_ATTACHED,
        forecast_id,
        ActorRef::service("service://ilxyr/mechanism-settlement-v1"),
        Some(reference.clone()),
    )?;
    Ok(reference)
}

/// Settle every mechanism forecast attached to `forecast_id` against current
/// ledger facts. Idempotent: re-settling returns the existing settlement.
pub fn settle_mechanism_forecast(
    workspace: &Workspace,
    forecast_id: &str,
) -> Result<MechanismSettlement> {
    let events = workspace.events()?;

    let (forecast, forecast_index) = submitted_forecast(workspace, &events, forecast_id)?;
    let attachments = events
        .iter()
        .enumerate()
        .filter(|(_, event)| {
            event.event_type == MECHANISM_CONDITION_ATTACHED && event.aggregate_id == forecast_id
        })
        .collect::<Vec<_>>();
    if attachments.len() != 1 {
        return Err(Error::Conflict(format!(
            "forecast {forecast_id} must have exactly one mechanism condition attachment"
        )));
    }
    let (attachment_index, attachment) = attachments[0];
    if attachment_index <= forecast_index {
        return Err(Error::Conflict(format!(
            "mechanism condition for forecast {forecast_id} predates the forecast"
        )));
    }
    let admitted_index = first_accepted_admission(workspace, &events, &forecast.experiment_id)?
        .ok_or_else(|| {
            Error::Conflict(format!(
                "experiment {} has no accepted admission decision",
                forecast.experiment_id
            ))
        })?;
    let completed_index = events
        .iter()
        .position(|event| {
            event.event_type == "ExperimentCompleted"
                && event.aggregate_id == forecast.experiment_id
        })
        .ok_or_else(|| {
            Error::Conflict(format!(
                "experiment {} has no completed run",
                forecast.experiment_id
            ))
        })?;
    if attachment_index >= admitted_index || attachment_index >= completed_index {
        return Err(Error::Conflict(format!(
            "mechanism condition for forecast {forecast_id} was attached after admission or results"
        )));
    }

    // Idempotency: find an existing settlement for this forecast.
    for event in &events {
        if event.event_type != MECHANISM_SETTLED || event.aggregate_id != forecast_id {
            continue;
        }
        if let Some(reference) = event.artifact_ref.as_deref() {
            return workspace.get::<MechanismSettlement>(reference);
        }
    }

    let condition_ref = attachment.artifact_ref.clone().ok_or_else(|| {
        Error::Conflict(format!(
            "mechanism condition for forecast {forecast_id} has no artifact reference"
        ))
    })?;

    let condition_set: ConditionSet = workspace.get(&condition_ref)?;
    let facts = ConditionFacts::from_workspace(workspace)?;
    let result = evaluate(&condition_set.root, &facts);

    let settlement = MechanismSettlement {
        schema: "ilxyr.mechanism_settlement.v1".to_owned(),
        forecast_id: forecast_id.to_owned(),
        condition_set_id: condition_set.id,
        resolved_outcome: if result.is_satisfied() {
            "correct".to_owned()
        } else {
            "incorrect".to_owned()
        },
        detail: match result {
            crate::conditions::ConditionResult::Satisfied => "condition satisfied".to_owned(),
            crate::conditions::ConditionResult::Unsatisfied { reason, .. } => reason,
            crate::conditions::ConditionResult::Unresolvable { key, .. } => {
                format!("unresolvable (fail-closed): {key}")
            }
        },
        settled_at_ms: crate::store::now_ms()?,
    };
    let reference = workspace.put(&settlement)?;
    workspace.append_event(
        MECHANISM_SETTLED,
        forecast_id,
        ActorRef::service("service://ilxyr/mechanism-settlement-v1"),
        Some(reference),
    )?;
    Ok(settlement)
}

fn submitted_forecast(
    workspace: &Workspace,
    events: &[ResearchEvent],
    forecast_id: &str,
) -> Result<(Forecast, usize)> {
    let (index, event) = events
        .iter()
        .enumerate()
        .find(|(_, event)| {
            event.event_type == workflow::FORECAST_SUBMITTED_EVENT
                && event.aggregate_id == forecast_id
        })
        .ok_or_else(|| Error::NotFound(format!("forecast {forecast_id} was never submitted")))?;
    let reference = event.artifact_ref.as_deref().ok_or_else(|| {
        Error::Conflict(format!("forecast {forecast_id} has no artifact reference"))
    })?;
    let forecast: Forecast = workspace.get(reference)?;
    if forecast.id != forecast_id {
        return Err(Error::Conflict(format!(
            "forecast event {forecast_id} points to {}",
            forecast.id
        )));
    }
    Ok((forecast, index))
}

fn first_accepted_admission(
    workspace: &Workspace,
    events: &[ResearchEvent],
    experiment_id: &str,
) -> Result<Option<usize>> {
    for (index, event) in events.iter().enumerate() {
        if event.event_type != "AdmissionDecided" || event.aggregate_id != experiment_id {
            continue;
        }
        let reference = event.artifact_ref.as_deref().ok_or_else(|| {
            Error::Conflict(format!(
                "admission decision for {experiment_id} has no artifact reference"
            ))
        })?;
        let decision: AdmissionDecision = workspace.get(reference)?;
        if decision.accepted {
            return Ok(Some(index));
        }
    }
    Ok(None)
}

/// Convenience constructor for metric-style mechanism conditions used in tests.
#[must_use]
pub fn metric_condition(
    experiment_id: &str,
    metric: &str,
    operator: ComparisonOperator,
    threshold: f64,
) -> crate::conditions::Condition {
    crate::conditions::Condition::Metric {
        experiment_id: experiment_id.to_owned(),
        metric: metric.to_owned(),
        operator,
        threshold,
    }
}

pub const FORECAST_SUBMITTED_EVENT: &str = workflow::FORECAST_SUBMITTED_EVENT;
pub const MECHANISM_CONDITION_ATTACHED: &str = "MechanismConditionAttached";
pub const MECHANISM_SETTLED: &str = "MechanismForecastSettled";
