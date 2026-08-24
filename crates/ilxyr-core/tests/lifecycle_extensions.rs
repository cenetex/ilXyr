//! Integration tests for the lifecycle extensions (#18, #19, #20, #22)
//! and the paper lane (#23, #24, #25).

use std::fs;
use std::path::PathBuf;

use ilxyr_core::conditions::{ConditionFacts, ConditionSet};
use ilxyr_core::lifecycle::{
    BranchDefinition, BranchPlan, RunIntent, activate_branches, ensure_test_access_allowed,
    register_branch_plan, release_test_digest, seal_test_digest,
};
use ilxyr_core::mechanism::{
    attach_mechanism_condition, metric_condition, settle_mechanism_forecast,
};
use ilxyr_core::model::ComparisonOperator;
use ilxyr_core::papers::{
    ExternalReceipt, PaperState, SufficiencyCriterion, candidate_state, nominate, record_decision,
    record_submission, register_candidate,
};
use ilxyr_core::{
    ExperimentSpec, Forecast, FundingCommitment, ResearchContribution, Workspace, commit_funding,
    compile_experiment, decide_admission, run_experiment, submit_contribution, submit_forecast,
};

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn create(label: &str) -> Self {
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
            "ilxyr-lifecycle-{label}-{}-{nonce}-{unique}",
            std::process::id()
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

/// Build the toy lifecycle through a completed run with recorded evidence.
fn build_completed_ledger(dir: &TestDirectory) {
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

fn condition_set(id: &str, threshold: f64) -> ConditionSet {
    ConditionSet {
        schema: "ilxyr.condition.v1".to_owned(),
        id: id.to_owned(),
        root: metric_condition("toy.score.v1", "score", ComparisonOperator::Gte, threshold),
    }
}

#[test]
fn mechanism_forecasts_settle_from_facts() {
    let dir = TestDirectory::create("mech");
    build_completed_ledger(&dir);
    let workspace = Workspace::open(&dir.0).unwrap();

    // Attach two mechanism predictions before settlement.
    attach_mechanism_condition(
        &workspace,
        "toy.forecast.model.v1",
        condition_set("mech.model.v1", 0.5),
    )
    .expect("attach must succeed");
    attach_mechanism_condition(
        &workspace,
        "toy.forecast.human.v1",
        condition_set("mech.human.v1", f64::MAX / 4.0), // impossible
    )
    .expect("attach must succeed");

    let good = settle_mechanism_forecast(&workspace, "toy.forecast.model.v1")
        .expect("settlement must succeed");
    assert_eq!(good.resolved_outcome, "correct");

    let bad = settle_mechanism_forecast(&workspace, "toy.forecast.human.v1")
        .expect("settlement must succeed");
    assert_eq!(bad.resolved_outcome, "incorrect");

    // Idempotent replay returns the same settlement.
    let again = settle_mechanism_forecast(&workspace, "toy.forecast.model.v1")
        .expect("idempotent settlement");
    assert_eq!(again.resolved_outcome, "correct");

    // Attaching to an unknown forecast fails.
    assert!(
        attach_mechanism_condition(
            &workspace,
            "toy.forecast.nonexistent.v1",
            condition_set("mech.x.v1", 0.0),
        )
        .is_err()
    );
}

#[test]
fn intent_defaults_exploratory_and_declares_confirmatory() {
    let dir = TestDirectory::create("intent");
    build_completed_ledger(&dir);
    let workspace = Workspace::open(&dir.0).unwrap();

    let undeclared = RunIntent::resolve(&workspace, "toy.score.v1").unwrap();
    assert_eq!(undeclared, RunIntent::Exploratory, "default is exploratory");

    RunIntent::declare(&workspace, "toy.score.v1", RunIntent::Confirmatory)
        .expect("declaration must append");
    let declared = RunIntent::resolve(&workspace, "toy.score.v1").unwrap();
    assert_eq!(declared, RunIntent::Confirmatory);

    assert!(
        RunIntent::declare(&workspace, "nonexistent.v1", RunIntent::Confirmatory).is_err(),
        "declaring intent for unknown experiment must fail"
    );
}

#[test]
fn sealed_digest_blocks_execution_until_released() {
    let dir = TestDirectory::create("seal");
    build_completed_ledger(&dir);
    let workspace = Workspace::open(&dir.0).unwrap();

    let digest: String = "a".repeat(64);
    seal_test_digest(&workspace, "toy.score.v1", &digest).expect("sealing must succeed");

    // Execution is refused while sealed.
    assert!(ensure_test_access_allowed(&workspace, "toy.score.v1").is_err());

    // Malformed digests reject at sealing time.
    assert!(seal_test_digest(&workspace, "toy.score.v1", "xyz").is_err());

    release_test_digest(
        &workspace,
        "toy.score.v1",
        &ilxyr_core::ActorRef::service("service://ilxyr/human-ack"),
    )
    .expect("release must succeed");
    ensure_test_access_allowed(&workspace, "toy.score.v1")
        .expect("released digest must allow execution");

    // Releasing without a sealed digest fails.
    assert!(
        release_test_digest(
            &workspace,
            "toy.score.v1",
            &ilxyr_core::ActorRef::service("service://ilxyr/human-ack"),
        )
        .is_err()
    );
}

#[test]
fn branch_plans_activate_deterministically_and_fail_closed() {
    let dir = TestDirectory::create("branch");
    build_completed_ledger(&dir);
    let workspace = Workspace::open(&dir.0).unwrap();

    let plan = BranchPlan {
        schema: "ilxyr.branch_plan.v1".to_owned(),
        id: "plan.toy.v1".to_owned(),
        parent_experiment_id: "toy.score.v1".to_owned(),
        branches: vec![
            BranchDefinition {
                id: "replication".to_owned(),
                condition: condition_set("cond.replicate.v1", 0.5),
                child_spec_ref:
                    "artifact://sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                        .to_owned(),
            },
            BranchDefinition {
                id: "scale-up".to_owned(),
                condition: condition_set("cond.scale.v1", f64::MAX / 4.0),
                child_spec_ref:
                    "artifact://sha256/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
                        .to_owned(),
            },
        ],
    };
    register_branch_plan(&workspace, plan).expect("plan must register");

    let outcomes = activate_branches(&workspace, "toy.score.v1").expect("activation must evaluate");
    assert_eq!(outcomes.len(), 2);
    assert_eq!(outcomes[0].branch_id, "replication");
    assert!(outcomes[0].activated, "satisfied branch activates");
    assert!(!outcomes[1].activated, "unsatisfied branch stays dormant");

    // Idempotent replay: same results, no duplicate activation events.
    let replay =
        activate_branches(&workspace, "toy.score.v1").expect("replay activation must succeed");
    assert_eq!(replay.len(), 2);
    assert!(
        replay
            .iter()
            .all(|outcome| outcome.detail.contains("idempotent"))
    );
}

#[test]
fn paper_lane_resolves_only_on_matching_receipts() {
    let dir = TestDirectory::create("papers");
    build_completed_ledger(&dir);
    let workspace = Workspace::open(&dir.0).unwrap();

    let digest: String = format!("{digest:064x}", digest = 48879u64);
    let candidate = ilxyr_core::papers::PaperCandidate {
        schema: "ilxyr.paper_candidate.v1".to_owned(),
        id: "paper.position-bias.v1".to_owned(),
        title: "Position bias at 4.85M parameters".to_owned(),
        required_claims: vec![],
        non_claims: vec!["no general language improvement claim".to_owned()],
        venue: "arxiv".to_owned(),
        content_digest: digest.clone(),
    };
    register_candidate(&workspace, candidate).expect("candidate must register");

    assert_eq!(
        candidate_state(&workspace, "paper.position-bias.v1").unwrap(),
        PaperState::Draft
    );

    // Digest mismatch is rejected as a security error.
    let bad_receipt = ExternalReceipt {
        schema: String::new(),
        paper_id: "paper.position-bias.v1".to_owned(),
        venue: "arxiv".to_owned(),
        external_id: "2608.00001".to_owned(),
        content_digest: format!("{digest:064x}", digest = 4277009102u64),
        recorded_at_ms: 1787605000000,
    };
    assert!(record_submission(&workspace, bad_receipt).is_err());

    let receipt = ExternalReceipt {
        schema: String::new(),
        paper_id: "paper.position-bias.v1".to_owned(),
        venue: "arxiv".to_owned(),
        external_id: "2608.00001".to_owned(),
        content_digest: digest.clone(),
        recorded_at_ms: 1787605000000,
    };
    record_submission(&workspace, receipt.clone()).expect("submission must record");
    assert_eq!(
        candidate_state(&workspace, "paper.position-bias.v1").unwrap(),
        PaperState::Submitted
    );

    // Double submission from Submitted state is invalid.
    assert!(record_submission(&workspace, receipt.clone()).is_err());

    let state = record_decision(&workspace, receipt, true).expect("decision must record");
    assert_eq!(state, PaperState::Promoted);
    assert_eq!(
        candidate_state(&workspace, "paper.position-bias.v1").unwrap(),
        PaperState::Promoted
    );
}

#[test]
fn nomination_reports_outcomes_and_near_misses() {
    let dir = TestDirectory::create("nominate");
    build_completed_ledger(&dir);
    let workspace = Workspace::open(&dir.0).unwrap();

    let criteria = vec![
        SufficiencyCriterion {
            id: "crit.curriculum.v1".to_owned(),
            title: "curriculum order effect replicated".to_owned(),
            condition: condition_set("crit.cond.v1", 0.5),
            required_claims: vec![],
        },
        SufficiencyCriterion {
            id: "crit.impossible.v1".to_owned(),
            title: "impossible criterion".to_owned(),
            condition: condition_set("crit.cond2.v1", f64::MAX / 4.0),
            required_claims: vec![],
        },
    ];
    let outcomes = nominate(&workspace, &criteria).expect("nomination must evaluate");
    assert_eq!(outcomes.len(), 2);
    assert!(outcomes[0].nominated, "met criterion nominates");
    assert!(!outcomes[1].nominated, "unmet criterion does not nominate");

    // Required claims gate nomination even when the condition passes.
    let gated = vec![SufficiencyCriterion {
        id: "crit.claimed.v1".to_owned(),
        title: "needs a supported claim".to_owned(),
        condition: condition_set("crit.cond3.v1", 0.5),
        required_claims: vec!["claim.never.registered.v1".to_owned()],
    }];
    let outcomes = nominate(&workspace, &gated).expect("gated nomination must evaluate");
    assert!(!outcomes[0].nominated);
    assert_eq!(
        outcomes[0].missing_claims,
        vec!["claim.never.registered.v1".to_owned()]
    );
}

#[test]
fn facts_snapshot_is_deterministic_across_replays() {
    let dir = TestDirectory::create("facts");
    build_completed_ledger(&dir);
    let first = Workspace::open(&dir.0).unwrap();
    let facts_a = ConditionFacts::from_workspace(&first).unwrap();
    let facts_b = ConditionFacts::from_workspace(&first).unwrap();
    let score_a = facts_a.metric("toy.score.v1", "score");
    let score_b = facts_b.metric("toy.score.v1", "score");
    assert_eq!(score_a, score_b, "fact resolution must be deterministic");
}
