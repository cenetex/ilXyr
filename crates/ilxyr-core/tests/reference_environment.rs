use std::{
    fs,
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signer, SigningKey};
use ilxyr_core::{
    ActorRef, AllocationPolicy, BudgetPolicy, ConformanceExecutionClass, ConformanceTestStatus,
    DigestResource, DsseEnvelope, DsseSignature, EnvironmentCapabilities, ExecutionNetworkMode,
    ExecutorArtifactMaterialization, ExecutorConformanceReport, ExecutorConformanceSuite,
    ExecutorConformanceTest, ExecutorConformanceTestResult, ExecutorEnvironmentManifest,
    ExecutorJobPackage, ExecutorMaterializationEntry, ExecutorResourceScope, ExportPolicy,
    IsolationProfile, ProviderBinding, ReportingPolicy, SourceRelease, TrustedAttestationKey,
    WeightClass, Workspace, dsse_pae, verify_conformance_report, verify_conformance_suite,
    verify_environment_manifest, verify_executor_materialization,
};
use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest as _, Sha256};

const OPERATOR_ID: &str = "service://cenetex/executor/public-v1";
const RUNNER_ID: &str = "service://independent/conformance-runner-v1";
const RUNNER_KEY_ID: &str = "key://independent/conformance-runner-v1/test";
const PAYLOAD_TYPE: &str = "application/vnd.in-toto.provenance+json";
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[test]
fn materialization_verifies_every_frozen_resource_without_authorizing_launch() {
    let fixture = MaterializationFixture::new();
    let receipt = verify_executor_materialization(
        &fixture.environment,
        &fixture.package,
        &fixture.materialization,
        &fixture.root,
    )
    .expect("materialization verifies");

    assert_eq!(receipt.verified_resources.len(), 13);
    assert_eq!(receipt.network, ExecutionNetworkMode::Denied);
    assert_eq!(receipt.export_policy, ExportPolicy::MetricsOnly);
    assert!(!receipt.guest_credentials_included);
    assert!(!receipt.launch_authorized);
}

#[test]
fn changed_oracle_and_changed_target_order_fail_closed() {
    let fixture = MaterializationFixture::new();
    let oracle_path = fixture.root.join("job/oracle");
    fs::write(&oracle_path, b"changed-oracle").expect("change oracle");
    assert!(
        verify_executor_materialization(
            &fixture.environment,
            &fixture.package,
            &fixture.materialization,
            &fixture.root,
        )
        .expect_err("changed oracle must fail")
        .to_string()
        .contains("digest or size drift")
    );

    let fresh = MaterializationFixture::new();
    let mut changed_package = fresh.package.clone();
    changed_package.targets.reverse();
    assert!(
        verify_executor_materialization(
            &fresh.environment,
            &changed_package,
            &fresh.materialization,
            &fresh.root,
        )
        .expect_err("changed target order must fail")
        .to_string()
        .contains("does not bind")
    );
}

#[test]
fn missing_resources_and_path_traversal_fail_closed() {
    let fixture = MaterializationFixture::new();
    let mut missing = fixture.materialization.clone();
    missing.resources.pop();
    assert!(
        verify_executor_materialization(
            &fixture.environment,
            &fixture.package,
            &missing,
            &fixture.root,
        )
        .expect_err("missing resource must fail")
        .to_string()
        .contains("every frozen")
    );

    let mut traversal = fixture.materialization.clone();
    traversal.resources[0].relative_path = "../outside".to_owned();
    assert!(
        verify_executor_materialization(
            &fixture.environment,
            &fixture.package,
            &traversal,
            &fixture.root,
        )
        .expect_err("path traversal must fail")
        .to_string()
        .contains("normal relative paths")
    );
}

