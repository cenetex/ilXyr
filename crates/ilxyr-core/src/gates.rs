//! Task accounting and paired-evaluation gate checks (#16, #17).
//!
//! Pure functions deriving [`GateCheck`]s from declared contracts and
//! recorded evidence. Used at evidence finalization and by downstream
//! consumers (nomination engine, paper lane).

use std::collections::BTreeMap;

use crate::model::GateCheck;

/// Declared per-task answer-token budgets (issue #17). Keyed by task name.
pub type TokenMassDeclaration = BTreeMap<String, u64>;

/// Declared paired-evaluation requirement (issue #16).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PairedEvalSpec {
    /// Orientations every item is evaluated under (e.g. ["ab", "ba"]).
    pub orientations: Vec<String>,
    /// Minimum acceptable mean paired choice accuracy, in [0, 1].
    pub min_mean_paired_accuracy: f64,
    /// Maximum tolerated gap between the best and worst orientation, in [0, 1].
    pub max_position_gap: f64,
}

/// Recorded paired-evaluation outcome for one experiment.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PairedEvalResult {
    /// Choice accuracy per orientation, keyed by orientation id.
    pub per_orientation: BTreeMap<String, f64>,
}

impl PairedEvalResult {
    #[must_use]
    pub fn mean_paired_accuracy(&self) -> Option<f64> {
        if self.per_orientation.is_empty() {
            return None;
        }
        let sum: f64 = self.per_orientation.values().sum();
        Some(sum / self.per_orientation.len() as f64)
    }

    #[must_use]
    pub fn position_gap(&self) -> Option<f64> {
        let max = self.per_orientation.values().copied().fold(f64::MIN, f64::max);
        let min = self.per_orientation.values().copied().fold(f64::MAX, f64::min);
        if self.per_orientation.is_empty() {
            None
        } else {
            Some(max - min)
        }
    }
}

fn check(gate: &str, passed: bool, detail: String) -> GateCheck {
    GateCheck {
        gate: gate.to_owned(),
        passed,
        detail,
    }
}

/// Verify that recorded answer-token masses match the contract declaration.
///
/// Fails closed: any declared task missing from the record, or any recorded
/// task absent from the declaration, is a failure. Masses must be equal —
/// the point of the accounting is that divergence is visible, not tolerated.
pub fn check_token_mass(
    declared: &TokenMassDeclaration,
    recorded: &TokenMassDeclaration,
) -> Vec<GateCheck> {
    let mut checks = Vec::new();
    for (task, expected) in declared {
        match recorded.get(task) {
            Some(actual) => checks.push(check(
                "token_mass",
                actual == expected,
                format!("task {task}: declared {expected} answer tokens, recorded {actual}"),
            )),
            None => checks.push(check(
                "token_mass",
                false,
                format!("task {task}: declared {expected} answer tokens, none recorded"),
            )),
        }
    }
    for (task, actual) in recorded {
        if !declared.contains_key(task) {
            checks.push(check(
                "token_mass",
                false,
                format!("task {task}: recorded {actual} answer tokens but not declared"),
            ));
        }
    }
    checks
}

/// Evaluate mirror-pair symmetry gates (issue #16).
///
/// Returns one check per required orientation, plus mean-paired-accuracy and
/// position-gap checks. Missing orientations fail closed.
pub fn evaluate_paired_eval(
    spec: &PairedEvalSpec,
    result: &PairedEvalResult,
) -> Vec<GateCheck> {
    let mut checks = Vec::new();
    for orientation in &spec.orientations {
        match result.per_orientation.get(orientation) {
            Some(accuracy) => checks.push(check(
                "paired_orientation",
                (0.0..=1.0).contains(accuracy),
                format!("orientation {orientation}: choice accuracy {accuracy:.4}"),
            )),
            None => checks.push(check(
                "paired_orientation",
                false,
                format!("orientation {orientation}: never evaluated"),
            )),
        }
    }
    match result.mean_paired_accuracy() {
        Some(mean) => checks.push(check(
            "paired_choice_accuracy",
            mean >= spec.min_mean_paired_accuracy,
            format!(
                "mean paired accuracy {mean:.4} vs gate {:.4}",
                spec.min_mean_paired_accuracy
            ),
        )),
        None => checks.push(check(
            "paired_choice_accuracy",
            false,
            "no paired accuracies recorded".to_owned(),
        )),
    }
    match result.position_gap() {
        Some(gap) => checks.push(check(
            "position_gap",
            gap <= spec.max_position_gap,
            format!(
                "orientation gap {gap:.4} vs maximum {:.4}",
                spec.max_position_gap
            ),
        )),
        None => checks.push(check(
            "position_gap",
            false,
            "no paired accuracies recorded".to_owned(),
        )),
    }
    checks
}
