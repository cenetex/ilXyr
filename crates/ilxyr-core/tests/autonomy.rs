use std::{fs, path::PathBuf, process, time::SystemTime};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signer, SigningKey};
use ilxyr_core::{
    ActorKind, ActorRef, Certificate, EpochBudget, EvidenceLane, ExperimentSpec, Forecast,
    FundingCommitment, ResearchContribution, SandboxSpec, Workspace, allocate_epoch,
    authorize_unattended_run, calibration_for, certificates_for_evidence, commit_funding,
    compile_experiment, decide_admission, epoch_budget_signing_payload, record_certificate,
    register_epoch_budget, run_experiment, run_experiment_unattended, run_sandbox,
    submit_contribution, submit_forecast, trust_policy_key,
};

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn create(label: &str) -> Self {
        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("test clock must follow Unix epoch")
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("ilxyr-autonomy-{label}-{}-{nonce}", process::id()));
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
fn signed_epoch_budget_rejects_tampering() {
    let directory = TestDirectory::create("signed-budget");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    let signing_key = SigningKey::from_bytes(&[7; 32]);
    trust_test_key(&workspace, &signing_key);

    let budget = signed_budget(&signing_key);
    register_epoch_budget(&workspace, budget.clone()).expect("valid budget must register");

    let mut tampered = budget;
    tampered.id = "toy.epoch-budget.tampered.v1".to_owned();
    tampered.total_compute_credits += 1;
    let error = register_epoch_budget(&workspace, tampered)
        .expect_err("mutation after signing must invalidate the budget");
    assert!(error.to_string().contains("invalid epoch budget signature"));

    let mut wrong_owner = signed_budget(&signing_key);
    wrong_owner.id = "toy.epoch-budget.wrong-owner.v1".to_owned();
    wrong_owner.signed_by = "human://toy/not-the-key-owner".to_owned();
    sign_budget(&mut wrong_owner, &signing_key);
    let error = register_epoch_budget(&workspace, wrong_owner)
        .expect_err("a valid signature from a differently owned key must be rejected");
    assert!(error.to_string().contains("does not own key"));
    assert!(workspace.verify().expect("ledger must verify").valid);
}

#[test]
fn allocator_admits_and_runs_with_signed_policy_then_updates_calibration() {
    let directory = TestDirectory::create("allocator");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    let signing_key = SigningKey::from_bytes(&[9; 32]);
    trust_test_key(&workspace, &signing_key);
    let budget = signed_budget(&signing_key);
    register_epoch_budget(&workspace, budget.clone()).expect("budget must register");
    prepare_unfunded_experiment(&workspace);

    let report = allocate_epoch(&workspace, &budget.id, &["toy.score.v1".to_owned()])
        .expect("allocator must rank and fund the experiment");
    assert_eq!(report.allocated_compute_credits, 10);
    assert_eq!(report.decisions.len(), 1);
    assert!(report.decisions[0].allocated);
    assert!(report.decisions[0].disagreement > 0.0);

    let authorization = authorize_unattended_run(&workspace, &budget.id, "toy.score.v1")
        .expect("authorization must be evaluated");
    assert!(authorization.unattended);
    let completed = run_experiment_unattended(&workspace, &budget.id, "toy.score.v1")
        .expect("allocated experiment must run unattended");
    assert_eq!(completed.evidence.lane, EvidenceLane::Promoted);
    assert_eq!(completed.calibrations.len(), 2);
    assert!(
        completed
            .calibrations
            .iter()
            .all(|record| record.forecasts_settled == 1 && record.probationary)
    );
    let model = calibration_for(&workspace, "model://toy/forecaster/v1")
        .expect("calibration query must succeed")
        .expect("model calibration must exist");
    assert_eq!(model.forecast_ids, vec!["toy.forecast.model.v1"]);

    let event_count = workspace.events().expect("events must load").len();
    let retry = run_experiment_unattended(&workspace, &budget.id, "toy.score.v1")
        .expect("unattended completion must be idempotent");
    assert_eq!(retry.run.id, completed.run.id);
    assert_eq!(
        workspace.events().expect("events must load").len(),
        event_count
    );
}