#[cfg(unix)]
#[test]
fn symlinked_resources_fail_closed() {
    use std::os::unix::fs::symlink;

    let fixture = MaterializationFixture::new();
    let entry = fixture
        .materialization
        .resources
        .iter()
        .find(|entry| entry.name == "oracle")
        .expect("oracle entry");
    let oracle = fixture.root.join(&entry.relative_path);
    let target = fixture.root.join("real-oracle");
    fs::rename(&oracle, &target).expect("move oracle");
    symlink(&target, &oracle).expect("link oracle");

    assert!(
        verify_executor_materialization(
            &fixture.environment,
            &fixture.package,
            &fixture.materialization,
            &fixture.root,
        )
        .expect_err("symlink must fail")
        .to_string()
        .contains("crosses a symlink")
    );
}

#[test]
fn materialization_format_has_no_place_for_guest_credentials() {
    let fixture = MaterializationFixture::new();
    let mut value = serde_json::to_value(&fixture.materialization).expect("serialize");
    value
        .as_object_mut()
        .expect("object")
        .insert("guest_credentials".to_owned(), json!(["secret"]));
    assert!(serde_json::from_value::<ExecutorArtifactMaterialization>(value).is_err());
}

#[test]
fn signed_independent_conformance_report_binds_the_exact_suite() {
    let signing_key = SigningKey::from_bytes(&[61; 32]);
    let (environment, suite, trusted_key, report) = conformance_fixture(&signing_key);
    let verified = verify_conformance_report(&environment, &suite, &[trusted_key], &report)
        .expect("conformance verifies");

    assert_eq!(verified.runner.id, RUNNER_ID);
    assert_eq!(verified.environment_ref, report.environment_ref);
    assert_eq!(verified.suite_ref, report.suite_ref);
    assert!(verified.passed);
    assert_eq!(verified.verified_key_ids, vec![RUNNER_KEY_ID]);
}

#[test]
fn signed_failed_conformance_is_verified_as_failed_not_promoted() {
    let signing_key = SigningKey::from_bytes(&[65; 32]);
    let (environment, suite, trusted_key, mut report) = conformance_fixture(&signing_key);
    report.tests[0].status = ConformanceTestStatus::Fail;
    report.passed = false;
    let body_ref = conformance_body_ref(&report);
    let statement = conformance_statement(&report, &body_ref, RUNNER_ID);
    report.attestation = signed_envelope(&signing_key, RUNNER_KEY_ID, &statement);

    let verified = verify_conformance_report(&environment, &suite, &[trusted_key], &report)
        .expect("a signed failure is a valid report");
    assert!(!verified.passed);
}

#[test]
fn self_verification_missing_tests_and_suite_drift_fail_closed() {
    let signing_key = SigningKey::from_bytes(&[62; 32]);
    let (environment, suite, trusted_key, report) = conformance_fixture(&signing_key);

    let mut self_report = report.clone();
    self_report.runner = environment.operator.clone();
    assert!(
        verify_conformance_report(
            &environment,
            &suite,
            std::slice::from_ref(&trusted_key),
            &self_report,
        )
        .expect_err("operator cannot self-verify")
        .to_string()
        .contains("cannot independently verify")
    );

    let mut missing = report.clone();
    missing.tests.pop();
    assert!(
        verify_conformance_report(
            &environment,
            &suite,
            std::slice::from_ref(&trusted_key),
            &missing,
        )
        .expect_err("missing suite result must fail")
        .to_string()
        .contains("exactly the frozen suite tests")
    );

    let mut drifted_suite = suite;
    drifted_suite.tests[0].requirement.push_str(" changed");
    assert!(
        verify_conformance_suite(&environment, &drifted_suite)
            .expect_err("suite drift must fail")
            .to_string()
            .contains("canonical suite bytes")
    );
}

#[test]
fn conformance_signature_from_a_different_runner_fails_closed() {
    let signing_key = SigningKey::from_bytes(&[63; 32]);
    let other_key = SigningKey::from_bytes(&[64; 32]);
    let (environment, suite, _, mut report) = conformance_fixture(&signing_key);
    let body_ref = conformance_body_ref(&report);
    let statement = conformance_statement(&report, &body_ref, "service://other/runner-v1");
    report.attestation = signed_envelope(&other_key, "key://other/runner-v1/test", &statement);
    let trusted_key = trusted_key_for(
        &other_key,
        "key://other/runner-v1/test",
        "service://other/runner-v1",
    );

    assert!(
        verify_conformance_report(&environment, &suite, &[trusted_key], &report)
            .expect_err("another runner signature must fail")
            .to_string()
            .contains("declared runner")
    );
}

