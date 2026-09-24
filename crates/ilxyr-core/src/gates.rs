//! Task accounting and paired-evaluation gate checks (#16, #17).
//!
//! Pure functions deriving [`GateCheck`]s from declared contracts and
//! recorded evidence. Paired evaluation is currently a library-only gate:
//! evidence finalization, export, nomination, and the paper lane do not call it.

use std::collections::{BTreeMap, BTreeSet};

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
        let max = self
            .per_orientation
            .values()
            .copied()
            .fold(f64::MIN, f64::max);
        let min = self
            .per_orientation
            .values()
            .copied()
            .fold(f64::MAX, f64::min);
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
/// position-gap checks for valid inputs. Invalid contracts or results return
/// only a failing contract check, before any aggregate is calculated.
pub fn evaluate_paired_eval(spec: &PairedEvalSpec, result: &PairedEvalResult) -> Vec<GateCheck> {
    let mut problems = Vec::new();
    let declared: BTreeSet<_> = spec.orientations.iter().collect();
    if spec.orientations.is_empty() {
        problems.push("no orientations declared".to_owned());
    }
    if spec.orientations.iter().any(|name| name.trim().is_empty()) {
        problems.push("empty orientation identifier".to_owned());
    }
    if declared.len() != spec.orientations.len() {
        problems.push("duplicate declared orientations".to_owned());
    }
    if !spec.min_mean_paired_accuracy.is_finite()
        || !(0.0..=1.0).contains(&spec.min_mean_paired_accuracy)
    {
        problems.push("invalid minimum paired accuracy".to_owned());
    }
    if !spec.max_position_gap.is_finite() || !(0.0..=1.0).contains(&spec.max_position_gap) {
        problems.push("invalid maximum position gap".to_owned());
    }
    for name in &spec.orientations {
        if !result.per_orientation.contains_key(name) {
            problems.push(format!("missing orientation {name}"));
        }
    }
    for (name, accuracy) in &result.per_orientation {
        if !declared.contains(name) {
            problems.push(format!("undeclared orientation {name}"));
        }
        if !accuracy.is_finite() || !(0.0..=1.0).contains(accuracy) {
            problems.push(format!("invalid accuracy for orientation {name}"));
        }
    }
    if !problems.is_empty() {
        return vec![check("paired_contract", false, problems.join("; "))];
    }

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

#[cfg(test)]
mod tests {
    use super::*;

    fn spec() -> PairedEvalSpec {
        PairedEvalSpec {
            orientations: vec!["ab".to_owned(), "ba".to_owned()],
            min_mean_paired_accuracy: 0.8,
            max_position_gap: 0.05,
        }
    }

    fn result(pairs: &[(&str, f64)]) -> PairedEvalResult {
        PairedEvalResult {
            per_orientation: pairs
                .iter()
                .map(|(name, score)| ((*name).to_owned(), *score))
                .collect(),
        }
    }

    #[test]
    fn undeclared_orientation_cannot_raise_the_paired_mean() {
        let checks = evaluate_paired_eval(
            &spec(),
            &result(&[("ab", 0.79), ("ba", 0.79), ("undeclared", 0.83)]),
        );
        assert_eq!(checks.len(), 1);
        assert_eq!(checks[0].gate, "paired_contract");
        assert!(!checks[0].passed);
        assert!(
            checks[0]
                .detail
                .contains("undeclared orientation undeclared")
        );
    }

    #[test]
    fn valid_pair_keeps_the_existing_gate_results() {
        let checks = evaluate_paired_eval(&spec(), &result(&[("ab", 0.81), ("ba", 0.82)]));
        assert_eq!(
            checks
                .iter()
                .map(|item| item.gate.as_str())
                .collect::<Vec<_>>(),
            [
                "paired_orientation",
                "paired_orientation",
                "paired_choice_accuracy",
                "position_gap"
            ]
        );
        assert!(checks.iter().all(|item| item.passed));
    }

    #[test]
    fn malformed_declarations_and_scores_fail_before_aggregation() {
        let cases = [
            (
                PairedEvalSpec {
                    orientations: vec![],
                    ..spec()
                },
                result(&[]),
            ),
            (
                PairedEvalSpec {
                    orientations: vec!["ab".to_owned(), "ab".to_owned()],
                    ..spec()
                },
                result(&[("ab", 0.9)]),
            ),
            (
                PairedEvalSpec {
                    min_mean_paired_accuracy: f64::NAN,
                    ..spec()
                },
                result(&[("ab", 0.9), ("ba", 0.9)]),
            ),
            (
                PairedEvalSpec {
                    max_position_gap: 1.1,
                    ..spec()
                },
                result(&[("ab", 0.9), ("ba", 0.9)]),
            ),
            (spec(), result(&[("ab", f64::INFINITY), ("ba", 0.9)])),
            (spec(), result(&[("ab", -0.1), ("ba", 0.9)])),
            (spec(), result(&[("ab", 0.9)])),
        ];
        for (spec, result) in cases {
            let checks = evaluate_paired_eval(&spec, &result);
            assert_eq!(checks.len(), 1);
            assert_eq!(checks[0].gate, "paired_contract");
            assert!(!checks[0].passed);
        }
    }
}