#[test]
fn acknowledgement_threshold_blocks_unattended_execution() {
    let directory = TestDirectory::create("threshold");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    let signing_key = SigningKey::from_bytes(&[11; 32]);
    trust_test_key(&workspace, &signing_key);
    let mut budget = budget_fixture();
    budget.total_compute_credits = 10;
    budget.replication_reserve_pct = 0.0;
    budget
        .per_executable_caps
        .get_mut("/bin/echo")
        .expect("echo cap must exist")
        .per_epoch_credits = 10;
    budget.acknowledgement_thresholds.cumulative_spend_pct = 100.0;
    sign_budget(&mut budget, &signing_key);
    register_epoch_budget(&workspace, budget.clone()).expect("budget must register");
    prepare_unfunded_experiment(&workspace);
    allocate_epoch(&workspace, &budget.id, &["toy.score.v1".to_owned()])
        .expect("allocator must reserve the final credits");

    let authorization = authorize_unattended_run(&workspace, &budget.id, "toy.score.v1")
        .expect("authorization must be evaluated");
    assert!(!authorization.unattended);
    assert!(
        authorization
            .acknowledgement_reasons
            .iter()
            .any(|reason| reason.contains("100.00%"))
    );
    assert!(run_experiment_unattended(&workspace, &budget.id, "toy.score.v1").is_err());
}

#[test]
fn unattended_retry_fails_closed_after_an_ambiguous_started_execution() {
    let directory = TestDirectory::create("ambiguous-execution");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    let signing_key = SigningKey::from_bytes(&[12; 32]);
    trust_test_key(&workspace, &signing_key);
    let missing_executable = "/definitely/missing/ilxyr-v1-promoted-executable";
    let mut budget = budget_fixture();
    let cap = budget
        .per_executable_caps
        .remove("/bin/echo")
        .expect("echo cap must exist");
    budget
        .per_executable_caps
        .insert(missing_executable.to_owned(), cap);
    budget.allowlisted_executables = vec![missing_executable.to_owned()];
    sign_budget(&mut budget, &signing_key);
    register_epoch_budget(&workspace, budget.clone()).expect("budget must register");

    submit_lineage(&workspace);
    let mut spec = experiment();
    spec.execution.program = missing_executable.to_owned();
    compile_experiment(&workspace, spec).expect("experiment must compile");
    submit_forecast(&workspace, forecast_model()).expect("model forecast must be accepted");
    submit_forecast(&workspace, forecast_human()).expect("human forecast must be accepted");
    allocate_epoch(&workspace, &budget.id, &["toy.score.v1".to_owned()])
        .expect("experiment must allocate and admit");
    let error = run_experiment(&workspace, "toy.score.v1")
        .expect_err("the nonexistent executable must fail to start");
    assert!(error.to_string().contains("could not start"));

    let authorization = authorize_unattended_run(&workspace, &budget.id, "toy.score.v1")
        .expect("authorization must be evaluated");
    assert!(!authorization.unattended);
    assert!(
        authorization
            .acknowledgement_reasons
            .iter()
            .any(|reason| reason.contains("prior execution started"))
    );
    let event_count = workspace.events().expect("events must load").len();
    assert!(run_experiment_unattended(&workspace, &budget.id, "toy.score.v1").is_err());
    assert_eq!(
        workspace.events().expect("events must load").len(),
        event_count,
        "failed unattended recovery must not start another execution"
    );
}

#[test]
fn admission_rejects_model_self_review_and_self_forecast() {
    let directory = TestDirectory::create("role-separation");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    let proposer = forecast_model().forecaster;
    submit_lineage_with_review_actor(&workspace, proposer.clone());
    let mut experiment = experiment();
    experiment.proposer = proposer;
    compile_experiment(&workspace, experiment.clone()).expect("experiment must compile");
    submit_forecast(&workspace, forecast_model()).expect("forecast must be structurally accepted");
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
            .any(|check| { check.gate == "reviewer_separation" && !check.passed })
    );
    assert!(
        admission
            .checks
            .iter()
            .any(|check| { check.gate == "forecaster_separation" && !check.passed })
    );
}