struct MaterializationFixture {
    root: std::path::PathBuf,
    environment: ExecutorEnvironmentManifest,
    package: ExecutorJobPackage,
    materialization: ExecutorArtifactMaterialization,
}

impl MaterializationFixture {
    fn new() -> Self {
        let root = unique_temp_dir("materialization");
        fs::create_dir_all(root.join("environment")).expect("environment dir");
        fs::create_dir_all(root.join("job")).expect("job dir");
        let mut entries = Vec::new();
        let source_archive = write_resource(
            &root,
            ExecutorResourceScope::Environment,
            "source-archive",
            &mut entries,
        );
        let build_recipe = write_resource(
            &root,
            ExecutorResourceScope::Environment,
            "build-recipe",
            &mut entries,
        );
        let runner = write_resource(
            &root,
            ExecutorResourceScope::Environment,
            "runner",
            &mut entries,
        );
        let kernel = write_resource(
            &root,
            ExecutorResourceScope::Environment,
            "kernel",
            &mut entries,
        );
        let rootfs = write_resource(
            &root,
            ExecutorResourceScope::Environment,
            "rootfs",
            &mut entries,
        );
        let sbom = write_resource(
            &root,
            ExecutorResourceScope::Environment,
            "sbom",
            &mut entries,
        );
        let provenance = write_resource(
            &root,
            ExecutorResourceScope::Environment,
            "provenance",
            &mut entries,
        );
        let conformance_suite = write_resource(
            &root,
            ExecutorResourceScope::Environment,
            "conformance-suite",
            &mut entries,
        );
        let environment = ExecutorEnvironmentManifest {
            schema: "ilxyr.executor_environment.v1".to_owned(),
            id: "environment://cenetex/public-v1/test".to_owned(),
            operator: ActorRef::service(OPERATOR_ID),
            source: SourceRelease {
                repository: "https://github.com/cenetex/ilXyr".to_owned(),
                commit: "1".repeat(40),
                archive: source_archive,
            },
            build_recipe,
            runner,
            kernel,
            rootfs,
            sbom,
            provenance,
            isolation: isolation(),
            capabilities: capabilities(),
            conformance_suite,
        };
        let environment_ref = artifact_ref(&environment);
        let input = write_resource(&root, ExecutorResourceScope::Job, "input", &mut entries);
        let executable = write_resource(
            &root,
            ExecutorResourceScope::Job,
            "executable",
            &mut entries,
        );
        let oracle = write_resource(&root, ExecutorResourceScope::Job, "oracle", &mut entries);
        let harness = write_resource(&root, ExecutorResourceScope::Job, "harness", &mut entries);
        let price_evidence = write_resource(
            &root,
            ExecutorResourceScope::Job,
            "price-evidence",
            &mut entries,
        );
        let package = ExecutorJobPackage {
            schema: "ilxyr.executor_job_package.v1".to_owned(),
            experiment_id: "experiment.remote.preflight.v1".to_owned(),
            compiled_ref: artifact_ref(&json!({"compiled": "preflight"})),
            environment_ref: environment_ref.clone(),
            inputs: vec![input],
            executable,
            arguments: vec![],
            oracle,
            harness,
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
                price_evidence,
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
            expected_executor: ActorRef::service(OPERATOR_ID),
            reporting: ReportingPolicy {
                endpoint: "https://submit.ilxyr.cenetex.com/v1/reports".to_owned(),
                protocol: "ilxyr.execution_report.v1".to_owned(),
                max_report_bytes: 1_048_576,
                expected_verifier: "service://ilxyr/report-verifier-v1".to_owned(),
            },
        };
        let materialization = ExecutorArtifactMaterialization {
            schema: "ilxyr.executor_artifact_materialization.v1".to_owned(),
            environment_ref,
            job_package_ref: artifact_ref(&package),
            resources: entries,
        };
        Self {
            root,
            environment,
            package,
            materialization,
        }
    }
}

