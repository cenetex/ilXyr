use std::{fs, path::PathBuf, process, time::SystemTime};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signer, SigningKey};
use ilxyr_core::{
    ActorRef, CodePolicy, CompiledExperiment, CorpusFile, CorpusLocation, CorpusMaterialization,
    CorpusRelease, CorpusRights, CorpusSource, DsseEnvelope, DsseSignature, ExperimentSpec,
    ExportPolicy, Forecast, FundingCommitment, HuggingFaceModel, MaterializedCorpusFile,
    NetworkPolicy, NsrlArtifact, NsrlCheckpoint, NsrlContinuation, NsrlRegistration,
    OciJobCompletion, OciJobDispatch, ResearchContribution, RunOutputArtifact, WeightClass,
    Workspace, commit_funding, compile_experiment, decide_admission, dsse_pae, experiment_status,
    record_corpus_materialization, record_executor_attestation, record_oci_job_completion,
    record_oci_job_dispatch, register_corpus_release, register_huggingface_model,
    register_nsrl_model, run_experiment, settle_oci_job, submit_contribution, submit_forecast,
    trust_attestation_key,
};
use serde_json::json;
use sha2::{Digest, Sha256};

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
    fn create(label: &str) -> Self {
        // Monotonic per-process counter: wall-clock nanoseconds alone can
        // collide when parallel tests start within one clock tick.
        let nonce = u128::from(UNIQUE.next_relaxed())
            + SystemTime::now()
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
fn oci_job_binds_corpus_reconciles_and_requires_attestation() {
    let directory = TestDirectory::create("oci-job");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    submit_lineage(&workspace);

    let release = CorpusRelease {
        schema: "ilxyr.corpus_release.v1".to_owned(),
        id: "dataset://stonks/sec-filings-v1".to_owned(),
        title: "SEC filing training examples".to_owned(),
        version: "v1".to_owned(),
        source: CorpusSource {
            repository: "https://github.com/ratimics/Stonks".to_owned(),
            revision: "0123456789abcdef0123456789abcdef01234567".to_owned(),
            path: "exports/sec-qwen-v1".to_owned(),
        },
        rights: CorpusRights {
            license: "SEC-PUBLIC-DOMAIN".to_owned(),
            use_constraints: vec!["preserve-source-provenance".to_owned()],
        },
        files: vec![CorpusFile {
            path: "train.jsonl".to_owned(),
            sha256: "a".repeat(64),
            size_bytes: 100,
            media_type: "application/x-jsonlines".to_owned(),
        }],
        metadata: std::collections::BTreeMap::new(),
    };
    let corpus = register_corpus_release(&workspace, release).expect("corpus must register");
    let materialization = record_corpus_materialization(
        &workspace,
        CorpusMaterialization {
            schema: "ilxyr.corpus_materialization.v1".to_owned(),
            id: "materialization://aws/sec-qwen-v1".to_owned(),
            corpus_ref: corpus.artifact_ref.clone(),
            location: CorpusLocation::AmazonS3 {
                region: "us-west-2".to_owned(),
                uri: "s3://ilxyr-test/sec-qwen-v1".to_owned(),
            },
            objects: vec![MaterializedCorpusFile {
                path: "train.jsonl".to_owned(),
                uri: "s3://ilxyr-test/sec-qwen-v1/train.jsonl".to_owned(),
                sha256: "a".repeat(64),
                size_bytes: 100,
                provider_version: "version-1".to_owned(),
            }],
            verified_by: ActorRef::service("service://ilxyr/corpus-verifier-v1"),
            verified_at_ms: 1,
        },
    )
    .expect("materialization must record");

    let mut spec = experiment();
    spec.id = "sec-qwen-v1".to_owned();
    spec.datasets = vec![corpus.release.id.clone()];
    spec.dataset_bindings
        .insert(corpus.release.id.clone(), corpus.artifact_ref.clone());
    spec.execution.executor = "oci-job".to_owned();
    spec.execution.program = format!("oci://ghcr.io/ratimics/sec-qwen@sha256:{}", "b".repeat(64));
    spec.execution.network = NetworkPolicy::Denied;
    spec.security.code_policy = CodePolicy::ApprovedImageOnly;
    spec.expected_outputs.push("artifacts.adapter".to_owned());
    let compiled_ref = compile_experiment(&workspace, spec.clone()).expect("experiment compiles");
    let compiled: CompiledExperiment = workspace.get(&compiled_ref).expect("compiled object");
    assert_eq!(
        compiled.resolved_datasets.get(&corpus.release.id),
        Some(&corpus.artifact_ref)
    );

    let mut model_forecast = forecast_model();
    model_forecast.id = "sec-qwen.forecast.model".to_owned();
    model_forecast.experiment_id.clone_from(&spec.id);
    let mut human_forecast = forecast_human();
    human_forecast.id = "sec-qwen.forecast.human".to_owned();
    human_forecast.experiment_id.clone_from(&spec.id);
    let mut first_funding = funding_a();
    first_funding.id = "sec-qwen.funding.a".to_owned();
    first_funding.experiment_id.clone_from(&spec.id);
    let mut second_funding = funding_b();
    second_funding.id = "sec-qwen.funding.b".to_owned();
    second_funding.experiment_id.clone_from(&spec.id);
    submit_forecast(&workspace, model_forecast).expect("forecast must submit");
    submit_forecast(&workspace, human_forecast).expect("forecast must submit");
    commit_funding(&workspace, first_funding).expect("funding must commit");
    commit_funding(&workspace, second_funding).expect("funding must commit");
    assert!(
        decide_admission(&workspace, &spec.id)
            .expect("admission")
            .accepted
    );

    let executor = ActorRef::service("service://ilxyr/aws-sagemaker-v1");
    let dispatch = OciJobDispatch {
        schema: "ilxyr.oci_job_dispatch.v1".to_owned(),
        id: "dispatch:sec-qwen-v1".to_owned(),
        experiment_id: spec.id.clone(),
        compiled_ref,
        executor: executor.clone(),
        provider_job_ref: "sagemaker://us-west-2/training-jobs/sec-qwen-v1".to_owned(),
        idempotency_key: "sec-qwen-v1".to_owned(),
        materializations: std::collections::BTreeMap::from([(
            corpus.release.id,
            materialization.artifact_ref,
        )]),
        dispatched_at_ms: 2,
    };
    let mut incomplete_dispatch = dispatch.clone();
    incomplete_dispatch.materializations.clear();
    assert!(
        record_oci_job_dispatch(&workspace, incomplete_dispatch)
            .expect_err("all frozen datasets must be materialized")
            .to_string()
            .contains("match every frozen dataset")
    );
    let dispatch_ref = record_oci_job_dispatch(&workspace, dispatch.clone()).expect("dispatch");
    assert_eq!(
        record_oci_job_dispatch(&workspace, dispatch).expect("dispatch retry"),
        dispatch_ref
    );
    let completion = OciJobCompletion {
        schema: "ilxyr.oci_job_completion.v1".to_owned(),
        id: "run:sec-qwen-v1".to_owned(),
        dispatch_ref,
        executor: executor.clone(),
        exit_code: 0,
        timed_out: false,
        metrics: std::collections::BTreeMap::from([("score".to_owned(), 0.82)]),
        artifacts: vec![RunOutputArtifact {
            name: "adapter".to_owned(),
            uri: "s3://ilxyr-test/sec-qwen-v1/adapter.tar".to_owned(),
            sha256: "c".repeat(64),
            size_bytes: 1_024,
            media_type: "application/x-tar".to_owned(),
            provider_version: "version-2".to_owned(),
        }],
        completed_at_ms: 3,
    };
    let mut undeclared_completion = completion.clone();
    undeclared_completion.artifacts[0].name = "undeclared".to_owned();
    assert!(
        record_oci_job_completion(&workspace, undeclared_completion)
            .expect_err("undeclared artifact must fail")
            .to_string()
            .contains("frozen successful-run contract")
    );
    let run_ref = record_oci_job_completion(&workspace, completion.clone()).expect("completion");
    assert_eq!(
        record_oci_job_completion(&workspace, completion).expect("completion retry"),
        run_ref
    );
    assert!(
        settle_oci_job(&workspace, &spec.id)
            .expect_err("unsigned result must not settle")
            .to_string()
            .contains("no trusted attestation")
    );

    let signing_key = SigningKey::from_bytes(&[42_u8; 32]);
    trust_attestation_key(
        &workspace,
        "key://ilxyr/aws-sagemaker-v1",
        executor.clone(),
        STANDARD.encode(signing_key.verifying_key().as_bytes()),
    )
    .expect("key must be trusted");
    let statement = json!({
        "_type": "https://in-toto.io/Statement/v1",
        "subject": [{
            "name": "ilxyr run record",
            "digest": {"sha256": run_ref.strip_prefix("artifact://sha256/").expect("digest")}
        }],
        "predicateType": "https://ilxyr.dev/attestations/executor/v1",
        "predicate": {"runRef": run_ref, "executor": executor.id}
    });
    let payload = serde_json::to_vec(&statement).expect("statement serializes");
    let payload_type = "application/vnd.in-toto+json";
    let signature = signing_key.sign(&dsse_pae(payload_type, &payload));
    record_executor_attestation(
        &workspace,
        statement["predicate"]["runRef"].as_str().expect("run ref"),
        DsseEnvelope {
            payload_type: payload_type.to_owned(),
            payload: STANDARD.encode(payload),
            signatures: vec![DsseSignature {
                keyid: Some("key://ilxyr/aws-sagemaker-v1".to_owned()),
                sig: STANDARD.encode(signature.to_bytes()),
            }],
        },
    )
    .expect("attestation must record");
    let settled = settle_oci_job(&workspace, &spec.id).expect("attested run settles");
    assert_eq!(settled.evidence.resolved_outcome, "success");
    assert_eq!(settled.run.artifacts[0].name, "adapter");
    assert!(workspace.verify().expect("ledger verifies").valid);
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
fn hugging_face_actor_and_weight_handles_require_a_registered_manifest() {
    let directory = TestDirectory::create("huggingface-binding");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    let model: HuggingFaceModel = serde_json::from_str(include_str!(
        "../../../examples/schema/huggingface-model.json"
    ))
    .expect("Hugging Face fixture must parse");

    let mut model_contribution =
        contribution(include_str!("../../../examples/toy/hypothesis.json"));
    model_contribution.id = "huggingface.hypothesis.v1".to_owned();
    model_contribution.actor.model_ref = Some(model.model_ref.clone());
    assert!(submit_contribution(&workspace, model_contribution.clone()).is_err());

    submit_lineage(&workspace);
    let mut experiment = experiment();
    experiment.models = vec![model.weight_ref.clone()];
    assert!(compile_experiment(&workspace, experiment.clone()).is_err());

    register_huggingface_model(&workspace, model).expect("model must register");
    submit_contribution(&workspace, model_contribution).expect("model actor must resolve");
    compile_experiment(&workspace, experiment).expect("model weights must resolve");
}

#[test]
fn nsrl_actor_and_weight_handles_require_a_registered_checkpoint() {
    let directory = TestDirectory::create("nsrl-binding");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    let registration: NsrlRegistration = serde_json::from_str(include_str!(
        "../../../examples/nsrl/p10m-v10-registration.json"
    ))
    .expect("NSRL fixture must parse");
    let registration = hydrate_nsrl_registration(&workspace, registration);

    let mut model_contribution =
        contribution(include_str!("../../../examples/toy/hypothesis.json"));
    model_contribution.id = "nsrl.hypothesis.v1".to_owned();
    model_contribution.actor.model_ref = Some(registration.checkpoint.model_ref.clone());
    assert!(submit_contribution(&workspace, model_contribution.clone()).is_err());

    submit_lineage(&workspace);
    let mut experiment = experiment();
    experiment.models = vec![registration.checkpoint.weight_ref.clone()];
    assert!(compile_experiment(&workspace, experiment.clone()).is_err());

    register_nsrl_model(&workspace, registration).expect("NSRL checkpoint must register");
    submit_contribution(&workspace, model_contribution).expect("model actor must resolve");
    compile_experiment(&workspace, experiment).expect("model weights must resolve");
}

fn hydrate_nsrl_registration(
    workspace: &Workspace,
    mut registration: NsrlRegistration,
) -> NsrlRegistration {
    import_nsrl_test_artifact(
        workspace,
        &mut registration.checkpoint.model,
        "test/model.nsrlpm",
        b"model bytes",
    );
    import_nsrl_test_artifact(
        workspace,
        &mut registration.checkpoint.tokenizer,
        "test/tokenizer.nsrlbpe",
        b"tokenizer bytes",
    );
    import_nsrl_test_artifact(
        workspace,
        &mut registration.checkpoint.model_card,
        "test/MODEL_CARD.md",
        b"model card",
    );
    import_nsrl_test_artifact(
        workspace,
        &mut registration.checkpoint.executable,
        "test/nsrl-production-model",
        b"executable bytes",
    );
    let model_ref = NsrlCheckpoint::model_ref_for(
        &registration.checkpoint.lineage,
        &registration.checkpoint.model.sha256,
    );
    registration.checkpoint.model_ref = model_ref.clone();
    registration.checkpoint.weight_ref = NsrlCheckpoint::weight_ref_for(
        &registration.checkpoint.lineage,
        &registration.checkpoint.model.sha256,
    );
    registration.checkpoint.parent_checkpoint = None;
    let continuation = registration.continuation.as_mut().expect("continuation");
    import_nsrl_test_artifact(
        workspace,
        &mut continuation.optimizer,
        "test/optimizer.nsrlpo",
        b"optimizer bytes",
    );
    continuation.checkpoint_ref = model_ref;
    continuation.source_model_sha256 = registration.checkpoint.model.sha256.clone();
    continuation.continuation_ref = NsrlContinuation::continuation_ref_for(
        &registration.checkpoint.lineage,
        &continuation.optimizer.sha256,
    );
    registration.checkpoint.continuation_ref = Some(continuation.continuation_ref.clone());
    registration
}

fn import_nsrl_test_artifact(
    workspace: &Workspace,
    artifact: &mut NsrlArtifact,
    path: &str,
    bytes: &[u8],
) {
    let source = workspace.root().join(path);
    fs::create_dir_all(source.parent().expect("parent")).expect("artifact directory");
    fs::write(&source, bytes).expect("artifact source");
    let sha256 = format!("{:x}", Sha256::digest(bytes));
    let blob_ref = workspace.put_blob(&source, &sha256).expect("import blob");
    *artifact = NsrlArtifact {
        path: path.to_owned(),
        sha256,
        size_bytes: u64::try_from(bytes.len()).expect("test bytes fit"),
        blob_ref,
    };
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
        .replace("toy.hypothesis.v1", "toy.hypothesis.tampered.v1");
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
fn status_projection_rejects_a_corrupt_ledger() {
    let directory = TestDirectory::create("corrupt-status");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    submit_lineage(&workspace);
    let experiment = experiment();
    compile_experiment(&workspace, experiment.clone()).expect("experiment must compile");

    let event_path = directory.0.join(".ilxyr/events.jsonl");
    let tampered = fs::read_to_string(&event_path)
        .expect("event log must be readable")
        .replace("toy.hypothesis.v1", "toy.hypothesis.tampered.v1");
    fs::write(event_path, tampered).expect("test must tamper with the ledger");

    let error = experiment_status(&workspace, &experiment.id)
        .expect_err("status must reject a corrupt ledger");
    assert!(error.to_string().contains("event digest mismatch"));
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