#[test]
fn sandbox_ratchet_and_certificates_are_decidable_and_idempotent() {
    let directory = TestDirectory::create("sandbox");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    let signing_key = SigningKey::from_bytes(&[13; 32]);
    trust_test_key(&workspace, &signing_key);
    let budget = signed_budget(&signing_key);
    register_epoch_budget(&workspace, budget.clone()).expect("budget must register");
    let spec = sandbox_spec();

    let mut unallowlisted_arguments = spec.clone();
    unallowlisted_arguments.id = "toy.sandbox.unallowlisted-arguments.v1".to_owned();
    unallowlisted_arguments.experiment_id = "toy.score.unallowlisted-arguments.v1".to_owned();
    unallowlisted_arguments.args = vec!["{\"metrics\":{\"score\":0.99}}".to_owned()];
    let error = run_sandbox(&workspace, &budget.id, unallowlisted_arguments)
        .expect_err("sandbox arguments must match the signed executable policy");
    assert!(error.to_string().contains("argument vector"));

    let mut missing_provenance = spec.clone();
    missing_provenance.id = "toy.sandbox.missing-provenance.v1".to_owned();
    missing_provenance.experiment_id = "toy.score.missing-provenance.v1".to_owned();
    missing_provenance
        .authority
        .provenance
        .artifact_hashes
        .push(format!("artifact://sha256/{}", "f".repeat(64)));
    let error = run_sandbox(&workspace, &budget.id, missing_provenance)
        .expect_err("sandbox provenance must resolve before planning");
    assert!(error.to_string().contains("artifact://sha256"));

    let completed =
        run_sandbox(&workspace, &budget.id, spec.clone()).expect("allowlisted sandbox must run");
    let evidence = completed.evidence.as_ref().expect("evidence must resolve");
    assert_eq!(evidence.lane, EvidenceLane::Sandbox);
    let promotion = completed
        .promotion
        .as_ref()
        .expect("promotion eligibility must be computed");
    assert!(promotion.authority_sufficient);
    assert!(promotion.eligible);
    assert_eq!(promotion.passed_metrics, vec!["score"]);

    let event_count = workspace.events().expect("events must load").len();
    let retried =
        run_sandbox(&workspace, &budget.id, spec).expect("sandbox retry must be idempotent");
    assert_eq!(retried.run.id, completed.run.id);
    assert_eq!(
        workspace.events().expect("events must load").len(),
        event_count
    );

    let mut certificate = certificate_fixture();
    certificate.evidence_ref = promotion.evidence_ref.clone();
    certificate.checked_artifacts = vec![evidence.run_ref.clone()];
    record_certificate(&workspace, certificate.clone()).expect("matching certificate must record");
    let certificates = certificates_for_evidence(&workspace, &promotion.evidence_ref)
        .expect("certificates must query");
    assert_eq!(certificates.len(), 1);

    certificate.id = "toy.certificate.invalid.v1".to_owned();
    if let ilxyr_core::CertificatePredicate::Metric { threshold, .. } = &mut certificate.predicate {
        *threshold = 0.9;
    }
    assert!(record_certificate(&workspace, certificate).is_err());
    assert!(workspace.verify().expect("ledger must verify").valid);
}

#[test]
fn replication_reserve_is_unavailable_to_general_sandbox_work() {
    let directory = TestDirectory::create("replication-reserve");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    let signing_key = SigningKey::from_bytes(&[15; 32]);
    trust_test_key(&workspace, &signing_key);
    let mut budget = budget_fixture();
    budget.total_compute_credits = 100;
    budget.replication_reserve_pct = 20.0;
    budget.acknowledgement_thresholds.cumulative_spend_pct = 100.0;
    let cap = budget
        .per_executable_caps
        .get_mut("/bin/echo")
        .expect("echo cap must exist");
    cap.per_run_credits = 100;
    cap.per_epoch_credits = 100;
    sign_budget(&mut budget, &signing_key);
    register_epoch_budget(&workspace, budget.clone()).expect("budget must register");

    let mut first = sandbox_spec();
    first.cost_credits = 80;
    run_sandbox(&workspace, &budget.id, first).expect("general capacity must remain usable");

    let mut beyond_general_limit = sandbox_spec();
    beyond_general_limit.id = "toy.sandbox.reserve-overrun.v1".to_owned();
    beyond_general_limit.experiment_id = "toy.score.reserve-overrun.v1".to_owned();
    beyond_general_limit.cost_credits = 1;
    let error = run_sandbox(&workspace, &budget.id, beyond_general_limit)
        .expect_err("replication reserve must not fund general work");
    assert!(error.to_string().contains("reserved for replication"));
}

