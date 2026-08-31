use std::{
    collections::BTreeMap,
    fs,
    path::PathBuf,
    process,
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signer, SigningKey};
use ilxyr_core::{
    AcceptedRemoteReport, ActorKind, ActorRef, AllocationPolicy, BudgetPolicy, CodePolicy,
    DigestResource, DsseEnvelope, DsseSignature, EnvironmentCapabilities, EpochBudget,
    ExecutionNetworkMode, ExecutionReport, ExecutorEnvironmentManifest, ExecutorJobPackage,
    ExportPolicy, Forecast, IsolationProfile, NetworkPolicy, ProviderBinding,
    ProviderLaunchReceipt, RemoteExecutionObservation, RemoteExecutionState, RemoteExecutorAdapter,
    RemoteLaunchReceipt, RemoteLaunchRequest, RemotePreflightReceipt, ReportingPolicy,
    ResearchContribution, RunRecord, SourceRelease, WeightClass, Workspace,
    accept_remote_execution_report, allocate_epoch, authorize_remote_execution,
    collect_remote_execution_report, compile_experiment, dsse_pae, epoch_budget_signing_payload,
    launch_remote_execution, observe_remote_execution, preflight_remote_execution,
    register_epoch_budget, run_experiment, submit_contribution, submit_forecast,
    trust_attestation_key, trust_policy_key, verify_compiled_job_package,
};
use serde::Serialize;
use serde_json::{Value, json};

const PAYLOAD_TYPE: &str = "application/vnd.in-toto.provenance+json";
const EXECUTOR_ID: &str = "service://cenetex/executor/public-v1";
const KEY_ID: &str = "key://cenetex/executor/public-v1/fake";
const ADAPTER_ID: &str = "fake-provider-v1";
const AUTHORIZATION_ID: &str = "authorization:toy.remote.v1";
const PROGRAM: &str = "/opt/ilxyr/bin/executable";

