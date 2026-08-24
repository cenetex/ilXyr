//! Tests for the claim compiler and program-level synthesis layer.
//!
//! These tests build a small ledger with a compiled experiment, recorded
//! evidence, a certificate, and a claim, then verify that `claim_support`
//! and `program_status` derive the correct mechanical support status.

use std::{fs, path::PathBuf, process, time::SystemTime};

use ilxyr_core::{
    ActorRef, Certificate, CertificateDomain, CertificatePredicate, CheckerRef, ClaimNode,
    ComparisonOperator, Evidence, ExperimentSpec, Forecast, FundingCommitment, PaperContract,
    ResearchContribution, SupportStatus, Workspace, claim_support, commit_funding,
    compile_experiment, decide_admission, evaluate_certificate, load_paper_contract,
    program_status, record_certificate, register_claim, run_experiment, submit_contribution,
    submit_forecast,
};

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
        let path = std::env::temp_dir().join(format!("ilxyr-claims-{}-{nonce}", process::id()));
        fs::create_dir_all(&path).expect("test directory must be created");
        Self(path)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn human_actor() -> ActorRef {
    ActorRef {
        id: "human://toy/owner".to_owned(),
        kind: ilxyr_core::ActorKind::Human,
        model_ref: None,
    }
}

/// Build a minimal ledger: compile + run a toy experiment, record evidence,
/// optionally record a certificate, and register a claim bound to that evidence.
struct Ledger {
    _dir: TestDirectory,
    workspace: Workspace,
    evidence_ref: String,
    experiment_id: String,
}

fn build_ledger(score: f64) -> Ledger {
    let dir = TestDirectory::create();
    let workspace = Workspace::init(&dir.0).expect("workspace must initialize");
    for json in [
        include_str!("../../../examples/toy/hypothesis.json"),
        include_str!("../../../examples/toy/foundation.json"),
        include_str!("../../../examples/toy/engineering-review.json"),
        include_str!("../../../examples/toy/experiment-design.json"),
    ] {
        let contribution: ResearchContribution =
            serde_json::from_str(json).expect("toy contribution must parse");
        submit_contribution(&workspace, contribution).expect("contribution must be accepted");
    }
    let mut spec = serde_json::from_str::<ExperimentSpec>(include_str!(
        "../../../examples/toy/experiment.json"
    ))
    .expect("toy experiment must parse");
    spec.title = "Claim compiler test".to_owned();
    // Inject the metric via the executor output by overriding the program to a
    // fixture script that prints the score.
    let script = write_score_script(score);
    spec.execution.program = script;
    let _ = compile_experiment(&workspace, spec.clone()).expect("experiment must compile");
    // Submit forecasts and funding so admission can pass, then admit.
    let forecast_model: Forecast =
        serde_json::from_str(include_str!("../../../examples/toy/forecast-model.json"))
            .expect("toy forecast must parse");
    let forecast_human: Forecast =
        serde_json::from_str(include_str!("../../../examples/toy/forecast-human.json"))
            .expect("toy forecast must parse");
    submit_forecast(&workspace, forecast_model).expect("model forecast must be accepted");
    submit_forecast(&workspace, forecast_human).expect("human forecast must be accepted");
    let funding_a: FundingCommitment =
        serde_json::from_str(include_str!("../../../examples/toy/funding-a.json"))
            .expect("toy funding must parse");
    let funding_b: FundingCommitment =
        serde_json::from_str(include_str!("../../../examples/toy/funding-b.json"))
            .expect("toy funding must parse");
    commit_funding(&workspace, funding_a).expect("first funding must be accepted");
    commit_funding(&workspace, funding_b).expect("second funding must be accepted");
    decide_admission(&workspace, &spec.id).expect("admission must be evaluated");
    let _ = run_experiment(&workspace, &spec.id).expect("experiment must run");
    let evidence_ref = workspace
        .latest_event("EvidenceRecorded", &spec.id)
        .expect("evidence event must exist")
        .and_then(|event| event.artifact_ref)
        .expect("evidence artifact ref must be recorded");
    Ledger {
        _dir: dir,
        workspace,
        evidence_ref,
        experiment_id: spec.id,
    }
}

