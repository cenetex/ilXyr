use std::fs;
use std::path::PathBuf;

use ilxyr_core::{
    ExperimentSpec, Forecast, FundingCommitment, MechanismTournament, ResearchContribution,
    TOURNAMENT_REGISTERED, Workspace, commit_funding, compile_experiment, decide_admission,
    rank_observations, register_mechanism_tournament, run_experiment, settle_mechanism_tournament,
    submit_contribution, submit_forecast,
};

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn create(label: &str) -> Self {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let unique = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::SystemTime::UNIX_EPOCH)
            .expect("test clock must follow Unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "ilxyr-tournament-{label}-{}-{nonce}-{unique}",
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

fn tournament() -> MechanismTournament {
    serde_json::from_str(include_str!(
        "../../../examples/schema/mechanism-tournament.json"
    ))
    .expect("mechanism tournament fixture must parse")
}

fn compile_toy(workspace: &Workspace) {
    for json in [
        include_str!("../../../examples/toy/hypothesis.json"),
        include_str!("../../../examples/toy/foundation.json"),
        include_str!("../../../examples/toy/engineering-review.json"),
        include_str!("../../../examples/toy/experiment-design.json"),
    ] {
        let contribution: ResearchContribution =
            serde_json::from_str(json).expect("toy contribution must parse");
        submit_contribution(workspace, contribution).expect("contribution must be accepted");
    }
    let spec: ExperimentSpec =
        serde_json::from_str(include_str!("../../../examples/toy/experiment.json"))
            .expect("toy experiment must parse");
    compile_experiment(workspace, spec).expect("experiment must compile");
}

fn complete_toy(workspace: &Workspace) {
    for json in [
        include_str!("../../../examples/toy/forecast-model.json"),
        include_str!("../../../examples/toy/forecast-human.json"),
    ] {
        let forecast: Forecast = serde_json::from_str(json).expect("forecast must parse");
        submit_forecast(workspace, forecast).expect("forecast must be accepted");
    }
    for json in [
        include_str!("../../../examples/toy/funding-a.json"),
        include_str!("../../../examples/toy/funding-b.json"),
    ] {
        let funding: FundingCommitment = serde_json::from_str(json).expect("funding must parse");
        commit_funding(workspace, funding).expect("funding must be accepted");
    }
    let admission =
        decide_admission(workspace, "toy.score.v1").expect("admission must be accepted");
    assert!(admission.accepted);
    run_experiment(workspace, "toy.score.v1").expect("run must complete");
}

#[test]
fn tournament_prioritizes_discriminating_observations_and_settles() {
    let dir = TestDirectory::create("settle");
    let workspace = Workspace::init(&dir.0).expect("workspace must initialize");
    compile_toy(&workspace);

    let registration = register_mechanism_tournament(&workspace, tournament())
        .expect("tournament must register before admission");
    assert_eq!(registration.observation_priorities.len(), 2);
    assert_eq!(
        registration.observation_priorities[0].observation_id,
        "clears_stretch"
    );
    assert!(registration.observation_priorities[0].priority_score > 0.0);
    assert_eq!(registration.observation_priorities[1].priority_score, 0.0);
    let registration_event = workspace
        .latest_event(TOURNAMENT_REGISTERED, "toy.score-mechanisms.v1")
        .expect("registration event query must succeed")
        .expect("registration event must exist");
    assert_eq!(registration_event.actor, tournament().author);

    assert!(
        settle_mechanism_tournament(&workspace, "toy.score-mechanisms.v1").is_err(),
        "missing evidence must fail closed without recording a decision"
    );

    complete_toy(&workspace);
    let replayed_registration = register_mechanism_tournament(&workspace, tournament())
        .expect("identical registration retry must remain safe after admission");
    assert_eq!(
        replayed_registration.tournament_ref,
        registration.tournament_ref
    );
    let mut drifted = tournament();
    drifted.question.push_str(" Changed after freezing.");
    let drift_error = register_mechanism_tournament(&workspace, drifted)
        .expect_err("same tournament id with different content must reject");
    assert!(drift_error.to_string().contains("different content"));

    let settlement = settle_mechanism_tournament(&workspace, "toy.score-mechanisms.v1")
        .expect("recorded evidence must settle the tournament");
    assert_eq!(settlement.decision_row_id, "threshold_only");
    assert_eq!(settlement.supported_rival_ids, vec!["threshold_fit"]);
    assert_eq!(settlement.lowest_scoring_rival_ids, vec!["threshold_fit"]);
    assert_eq!(settlement.rival_scores[0].rival_id, "threshold_fit");
    assert!((settlement.rival_scores[0].brier_score - 0.025).abs() < 1.0e-12);
    assert!((settlement.rival_scores[1].brier_score - 0.325).abs() < 1.0e-12);

    let replay = settle_mechanism_tournament(&workspace, "toy.score-mechanisms.v1")
        .expect("settlement replay must be idempotent");
    assert_eq!(replay.settled_at_ms, settlement.settled_at_ms);
    assert!(workspace.verify().expect("workspace must verify").valid);
}

#[test]
fn tournament_requires_an_exhaustive_distinguishing_design() {
    let complete = tournament();
    complete.validate().expect("fixture must be valid");
    assert_eq!(
        rank_observations(&complete).expect("ranking must succeed")[0].observation_id,
        "clears_stretch"
    );

    let mut missing_row = complete.clone();
    missing_row.decision_table.pop();
    assert!(missing_row.validate().is_err());

    let mut duplicate_rival = complete.clone();
    duplicate_rival.rivals[1].predictions = duplicate_rival.rivals[0].predictions.clone();
    assert!(duplicate_rival.validate().is_err());

    let mut incomplete_prediction = complete.clone();
    incomplete_prediction.rivals[0].predictions.pop();
    assert!(incomplete_prediction.validate().is_err());

    let mut invalid_author = complete;
    invalid_author.author.model_ref = None;
    assert!(invalid_author.validate().is_err());
}

#[test]
fn tournament_cannot_be_registered_after_admission() {
    let dir = TestDirectory::create("late");
    let workspace = Workspace::init(&dir.0).expect("workspace must initialize");
    compile_toy(&workspace);
    complete_toy(&workspace);

    let error = register_mechanism_tournament(&workspace, tournament())
        .expect_err("late tournament registration must reject");
    assert!(error.to_string().contains("must be frozen first"));
}