static UNIQUE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn create() -> Self {
        let nonce = UNIX_EPOCH
            .elapsed()
            .expect("test clock follows Unix epoch")
            .as_nanos()
            + u128::from(UNIQUE.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
        let path =
            std::env::temp_dir().join(format!("ilxyr-remote-adapter-{}-{nonce}", process::id()));
        fs::create_dir_all(&path).expect("test directory is created");
        Self(path)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn fake_adapter_recovers_idempotently_and_intake_is_durable() {
    let fixture = Fixture::new();
    let mut adapter = FakeAdapter::new(true);
    let events_before = fixture.workspace.events().expect("events load").len();
    let preflight =
        preflight_remote_execution(&mut adapter, &fixture.environment, &fixture.package)
            .expect("preflight succeeds");
    assert_eq!(preflight.adapter, ADAPTER_ID);
    assert_eq!(adapter.preflight_calls, 1);
    assert_eq!(adapter.launch_calls, 0);
    assert_eq!(
        fixture.workspace.events().expect("events load").len(),
        events_before
    );

    let authorization = authorize_remote_execution(
        &fixture.workspace,
        &fixture.environment,
        &fixture.package,
        &fixture.budget_id,
        AUTHORIZATION_ID,
        future_expiry(),
    )
    .expect("remote run is authorized by the signed budget");
    assert_eq!(
        authorization.job_package_ref,
        artifact_ref(&fixture.package)
    );

    let lost = launch_remote_execution(&fixture.workspace, &mut adapter, AUTHORIZATION_ID)
        .expect_err("the fake provider loses its first response after launch");
    assert!(
        lost.to_string()
            .contains("simulated provider response loss")
    );
    assert_eq!(adapter.unique_launches(), 1);
    assert_eq!(event_count(&fixture.workspace, "RemoteLaunchReserved"), 1);
    assert_eq!(event_count(&fixture.workspace, "RemoteLaunchRecorded"), 0);

    let receipt = launch_remote_execution(&fixture.workspace, &mut adapter, AUTHORIZATION_ID)
        .expect("retry recovers the same provider launch");
    assert_eq!(adapter.launch_calls, 2);
    assert_eq!(adapter.unique_launches(), 1);
    assert_eq!(event_count(&fixture.workspace, "RemoteLaunchReserved"), 1);
    assert_eq!(event_count(&fixture.workspace, "RemoteLaunchRecorded"), 1);

    let retry = launch_remote_execution(&fixture.workspace, &mut adapter, AUTHORIZATION_ID)
        .expect("recorded launch retry is read-only");
    assert_eq!(retry, receipt);
    assert_eq!(adapter.launch_calls, 2);

    let observation = observe_remote_execution(&fixture.workspace, &mut adapter, AUTHORIZATION_ID)
        .expect("observation succeeds");
    assert_eq!(observation.state, RemoteExecutionState::Succeeded);
    let launch_calls_before_collect = adapter.launch_calls;
    let report =
        collect_remote_execution_report(&fixture.workspace, &mut adapter, AUTHORIZATION_ID)
            .expect("collection succeeds");
    assert_eq!(adapter.launch_calls, launch_calls_before_collect);
    assert_eq!(adapter.collect_calls, 1);

    let mut unsigned_tamper = report.clone();
    unsigned_tamper.outputs[0].sha256 = "0".repeat(64);
    let error = accept_remote_execution_report(&fixture.workspace, &unsigned_tamper)
        .expect_err("unsigned output mutation is rejected");
    assert!(error.to_string().contains("ilxyrOutputsRef"));
    assert_eq!(event_count(&fixture.workspace, "RemoteReportAccepted"), 0);

    let accepted = accept_remote_execution_report(&fixture.workspace, &report)
        .expect("trusted ledger intake accepts the signed report");
    assert_eq!(accepted.resolved_outcome, "success");
    assert_eq!(accepted.report_ref, artifact_ref(&report));
    assert_eq!(event_count(&fixture.workspace, "RemoteReportAccepted"), 1);
    let event_total = fixture.workspace.events().expect("events load").len();
    let accepted_retry = accept_remote_execution_report(&fixture.workspace, &report)
        .expect("exact report retry is idempotent");
    assert_eq!(accepted_retry.report_ref, accepted.report_ref);
    assert_eq!(
        fixture.workspace.events().expect("events load").len(),
        event_total
    );

    let mut second_report = report;
    second_report.reported_at_ms += 1;
    let error = accept_remote_execution_report(&fixture.workspace, &second_report)
        .expect_err("one launch cannot publish a second report");
    assert!(error.to_string().contains("already bound"));
    assert!(fixture.workspace.verify().expect("ledger verifies").valid);
}

#[test]
fn authorization_rejects_package_drift_expiry_and_a_second_run() {
    let fixture = Fixture::new();
    let mut changed = fixture.package.clone();
    changed.arguments.push("--changed".to_owned());
    let error = verify_compiled_job_package(&fixture.workspace, &fixture.environment, &changed)
        .expect_err("argument drift is rejected");
    assert!(error.to_string().contains("compiled experiment"));

    let expired = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("test clock follows Unix epoch")
        .as_millis();
    let error = authorize_remote_execution(
        &fixture.workspace,
        &fixture.environment,
        &fixture.package,
        &fixture.budget_id,
        "authorization:expired",
        expired,
    )
    .expect_err("expired authorization is rejected");
    assert!(error.to_string().contains("future"));

    let expiry = future_expiry();
    authorize_remote_execution(
        &fixture.workspace,
        &fixture.environment,
        &fixture.package,
        &fixture.budget_id,
        AUTHORIZATION_ID,
        expiry,
    )
    .expect("first authorization succeeds");
    let retry = authorize_remote_execution(
        &fixture.workspace,
        &fixture.environment,
        &fixture.package,
        &fixture.budget_id,
        AUTHORIZATION_ID,
        expiry,
    )
    .expect("exact authorization retry succeeds");
    assert_eq!(retry.id, AUTHORIZATION_ID);
    let error = authorize_remote_execution(
        &fixture.workspace,
        &fixture.environment,
        &fixture.package,
        &fixture.budget_id,
        "authorization:second",
        expiry,
    )
    .expect_err("a second authorization for the experiment is rejected");
    assert!(
        error
            .to_string()
            .contains("already has remote authorization")
    );
    assert!(fixture.workspace.verify().expect("ledger verifies").valid);
}

struct Fixture {
    _directory: TestDirectory,
    workspace: Workspace,
    environment: ExecutorEnvironmentManifest,
    package: ExecutorJobPackage,
    budget_id: String,
}

impl Fixture {
    fn new() -> Self {
        let directory = TestDirectory::create();
        let workspace = Workspace::init(&directory.0).expect("workspace initializes");
        let policy_key = SigningKey::from_bytes(&[61; 32]);
        trust_policy_key(
            &workspace,
            "key://toy/policy-owner/v1",
            ActorRef {
                id: "human://toy/policy-owner".to_owned(),
                kind: ActorKind::Human,
                model_ref: None,
            },
            STANDARD.encode(policy_key.verifying_key().to_bytes()),
        )
        .expect("policy key is trusted");
        let executor_key = SigningKey::from_bytes(&[62; 32]);
        trust_attestation_key(
            &workspace,
            KEY_ID,
            ActorRef::service(EXECUTOR_ID),
            STANDARD.encode(executor_key.verifying_key().to_bytes()),
        )
        .expect("executor key is trusted");
        submit_lineage(&workspace);
        let mut experiment = experiment();
        experiment.execution.executor = "remote-v1".to_owned();
        experiment.execution.program = PROGRAM.to_owned();
        experiment.execution.args = vec!["--frozen".to_owned()];
        experiment.execution.network = NetworkPolicy::Denied;
        experiment.security.code_policy = CodePolicy::ApprovedImageOnly;
        experiment.security.export_policy = ExportPolicy::MetricsOnly;
        let compiled_ref =
            compile_experiment(&workspace, experiment.clone()).expect("experiment compiles");
        submit_forecast(
            &workspace,
            forecast("../../../examples/toy/forecast-model.json"),
        )
        .expect("model forecast is accepted");
        submit_forecast(
            &workspace,
            forecast("../../../examples/toy/forecast-human.json"),
        )
        .expect("human forecast is accepted");

        let mut budget: EpochBudget =
            serde_json::from_str(include_str!("../../../examples/schema/epoch-budget.json"))
                .expect("budget fixture parses");
        let mut cap = budget
            .per_executable_caps
            .remove("/bin/echo")
            .expect("toy cap exists");
        cap.network = NetworkPolicy::Denied;
        cap.allowed_argument_sets = vec![experiment.execution.args.clone()];
        budget.per_executable_caps.insert(PROGRAM.to_owned(), cap);
        budget.allowlisted_executables = vec![PROGRAM.to_owned()];
        budget.signature.value.clear();
        let payload = epoch_budget_signing_payload(&budget).expect("budget payload serializes");
        budget.signature.value = STANDARD.encode(policy_key.sign(&payload).to_bytes());
        let budget_id = budget.id.clone();
        register_epoch_budget(&workspace, budget).expect("budget registers");
        let allocation = allocate_epoch(&workspace, &budget_id, &[experiment.id.clone()])
            .expect("remote experiment allocates through normal policy");
        assert_eq!(allocation.allocated_compute_credits, 10);
        let error = run_experiment(&workspace, &experiment.id)
            .expect_err("the local run path must not dispatch a remote experiment");
        assert!(error.to_string().contains("remote-v1 dispatcher"));
        assert_eq!(event_count(&workspace, "ExecutionStarted"), 0);

        let environment = environment();
        let package = package(&environment, &experiment, compiled_ref);
        verify_compiled_job_package(&workspace, &environment, &package)
            .expect("job package matches the compiled experiment");
        Self {
            _directory: directory,
            workspace,
            environment,
            package,
            budget_id,
        }
    }
}

struct FakeAdapter {
    executor: ActorRef,
    signing_key: SigningKey,
    launches: BTreeMap<String, ProviderLaunchReceipt>,
    fail_after_first_launch: bool,
    preflight_calls: usize,
    launch_calls: usize,
    observe_calls: usize,
    collect_calls: usize,
}

impl FakeAdapter {
    fn new(fail_after_first_launch: bool) -> Self {
        Self {
            executor: ActorRef::service(EXECUTOR_ID),
            signing_key: SigningKey::from_bytes(&[62; 32]),
            launches: BTreeMap::new(),
            fail_after_first_launch,
            preflight_calls: 0,
            launch_calls: 0,
            observe_calls: 0,
            collect_calls: 0,
        }
    }

    fn unique_launches(&self) -> usize {
        self.launches.len()
    }
}

impl RemoteExecutorAdapter for FakeAdapter {
    fn adapter_id(&self) -> &str {
        ADAPTER_ID
    }

    fn executor(&self) -> &ActorRef {
        &self.executor
    }

    fn preflight(
        &mut self,
        environment: &ExecutorEnvironmentManifest,
        package: &ExecutorJobPackage,
    ) -> ilxyr_core::Result<RemotePreflightReceipt> {
        self.preflight_calls += 1;
        Ok(RemotePreflightReceipt {
            schema: "ilxyr.remote_preflight.v1".to_owned(),
            adapter: ADAPTER_ID.to_owned(),
            executor: self.executor.clone(),
            environment_ref: artifact_ref(environment),
            job_package_ref: artifact_ref(package),
            provider: package.provider.clone(),
            checked_at_ms: 1,
        })
    }

    fn launch(
        &mut self,
        request: &RemoteLaunchRequest,
        _environment: &ExecutorEnvironmentManifest,
        package: &ExecutorJobPackage,
    ) -> ilxyr_core::Result<ProviderLaunchReceipt> {
        self.launch_calls += 1;
        if let Some(receipt) = self.launches.get(&request.idempotency_key) {
            return Ok(receipt.clone());
        }
        let receipt = ProviderLaunchReceipt {
            schema: "ilxyr.provider_launch_receipt.v1".to_owned(),
            provider_instance_id: format!("fake-instance-{}", self.launches.len() + 1),
            machine_image_id: package.provider.image_id.clone(),
            machine_image_sha256: package.provider.image_sha256.clone(),
            launched_at_ms: now_ms(),
        };
        self.launches
            .insert(request.idempotency_key.clone(), receipt.clone());
        if self.fail_after_first_launch {
            self.fail_after_first_launch = false;
            return Err(ilxyr_core::Error::Execution(
                "simulated provider response loss".to_owned(),
            ));
        }
        Ok(receipt)
    }

    fn observe(
        &mut self,
        receipt: &RemoteLaunchReceipt,
    ) -> ilxyr_core::Result<RemoteExecutionObservation> {
        self.observe_calls += 1;
        Ok(RemoteExecutionObservation {
            schema: "ilxyr.remote_execution_observation.v1".to_owned(),
            launch_ref: artifact_ref(receipt),
            provider_instance_id: receipt.provider_instance_id.clone(),
            state: RemoteExecutionState::Succeeded,
            observed_at_ms: receipt.launched_at_ms + 2_000,
        })
    }

    fn collect(&mut self, receipt: &RemoteLaunchReceipt) -> ilxyr_core::Result<ExecutionReport> {
        self.collect_calls += 1;
        let run = RunRecord {
            schema: "ilxyr.run.v1".to_owned(),
            id: "run:toy.remote.v1".to_owned(),
            experiment_id: "toy.score.v1".to_owned(),
            started_at_ms: receipt.launched_at_ms,
            completed_at_ms: receipt.launched_at_ms + 1_000,
            exit_code: 0,
            timed_out: false,
            stdout: String::new(),
            stderr: String::new(),
            output_truncated: false,
            output_error: None,
            metrics: BTreeMap::from([("score".to_owned(), 0.82)]),
            source_attestation: None,
        };
        let outputs = vec![resource_with_uri(
            "metrics.score",
            "https://results.example/metrics",
            '9',
        )];
        let mut report = ExecutionReport {
            schema: "ilxyr.execution_report.v1".to_owned(),
            job_package_ref: receipt.job_package_ref.clone(),
            authorization_ref: receipt.authorization_ref.clone(),
            launch_ref: artifact_ref(receipt),
            environment_ref: receipt.environment_ref.clone(),
            executor: receipt.executor.clone(),
            provider_instance_id: receipt.provider_instance_id.clone(),
            machine_image_id: receipt.provider.image_id.clone(),
            machine_image_sha256: receipt.provider.image_sha256.clone(),
            run_ref: artifact_ref(&run),
            run,
            outputs,
            attestation: DsseEnvelope {
                payload_type: PAYLOAD_TYPE.to_owned(),
                payload: String::new(),
                signatures: vec![],
            },
            reported_at_ms: receipt.launched_at_ms + 2_000,
        };
        let statement = remote_statement(&report);
        let payload = serde_json::to_vec(&statement).expect("statement serializes");
        report.attestation = DsseEnvelope {
            payload_type: PAYLOAD_TYPE.to_owned(),
            payload: STANDARD.encode(&payload),
            signatures: vec![DsseSignature {
                keyid: Some(KEY_ID.to_owned()),
                sig: STANDARD.encode(
                    self.signing_key
                        .sign(&dsse_pae(PAYLOAD_TYPE, &payload))
                        .to_bytes(),
                ),
            }],
        };
        Ok(report)
    }
}

fn environment() -> ExecutorEnvironmentManifest {
    ExecutorEnvironmentManifest {
        schema: "ilxyr.executor_environment.v1".to_owned(),
        id: "environment://cenetex/public-v1/fake".to_owned(),
        operator: ActorRef::service(EXECUTOR_ID),
        source: SourceRelease {
            repository: "https://github.com/cenetex/ilXyr".to_owned(),
            commit: "1".repeat(40),
            archive: resource("source-archive", '1'),
        },
        build_recipe: resource("build-recipe", '2'),
        runner: resource("runner", '3'),
        kernel: resource("kernel", '4'),
        rootfs: resource("rootfs", '5'),
        sbom: resource("sbom", '6'),
        provenance: resource("build-provenance", '7'),
        isolation: IsolationProfile {
            boundary: "fake_microvm".to_owned(),
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
        conformance_suite: resource("conformance-suite", '8'),
    }
}

fn package(
    environment: &ExecutorEnvironmentManifest,
    experiment: &ilxyr_core::ExperimentSpec,
    compiled_ref: String,
) -> ExecutorJobPackage {
    ExecutorJobPackage {
        schema: "ilxyr.executor_job_package.v1".to_owned(),
        experiment_id: experiment.id.clone(),
        compiled_ref,
        environment_ref: artifact_ref(environment),
        inputs: vec![
            resource_with_uri("dataset", &experiment.datasets[0], 'c'),
            resource_with_uri("model", &experiment.models[0], 'd'),
        ],
        executable: resource_with_uri("executable", PROGRAM, 'e'),
        arguments: experiment.execution.args.clone(),
        oracle: resource("oracle", 'f'),
        harness: resource("harness", '1'),
        provider: ProviderBinding {
            provider: "fake".to_owned(),
            region: "local-test-1".to_owned(),
            machine_type: "fake-1".to_owned(),
            architecture: "x86_64".to_owned(),
            image_id: "fake-image-immutable".to_owned(),
            image_sha256: "2".repeat(64),
            storage_gib: 8,
        },
        budget: BudgetPolicy {
            max_runtime_seconds: experiment.execution.timeout_seconds,
            max_cost_microusd: 1,
            price_evidence: resource("price-evidence", '3'),
            watchdog_grace_seconds: 1,
        },
        targets: experiment
            .seeds
            .iter()
            .map(|seed| format!("seed:{seed}"))
            .collect(),
        expected_outputs: vec![format!(
            "metrics.{}",
            experiment.outcome_contract.primary_metric
        )],
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
    }
}

fn submit_lineage(workspace: &Workspace) {
    for contribution in [
        contribution("../../../examples/toy/hypothesis.json"),
        contribution("../../../examples/toy/foundation.json"),
        contribution("../../../examples/toy/engineering-review.json"),
        contribution("../../../examples/toy/experiment-design.json"),
    ] {
        submit_contribution(workspace, contribution).expect("contribution is accepted");
    }
}

fn contribution(path: &str) -> ResearchContribution {
    let contents = match path {
        "../../../examples/toy/hypothesis.json" => {
            include_str!("../../../examples/toy/hypothesis.json")
        }
        "../../../examples/toy/foundation.json" => {
            include_str!("../../../examples/toy/foundation.json")
        }
        "../../../examples/toy/engineering-review.json" => {
            include_str!("../../../examples/toy/engineering-review.json")
        }
        _ => include_str!("../../../examples/toy/experiment-design.json"),
    };
    serde_json::from_str(contents).expect("contribution fixture parses")
}

fn experiment() -> ilxyr_core::ExperimentSpec {
    serde_json::from_str(include_str!("../../../examples/toy/experiment.json"))
        .expect("experiment fixture parses")
}

fn forecast(path: &str) -> Forecast {
    let contents = if path.ends_with("forecast-model.json") {
        include_str!("../../../examples/toy/forecast-model.json")
    } else {
        include_str!("../../../examples/toy/forecast-human.json")
    };
    serde_json::from_str(contents).expect("forecast fixture parses")
}

fn remote_statement(report: &ExecutionReport) -> Value {
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
                    "ilxyrRunRef": report.run_ref,
                    "ilxyrJobPackageRef": report.job_package_ref,
                    "ilxyrEnvironmentRef": report.environment_ref,
                    "ilxyrAuthorizationRef": report.authorization_ref,
                    "ilxyrLaunchRef": report.launch_ref,
                    "ilxyrOutputsRef": artifact_ref(&report.outputs),
                    "ilxyrProviderInstanceId": report.provider_instance_id,
                    "ilxyrMachineImageId": report.machine_image_id,
                    "ilxyrMachineImageSha256": report.machine_image_sha256
                },
                "resolvedDependencies": []
            },
            "runDetails": {
                "builder": {"id": EXECUTOR_ID},
                "metadata": {"invocationId": report.launch_ref}
            }
        }
    })
}

fn resource(name: &str, digit: char) -> DigestResource {
    resource_with_uri(name, &format!("https://artifacts.example/{name}"), digit)
}

fn resource_with_uri(name: &str, uri: &str, digit: char) -> DigestResource {
    DigestResource {
        name: name.to_owned(),
        uri: uri.to_owned(),
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

fn event_count(workspace: &Workspace, event_type: &str) -> usize {
    workspace
        .events()
        .expect("events load")
        .into_iter()
        .filter(|event| event.event_type == event_type)
        .count()
}

fn future_expiry() -> u128 {
    now_ms() + 86_400_000
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("test clock follows Unix epoch")
        .as_millis()
}

#[allow(dead_code)]
fn assert_accepted_type(_: &AcceptedRemoteReport) {}