fn write_score_script(score: f64) -> String {
    let dir = std::env::temp_dir().join(format!(
        "ilxyr-claims-script-{}-{}",
        process::id(),
        UNIQUE.next_relaxed()
    ));
    fs::create_dir_all(&dir).expect("script dir");
    let script = dir.join("score.sh");
    let metrics = serde_json::json!({
        "metrics": { "score": score },
        "source": null
    });
    fs::write(&script, format!("#!/bin/sh\necho '{}'", metrics)).expect("write script");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&script).unwrap().permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&script, perms).unwrap();
    }
    script.to_string_lossy().into_owned()
}

fn record_metric_cert(ledger: &Ledger, threshold: f64, holds: bool) -> String {
    let evidence: Evidence = ledger
        .workspace
        .get(&ledger.evidence_ref)
        .expect("evidence must load");
    let cert = Certificate {
        schema: "ilxyr.certificate.v1".to_owned(),
        id: format!("cert:claim-test.{}", if holds { "ok" } else { "bad" }),
        evidence_ref: ledger.evidence_ref.clone(),
        predicate: CertificatePredicate::Metric {
            metric: "score".to_owned(),
            operator: ComparisonOperator::Gte,
            threshold,
        },
        domain: CertificateDomain::Enumerated {
            values: vec![serde_json::Value::String("success".to_owned())],
        },
        checker: CheckerRef {
            id: "toy-checker".to_owned(),
            version: "1".to_owned(),
        },
        checked_artifacts: vec![evidence.run_ref.clone()],
        issued_at_ms: 1_790_000_000_000,
    };
    record_certificate(&ledger.workspace, cert).expect("certificate must record")
}

#[test]
fn supported_claim_when_certificate_predicate_holds() {
    let ledger = build_ledger(0.82);
    record_metric_cert(&ledger, 0.8, true);
    let claim_id = "claim:claim-test.supported.v1";
    register_claim(
        &ledger.workspace,
        ClaimNode {
            schema: "ilxyr.claim.v1".to_owned(),
            id: claim_id.to_owned(),
            statement: "The frozen toy procedure emits score 0.82.".to_owned(),
            evidence_refs: vec![ledger.evidence_ref.clone()],
            shared_task_ref: None,
            freshness_prerequisite: None,
            refresh_command: None,
            created_by: human_actor(),
            created_at_ms: 1_780_000_000_000,
        },
    )
    .expect("claim must register");
    let support = claim_support(&ledger.workspace, claim_id).expect("support must derive");
    assert_eq!(support.status, SupportStatus::Supported);
    assert_eq!(support.certificates.len(), 1);
    let observed = support.certificates[0].observed_value.unwrap();
    assert!((observed - 0.82).abs() < f64::EPSILON);
}

#[test]
fn evaluate_certificate_returns_contradicted_when_predicate_fails() {
    // `record_certificate` validates predicates at record time, so a recorded
    // certificate can never be contradicted. But `evaluate_certificate` is the
    // pure evaluator the synthesis layer exposes, and it must report
    // Contradicted for a predicate that does not hold against the evidence.
    let ledger = build_ledger(0.5);
    let evidence: Evidence = ledger
        .workspace
        .get(&ledger.evidence_ref)
        .expect("evidence must load");
    let cert = Certificate {
        schema: "ilxyr.certificate.v1".to_owned(),
        id: "cert:claim-test.direct-bad".to_owned(),
        evidence_ref: ledger.evidence_ref.clone(),
        predicate: CertificatePredicate::Metric {
            metric: "score".to_owned(),
            operator: ComparisonOperator::Gte,
            threshold: 0.8,
        },
        domain: CertificateDomain::Enumerated {
            values: vec![serde_json::Value::String("success".to_owned())],
        },
        checker: CheckerRef {
            id: "toy-checker".to_owned(),
            version: "1".to_owned(),
        },
        checked_artifacts: vec![evidence.run_ref.clone()],
        issued_at_ms: 1_790_000_000_000,
    };
    let status = evaluate_certificate(&ledger.workspace, &cert, &evidence).expect("eval must run");
    assert_eq!(status, SupportStatus::Contradicted);
}

