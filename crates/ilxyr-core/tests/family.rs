use std::{fs, path::PathBuf, process, time::SystemTime};

use ilxyr_core::{
    ExperimentFamilyContract, ExperimentFamilyMember, ExperimentSpec, Forecast, FundingCommitment,
    PriorFamilyOutcome, ResearchContribution, Workspace, commit_funding, compile_experiment,
    decide_admission, experiment_family_status, register_experiment_family, run_experiment,
    settle_experiment_family, submit_contribution, submit_forecast,
};

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn create(label: &str) -> Self {
        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("test clock must follow Unix epoch")
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("ilxyr-family-{label}-{}-{nonce}", process::id()));
        fs::create_dir_all(&path).expect("test directory must be created");
        Self(path)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn family_waits_for_every_run_and_settles_once() {
    let directory = TestDirectory::create("settlement");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    let (first, second) = freeze_two_toy_members(&workspace);
    register_experiment_family(
        &workspace,
        family_contract(&first.id, &second.id, "success"),
    )
    .expect("family must register");

    assert!(
        decide_admission(&workspace, &first.id)
            .expect("first admission must resolve")
            .accepted
    );
    assert!(
        decide_admission(&workspace, &second.id)
            .expect("second admission must resolve")
            .accepted
    );
    run_experiment(&workspace, &first.id).expect("first member must run");
    assert!(
        settle_experiment_family(&workspace, "toy.family.v1").is_err(),
        "run_all family must not settle early"
    );
    run_experiment(&workspace, &second.id).expect("second member must run");

    let settled =
        settle_experiment_family(&workspace, "toy.family.v1").expect("complete family must settle");
    assert_eq!(settled.settlement.resolved_outcome, "go");
    assert!(settled.settlement.promotion_eligible);
    assert_eq!(settled.settlement.members.len(), 2);
    assert!(
        settled
            .settlement
            .members
            .iter()
            .all(|member| member.passed)
    );
    assert!(settled.ledger.valid);

    let event_count = workspace.events().expect("events must load").len();
    let retried = settle_experiment_family(&workspace, "toy.family.v1")
        .expect("family settlement must be idempotent");
    assert_eq!(retried.settlement, settled.settlement);
    assert_eq!(
        workspace.events().expect("events must load").len(),
        event_count
    );

    let status =
        experiment_family_status(&workspace, "toy.family.v1").expect("family status must load");
    assert!(status.all_runs_terminal);
    assert_eq!(status.projected_outcome.as_deref(), Some("go"));
    assert!(status.latest_settlement.is_some());
}

#[test]
fn prior_failure_prevents_family_promotion() {
    let directory = TestDirectory::create("prior-failure");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    let (first, second) = freeze_two_toy_members(&workspace);
    register_experiment_family(
        &workspace,
        family_contract(&first.id, &second.id, "below_threshold"),
    )
    .expect("family must register");
    for experiment in [&first, &second] {
        assert!(
            decide_admission(&workspace, &experiment.id)
                .expect("admission must resolve")
                .accepted
        );
        run_experiment(&workspace, &experiment.id).expect("member must run");
    }

    let settled = settle_experiment_family(&workspace, "toy.family.v1")
        .expect("family must settle after both runs");
    assert_eq!(settled.settlement.resolved_outcome, "no_go");
    assert!(!settled.settlement.promotion_eligible);
}

fn freeze_two_toy_members(workspace: &Workspace) -> (ExperimentSpec, ExperimentSpec) {
    for contribution in [
        contribution(include_str!("../../../examples/toy/hypothesis.json")),
        contribution(include_str!("../../../examples/toy/foundation.json")),
        contribution(include_str!(
            "../../../examples/toy/engineering-review.json"
        )),
        contribution(include_str!("../../../examples/toy/experiment-design.json")),
    ] {
        submit_contribution(workspace, contribution).expect("contribution must freeze");
    }

    let mut first = experiment();
    first.id = "toy.family.seed1.v1".to_owned();
    first.seeds = vec![1];
    first.evidence_authority.scope.seeds = vec![1];
    let mut second = first.clone();
    second.id = "toy.family.seed3.v1".to_owned();
    second.seeds = vec![3];
    second.evidence_authority.scope.seeds = vec![3];
    compile_experiment(workspace, first.clone()).expect("first experiment must compile");
    compile_experiment(workspace, second.clone()).expect("second experiment must compile");

    for (index, experiment) in [&first, &second].into_iter().enumerate() {
        let mut model = forecast_model();
        model.id = format!("toy.family.{index}.forecast.model.v1");
        model.experiment_id.clone_from(&experiment.id);
        let mut human = forecast_human();
        human.id = format!("toy.family.{index}.forecast.human.v1");
        human.experiment_id.clone_from(&experiment.id);
        submit_forecast(workspace, model).expect("model forecast must freeze");
        submit_forecast(workspace, human).expect("human forecast must freeze");

        let mut first_funding = funding_a();
        first_funding.id = format!("toy.family.{index}.funding.a.v1");
        first_funding.experiment_id.clone_from(&experiment.id);
        let mut second_funding = funding_b();
        second_funding.id = format!("toy.family.{index}.funding.b.v1");
        second_funding.experiment_id.clone_from(&experiment.id);
        commit_funding(workspace, first_funding).expect("first funding must freeze");
        commit_funding(workspace, second_funding).expect("second funding must freeze");
    }
    (first, second)
}

fn family_contract(
    first_experiment_id: &str,
    second_experiment_id: &str,
    prior_outcome: &str,
) -> ExperimentFamilyContract {
    ExperimentFamilyContract {
        schema: "ilxyr.experiment_family.v1".to_owned(),
        id: "toy.family.v1".to_owned(),
        title: "Toy family".to_owned(),
        members: vec![
            ExperimentFamilyMember {
                experiment_id: first_experiment_id.to_owned(),
                seed: 1,
                required_outcome: "success".to_owned(),
            },
            ExperimentFamilyMember {
                experiment_id: second_experiment_id.to_owned(),
                seed: 3,
                required_outcome: "success".to_owned(),
            },
        ],
        prior_outcomes: vec![PriorFamilyOutcome {
            experiment_id: "toy.family.seed2.v1".to_owned(),
            seed: 2,
            resolved_outcome: prior_outcome.to_owned(),
            required_outcome: "success".to_owned(),
            result_ref: format!("artifact://sha256/{}", "a".repeat(64)),
        }],
        run_all: true,
        success_outcome: "go".to_owned(),
        failure_outcome: "no_go".to_owned(),
        promotion_candidate: Some("weight://toy/candidate-v1".to_owned()),
    }
}

fn contribution(json: &str) -> ResearchContribution {
    serde_json::from_str(json).expect("example contribution must parse")
}

fn experiment() -> ExperimentSpec {
    serde_json::from_str(include_str!("../../../examples/toy/experiment.json"))
        .expect("example experiment must parse")
}

fn forecast_model() -> Forecast {
    serde_json::from_str(include_str!("../../../examples/toy/forecast-model.json"))
        .expect("example forecast must parse")
}

fn forecast_human() -> Forecast {
    serde_json::from_str(include_str!("../../../examples/toy/forecast-human.json"))
        .expect("example forecast must parse")
}

fn funding_a() -> FundingCommitment {
    serde_json::from_str(include_str!("../../../examples/toy/funding-a.json"))
        .expect("example funding must parse")
}

fn funding_b() -> FundingCommitment {
    serde_json::from_str(include_str!("../../../examples/toy/funding-b.json"))
        .expect("example funding must parse")
}
