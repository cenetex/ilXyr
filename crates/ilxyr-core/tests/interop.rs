use std::{fs, path::PathBuf, process, time::SystemTime};

use ilxyr_core::{
    EvidenceBundle, Forecast, FundingCommitment, InteropFormat, ResearchContribution, Workspace,
    commit_funding, compile_experiment, decide_admission, evidence_bundle, export_evidence,
    retro_register, run_experiment, submit_contribution, submit_forecast,
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
    fn create(label: &str) -> Self {
        // Monotonic per-process counter: wall-clock nanoseconds alone can
        // collide when parallel tests start within one clock tick.
        let nonce = u128::from(UNIQUE.next_relaxed())
            + SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .expect("test clock must follow Unix epoch")
                .as_nanos();
        let path =
            std::env::temp_dir().join(format!("ilxyr-interop-{label}-{}-{nonce}", process::id()));
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
fn promoted_evidence_exports_through_all_interoperability_views() {
    let directory = TestDirectory::create("promoted");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    submit_toy_inputs(&workspace);
    let completed =
        run_experiment(&workspace, "toy.score.v1").expect("toy experiment must complete");
    let evidence_event = workspace
        .latest_event("EvidenceRecorded", "toy.score.v1")
        .expect("ledger must load")
        .expect("evidence event must exist");
    let evidence_ref = evidence_event
        .artifact_ref
        .expect("evidence event must reference its object");

    let bundle = evidence_bundle(&workspace, &evidence_ref).expect("bundle must export");
    assert_eq!(bundle.schema, "ilxyr.evidence_bundle.v1");
    assert_eq!(bundle.evidence.id, completed.evidence.id);
    assert_eq!(bundle.forecasts.len(), 2);
    assert_eq!(bundle.settlements.len(), 2);
    assert!(bundle.forecast_risked);
    assert!(!bundle.source_attested);
    assert!(!bundle.cold_replayable);
    assert!(bundle.compiled.is_some());
    assert!(bundle.retro_plan.is_none());

    let native =
        export_evidence(&workspace, &evidence_ref, InteropFormat::Native).expect("native export");
    assert_eq!(native["schema"], "ilxyr.evidence_bundle.v1");
    let roundtrip: EvidenceBundle =
        serde_json::from_value(native).expect("native bundle must round-trip");
    assert_eq!(roundtrip.evidence_ref, evidence_ref);

    let ro_crate =
        export_evidence(&workspace, &evidence_ref, InteropFormat::RoCrate).expect("RO-Crate");
    assert_eq!(
        ro_crate["@context"][0],
        "https://w3id.org/ro/crate/1.3/context"
    );
    let evidence_entity = ro_crate["@graph"]
        .as_array()
        .expect("RO-Crate graph must be an array")
        .iter()
        .find(|entity| entity["@id"] == evidence_ref)
        .expect("RO-Crate must contain the evidence entity");
    assert_eq!(evidence_entity["ilxyr:forecastRisked"], true);
    assert_eq!(
        evidence_entity["prov:wasGeneratedBy"]["@id"],
        bundle.run_ref
    );
    let compiled_entity = ro_crate["@graph"]
        .as_array()
        .expect("RO-Crate graph must be an array")
        .iter()
        .find(|entity| {
            bundle
                .compiled_ref
                .as_deref()
                .is_some_and(|compiled_ref| entity["@id"] == compiled_ref)
        })
        .expect("RO-Crate must contain the compiled plan");
    assert_eq!(compiled_entity["author"]["@type"], "SoftwareApplication");
    let human_forecast = ro_crate["@graph"]
        .as_array()
        .expect("RO-Crate graph must be an array")
        .iter()
        .find(|entity| entity["identifier"] == "toy.forecast.human.v1")
        .expect("RO-Crate must contain the human forecast");
    assert_eq!(human_forecast["author"]["@type"], "Person");

    let statement =
        export_evidence(&workspace, &evidence_ref, InteropFormat::InToto).expect("in-toto");
    assert_eq!(statement["_type"], "https://in-toto.io/Statement/v1");
    assert_eq!(
        statement["predicateType"],
        "https://ilxyr.dev/attestations/evidence/v1"
    );
    assert_eq!(
        statement["subject"][0]["digest"]["sha256"],
        evidence_ref
            .strip_prefix("artifact://sha256/")
            .expect("artifact reference must carry its digest")
    );
    assert_eq!(statement["predicate"]["forecast_risked"], true);

    let mlflow = export_evidence(&workspace, &evidence_ref, InteropFormat::Mlflow).expect("MLflow");
    assert_eq!(mlflow["schema"], "ilxyr.mlflow_bridge.v1");
    assert_eq!(mlflow["required_inputs"][0], "experiment_id");
    assert_eq!(
        mlflow["create_run"]["endpoint"],
        "/api/2.0/mlflow/runs/create"
    );
    assert_eq!(
        mlflow["create_run"]["request_template"]["experiment_id"]["$input"],
        "experiment_id"
    );
    assert_eq!(
        mlflow["after_create"]["log_batch"]["endpoint"],
        "/api/2.0/mlflow/runs/log-batch"
    );
    assert_eq!(
        mlflow["after_create"]["log_batch"]["request_template"]["metrics"][0]["key"],
        "score"
    );
    assert_eq!(
        mlflow["after_create"]["artifacts"][0]["path"],
        "ilxyr/evidence-bundle.json"
    );

    assert!(
        "unknown"
            .parse::<InteropFormat>()
            .expect_err("unknown formats must fail")
            .to_string()
            .contains("unsupported evidence export format")
    );
    assert!(workspace.verify().expect("ledger must verify").valid);
}

#[test]
fn retro_evidence_is_cold_replayable_but_never_forecast_risked() {
    let directory = TestDirectory::create("retro");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    let completed = retro_register(
        &workspace,
        fixture("../../../examples/schema/retro-registration.json"),
    )
    .expect("frozen retro claim must replay");

    let bundle = evidence_bundle(&workspace, &completed.registration.evidence_ref)
        .expect("retro evidence bundle must export");
    assert!(!bundle.forecast_risked);
    assert!(bundle.source_attested);
    assert!(bundle.cold_replayable);
    assert!(bundle.compiled.is_none());
    assert!(bundle.retro_plan.is_some());
    assert_eq!(
        bundle
            .retro_registration
            .as_ref()
            .expect("retro registration must be included")
            .evidence_ref,
        completed.registration.evidence_ref
    );

    let ro_crate = export_evidence(
        &workspace,
        &completed.registration.evidence_ref,
        InteropFormat::RoCrate,
    )
    .expect("retro RO-Crate export");
    let evidence_entity = ro_crate["@graph"]
        .as_array()
        .expect("RO-Crate graph must be an array")
        .iter()
        .find(|entity| entity["@id"] == completed.registration.evidence_ref)
        .expect("RO-Crate must contain retro evidence");
    assert_eq!(evidence_entity["ilxyr:forecastRisked"], false);
    assert_eq!(evidence_entity["ilxyr:coldReplayable"], true);
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
    compile_experiment(workspace, fixture("../../../examples/toy/experiment.json"))
        .expect("experiment must compile");
    for path in [
        "../../../examples/toy/forecast-model.json",
        "../../../examples/toy/forecast-human.json",
    ] {
        submit_forecast(workspace, fixture::<Forecast>(path)).expect("forecast must submit");
    }
    for path in [
        "../../../examples/toy/funding-a.json",
        "../../../examples/toy/funding-b.json",
    ] {
        commit_funding(workspace, fixture::<FundingCommitment>(path)).expect("funding must commit");
    }
    assert!(
        decide_admission(workspace, "toy.score.v1")
            .expect("admission must decide")
            .accepted
    );
}

fn fixture<T: DeserializeOwned>(relative: &str) -> T {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join(relative);
    let contents = fs::read(path).expect("fixture must be readable");
    serde_json::from_slice::<T>(&contents).expect("fixture must parse")
}
