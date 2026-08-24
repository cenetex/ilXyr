use std::{collections::BTreeMap, fs, path::PathBuf, process, time::SystemTime};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signer, SigningKey};
use ilxyr_core::{
    ActorKind, ActorRef, AllocationKind, ClaimNode, EpochBudget, EvidenceGraphEdge,
    EvidenceRelation, ExperimentSpec, Forecast, ReplicationContract, ReplicationKind,
    ResearchContribution, RetroRegistrationSpec, SharedTaskContract, Workspace,
    allocate_replication, claim_status, compile_experiment, epoch_budget_signing_payload,
    record_evidence_edge, register_claim, register_epoch_budget, register_replication_contract,
    register_shared_task, retro_register, run_experiment_unattended, settle_replication,
    submit_contribution, submit_forecast, trust_policy_key,
};
use serde::de::DeserializeOwned;

/// Process-global uniqueness for temporary test directories. Parallel tests
/// can read the same coarse clock tick on macOS, so timestamps alone are not
/// sufficient to keep directories distinct.
static UNIQUE: Unique = Unique::new();

struct Unique(std::sync::atomic::AtomicU64);

impl Unique {
    const fn new() -> Self {
        Self(std::sync::atomic::AtomicU64::new(0))
    }
    fn next_relaxed(&self) -> u64 {
        self.0.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    }
}

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn create() -> Self {
        // Monotonic per-process counter: wall-clock nanoseconds alone can
        // collide when parallel tests start within one clock tick.
        let nonce = u128::from(UNIQUE.next_relaxed())
            + SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .expect("test clock must follow Unix epoch")
                .as_nanos();
        let path = std::env::temp_dir().join(format!("ilxyr-graph-{}-{nonce}", process::id()));
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
fn claim_enters_spine_only_after_forward_risked_independent_replication() {
    let directory = TestDirectory::create();
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    let mut retro_spec =
        fixture::<RetroRegistrationSpec>("../../../examples/schema/retro-registration.json");
    let mut shared_task =
        fixture::<SharedTaskContract>("../../../examples/schema/shared-task.json");
    shared_task.id = "toy.score.shared.v1".to_owned();
    shared_task.title = "Toy score replication task".to_owned();
    shared_task.dataset.handle = "dataset://toy/score/train/v1".to_owned();
    shared_task.eval_set.handle = "dataset://toy/score/eval/v1".to_owned();
    shared_task.metrics = retro_spec.metrics.clone();
    shared_task.seeds = vec![17];
    let shared_task_ref =
        register_shared_task(&workspace, shared_task.clone()).expect("shared task must register");
    retro_spec.shared_task_id = Some(shared_task.id.clone());
    retro_spec.seeds = shared_task.seeds.clone();
    retro_spec.authority.scope.seeds = shared_task.seeds.clone();
    retro_spec.authority.scope.eval_set = Some(shared_task.eval_set.handle.clone());
    let retro = retro_register(&workspace, retro_spec).expect("frozen prior claim must replay");
    let retro_evidence_ref = retro.registration.evidence_ref;
    let mut other_task = shared_task.clone();
    other_task.id = "toy.score.other-task.v1".to_owned();
    let other_task_ref =
        register_shared_task(&workspace, other_task).expect("second shared task must register");
    let mismatched_claim = register_claim(
        &workspace,
        ClaimNode {
            schema: "ilxyr.claim.v1".to_owned(),
            id: "claim:toy.score.mismatched.v1".to_owned(),
            statement: "Mismatched task binding must fail.".to_owned(),
            evidence_refs: vec![retro_evidence_ref.clone()],
            shared_task_ref: Some(other_task_ref),
            freshness_prerequisite: None,
            refresh_command: None,
            created_by: human_owner(),
            created_at_ms: 1_780_000_000_000,
        },
    )
    .expect_err("claim evidence must prove the same shared-task binding");
    assert!(mismatched_claim.to_string().contains("is not bound"));

    let claim_id = "claim:toy.score.v1";
    register_claim(
        &workspace,
        ClaimNode {
            schema: "ilxyr.claim.v1".to_owned(),
            id: claim_id.to_owned(),
            statement: "The frozen toy procedure emits score 0.82.".to_owned(),
            evidence_refs: vec![retro_evidence_ref.clone()],
            shared_task_ref: Some(shared_task_ref.clone()),
            freshness_prerequisite: None,
            refresh_command: None,
            created_by: human_owner(),
            created_at_ms: 1_780_000_000_000,
        },
    )
    .expect("claim must register");
    record_evidence_edge(
        &workspace,
        EvidenceGraphEdge {
            schema: "ilxyr.evidence_graph_edge.v1".to_owned(),
            id: "edge:toy.score.retro-support".to_owned(),
            source: retro_evidence_ref.clone(),
            target: claim_id.to_owned(),
            relation: EvidenceRelation::Supports,
            asserted_by: human_owner(),
            asserted_at_ms: 1_780_000_000_001,
        },
    )
    .expect("support edge must record");

    let initial = claim_status(&workspace, claim_id).expect("claim status must query");
    assert!(initial.shared_task_bound);
    assert!(initial.cold_replayable);
    assert!(!initial.prospectively_risked);
    assert_eq!(initial.independent_replications, 0);
    assert!(!initial.spine_eligible);

    let private_claim_id = "claim:toy.score.private.v1";
    register_claim(
        &workspace,
        ClaimNode {
            schema: "ilxyr.claim.v1".to_owned(),
            id: private_claim_id.to_owned(),
            statement: "Private analysis of the frozen toy score.".to_owned(),
            evidence_refs: vec![retro_evidence_ref.clone()],
            shared_task_ref: None,
            freshness_prerequisite: None,
            refresh_command: None,
            created_by: human_owner(),
            created_at_ms: 1_780_000_000_002,
        },
    )
    .expect("private claim must remain representable");
    let private_status =
        claim_status(&workspace, private_claim_id).expect("private claim status must query");
    assert!(!private_status.shared_task_bound);
    assert!(private_status.cold_replayable);
    assert!(!private_status.spine_eligible);

    submit_toy_inputs(&workspace);
    let mut experiment = fixture::<ExperimentSpec>("../../../examples/toy/experiment.json");
    let family_binding = shared_task
        .family_bindings
        .iter()
        .find(|binding| binding.family == ilxyr_core::ModelFamily::Zero)
        .expect("zero family must be bound");
    experiment.family = Some(family_binding.family.clone());
    experiment.shared_task_id = Some(shared_task.id.clone());
    experiment.proposer = family_binding.designated_proposer.clone();
    experiment.datasets = vec![
        shared_task.dataset.handle.clone(),
        shared_task.eval_set.handle.clone(),
    ];
    experiment.metrics = shared_task.metrics.clone();
    experiment.seeds = shared_task.seeds.clone();
    experiment.evidence_authority.provenance.model_lineage =
        Some("model://toy/independent-replication/v1".to_owned());
    experiment.evidence_authority.scope.eval_set = Some(shared_task.eval_set.handle.clone());
    compile_experiment(&workspace, experiment).expect("replication experiment must compile");
    let contract = ReplicationContract {
        schema: "ilxyr.replication_contract.v1".to_owned(),
        id: "toy.score.replication.v1".to_owned(),
        target_claim: claim_id.to_owned(),
        reference_evidence_ref: retro_evidence_ref.clone(),
        replication_experiment_id: "toy.score.v1".to_owned(),
        kind: ReplicationKind::Capability,
        tolerances: Some(BTreeMap::from([("score".to_owned(), 0.01)])),
        eval_set: shared_task.eval_set.handle.clone(),
        agreement_metric: None,
        agreement_threshold: None,
        declared_by: ActorRef {
            id: "model://toy/replication-designer".to_owned(),
            kind: ActorKind::Model,
            model_ref: Some("model://toy/replication-designer/v1".to_owned()),
        },
        declared_at_ms: 1_780_000_000_002,
    };
    let mut private_contract = contract.clone();
    private_contract.id = "toy.score.private-replication.v1".to_owned();
    private_contract.target_claim = private_claim_id.to_owned();
    assert!(
        register_replication_contract(&workspace, private_contract)
            .expect_err("private claims must not consume the replication reserve")
            .to_string()
            .contains("not bound to a shared task")
    );
    let contract_ref = register_replication_contract(&workspace, contract)
        .expect("replication contract must freeze before execution");
    for path in [
        "../../../examples/toy/forecast-model.json",
        "../../../examples/toy/forecast-human.json",
    ] {
        submit_forecast(&workspace, fixture::<Forecast>(path)).expect("forecast must submit");
    }
    let signing_key = SigningKey::from_bytes(&[11_u8; 32]);
    trust_policy_key(
        &workspace,
        "key://toy/policy-owner/v1",
        ActorRef {
            id: "human://toy/policy-owner".to_owned(),
            kind: ActorKind::Human,
            model_ref: None,
        },
        STANDARD.encode(signing_key.verifying_key().to_bytes()),
    )
    .expect("policy key must be trusted");
    let mut budget = fixture::<EpochBudget>("../../../examples/schema/epoch-budget.json");
    budget.signature.value.clear();
    budget.signature.value = STANDARD.encode(
        signing_key
            .sign(&epoch_budget_signing_payload(&budget).expect("budget payload must serialize"))
            .to_bytes(),
    );
    register_epoch_budget(&workspace, budget).expect("signed budget must register");
    let allocation = allocate_replication(&workspace, "toy.epoch-budget.v1", &contract_ref)
        .expect("replication reserve must fund the frozen contract");
    assert_eq!(allocation.kind, AllocationKind::Replication);
    let completed = run_experiment_unattended(&workspace, "toy.epoch-budget.v1", "toy.score.v1")
        .expect("allocated replication must run unattended");
    let replication_evidence_ref = artifact_ref(&completed.evidence);

    let settlement = settle_replication(&workspace, &contract_ref, &replication_evidence_ref)
        .expect("replication must settle");
    assert!(settlement.capability_passed);
    assert!(settlement.equivalence_passed);
    assert!(settlement.forward_risked);
    assert!(settlement.independence.shared_artifacts.is_empty());
    assert!(settlement.independence.distinct_checker);
    assert!(settlement.independence.distinct_model_lineage);
    assert!(settlement.independence.independent);
    assert!(settlement.succeeded);

    let event_count = workspace.events().expect("events must load").len();
    assert_eq!(
        settle_replication(&workspace, &contract_ref, &replication_evidence_ref)
            .expect("settlement retry must be idempotent")
            .id,
        settlement.id
    );
    assert_eq!(
        workspace.events().expect("events must load").len(),
        event_count
    );

    let status = claim_status(&workspace, claim_id).expect("settled claim must query");
    assert!(status.shared_task_bound);
    assert!(status.prospectively_risked);
    assert!(status.cold_replayable);
    assert_eq!(status.independent_replications, 1);
    assert!(status.spine_eligible);
    assert!(status.edges.iter().any(|edge| {
        edge.relation == EvidenceRelation::Replicates
            && edge.source == replication_evidence_ref
            && edge.target == claim_id
    }));
    assert!(
        record_evidence_edge(
            &workspace,
            EvidenceGraphEdge {
                schema: "ilxyr.evidence_graph_edge.v1".to_owned(),
                id: "edge:unknown".to_owned(),
                source: "claim:does-not-exist".to_owned(),
                target: claim_id.to_owned(),
                relation: EvidenceRelation::Contradicts,
                asserted_by: human_owner(),
                asserted_at_ms: 1_780_000_000_003,
            },
        )
        .expect_err("edges must not create phantom nodes")
        .to_string()
        .contains("claim claim:does-not-exist")
    );
    assert!(workspace.verify().expect("ledger must verify").valid);
}

fn submit_toy_inputs(workspace: &Workspace) {
    for path in [
        "../../../examples/toy/hypothesis.json",
        "../../../examples/toy/foundation.json",
        "../../../examples/toy/engineering-review.json",
        "../../../examples/toy/experiment-design.json",
    ] {
        submit_contribution(workspace, fixture::<ResearchContribution>(path))
            .expect("contribution must submit");
    }
}

fn human_owner() -> ActorRef {
    ActorRef {
        id: "human://toy/owner".to_owned(),
        kind: ActorKind::Human,
        model_ref: None,
    }
}

fn fixture<T: DeserializeOwned>(relative: &str) -> T {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join(relative);
    let contents = fs::read(path).expect("fixture must be readable");
    serde_json::from_slice::<T>(&contents).expect("fixture must parse")
}

fn artifact_ref<T: serde::Serialize>(value: &T) -> String {
    format!(
        "artifact://sha256/{}",
        Workspace::digest(value).expect("object must hash")
    )
}