#[test]
fn missing_claim_when_no_certificate_recorded() {
    let ledger = build_ledger(0.82);
    let claim_id = "claim:claim-test.missing.v1";
    register_claim(
        &ledger.workspace,
        ClaimNode {
            schema: "ilxyr.claim.v1".to_owned(),
            id: claim_id.to_owned(),
            statement: "Uncertified claim.".to_owned(),
            evidence_refs: vec![ledger.evidence_ref.clone()],
            shared_task_ref: None,
            freshness_prerequisite: None,
            refresh_command: None,
            created_by: human_actor(),
            created_at_ms: 1_780_000_000_000,
        },
    )
    .expect("claim must register");
    let support = claim_support(&ledger.workspace, claim_id).expect("support must derive");
    assert_eq!(support.status, SupportStatus::Missing);
}

#[test]
fn program_status_counts_claims_and_lists_experiments() {
    let ledger = build_ledger(0.82);
    record_metric_cert(&ledger, 0.8, true);
    register_claim(
        &ledger.workspace,
        ClaimNode {
            schema: "ilxyr.claim.v1".to_owned(),
            id: "claim:overview.supported.v1".to_owned(),
            statement: "Supported claim for the overview.".to_owned(),
            evidence_refs: vec![ledger.evidence_ref.clone()],
            shared_task_ref: None,
            freshness_prerequisite: None,
            refresh_command: None,
            created_by: human_actor(),
            created_at_ms: 1_780_000_000_000,
        },
    )
    .expect("claim must register");

    let overview = program_status(&ledger.workspace, None).expect("overview must derive");
    assert_eq!(overview.claims.len(), 1);
    assert_eq!(
        overview.status_counts.get("supported").copied(),
        Some(1),
        "status_counts = {:?}",
        overview.status_counts
    );
    assert!(
        overview
            .experiments
            .iter()
            .any(|e| e.experiment_id == ledger.experiment_id)
    );
    assert!(overview.scope_violations.is_empty());
}

#[test]
fn program_status_flags_scope_violation_for_supported_non_claim() {
    let ledger = build_ledger(0.82);
    record_metric_cert(&ledger, 0.8, true);
    register_claim(
        &ledger.workspace,
        ClaimNode {
            schema: "ilxyr.claim.v1".to_owned(),
            id: "claim:overview.scope.v1".to_owned(),
            statement: "This model achieves general task solving across benchmarks.".to_owned(),
            evidence_refs: vec![ledger.evidence_ref.clone()],
            shared_task_ref: None,
            freshness_prerequisite: None,
            refresh_command: None,
            created_by: human_actor(),
            created_at_ms: 1_780_000_000_000,
        },
    )
    .expect("claim must register");

    let paper = PaperContract {
        schema: "ilxyr.paper_contract.v1".to_owned(),
        id: "paper:scope-test.v1".to_owned(),
        title: "Scope test".to_owned(),
        non_claims: vec!["general task solving".to_owned()],
        required_claims: vec![],
    };
    let overview = program_status(&ledger.workspace, Some(&paper)).expect("overview must derive");
    assert_eq!(
        overview.scope_violations.len(),
        1,
        "expected one scope violation, got {:?}",
        overview.scope_violations
    );
    assert!(overview.scope_violations[0].contains("general task solving"));
}

#[test]
fn load_paper_contract_rejects_wrong_schema() {
    let dir = TestDirectory::create();
    let path = dir.0.join("bad.json");
    fs::write(&path, r#"{"schema":"wrong","id":"x","title":"t"}"#).unwrap();
    let err = load_paper_contract(&path).expect_err("must reject wrong schema");
    assert!(err.to_string().contains("ilxyr.paper_contract.v1"));
}

#[test]
fn load_paper_contract_loads_fixture() {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/schema/paper-contract.json");
    let contract = load_paper_contract(&path).expect("fixture must load");
    assert_eq!(contract.id, "paper:toy.v1");
    assert!(
        contract
            .non_claims
            .contains(&"general task solving".to_owned())
    );
}
