use std::{fs, path::PathBuf, process, time::SystemTime};

use ilxyr_core::{
    ActorKind, ActorRef, ExperimentSpec, ExternalRegistrationReceipt, RegistrationProvider,
    RegistrationRequirement, RegistrationVisibility, ResearchContribution, Workspace,
    commit_funding, compile_experiment, decide_admission, evidence_bundle, prepare_registration,
    record_external_registration, run_experiment, submit_contribution, submit_forecast,
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
        let path =
            std::env::temp_dir().join(format!("ilxyr-registration-{}-{nonce}", process::id()));
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
fn external_registration_is_bound_to_the_frozen_plan_and_gates_admission() {
    let directory = TestDirectory::create();
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    submit_toy_inputs(&workspace);
    let mut experiment = fixture::<ExperimentSpec>("../../../examples/toy/experiment.json");
    experiment.preregistration = Some(RegistrationRequirement {
        provider: RegistrationProvider::Osf,
        visibility: RegistrationVisibility::Public,
    });
    let compiled_ref = compile_experiment(&workspace, experiment).expect("experiment must compile");
    submit_forecast(
        &workspace,
        fixture("../../../examples/toy/forecast-model.json"),
    )
    .expect("model forecast must submit");
    submit_forecast(
        &workspace,
        fixture("../../../examples/toy/forecast-human.json"),
    )
    .expect("human forecast must submit");
    commit_funding(&workspace, fixture("../../../examples/toy/funding-a.json"))
        .expect("first funding must commit");
    commit_funding(&workspace, fixture("../../../examples/toy/funding-b.json"))
        .expect("second funding must commit");

    let rejected = decide_admission(&workspace, "toy.score.v1")
        .expect("missing registration must produce a decision");
    assert!(!rejected.accepted);
    let registration_gate = rejected
        .checks
        .iter()
        .find(|check| check.gate == "external_preregistration")
        .expect("registration gate must be visible");
    assert!(!registration_gate.passed);

    let prepared = prepare_registration(&workspace, "toy.score.v1").expect("package must prepare");
    assert_eq!(prepared.package.compiled_ref, compiled_ref);
    assert_eq!(
        Workspace::digest(&prepared.package.compiled).expect("compiled object must hash"),
        compiled_ref
            .strip_prefix("artifact://sha256/")
            .expect("compiled ref must carry its digest")
    );
    let event_count = workspace.events().expect("events must load").len();
    let retry = prepare_registration(&workspace, "toy.score.v1")
        .expect("package preparation must be idempotent");
    assert_eq!(retry.package_ref, prepared.package_ref);
    assert_eq!(
        workspace.events().expect("events must load").len(),
        event_count
    );

    let receipt = ExternalRegistrationReceipt {
        schema: "ilxyr.external_registration_receipt.v1".to_owned(),
        id: "toy.score.osf.v1".to_owned(),
        experiment_id: "toy.score.v1".to_owned(),
        provider: RegistrationProvider::Osf,
        visibility: RegistrationVisibility::Public,
        package_ref: prepared.package_ref.clone(),
        registration_id: "abc12".to_owned(),
        url: "https://osf.io/abc12".to_owned(),
        doi: Some("10.17605/OSF.IO/ABC12".to_owned()),
        registered_by: ActorRef {
            id: "human://toy/owner".to_owned(),
            kind: ActorKind::Human,
            model_ref: None,
        },
        registered_at_ms: 1_780_000_000_000,
    };
    let mut wrong_package = receipt.clone();
    wrong_package.package_ref = compiled_ref;
    assert!(
        record_external_registration(&workspace, wrong_package)
            .expect_err("receipt for a non-package artifact must fail")
            .to_string()
            .contains("does not match ledgered package")
    );

    let receipt_ref = record_external_registration(&workspace, receipt.clone())
        .expect("matching receipt must record");
    let event_count = workspace.events().expect("events must load").len();
    assert_eq!(
        record_external_registration(&workspace, receipt)
            .expect("exact receipt retry must be idempotent"),
        receipt_ref
    );
    assert_eq!(
        workspace.events().expect("events must load").len(),
        event_count
    );

    let accepted =
        decide_admission(&workspace, "toy.score.v1").expect("registered experiment must decide");
    assert!(accepted.accepted);
    assert!(
        accepted
            .checks
            .iter()
            .find(|check| check.gate == "external_preregistration")
            .expect("registration gate must remain visible")
            .passed
    );
    let completed =
        run_experiment(&workspace, "toy.score.v1").expect("registered experiment must run");
    let bundle = evidence_bundle(
        &workspace,
        &Workspace::digest(&completed.evidence)
            .map(|digest| format!("artifact://sha256/{digest}"))
            .expect("evidence must hash"),
    )
    .expect("registered evidence must bundle");
    assert_eq!(
        bundle
            .registration_package
            .as_ref()
            .expect("bundle must contain registration package")
            .compiled_ref,
        bundle
            .compiled_ref
            .expect("bundle must contain compiled ref")
    );
    assert_eq!(
        bundle
            .external_registration_receipt
            .expect("bundle must contain external receipt")
            .registration_id,
        "abc12"
    );
    assert_eq!(
        prepare_registration(&workspace, "toy.score.v1")
            .expect("exact package retry remains idempotent after execution")
            .package_ref,
        prepared.package_ref
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

fn fixture<T: DeserializeOwned>(relative: &str) -> T {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join(relative);
    let contents = fs::read(path).expect("fixture must be readable");
    serde_json::from_slice::<T>(&contents).expect("fixture must parse")
}
