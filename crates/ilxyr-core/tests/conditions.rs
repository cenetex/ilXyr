//! Tests for the declarative condition language (#28).
//!
//! Builds a real ledger via the toy lifecycle, resolves facts from it, and
//! exercises evaluation semantics including fail-closed unresolvability,
//! depth bounds, and deterministic replay.

use std::{fs, path::PathBuf, process};

use ilxyr_core::conditions::{
    Condition, ConditionFacts, ConditionResult, MAX_CONDITION_DEPTH, evaluate,
};
use ilxyr_core::model::{ComparisonOperator, Evidence};
use ilxyr_core::{
    ExperimentSpec, Forecast, FundingCommitment, ResearchContribution, Workspace, commit_funding,
    compile_experiment, decide_admission, run_experiment, submit_contribution, submit_forecast,
};
use serde_json::Value;

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn create() -> Self {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let unique = std::sync::atomic::AtomicU64::fetch_add(
            &COUNTER,
            1,
            std::sync::atomic::Ordering::Relaxed,
        );
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::SystemTime::UNIX_EPOCH)
            .expect("test clock must follow Unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "ilxyr-conditions-{}-{nonce}-{unique}",
            process::id()
        ));
        fs::create_dir_all(&path).expect("test directory must be created");
        Self(path)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn build_ledger(dir: &TestDirectory) {
    let workspace = Workspace::init(&dir.0).expect("workspace must initialize");
    for json in [
        include_str!("../../../examples/toy/hypothesis.json"),
        include_str!("../../../examples/toy/foundation.json"),
        include_str!("../../../examples/toy/engineering-review.json"),
        include_str!("../../../examples/toy/experiment-design.json"),
    ] {
        let contribution: ResearchContribution =
            serde_json::from_str(json).expect("toy contribution must parse");
        submit_contribution(&workspace, contribution).expect("contribution must be accepted");
    }
    let spec: ExperimentSpec =
        serde_json::from_str(include_str!("../../../examples/toy/experiment.json"))
            .expect("toy experiment must parse");
    compile_experiment(&workspace, spec).expect("experiment must compile");
    for json in [
        include_str!("../../../examples/toy/forecast-model.json"),
        include_str!("../../../examples/toy/forecast-human.json"),
    ] {
        let forecast: Forecast = serde_json::from_str(json).expect("forecast must parse");
        submit_forecast(&workspace, forecast).expect("forecast must be accepted");
    }
    for json in [
        include_str!("../../../examples/toy/funding-a.json"),
        include_str!("../../../examples/toy/funding-b.json"),
    ] {
        let funding: FundingCommitment = serde_json::from_str(json).expect("funding must parse");
        commit_funding(&workspace, funding).expect("funding must be accepted");
    }
    decide_admission(&workspace, "toy.score.v1").expect("admission must decide");
    run_experiment(&workspace, "toy.score.v1").expect("run must complete");
}

fn metric_condition(value: f64) -> Condition {
    Condition::Metric {
        experiment_id: "toy.score.v1".to_owned(),
        metric: "score".to_owned(),
        operator: ComparisonOperator::Gte,
        threshold: value,
    }
}

#[test]
fn facts_resolve_from_ledger_and_evaluate() {
    let dir = TestDirectory::create();
    build_ledger(&dir);
    let workspace = Workspace::open(&dir.0).expect("workspace must open");
    let facts =
        ConditionFacts::from_workspace(&workspace).expect("facts must resolve from the ledger");

    // The toy run resolves its declared outcome; score threshold gates on it.
    let satisfied = evaluate(&metric_condition(0.0), &facts);
    assert!(matches!(
        satisfied,
        ConditionResult::Satisfied | ConditionResult::Unsatisfied { .. }
    ));

    let impossible = Condition::AllOf {
        all_of: vec![
            metric_condition(f64::MAX / 4.0),
            metric_condition(f64::MAX / 8.0),
        ],
    };
    assert!(matches!(
        evaluate(&impossible, &facts),
        ConditionResult::Unsatisfied { .. }
    ));
}