#[test]
fn sandbox_allocation_is_reused_after_executor_start_failure() {
    let directory = TestDirectory::create("sandbox-resume");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    let signing_key = SigningKey::from_bytes(&[17; 32]);
    trust_test_key(&workspace, &signing_key);
    let missing_executable = "/definitely/missing/ilxyr-v1-test-executable";
    let mut budget = budget_fixture();
    let cap = budget
        .per_executable_caps
        .remove("/bin/echo")
        .expect("echo cap must exist");
    budget
        .per_executable_caps
        .insert(missing_executable.to_owned(), cap);
    budget.allowlisted_executables = vec![missing_executable.to_owned()];
    sign_budget(&mut budget, &signing_key);
    register_epoch_budget(&workspace, budget.clone()).expect("budget must register");
    let mut spec = sandbox_spec();
    spec.executable = missing_executable.to_owned();

    for _ in 0..2 {
        let error = run_sandbox(&workspace, &budget.id, spec.clone())
            .expect_err("the nonexistent executable must fail to start");
        assert!(error.to_string().contains("could not start"));
    }
    let mut mutated = spec;
    mutated.args = vec!["{\"metrics\":{\"score\":0.99}}".to_owned()];
    let error = run_sandbox(&workspace, &budget.id, mutated)
        .expect_err("a retry may not mutate the frozen sandbox plan");
    assert!(error.to_string().contains("sandbox plan"));
    let allocations = workspace
        .events()
        .expect("events must load")
        .into_iter()
        .filter(|event| event.event_type == "AllocationCommitted")
        .count();
    assert_eq!(allocations, 1, "retry must not consume the budget twice");
    assert!(workspace.verify().expect("ledger must verify").valid);
}

fn trust_test_key(workspace: &Workspace, signing_key: &SigningKey) {
    trust_policy_key(
        workspace,
        "key://toy/policy-owner/v1",
        ActorRef {
            id: "human://toy/policy-owner".to_owned(),
            kind: ActorKind::Human,
            model_ref: None,
        },
        STANDARD.encode(signing_key.verifying_key().to_bytes()),
    )
    .expect("policy key must be trusted");
}

fn signed_budget(signing_key: &SigningKey) -> EpochBudget {
    let mut budget = budget_fixture();
    sign_budget(&mut budget, signing_key);
    budget
}

fn sign_budget(budget: &mut EpochBudget, signing_key: &SigningKey) {
    budget.signature.value.clear();
    let payload = epoch_budget_signing_payload(budget).expect("budget payload must serialize");
    budget.signature.value = STANDARD.encode(signing_key.sign(&payload).to_bytes());
}

fn prepare_unfunded_experiment(workspace: &Workspace) {
    submit_lineage(workspace);
    compile_experiment(workspace, experiment()).expect("experiment must compile");
    submit_forecast(workspace, forecast_model()).expect("model forecast must be accepted");
    submit_forecast(workspace, forecast_human()).expect("human forecast must be accepted");
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

fn submit_lineage_with_review_actor(workspace: &Workspace, actor: ActorRef) {
    let mut review = contribution(include_str!(
        "../../../examples/toy/engineering-review.json"
    ));
    review.actor = actor;
    for contribution in [
        contribution(include_str!("../../../examples/toy/hypothesis.json")),
        contribution(include_str!("../../../examples/toy/foundation.json")),
        review,
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

fn budget_fixture() -> EpochBudget {
    serde_json::from_str(include_str!("../../../examples/schema/epoch-budget.json"))
        .expect("epoch budget fixture must parse")
}

fn sandbox_spec() -> SandboxSpec {
    serde_json::from_str(include_str!("../../../examples/schema/sandbox-spec.json"))
        .expect("sandbox spec fixture must parse")
}

fn certificate_fixture() -> Certificate {
    serde_json::from_str(include_str!("../../../examples/schema/certificate.json"))
        .expect("certificate fixture must parse")
}
