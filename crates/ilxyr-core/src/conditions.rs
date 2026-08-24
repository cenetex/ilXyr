//! Declarative condition expressions over evidence metrics (#28).
//!
//! Conditions are frozen protocol objects (hash-bound like any artifact)
//! used by contingent preregistration trees (#18) and paper nomination
//! criteria (#25). Evaluation is deterministic over ledger-resolved facts
//! and **fails closed**: an unresolvable leaf is never satisfied.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::model::{ComparisonOperator, Evidence};
use crate::{Error, Result, Workspace, workflow};

pub const CONDITION_SCHEMA: &str = "ilxyr.condition.v1";

/// Maximum nesting depth; bounds replay cost and forbids pathological trees.
pub const MAX_CONDITION_DEPTH: usize = 8;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConditionSet {
    pub schema: String,
    pub id: String,
    pub root: Condition,
}

impl ConditionSet {
    pub fn validate(&self) -> Result<()> {
        self.root.validate()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Condition {
    /// Latest evidence metric for an experiment satisfies a comparison.
    Metric {
        experiment_id: String,
        metric: String,
        operator: ComparisonOperator,
        threshold: f64,
    },
    AllOf {
        all_of: Vec<Condition>,
    },
    AnyOf {
        any_of: Vec<Condition>,
    },
    Not {
        not: Box<Condition>,
    },
}

impl Condition {
    #[must_use]
    pub fn depth(&self) -> usize {
        match self {
            Condition::Metric { .. } => 1,
            Condition::AllOf { all_of } => {
                1 + all_of.iter().map(Condition::depth).max().unwrap_or(0)
            }
            Condition::AnyOf { any_of } => {
                1 + any_of.iter().map(Condition::depth).max().unwrap_or(0)
            }
            Condition::Not { not } => 1 + not.depth(),
        }
    }

    pub fn validate(&self) -> Result<()> {
        if self.depth() > MAX_CONDITION_DEPTH {
            return Err(Error::Validation(vec![format!(
                "condition nesting depth {} exceeds maximum {MAX_CONDITION_DEPTH}",
                self.depth()
            )]));
        }
        match self {
            Condition::Metric {
                experiment_id,
                metric,
                ..
            } => {
                if experiment_id.trim().is_empty() || metric.trim().is_empty() {
                    return Err(Error::Validation(vec![
                        "condition metric leaves need non-empty experiment_id and metric"
                            .to_owned(),
                    ]));
                }
            }
            Condition::AllOf { all_of } => {
                if all_of.is_empty() {
                    return Err(Error::Validation(vec![
                        "all_of must contain at least one condition".to_owned(),
                    ]));
                }
                for child in all_of {
                    child.validate()?;
                }
            }
            Condition::AnyOf { any_of } => {
                if any_of.is_empty() {
                    return Err(Error::Validation(vec![
                        "any_of must contain at least one condition".to_owned(),
                    ]));
                }
                for child in any_of {
                    child.validate()?;
                }
            }
            Condition::Not { .. } => {}
        }
        Ok(())
    }
}

/// Facts resolved from the ledger: the latest evidence metrics per experiment.
#[derive(Debug, Clone, Default)]
pub struct ConditionFacts {
    metrics: BTreeMap<String, BTreeMap<String, f64>>,
}

impl ConditionFacts {
    #[must_use]
    pub fn from_evidence(records: &[Evidence]) -> Self {
        let mut metrics: BTreeMap<String, BTreeMap<String, f64>> = BTreeMap::new();
        // Records are applied in order; later evidence wins per (experiment, metric).
        for record in records {
            let entry = metrics.entry(record.experiment_id.clone()).or_default();
            for (name, value) in &record.metrics {
                entry.insert(name.clone(), *value);
            }
        }
        Self { metrics }
    }

    /// Resolve facts directly from a workspace ledger.
    pub fn from_workspace(workspace: &Workspace) -> Result<Self> {
        let events = workspace.events()?;
        let mut records = Vec::new();
        for event in &events {
            if event.event_type != workflow::EVIDENCE_RECORDED_EVENT {
                continue;
            }
            let Some(reference) = event.artifact_ref.as_deref() else {
                continue;
            };
            let evidence = workspace.get::<Evidence>(reference)?;
            records.push(evidence);
        }
        Ok(Self::from_evidence(&records))
    }

    #[must_use]
    pub fn metric(&self, experiment_id: &str, metric: &str) -> Option<f64> {
        self.metrics.get(experiment_id)?.get(metric).copied()
    }
}

/// Outcome of evaluation. `Unresolvable` is fail-closed: never satisfied.
#[derive(Debug, Clone, PartialEq)]
pub enum ConditionResult {
    Satisfied,
    Unsatisfied { path: String, reason: String },
    Unresolvable { path: String, key: String },
}

impl ConditionResult {
    #[must_use]
    pub const fn is_satisfied(&self) -> bool {
        matches!(self, ConditionResult::Satisfied)
    }
}

fn compare(operator: &ComparisonOperator, left: f64, right: f64) -> bool {
    match operator {
        ComparisonOperator::Gt => left > right,
        ComparisonOperator::Gte => left >= right,
        ComparisonOperator::Lt => left < right,
        ComparisonOperator::Lte => left <= right,
        ComparisonOperator::Eq => left == right,
    }
}

/// Evaluate a condition against resolved facts. Deterministic and total.
pub fn evaluate(condition: &Condition, facts: &ConditionFacts) -> ConditionResult {
    evaluate_at(condition, facts, "root")
}

fn evaluate_at(condition: &Condition, facts: &ConditionFacts, path: &str) -> ConditionResult {
    match condition {
        Condition::Metric {
            experiment_id,
            metric,
            operator,
            threshold,
        } => {
            let key = format!("{experiment_id}:{metric}");
            match facts.metric(experiment_id, metric) {
                Some(value) => {
                    if compare(operator, value, *threshold) {
                        ConditionResult::Satisfied
                    } else {
                        ConditionResult::Unsatisfied {
                            path: path.to_owned(),
                            reason: format!(
                                "{key} = {value} does not satisfy {operator:?} {threshold}"
                            ),
                        }
                    }
                }
                None => ConditionResult::Unresolvable {
                    path: path.to_owned(),
                    key,
                },
            }
        }
        Condition::AllOf { all_of } => {
            for (index, child) in all_of.iter().enumerate() {
                let result = evaluate_at(child, facts, &format!("{path}.all_of[{index}]"));
                if !result.is_satisfied() {
                    return result;
                }
            }
            ConditionResult::Satisfied
        }
        Condition::AnyOf { any_of } => {
            // Evaluate every arm so resolution is order-independent. A
            // satisfied arm wins; otherwise any unresolvable arm fails
            // closed; otherwise report the first unsatisfaction.
            let mut saw_unresolvable = false;
            let mut first_unsatisfied = None;
            for (index, child) in any_of.iter().enumerate() {
                let result = evaluate_at(child, facts, &format!("{path}.any_of[{index}]"));
                match result {
                    ConditionResult::Satisfied => return ConditionResult::Satisfied,
                    ConditionResult::Unresolvable { path, key } => {
                        saw_unresolvable = true;
                        let _ = (path, key);
                    }
                    unsatisfied @ ConditionResult::Unsatisfied { .. } => {
                        if first_unsatisfied.is_none() {
                            first_unsatisfied = Some(unsatisfied);
                        }
                    }
                }
            }
            if saw_unresolvable {
                return ConditionResult::Unresolvable {
                    path: path.to_owned(),
                    key: "any_of has unresolvable arms".to_owned(),
                };
            }
            first_unsatisfied.unwrap_or(ConditionResult::Unsatisfied {
                path: path.to_owned(),
                reason: "empty any_of".to_owned(),
            })
        }
        Condition::Not { not } => {
            // Negation propagates unresolvability (fail-closed): not(unresolvable)
            // is itself unresolvable, never silently true.
            match evaluate_at(not, facts, &format!("{path}.not")) {
                ConditionResult::Satisfied => ConditionResult::Unsatisfied {
                    path: path.to_owned(),
                    reason: "negated condition was satisfied".to_owned(),
                },
                ConditionResult::Unsatisfied { .. } => ConditionResult::Satisfied,
                unresolvable @ ConditionResult::Unresolvable { .. } => unresolvable,
            }
        }
    }
}