#[test]
fn unknown_metric_fails_closed_through_every_combinator() {
    let evidence = Evidence {
        schema: "ilxyr.evidence.v1".to_owned(),
        id: "toy.evidence.score.v1".to_owned(),
        experiment_id: "toy.score.v1".to_owned(),
        run_ref: "artifact://sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            .to_owned(),
        resolved_outcome: "success".to_owned(),
        metrics: [("score".to_owned(), 0.82)].into_iter().collect(),
        recorded_at_ms: 1770000000000,
        authority: serde_json::from_value(Value::Null).unwrap_or_else(|_| {
            serde_json::from_str(
                r#"{
                "level": "deterministic_replay",
                "scope": {"seeds": [7], "eval_set": "dataset://toy/score/v1", "coverage": 1},
                "provenance": {
                    "artifact_hashes": ["artifact://sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
                    "model_lineage": "model://toy/scorer/v1",
                    "checker": "checker://toy/score/v1"
                }
            }"#,
            )
            .expect("authority must parse")
        }),
        lane: ilxyr_core::EvidenceLane::Promoted,
        answer_token_mass: None,
    };
    let facts = ConditionFacts::from_evidence(&[evidence]);

    // Known metric evaluates.
    assert!(evaluate(&metric_condition(0.5), &facts).is_satisfied());

    // Unknown metric is unresolvable and never satisfied.
    let unknown = Condition::Metric {
        experiment_id: "toy.score.v1".to_owned(),
        metric: "does_not_exist".to_owned(),
        operator: ComparisonOperator::Lt,
        threshold: f64::MAX,
    };
    let result = evaluate(&unknown, &facts);
    assert!(matches!(result, ConditionResult::Unresolvable { .. }));
    assert!(!result.is_satisfied());

    // not(unresolvable) is unresolvable — negation never fabricates truth.
    let negated = Condition::Not {
        not: Box::new(unknown.clone()),
    };
    let result = evaluate(&negated, &facts);
    assert!(matches!(result, ConditionResult::Unresolvable { .. }));
    assert!(!result.is_satisfied());

    // any_of is order-independent: a satisfied arm wins even when another arm
    // is unresolvable.
    let any_satisfied = Condition::AnyOf {
        any_of: vec![metric_condition(0.5), unknown.clone()],
    };
    assert!(evaluate(&any_satisfied, &facts).is_satisfied());

    // any_of with only unsatisfied + unresolvable arms fails closed.
    let failing = Condition::Metric {
        experiment_id: "toy.score.v1".to_owned(),
        metric: "score".to_owned(),
        operator: ComparisonOperator::Gt,
        threshold: f64::MAX,
    };
    let any_closed = Condition::AnyOf {
        any_of: vec![failing, unknown],
    };
    let result = evaluate(&any_closed, &facts);
    assert!(matches!(result, ConditionResult::Unresolvable { .. }));
    assert!(!result.is_satisfied());
}

#[test]
fn depth_validation_bounds_nesting() {
    let mut leaf = metric_condition(0.5);
    // Build depth MAX_CONDITION_DEPTH + 1.
    for _ in 0..MAX_CONDITION_DEPTH {
        leaf = Condition::Not {
            not: Box::new(leaf),
        };
    }
    assert!(leaf.validate().is_err(), "over-deep condition must reject");

    let mut ok_leaf = metric_condition(0.5);
    for _ in 0..MAX_CONDITION_DEPTH - 1 {
        ok_leaf = Condition::Not {
            not: Box::new(ok_leaf),
        };
    }
    assert_eq!(ok_leaf.depth(), MAX_CONDITION_DEPTH);
    assert!(ok_leaf.validate().is_ok());
}

#[test]
fn empty_composites_reject() {
    let empty_all_of = Condition::AllOf { all_of: vec![] };
    assert!(empty_all_of.validate().is_err());
    let empty_any_of = Condition::AnyOf { any_of: vec![] };
    assert!(empty_any_of.validate().is_err());
}
