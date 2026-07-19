use std::{fs, path::PathBuf, process, time::SystemTime};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signer, SigningKey};
use ilxyr_core::{
    ActorKind, ActorRef, ComparisonOperator, EpochBudget, EvidenceLane, ExperimentSpec, Forecast,
    LoopCycle, ModelFamily, OutcomePredicate, ResearchContribution, RetroRegistrationSpec,
    SharedTaskContract, Workspace, compile_experiment, epoch_budget_signing_payload,
    execute_loop_cycle, register_epoch_budget, register_shared_task, retro_register,
    submit_contribution, trust_policy_key,
};

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn create(label: &str) -> Self {
        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("test clock must follow Unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "ilxyr-onboarding-{label}-{}-{nonce}",
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

#[test]
fn shared_tasks_are_immutable_and_bind_both_family_harnesses() {
    let directory = TestDirectory::create("shared-task");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    let contract = shared_task();
    let first_ref =
        register_shared_task(&workspace, contract.clone()).expect("shared task must register");
    let retry_ref = register_shared_task(&workspace, contract.clone())
        .expect("identical shared task registration must be idempotent");
    assert_eq!(first_ref, retry_ref);

    let mut changed = contract.clone();
    changed.eval_set.sha256 = "4".repeat(64);
    let error = register_shared_task(&workspace, changed)
        .expect_err("a shared task binding may not be changed in place");
    assert!(error.to_string().contains("immutable"));

    submit_lineage(&workspace);
    let experiment = shared_experiment(&contract);
    let compiled_ref =
        compile_experiment(&workspace, experiment).expect("bound experiment must compile");
    let compiled: ilxyr_core::CompiledExperiment = workspace
        .get(&compiled_ref)
        .expect("compiled experiment must load");
    assert_eq!(
        compiled.shared_task_ref.as_deref(),
        Some(first_ref.as_str())
    );
    assert!(
        compiled
            .evidence_authority
            .provenance
            .artifact_hashes
            .contains(&first_ref)
    );

    let mut wrong_proposer = shared_experiment(&contract);
    wrong_proposer.id = "toy.shared.wrong-proposer.v1".to_owned();
    wrong_proposer.proposer = ActorRef::service("service://toy/not-designated");
    let error = compile_experiment(&workspace, wrong_proposer)
        .expect_err("only the designated family proposer may compile on the task");
    assert!(error.to_string().contains("designated Zero proposer"));
    assert!(workspace.verify().expect("ledger must verify").valid);
}

#[test]
fn retro_registration_replays_once_and_never_claims_forecast_risk() {
    let directory = TestDirectory::create("retro");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    let spec = retro_spec();
    let completed =
        retro_register(&workspace, spec.clone()).expect("the deterministic toy claim must replay");
    assert_eq!(completed.evidence.lane, EvidenceLane::Retro);
    assert_eq!(completed.run.metrics.get("score"), Some(&0.82));
    assert!(completed.registration.grounded);
    assert!(!completed.registration.forecast_risked);
    assert!(
        completed
            .evidence
            .authority
            .provenance
            .artifact_hashes
            .contains(&completed.registration.plan_ref)
    );

    let events_before_retry = workspace.events().expect("events must load").len();
    let retry =
        retro_register(&workspace, spec).expect("completed registration must be idempotent");
    assert_eq!(retry.run.id, completed.run.id);
    assert_eq!(
        workspace.events().expect("events must load").len(),
        events_before_retry
    );
    assert!(workspace.verify().expect("ledger must verify").valid);
}

#[test]
fn failed_retro_output_is_terminal_and_cannot_become_evidence() {
    let directory = TestDirectory::create("retro-failure");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    let mut spec = retro_spec();
    spec.id = "toy.retro.bad-output.v1".to_owned();
    spec.replay.args = vec!["not metric JSON".to_owned()];
    let error = retro_register(&workspace, spec.clone())
        .expect_err("invalid metric output must fail closed");
    assert!(error.to_string().contains("metric contract"));
    assert_eq!(event_count(&workspace, "RetroRunCompleted"), 1);
    assert_eq!(event_count(&workspace, "EvidenceRecorded"), 0);
    assert_eq!(event_count(&workspace, "RetroRegistered"), 0);

    let retry = retro_register(&workspace, spec)
        .expect_err("a terminal invalid replay must not execute again");
    assert!(retry.to_string().contains("metric contract"));
    assert_eq!(event_count(&workspace, "RetroRunCompleted"), 1);
    assert!(workspace.verify().expect("ledger must verify").valid);

    let mut unattested = retro_spec();
    unattested.id = "toy.retro.unattested.v1".to_owned();
    unattested.replay.args = vec!["{\"metrics\":{\"score\":0.82}}".to_owned()];
    let error = retro_register(&workspace, unattested)
        .expect_err("valid metrics without an exact source attestation must fail closed");
    assert!(error.to_string().contains("exact frozen source snapshot"));
    assert_eq!(event_count(&workspace, "RetroRunCompleted"), 2);
    assert_eq!(event_count(&workspace, "EvidenceRecorded"), 0);
    assert_eq!(event_count(&workspace, "RetroRegistered"), 0);
    assert!(workspace.verify().expect("ledger must verify").valid);
}

#[test]
fn loop_cycle_proposes_forecasts_allocates_runs_and_settles_idempotently() {
    let directory = TestDirectory::create("loop-cycle");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    let signing_key = SigningKey::from_bytes(&[31; 32]);
    trust_test_key(&workspace, &signing_key);
    let budget = signed_budget(&signing_key);
    register_epoch_budget(&workspace, budget.clone()).expect("budget must register");
    let cycle = LoopCycle {
        schema: "ilxyr.loop_cycle.v1".to_owned(),
        contributions: lineage(),
        experiment: experiment(),
        forecasts: vec![forecast_model(), forecast_human()],
    };

    let completed = execute_loop_cycle(&workspace, &budget.id, cycle.clone())
        .expect("full loop cycle must settle");
    assert_eq!(completed.experiment_id, "toy.score.v1");
    assert!(completed.allocation.is_some());
    assert_eq!(completed.completed.evidence.resolved_outcome, "success");
    assert_eq!(completed.completed.settlements.len(), 2);

    let events_before_retry = workspace.events().expect("events must load").len();
    let retry = execute_loop_cycle(&workspace, &budget.id, cycle)
        .expect("settled loop cycle must be idempotent");
    assert!(retry.allocation.is_none());
    assert_eq!(retry.completed.run.id, completed.completed.run.id);
    assert_eq!(
        workspace.events().expect("events must load").len(),
        events_before_retry
    );
    assert!(workspace.verify().expect("ledger must verify").valid);
}

fn shared_experiment(contract: &SharedTaskContract) -> ExperimentSpec {
    let mut spec = experiment();
    spec.id = "toy.shared.zero.v1".to_owned();
    spec.title = "ZERO run on a frozen shared task".to_owned();
    spec.proposer = contract.family_bindings[0].designated_proposer.clone();
    spec.family = Some(ModelFamily::Zero);
    spec.shared_task_id = Some(contract.id.clone());
    spec.datasets = vec![
        contract.dataset.handle.clone(),
        contract.eval_set.handle.clone(),
    ];
    spec.metrics.clone_from(&contract.metrics);
    spec.seeds.clone_from(&contract.seeds);
    spec.evidence_authority
        .scope
        .seeds
        .clone_from(&contract.seeds);
    spec.evidence_authority.scope.eval_set = Some(contract.eval_set.handle.clone());
    spec.outcome_contract.primary_metric = "exact_rate".to_owned();
    spec.outcome_contract.outcomes[0].predicate = OutcomePredicate::Metric {
        metric: "exact_rate".to_owned(),
        operator: ComparisonOperator::Gte,
        threshold: 0.8,
    };
    spec.outcome_contract.outcomes[1].predicate = OutcomePredicate::Metric {
        metric: "exact_rate".to_owned(),
        operator: ComparisonOperator::Lt,
        threshold: 0.8,
    };
    spec.execution.args = vec!["{\"metrics\":{\"exact_rate\":0.82}}".to_owned()];
    spec.expected_outputs = vec!["metrics.exact_rate".to_owned()];
    spec
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
    let mut budget: EpochBudget =
        serde_json::from_str(include_str!("../../../examples/schema/epoch-budget.json"))
            .expect("budget fixture must parse");
    budget.signature.value.clear();
    let payload = epoch_budget_signing_payload(&budget).expect("budget payload must serialize");
    budget.signature.value = STANDARD.encode(signing_key.sign(&payload).to_bytes());
    budget
}

fn submit_lineage(workspace: &Workspace) {
    for contribution in lineage() {
        submit_contribution(workspace, contribution).expect("contribution must be accepted");
    }
}

fn lineage() -> Vec<ResearchContribution> {
    vec![
        contribution(include_str!("../../../examples/toy/hypothesis.json")),
        contribution(include_str!("../../../examples/toy/foundation.json")),
        contribution(include_str!(
            "../../../examples/toy/engineering-review.json"
        )),
        contribution(include_str!("../../../examples/toy/experiment-design.json")),
    ]
}

fn event_count(workspace: &Workspace, event_type: &str) -> usize {
    workspace
        .events()
        .expect("events must load")
        .into_iter()
        .filter(|event| event.event_type == event_type)
        .count()
}

fn contribution(json: &str) -> ResearchContribution {
    serde_json::from_str(json).expect("contribution fixture must parse")
}

fn shared_task() -> SharedTaskContract {
    serde_json::from_str(include_str!("../../../examples/schema/shared-task.json"))
        .expect("shared-task fixture must parse")
}

fn retro_spec() -> RetroRegistrationSpec {
    serde_json::from_str(include_str!(
        "../../../examples/schema/retro-registration.json"
    ))
    .expect("retro-registration fixture must parse")
}

fn experiment() -> ExperimentSpec {
    serde_json::from_str(include_str!("../../../examples/toy/experiment.json"))
        .expect("experiment fixture must parse")
}

fn forecast_model() -> Forecast {
    serde_json::from_str(include_str!("../../../examples/toy/forecast-model.json"))
        .expect("forecast fixture must parse")
}

fn forecast_human() -> Forecast {
    serde_json::from_str(include_str!("../../../examples/toy/forecast-human.json"))
        .expect("forecast fixture must parse")
}
