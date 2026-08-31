use std::collections::BTreeMap;

use base64::{Engine as _, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signer, SigningKey};
use ilxyr_core::{
    ActorRef, AllocationPolicy, BudgetPolicy, DigestResource, DsseEnvelope, DsseSignature,
    EnvironmentCapabilities, ExecutionNetworkMode, ExecutionReport, ExecutorEnvironmentManifest,
    ExecutorJobPackage, ExportPolicy, IsolationProfile, ProviderBinding, ReportReplayGuard,
    ReportingPolicy, RunRecord, SourceRelease, TrustedAttestationKey, WeightClass, Workspace,
    dsse_pae, verify_environment_manifest, verify_execution_report, verify_job_package,
};
use serde::Serialize;
use serde_json::{Value, json};

const PAYLOAD_TYPE: &str = "application/vnd.in-toto.provenance+json";
const EXECUTOR_ID: &str = "service://cenetex/executor/public-v1";
const KEY_ID: &str = "key://cenetex/executor/public-v1/test";

#[test]
fn signed_report_is_bound_to_the_frozen_package_and_environment() {
    let signing_key = SigningKey::from_bytes(&[41; 32]);
    let (environment, package, trusted_key, report) = fixture(&signing_key);

    let environment_ref = verify_environment_manifest(&environment).expect("environment verifies");
    let package_ref = verify_job_package(&environment, &package).expect("package verifies");
    let verified = verify_execution_report(&environment, &package, &[trusted_key], &report)
        .expect("signed execution report verifies");

    assert_eq!(verified.environment_ref, environment_ref);
    assert_eq!(verified.job_package_ref, package_ref);
    assert_eq!(verified.run_ref, report.run_ref);
    assert_eq!(verified.verified_key_ids, vec![KEY_ID]);
}

