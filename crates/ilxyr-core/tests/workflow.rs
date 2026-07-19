use std::{fs, path::PathBuf, process, time::SystemTime};

use ilxyr_core::{
    CodePolicy, ExperimentSpec, ExportPolicy, Forecast, FundingCommitment, NetworkPolicy,
    ResearchContribution, WeightClass, Workspace, commit_funding, compile_experiment,
    decide_admission, experiment_status, run_experiment, submit_contribution, submit_forecast,
};

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn create(label: &str) -> Self {
        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("test clock must follow Unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("ilxyr-{label}-{}-{nonce}", process::id()));
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
fn funded_experiment_runs_and_settles_forecasts() {
    let directory = TestDirectory::create("complete");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    submit_lineage(&workspace);
    let experiment = experiment();
    compile_experiment(&workspace, experiment.clone()).expect("experiment must compile");

    let forecast_model = forecast_model();
    let forecast_human = forecast_human();
    submit_forecast(&workspace, forecast_model).expect("model forecast must be accepted");
    submit_forecast(&workspace, forecast_human).expect("human forecast must be accepted");
    commit_funding(&workspace, funding_a()).expect("first funding must be accepted");
    commit_funding(&workspace, funding_b()).expect("second funding must be accepted");

    let admission =
        decide_admission(&workspace, &experiment.id).expect("admission must be evaluated");
    assert!(admission.accepted);
    assert!(admission.checks.iter().all(|check| check.passed));

    let completed =
        run_experiment(&workspace, &experiment.id).expect("experiment must run and resolve");
    assert_eq!(completed.evidence.resolved_outcome, "success");
    assert_eq!(completed.run.metrics.get("score"), Some(&0.82));
    assert_eq!(completed.settlements.len(), 2);
    assert_eq!(completed.calibrations.len(), 2);
    assert!(
        completed
            .settlements
            .iter()
            .all(|settlement| settlement.brier_score >= 0.0)
    );
    let status = experiment_status(&workspace, &experiment.id).expect("status must load");
    assert!(status.execution_started);
    assert_eq!(
        status.latest_run.as_ref().map(|run| run.id.as_str()),
        Some(completed.run.id.as_str())
    );

    let report = workspace.verify().expect("ledger must verify");
    assert!(report.valid);
    assert!(report.objects_checked >= 12);
    assert!(report.events_checked >= 15);

    let events_before_retry = workspace
        .events()
        .expect("events must remain readable")
        .len();
    let retried = run_experiment(&workspace, &experiment.id)
        .expect("completed experiment finalization must be idempotent");
    assert_eq!(retried.run.id, completed.run.id);
    assert_eq!(retried.settlements.len(), completed.settlements.len());
    assert_eq!(
        workspace
            .events()
            .expect("events must remain readable")
            .len(),
        events_before_retry,
        "a completed experiment must not run or settle twice"
    );
}

#[test]
fn completed_run_resumes_missing_evidence_and_settlements() {
    let directory = TestDirectory::create("resume-finalization");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    submit_lineage(&workspace);
    let experiment = experiment();
    compile_experiment(&workspace, experiment.clone()).expect("experiment must compile");
    submit_forecast(&workspace, forecast_model()).expect("forecast must be accepted");
    submit_forecast(&workspace, forecast_human()).expect("forecast must be accepted");
    commit_funding(&workspace, funding_a()).expect("funding must be accepted");
    commit_funding(&workspace, funding_b()).expect("funding must be accepted");
    assert!(
        decide_admission(&workspace, &experiment.id)
            .expect("admission must be evaluated")
            .accepted
    );

    let completed =
        run_experiment(&workspace, &experiment.id).expect("experiment must initially complete");
    let events = workspace.events().expect("events must load");
    let completed_position = events
        .iter()
        .position(|event| event.event_type == "ExperimentCompleted")
        .expect("completed event must exist");
    let retained = events[..=completed_position]
        .iter()
        .map(|event| serde_json::to_string(event).expect("event must serialize"))
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(
        directory.0.join(".ilxyr/events.jsonl"),
        format!("{retained}\n"),
    )
    .expect("valid ledger tail must be truncatable for crash simulation");

    let resumed = run_experiment(&workspace, &experiment.id)
        .expect("post-run finalization must resume without execution");
    assert_eq!(resumed.run.id, completed.run.id);
    assert_eq!(resumed.evidence.resolved_outcome, "success");
    assert_eq!(resumed.settlements.len(), 2);
    assert!(
        workspace
            .verify()
            .expect("resumed ledger must verify")
            .valid
    );
}

#[test]
fn insufficient_forecast_and_funding_are_recorded_as_rejected() {
    let directory = TestDirectory::create("unfunded");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    submit_lineage(&workspace);
    let experiment = experiment();
    compile_experiment(&workspace, experiment.clone()).expect("experiment must compile");

    let admission =
        decide_admission(&workspace, &experiment.id).expect("admission must be evaluated");
    assert!(!admission.accepted);
    assert!(
        admission
            .checks
            .iter()
            .any(|check| { check.gate == "forecast_participation" && !check.passed })
    );
    assert!(
        admission
            .checks
            .iter()
            .any(|check| check.gate == "compute_funding" && !check.passed)
    );

    submit_forecast(&workspace, forecast_model()).expect("rejected admission remains open");
    submit_forecast(&workspace, forecast_human()).expect("rejected admission remains open");
    commit_funding(&workspace, funding_a()).expect("rejected admission remains open");
    commit_funding(&workspace, funding_b()).expect("rejected admission remains open");
    let accepted =
        decide_admission(&workspace, &experiment.id).expect("admission may be reevaluated");
    assert!(accepted.accepted);
}

#[test]
fn protected_weights_require_an_attested_executor() {
    let directory = TestDirectory::create("restricted");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    submit_lineage(&workspace);
    let mut experiment = experiment();
    experiment.id = "toy.score.restricted.v1".to_owned();
    experiment.security.weight_class = WeightClass::Restricted;
    experiment.security.code_policy = CodePolicy::ApprovedImageOnly;
    experiment.security.export_policy = ExportPolicy::MetricsOnly;
    experiment.execution.network = NetworkPolicy::Denied;
    compile_experiment(&workspace, experiment.clone()).expect("policy must be structurally valid");

    let mut model = forecast_model();
    model.id = "toy.forecast.model.restricted.v1".to_owned();
    model.experiment_id.clone_from(&experiment.id);
    let mut human = forecast_human();
    human.id = "toy.forecast.human.restricted.v1".to_owned();
    human.experiment_id.clone_from(&experiment.id);
    let mut first_funding = funding_a();
    first_funding.id = "toy.funding.a.restricted.v1".to_owned();
    first_funding.experiment_id.clone_from(&experiment.id);
    let mut second_funding = funding_b();
    second_funding.id = "toy.funding.b.restricted.v1".to_owned();
    second_funding.experiment_id.clone_from(&experiment.id);
    submit_forecast(&workspace, model).expect("forecast must be accepted");
    submit_forecast(&workspace, human).expect("forecast must be accepted");
    commit_funding(&workspace, first_funding).expect("funding must be accepted");
    commit_funding(&workspace, second_funding).expect("funding must be accepted");

    let admission =
        decide_admission(&workspace, &experiment.id).expect("admission must be evaluated");
    assert!(!admission.accepted);
    assert!(
        admission
            .checks
            .iter()
            .any(|check| { check.gate == "weight_protection" && !check.passed })
    );
    assert!(
        admission
            .checks
            .iter()
            .any(|check| check.gate == "code_policy" && !check.passed)
    );
    assert!(run_experiment(&workspace, &experiment.id).is_err());
}

#[test]
fn local_executor_rejects_output_restrictions_it_cannot_enforce() {
    let directory = TestDirectory::create("export-policy");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    submit_lineage(&workspace);
    let mut experiment = experiment();
    experiment.security.export_policy = ExportPolicy::MetricsOnly;
    compile_experiment(&workspace, experiment.clone()).expect("policy must be structurally valid");
    submit_forecast(&workspace, forecast_model()).expect("forecast must be accepted");
    submit_forecast(&workspace, forecast_human()).expect("forecast must be accepted");
    commit_funding(&workspace, funding_a()).expect("funding must be accepted");
    commit_funding(&workspace, funding_b()).expect("funding must be accepted");

    let admission =
        decide_admission(&workspace, &experiment.id).expect("admission must be evaluated");
    assert!(!admission.accepted);
    assert!(
        admission
            .checks
            .iter()
            .any(|check| { check.gate == "export_policy" && !check.passed })
    );
    assert!(run_experiment(&workspace, &experiment.id).is_err());
}

#[test]
fn compiled_experiment_id_is_frozen() {
    let directory = TestDirectory::create("frozen");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    submit_lineage(&workspace);
    let experiment = experiment();
    compile_experiment(&workspace, experiment.clone()).expect("experiment must compile");
    assert!(compile_experiment(&workspace, experiment).is_err());
}

#[test]
fn expected_metric_outputs_must_reference_the_frozen_contract() {
    let directory = TestDirectory::create("expected-output");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    submit_lineage(&workspace);
    let mut experiment = experiment();
    experiment.expected_outputs.push("metrics.extra".to_owned());

    let error = compile_experiment(&workspace, experiment)
        .expect_err("undeclared expected metric output must be rejected");
    assert!(error.to_string().contains("undeclared metric extra"));
}

#[test]
fn contribution_ids_are_immutable() {
    let directory = TestDirectory::create("contribution-id");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    let contribution = contribution(include_str!("../../../examples/toy/hypothesis.json"));
    submit_contribution(&workspace, contribution.clone()).expect("first submission must succeed");

    let mut replacement = contribution;
    replacement.body = "A changed body under the same identifier.".to_owned();
    assert!(submit_contribution(&workspace, replacement).is_err());
    assert_eq!(
        workspace
            .events()
            .expect("events must remain readable")
            .len(),
        1
    );
}

#[test]
fn append_refuses_to_extend_a_corrupt_ledger() {
    let directory = TestDirectory::create("corrupt-ledger");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    submit_contribution(
        &workspace,
        contribution(include_str!("../../../examples/toy/hypothesis.json")),
    )
    .expect("first contribution must succeed");
    let event_path = directory.0.join(".ilxyr/events.jsonl");
    let tampered = fs::read_to_string(&event_path)
        .expect("event log must be readable")
        .replace("ContributionSubmitted", "ContributionCorrupted");
    fs::write(&event_path, &tampered).expect("test must tamper with the ledger");

    let error = submit_contribution(
        &workspace,
        contribution(include_str!("../../../examples/toy/foundation.json")),
    )
    .expect_err("append must fail on an invalid existing chain");
    assert!(error.to_string().contains("event digest mismatch"));
    assert_eq!(
        fs::read_to_string(&event_path).expect("event log must remain readable"),
        tampered,
        "failed append must leave the corrupt log unchanged"
    );
}

#[test]
fn one_model_identity_cannot_multiply_forecast_stake() {
    let directory = TestDirectory::create("forecast-identity");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    submit_lineage(&workspace);
    let experiment = experiment();
    compile_experiment(&workspace, experiment).expect("experiment must compile");

    let first = forecast_model();
    let mut duplicate = first.clone();
    duplicate.id = "toy.forecast.model.alias.v1".to_owned();
    duplicate.forecaster.id = "model://toy/forecaster-alias".to_owned();
    submit_forecast(&workspace, first).expect("first forecast must succeed");
    assert!(submit_forecast(&workspace, duplicate).is_err());

    let status = experiment_status(&workspace, "toy.score.v1").expect("status must load");
    assert_eq!(status.forecasts, 1);
    assert_eq!(status.total_stake, 6);
}

#[test]
fn accepted_admission_closes_forecasts_and_funding() {
    let directory = TestDirectory::create("closed-inputs");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    submit_lineage(&workspace);
    let experiment = experiment();
    compile_experiment(&workspace, experiment.clone()).expect("experiment must compile");
    submit_forecast(&workspace, forecast_model()).expect("forecast must be accepted");
    submit_forecast(&workspace, forecast_human()).expect("forecast must be accepted");
    commit_funding(&workspace, funding_a()).expect("funding must be accepted");
    commit_funding(&workspace, funding_b()).expect("funding must be accepted");
    assert!(
        decide_admission(&workspace, &experiment.id)
            .expect("admission must be evaluated")
            .accepted
    );

    let mut late_forecast = forecast_human();
    late_forecast.id = "toy.forecast.late.v1".to_owned();
    late_forecast.forecaster.id = "human://toy/late-forecaster".to_owned();
    let mut late_funding = funding_a();
    late_funding.id = "toy.funding.late.v1".to_owned();
    assert!(submit_forecast(&workspace, late_forecast).is_err());
    assert!(commit_funding(&workspace, late_funding).is_err());

    let events_before_readmission = workspace
        .events()
        .expect("events must remain readable")
        .len();
    assert!(
        decide_admission(&workspace, &experiment.id)
            .expect("accepted admission is idempotent")
            .accepted
    );
    assert_eq!(
        workspace
            .events()
            .expect("events must remain readable")
            .len(),
        events_before_readmission
    );
}

#[test]
fn unresolved_outcome_records_a_terminal_run_without_evidence() {
    let directory = TestDirectory::create("unresolved");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    submit_lineage(&workspace);
    let mut experiment = experiment();
    experiment.execution.args = vec!["not-json".to_owned()];
    compile_experiment(&workspace, experiment.clone()).expect("experiment must compile");
    submit_forecast(&workspace, forecast_model()).expect("forecast must be accepted");
    submit_forecast(&workspace, forecast_human()).expect("forecast must be accepted");
    commit_funding(&workspace, funding_a()).expect("funding must be accepted");
    commit_funding(&workspace, funding_b()).expect("funding must be accepted");
    assert!(
        decide_admission(&workspace, &experiment.id)
            .expect("admission must be evaluated")
            .accepted
    );

    assert!(run_experiment(&workspace, &experiment.id).is_err());
    let status = experiment_status(&workspace, &experiment.id).expect("status must load");
    assert!(status.execution_started);
    assert!(
        status
            .latest_run
            .as_ref()
            .and_then(|run| run.output_error.as_deref())
            .is_some_and(|error| error.contains("not valid metric JSON"))
    );
    assert!(status.latest_evidence.is_none());
    let events_before_retry = workspace.events().expect("events must load").len();
    assert!(run_experiment(&workspace, &experiment.id).is_err());
    assert_eq!(
        workspace.events().expect("events must load").len(),
        events_before_retry,
        "retry must not execute or append after a terminal unresolved run"
    );
}

#[test]
fn undeclared_executor_metrics_are_not_recorded_as_evidence() {
    let directory = TestDirectory::create("extra-metric");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    submit_lineage(&workspace);
    let mut experiment = experiment();
    experiment.execution.args = vec!["{\"metrics\":{\"score\":0.82,\"extra\":1.0}}".to_owned()];
    compile_experiment(&workspace, experiment.clone()).expect("experiment must compile");
    submit_forecast(&workspace, forecast_model()).expect("forecast must be accepted");
    submit_forecast(&workspace, forecast_human()).expect("forecast must be accepted");
    commit_funding(&workspace, funding_a()).expect("funding must be accepted");
    commit_funding(&workspace, funding_b()).expect("funding must be accepted");
    assert!(
        decide_admission(&workspace, &experiment.id)
            .expect("admission must be evaluated")
            .accepted
    );

    assert!(run_experiment(&workspace, &experiment.id).is_err());
    let status = experiment_status(&workspace, &experiment.id).expect("status must load");
    let run = status.latest_run.expect("terminal run must be recorded");
    assert!(run.metrics.is_empty());
    assert!(
        run.output_error
            .as_deref()
            .is_some_and(|error| error.contains("undeclared: [extra]"))
    );
    assert!(status.latest_evidence.is_none());
}

#[test]
fn credit_totals_fail_closed_on_overflow() {
    let directory = TestDirectory::create("credit-overflow");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    submit_lineage(&workspace);
    let experiment = experiment();
    compile_experiment(&workspace, experiment.clone()).expect("experiment must compile");

    let mut first = forecast_model();
    first.stake = u64::MAX;
    let mut second = forecast_human();
    second.stake = 1;
    submit_forecast(&workspace, first).expect("first forecast must be accepted");
    submit_forecast(&workspace, second).expect("second forecast must be accepted");

    let error = decide_admission(&workspace, &experiment.id)
        .expect_err("overflowing stake must reject admission");
    assert!(error.to_string().contains("exceeds u64 capacity"));
    assert!(experiment_status(&workspace, &experiment.id).is_err());
}

#[test]
fn wire_objects_reject_unknown_fields() {
    let json = include_str!("../../../examples/toy/hypothesis.json").replace(
        "\"confidence\": 0.74",
        "\"confidence\": 0.74, \"unexpected\": true",
    );
    assert!(serde_json::from_str::<ResearchContribution>(&json).is_err());

    let nested = include_str!("../../../examples/toy/experiment.json").replace(
        "\"threshold\": 0.8",
        "\"threshold\": 0.8, \"unexpected\": true",
    );
    assert!(serde_json::from_str::<ExperimentSpec>(&nested).is_err());
}

fn submit_lineage(workspace: &Workspace) {
    for contribution in [
        contribution(include_str!("../../../examples/toy/hypothesis.json")),
        contribution(include_str!("../../../examples/toy/foundation.json")),
        contribution(include_str!(
            "../../../examples/toy/engineering-review.json"
        )),
        contribution(include_str!("../../../examples/toy/experiment-design.json")),
    ] {
        submit_contribution(workspace, contribution).expect("contribution must be accepted");
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