impl Drop for MaterializationFixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn write_resource(
    root: &Path,
    scope: ExecutorResourceScope,
    name: &str,
    entries: &mut Vec<ExecutorMaterializationEntry>,
) -> DigestResource {
    let scope_path = match scope {
        ExecutorResourceScope::Environment => "environment",
        ExecutorResourceScope::Job => "job",
    };
    let relative_path = format!("{scope_path}/{name}");
    let bytes = format!("frozen-{scope_path}-{name}").into_bytes();
    fs::write(root.join(&relative_path), &bytes).expect("resource");
    let sha256 = format!("{:x}", Sha256::digest(&bytes));
    let uri = format!("https://artifacts.example/{scope_path}/{name}");
    entries.push(ExecutorMaterializationEntry {
        scope,
        name: name.to_owned(),
        uri: uri.clone(),
        relative_path,
    });
    DigestResource {
        name: name.to_owned(),
        uri,
        sha256,
        size_bytes: bytes.len() as u64,
    }
}

fn conformance_fixture(
    signing_key: &SigningKey,
) -> (
    ExecutorEnvironmentManifest,
    ExecutorConformanceSuite,
    TrustedAttestationKey,
    ExecutorConformanceReport,
) {
    let suite = ExecutorConformanceSuite {
        schema: "ilxyr.executor_conformance_suite.v1".to_owned(),
        id: "conformance://cenetex/public-v1/test".to_owned(),
        environment_id: "environment://cenetex/public-v1/test".to_owned(),
        tests: vec![
            ExecutorConformanceTest {
                name: "digest-drift-fails-closed".to_owned(),
                execution_class: ConformanceExecutionClass::Offline,
                requirement: "Changed artifact bytes are rejected before launch.".to_owned(),
            },
            ExecutorConformanceTest {
                name: "guest-network-denied".to_owned(),
                execution_class: ConformanceExecutionClass::LinuxMicrovm,
                requirement: "The guest cannot reach any network destination.".to_owned(),
            },
        ],
    };
    let suite_bytes = Workspace::canonical_json_bytes(&suite).expect("canonical suite");
    let suite_resource = DigestResource {
        name: "conformance-suite".to_owned(),
        uri: "https://artifacts.example/conformance-suite.json".to_owned(),
        sha256: Workspace::digest(&suite).expect("suite digest"),
        size_bytes: suite_bytes.len() as u64,
    };
    let environment = ExecutorEnvironmentManifest {
        schema: "ilxyr.executor_environment.v1".to_owned(),
        id: suite.environment_id.clone(),
        operator: ActorRef::service(OPERATOR_ID),
        source: SourceRelease {
            repository: "https://github.com/cenetex/ilXyr".to_owned(),
            commit: "1".repeat(40),
            archive: dummy_resource("source-archive", 'a'),
        },
        build_recipe: dummy_resource("build-recipe", 'b'),
        runner: dummy_resource("runner", 'c'),
        kernel: dummy_resource("kernel", 'd'),
        rootfs: dummy_resource("rootfs", 'e'),
        sbom: dummy_resource("sbom", 'f'),
        provenance: dummy_resource("provenance", '1'),
        isolation: isolation(),
        capabilities: capabilities(),
        conformance_suite: suite_resource,
    };
    let environment_ref = verify_environment_manifest(&environment).expect("environment");
    let suite_ref = verify_conformance_suite(&environment, &suite).expect("suite");
    let tests = suite
        .tests
        .iter()
        .enumerate()
        .map(|(index, test)| ExecutorConformanceTestResult {
            name: test.name.clone(),
            status: ConformanceTestStatus::Pass,
            evidence_ref: artifact_ref(&json!({"evidence": index})),
        })
        .collect();
    let mut report = ExecutorConformanceReport {
        schema: "ilxyr.executor_conformance_report.v1".to_owned(),
        environment_ref,
        suite_ref,
        runner: ActorRef::service(RUNNER_ID),
        started_at_ms: 1_000,
        completed_at_ms: 2_000,
        passed: true,
        tests,
        attestation: DsseEnvelope {
            payload_type: PAYLOAD_TYPE.to_owned(),
            payload: String::new(),
            signatures: vec![],
        },
    };
    let body_ref = conformance_body_ref(&report);
    let statement = conformance_statement(&report, &body_ref, RUNNER_ID);
    report.attestation = signed_envelope(signing_key, RUNNER_KEY_ID, &statement);
    let trusted_key = trusted_key_for(signing_key, RUNNER_KEY_ID, RUNNER_ID);
    (environment, suite, trusted_key, report)
}