#[test]
fn tampering_and_cross_executor_signatures_fail_closed() {
    let signing_key = SigningKey::from_bytes(&[42; 32]);
    let (environment, package, trusted_key, report) = fixture(&signing_key);

    let mut tampered = report.clone();
    tampered.attestation.payload = STANDARD.encode(br#"{"_type":"tampered"}"#);
    assert!(
        verify_execution_report(
            &environment,
            &package,
            std::slice::from_ref(&trusted_key),
            &tampered,
        )
        .expect_err("tampered payload must fail")
        .to_string()
        .contains("no signature from a trusted")
    );

    let (_, original_package, _, mut changed_outputs) = fixture(&signing_key);
    changed_outputs.outputs[0].sha256 = "a".repeat(64);
    assert!(
        verify_execution_report(
            &environment,
            &original_package,
            std::slice::from_ref(&trusted_key),
            &changed_outputs,
        )
        .expect_err("outputs changed outside the signed provenance must fail")
        .to_string()
        .contains("ilxyrOutputsRef")
    );

    let other_key = SigningKey::from_bytes(&[43; 32]);
    let mut cross_signed = report;
    let statement = remote_statement(
        &cross_signed,
        "service://other/executor-v1",
        &cross_signed.run_ref,
    );
    cross_signed.attestation = signed_envelope(&other_key, "key://other/executor/test", &statement);
    let other_trusted = trusted_key_for(
        &other_key,
        "key://other/executor/test",
        "service://other/executor-v1",
    );
    assert!(
        verify_execution_report(
            &environment,
            &package,
            &[trusted_key, other_trusted],
            &cross_signed
        )
        .expect_err("a different executor must not satisfy the report identity")
        .to_string()
        .contains("declared executor")
    );
}

#[test]
fn changed_package_or_provenance_binding_is_rejected() {
    let signing_key = SigningKey::from_bytes(&[44; 32]);
    let (environment, mut package, trusted_key, mut report) = fixture(&signing_key);

    package.targets.reverse();
    assert!(
        verify_execution_report(
            &environment,
            &package,
            std::slice::from_ref(&trusted_key),
            &report,
        )
        .expect_err("changed target order changes the package identity")
        .to_string()
        .contains("does not bind the supplied package")
    );

    let (_, original_package, _, _) = fixture(&signing_key);
    let wrong_launch = artifact_ref(&json!({"launch": "different"}));
    let statement = remote_statement(&report, EXECUTOR_ID, &wrong_launch);
    report.attestation = signed_envelope(&signing_key, KEY_ID, &statement);
    assert!(
        verify_execution_report(&environment, &original_package, &[trusted_key], &report)
            .expect_err("signed provenance must bind the launch")
            .to_string()
            .contains("ilxyrRunRef")
    );
}

#[test]
fn replay_guard_is_idempotent_but_rejects_launch_reuse() {
    let signing_key = SigningKey::from_bytes(&[45; 32]);
    let (environment, package, trusted_key, report) = fixture(&signing_key);
    let verified = verify_execution_report(&environment, &package, &[trusted_key], &report)
        .expect("report verifies");
    let mut guard = ReportReplayGuard::default();

    assert!(guard.admit(&verified).expect("first report is admitted"));
    assert!(!guard.admit(&verified).expect("exact retry is idempotent"));

    let mut conflicting = verified;
    conflicting.report_ref = artifact_ref(&json!({"report": "different"}));
    assert!(
        guard
            .admit(&conflicting)
            .expect_err("one launch cannot publish two reports")
            .to_string()
            .contains("already bound")
    );
}

#[test]
fn unsafe_environment_baseline_is_rejected() {
    let signing_key = SigningKey::from_bytes(&[46; 32]);
    let (mut environment, _, _, _) = fixture(&signing_key);
    environment.isolation.signing_key_in_guest = true;

    assert!(
        verify_environment_manifest(&environment)
            .expect_err("guest signing key must fail the public baseline")
            .to_string()
            .contains("isolation baseline")
    );
}

fn fixture(
    signing_key: &SigningKey,
) -> (
    ExecutorEnvironmentManifest,
    ExecutorJobPackage,
    TrustedAttestationKey,
    ExecutionReport,
) {
    let environment = ExecutorEnvironmentManifest {
        schema: "ilxyr.executor_environment.v1".to_owned(),
        id: "environment://cenetex/public-v1/test".to_owned(),
        operator: ActorRef::service(EXECUTOR_ID),
        source: SourceRelease {
            repository: "https://github.com/cenetex/ilXyr".to_owned(),
            commit: "1".repeat(40),
            archive: resource("source-archive", 'a'),
        },
        build_recipe: resource("build-recipe", 'b'),
        runner: resource("runner", 'c'),
        kernel: resource("kernel", 'd'),
        rootfs: resource("rootfs", 'e'),
        sbom: resource("sbom", 'f'),
        provenance: resource("build-provenance", '1'),
        isolation: IsolationProfile {
            boundary: "firecracker_microvm".to_owned(),
            one_job_per_vm: true,
            read_only_rootfs: true,
            host_mounts: false,
            interactive_access: false,
            metadata_service_in_guest: false,
            signing_key_in_guest: false,
            reporting_outside_guest: true,
        },
        capabilities: EnvironmentCapabilities {
            weight_classes: vec![WeightClass::Public],
            network_modes: vec![ExecutionNetworkMode::Denied],
            export_policies: vec![ExportPolicy::MetricsOnly],
        },
        conformance_suite: resource("conformance-suite", '2'),
    };
    let environment_ref = artifact_ref(&environment);
    let package = ExecutorJobPackage {
        schema: "ilxyr.executor_job_package.v1".to_owned(),
        experiment_id: "experiment.remote.test.v1".to_owned(),
        compiled_ref: artifact_ref(&json!({"compiled": "experiment.remote.test.v1"})),
        environment_ref: environment_ref.clone(),
        inputs: vec![resource("input", '3')],
        executable: resource("executable", '4'),
        arguments: vec![],
        oracle: resource("oracle", '5'),
        harness: resource("harness", '6'),
        provider: ProviderBinding {
            provider: "aws".to_owned(),
            region: "ca-central-1".to_owned(),
            machine_type: "c7i.metal-24xl".to_owned(),
            architecture: "x86_64".to_owned(),
            image_id: "ami-test-immutable".to_owned(),
            image_sha256: "7".repeat(64),
            storage_gib: 32,
        },
        budget: BudgetPolicy {
            max_runtime_seconds: 3_600,
            max_cost_microusd: 5_000_000,
            price_evidence: resource("price-evidence", '8'),
            watchdog_grace_seconds: 30,
        },
        targets: vec!["target-a".to_owned(), "target-b".to_owned()],
        expected_outputs: vec!["metrics".to_owned()],
        allocation: AllocationPolicy {
            concurrency: 1,
            retry_limit: 1,
            failure_policy: "fail_closed".to_owned(),
        },
        network: ExecutionNetworkMode::Denied,
        allowed_hosts: vec![],
        export_policy: ExportPolicy::MetricsOnly,
        weight_class: WeightClass::Public,
        expected_executor: ActorRef::service(EXECUTOR_ID),
        reporting: ReportingPolicy {
            endpoint: "https://submit.ilxyr.cenetex.com/v1/reports".to_owned(),
            protocol: "ilxyr.execution_report.v1".to_owned(),
            max_report_bytes: 1_048_576,
            expected_verifier: "service://ilxyr/report-verifier-v1".to_owned(),
        },
    };
    let run = RunRecord {
        schema: "ilxyr.run.v1".to_owned(),
        id: "run.remote.test.v1".to_owned(),
        experiment_id: package.experiment_id.clone(),
        started_at_ms: 1_000,
        completed_at_ms: 2_000,
        exit_code: 0,
        timed_out: false,
        stdout: String::new(),
        stderr: String::new(),
        output_truncated: false,
        output_error: None,
        metrics: BTreeMap::from([("score".to_owned(), 0.75)]),
        artifacts: Vec::new(),
        source_attestation: None,
    };
    let mut report = ExecutionReport {
        schema: "ilxyr.execution_report.v1".to_owned(),
        job_package_ref: artifact_ref(&package),
        authorization_ref: artifact_ref(&json!({"authorization": "one-run"})),
        launch_ref: artifact_ref(&json!({"launch": "one"})),
        environment_ref,
        executor: ActorRef::service(EXECUTOR_ID),
        provider_instance_id: "i-test".to_owned(),
        machine_image_id: package.provider.image_id.clone(),
        machine_image_sha256: package.provider.image_sha256.clone(),
        run_ref: artifact_ref(&run),
        run,
        outputs: vec![resource("metrics", '9')],
        attestation: DsseEnvelope {
            payload_type: PAYLOAD_TYPE.to_owned(),
            payload: String::new(),
            signatures: vec![],
        },
        reported_at_ms: 3_000,
    };
    let statement = remote_statement(&report, EXECUTOR_ID, &report.run_ref);
    report.attestation = signed_envelope(signing_key, KEY_ID, &statement);
    let trusted_key = trusted_key_for(signing_key, KEY_ID, EXECUTOR_ID);
    (environment, package, trusted_key, report)
}

fn remote_statement(report: &ExecutionReport, builder_id: &str, run_ref: &str) -> Value {
    let outputs_ref = artifact_ref(&report.outputs);
    json!({
        "_type": "https://in-toto.io/Statement/v1",
        "subject": [{
            "name": "ilxyr run record",
            "digest": {
                "sha256": report.run_ref
                    .strip_prefix("artifact://sha256/")
                    .expect("run ref has a digest")
            }
        }],
        "predicateType": "https://slsa.dev/provenance/v1",
        "predicate": {
            "buildDefinition": {
                "buildType": "https://ilxyr.dev/buildtypes/remote-execution/v1",
                "externalParameters": {
                    "ilxyrRunRef": run_ref,
                    "ilxyrJobPackageRef": report.job_package_ref,
                    "ilxyrEnvironmentRef": report.environment_ref,
                    "ilxyrAuthorizationRef": report.authorization_ref,
                    "ilxyrLaunchRef": report.launch_ref,
                    "ilxyrOutputsRef": outputs_ref,
                    "ilxyrProviderInstanceId": report.provider_instance_id,
                    "ilxyrMachineImageId": report.machine_image_id,
                    "ilxyrMachineImageSha256": report.machine_image_sha256
                },
                "resolvedDependencies": []
            },
            "runDetails": {
                "builder": {"id": builder_id},
                "metadata": {"invocationId": report.launch_ref}
            }
        }
    })
}

fn signed_envelope(signing_key: &SigningKey, key_id: &str, statement: &Value) -> DsseEnvelope {
    let payload = serde_json::to_vec(statement).expect("statement serializes");
    let signature = signing_key.sign(&dsse_pae(PAYLOAD_TYPE, &payload));
    DsseEnvelope {
        payload_type: PAYLOAD_TYPE.to_owned(),
        payload: STANDARD.encode(payload),
        signatures: vec![DsseSignature {
            keyid: Some(key_id.to_owned()),
            sig: STANDARD.encode(signature.to_bytes()),
        }],
    }
}

fn trusted_key_for(
    signing_key: &SigningKey,
    key_id: &str,
    executor_id: &str,
) -> TrustedAttestationKey {
    TrustedAttestationKey {
        schema: "ilxyr.trusted_attestation_key.v1".to_owned(),
        key_id: key_id.to_owned(),
        executor: ActorRef::service(executor_id),
        algorithm: "ed25519".to_owned(),
        public_key: STANDARD.encode(signing_key.verifying_key().as_bytes()),
        trusted_at_ms: 1,
    }
}

fn resource(name: &str, digit: char) -> DigestResource {
    DigestResource {
        name: name.to_owned(),
        uri: format!("https://artifacts.example/{name}"),
        sha256: digit.to_string().repeat(64),
        size_bytes: 1,
    }
}

fn artifact_ref<T: Serialize>(value: &T) -> String {
    format!(
        "artifact://sha256/{}",
        Workspace::digest(value).expect("object hashes")
    )
}
