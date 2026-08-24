use std::{fs, path::PathBuf, process, time::SystemTime};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signer, SigningKey};
use ilxyr_core::{
    ActorKind, ActorRef, DsseEnvelope, DsseSignature, ExecutorAttestation, Forecast,
    FundingCommitment, ResearchContribution, Workspace, commit_funding, compile_experiment,
    decide_admission, dsse_pae, evidence_bundle, record_executor_attestation, run_experiment,
    submit_contribution, submit_forecast, trust_attestation_key,
};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

const PAYLOAD_TYPE: &str = "application/vnd.in-toto.provenance+json";
const EXECUTOR_ID: &str = "service://toy/attested-executor-v1";
const KEY_ID: &str = "key://toy/attested-executor/v1";

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
        let path =
            std::env::temp_dir().join(format!("ilxyr-attestation-{}-{nonce}", process::id()));
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
fn signed_dsse_slsa_provenance_is_verified_and_bound_to_a_ledgered_run() {
    let directory = TestDirectory::create();
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    submit_toy_inputs(&workspace);
    compile_experiment(&workspace, fixture("../../../examples/toy/experiment.json"))
        .expect("experiment must compile");
    for path in [
        "../../../examples/toy/forecast-model.json",
        "../../../examples/toy/forecast-human.json",
    ] {
        submit_forecast(&workspace, fixture::<Forecast>(path)).expect("forecast must submit");
    }
    for path in [
        "../../../examples/toy/funding-a.json",
        "../../../examples/toy/funding-b.json",
    ] {
        commit_funding(&workspace, fixture::<FundingCommitment>(path))
            .expect("funding must commit");
    }
    assert!(
        decide_admission(&workspace, "toy.score.v1")
            .expect("admission must decide")
            .accepted
    );
    let completed = run_experiment(&workspace, "toy.score.v1").expect("experiment must complete");
    let run_ref = artifact_ref(&completed.run);
    let evidence_ref = artifact_ref(&completed.evidence);

    let signing_key = SigningKey::from_bytes(&[9_u8; 32]);
    trust_attestation_key(
        &workspace,
        KEY_ID,
        ActorRef {
            id: EXECUTOR_ID.to_owned(),
            kind: ActorKind::Service,
            model_ref: None,
        },
        STANDARD.encode(signing_key.verifying_key().as_bytes()),
    )
    .expect("executor key must be trusted");

    let statement = slsa_statement(&run_ref, EXECUTOR_ID);
    let envelope = signed_envelope(&signing_key, &statement);

    let mut tampered = envelope.clone();
    tampered.payload = STANDARD.encode(br#"{"_type":"tampered"}"#);
    assert!(
        record_executor_attestation(&workspace, &run_ref, tampered)
            .expect_err("tampered payload must fail verification")
            .to_string()
            .contains("no signature from a trusted")
    );

    let wrong_builder = signed_envelope(
        &signing_key,
        &slsa_statement(&run_ref, "service://toy/different-executor"),
    );
    assert!(
        record_executor_attestation(&workspace, &run_ref, wrong_builder)
            .expect_err("signed identity mismatch must fail")
            .to_string()
            .contains("not the executor bound to a verified signature")
    );

    let attestation_ref = record_executor_attestation(&workspace, &run_ref, envelope.clone())
        .expect("valid DSSE envelope must record");
    let recorded: ExecutorAttestation = workspace
        .get(&attestation_ref)
        .expect("attestation record must load");
    assert_eq!(recorded.run_ref, run_ref);
    assert_eq!(recorded.predicate_type, "https://slsa.dev/provenance/v1");
    assert_eq!(recorded.verified_key_ids, vec![KEY_ID]);
    assert_eq!(recorded.statement, statement);

    let event_count = workspace.events().expect("events must load").len();
    assert_eq!(
        record_executor_attestation(&workspace, &run_ref, envelope)
            .expect("exact attestation retry must be idempotent"),
        attestation_ref
    );
    assert_eq!(
        workspace.events().expect("events must load").len(),
        event_count
    );

    let bundle = evidence_bundle(&workspace, &evidence_ref).expect("evidence bundle must export");
    assert!(bundle.executor_attested);
    assert_eq!(bundle.executor_attestations.len(), 1);
    assert_eq!(bundle.executor_attestations[0].id, recorded.id);
    assert!(workspace.verify().expect("ledger must verify").valid);
}

fn slsa_statement(run_ref: &str, builder_id: &str) -> Value {
    json!({
        "_type": "https://in-toto.io/Statement/v1",
        "subject": [{
            "name": "ilxyr run record",
            "digest": {
                "sha256": run_ref
                    .strip_prefix("artifact://sha256/")
                    .expect("run ref must carry its digest")
            }
        }],
        "predicateType": "https://slsa.dev/provenance/v1",
        "predicate": {
            "buildDefinition": {
                "buildType": "https://ilxyr.dev/buildtypes/local-command/v1",
                "externalParameters": {
                    "ilxyrRunRef": run_ref
                },
                "resolvedDependencies": []
            },
            "runDetails": {
                "builder": {
                    "id": builder_id
                },
                "metadata": {
                    "invocationId": "toy.score.v1"
                }
            }
        }
    })
}

fn signed_envelope(signing_key: &SigningKey, statement: &Value) -> DsseEnvelope {
    let payload = serde_json::to_vec(statement).expect("statement must serialize");
    let signature = signing_key.sign(&dsse_pae(PAYLOAD_TYPE, &payload));
    DsseEnvelope {
        payload_type: PAYLOAD_TYPE.to_owned(),
        payload: STANDARD.encode(payload),
        signatures: vec![DsseSignature {
            keyid: Some(KEY_ID.to_owned()),
            sig: STANDARD.encode(signature.to_bytes()),
        }],
    }
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