fn conformance_body_ref(report: &ExecutorConformanceReport) -> String {
    artifact_ref(&json!({
        "schema": report.schema,
        "environment_ref": report.environment_ref,
        "suite_ref": report.suite_ref,
        "runner": report.runner,
        "started_at_ms": report.started_at_ms,
        "completed_at_ms": report.completed_at_ms,
        "passed": report.passed,
        "tests": report.tests,
    }))
}

fn conformance_statement(
    report: &ExecutorConformanceReport,
    body_ref: &str,
    builder_id: &str,
) -> Value {
    json!({
        "_type": "https://in-toto.io/Statement/v1",
        "subject": [{
            "name": "ilxyr executor conformance report body",
            "digest": {
                "sha256": body_ref
                    .strip_prefix("artifact://sha256/")
                    .expect("body ref digest")
            }
        }],
        "predicateType": "https://slsa.dev/provenance/v1",
        "predicate": {
            "buildDefinition": {
                "buildType": "https://ilxyr.dev/buildtypes/executor-conformance/v1",
                "externalParameters": {
                    "ilxyrRunRef": body_ref,
                    "ilxyrEnvironmentRef": report.environment_ref,
                    "ilxyrSuiteRef": report.suite_ref
                },
                "resolvedDependencies": []
            },
            "runDetails": {
                "builder": {"id": builder_id},
                "metadata": {"invocationId": body_ref}
            }
        }
    })
}

fn signed_envelope(signing_key: &SigningKey, key_id: &str, statement: &Value) -> DsseEnvelope {
    let payload = serde_json::to_vec(statement).expect("statement");
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
        public_key: STANDARD.encode(signing_key.verifying_key().to_bytes()),
        trusted_at_ms: 1,
    }
}

fn isolation() -> IsolationProfile {
    IsolationProfile {
        boundary: "firecracker_microvm".to_owned(),
        one_job_per_vm: true,
        read_only_rootfs: true,
        host_mounts: false,
        interactive_access: false,
        metadata_service_in_guest: false,
        signing_key_in_guest: false,
        reporting_outside_guest: true,
    }
}

fn capabilities() -> EnvironmentCapabilities {
    EnvironmentCapabilities {
        weight_classes: vec![WeightClass::Public],
        network_modes: vec![ExecutionNetworkMode::Denied],
        export_policies: vec![ExportPolicy::MetricsOnly],
    }
}

fn dummy_resource(name: &str, character: char) -> DigestResource {
    DigestResource {
        name: name.to_owned(),
        uri: format!("https://artifacts.example/{name}"),
        sha256: character.to_string().repeat(64),
        size_bytes: 1,
    }
}

fn artifact_ref<T: Serialize>(value: &T) -> String {
    format!(
        "artifact://sha256/{}",
        Workspace::digest(value).expect("artifact digest")
    )
}

fn unique_temp_dir(label: &str) -> std::path::PathBuf {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let root = std::env::temp_dir().join(format!(
        "ilxyr-reference-{label}-{}-{nonce}-{}",
        std::process::id(),
        TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir(&root).expect("temp root");
    root
}
