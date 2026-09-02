use std::{
    cell::RefCell,
    collections::VecDeque,
    fs,
    path::PathBuf,
    process,
    rc::Rc,
    sync::atomic::{AtomicU64, Ordering},
};

use ilxyr_aws::{
    AWS_ADAPTER_ID, AwsCliAdapter, AwsCommandOutput, AwsCommandRunner, AwsLauncherConfig,
    AwsPriceEvidence,
};
use ilxyr_core::{
    ActorRef, AllocationPolicy, BudgetPolicy, DigestResource, EnvironmentCapabilities,
    ExecutionNetworkMode, ExecutionReport, ExecutorEnvironmentManifest, ExecutorJobPackage,
    ExportPolicy, IsolationProfile, ProviderBinding, RemoteExecutionState, RemoteExecutorAdapter,
    RemoteLaunchReceipt, RemoteLaunchRequest, ReportingPolicy, SourceRelease, WeightClass,
    Workspace, preflight_remote_execution,
};
use serde::Serialize;
use serde_json::json;
use sha2::{Digest, Sha256};

static UNIQUE: AtomicU64 = AtomicU64::new(0);

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn create() -> Self {
        let nonce = UNIQUE.fetch_add(1, Ordering::Relaxed);
        let path =
            std::env::temp_dir().join(format!("ilxyr-aws-adapter-{}-{nonce}", process::id()));
        fs::create_dir_all(&path).expect("test directory is created");
        Self(path)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[derive(Clone, Default)]
struct ScriptedAws {
    state: Rc<RefCell<ScriptedState>>,
}

#[derive(Default)]
struct ScriptedState {
    outputs: VecDeque<AwsCommandOutput>,
    calls: Vec<RecordedCall>,
}

#[derive(Debug)]
struct RecordedCall {
    args: Vec<String>,
    stdin: Option<Vec<u8>>,
}

impl ScriptedAws {
    fn from_outputs(outputs: impl IntoIterator<Item = AwsCommandOutput>) -> Self {
        Self {
            state: Rc::new(RefCell::new(ScriptedState {
                outputs: outputs.into_iter().collect(),
                calls: Vec::new(),
            })),
        }
    }

    fn calls(&self) -> Vec<(Vec<String>, Option<Vec<u8>>)> {
        self.state
            .borrow()
            .calls
            .iter()
            .map(|call| (call.args.clone(), call.stdin.clone()))
            .collect()
    }
}

impl AwsCommandRunner for ScriptedAws {
    fn run(
        &mut self,
        args: &[String],
        stdin: Option<&[u8]>,
    ) -> ilxyr_core::Result<AwsCommandOutput> {
        let mut state = self.state.borrow_mut();
        state.calls.push(RecordedCall {
            args: args.to_vec(),
            stdin: stdin.map(<[u8]>::to_vec),
        });
        state.outputs.pop_front().ok_or_else(|| {
            ilxyr_core::Error::Execution("test AWS response queue is empty".to_owned())
        })
    }
}

struct Fixture {
    _directory: TestDirectory,
    environment: ExecutorEnvironmentManifest,
    package: ExecutorJobPackage,
    config: AwsLauncherConfig,
}

impl Fixture {
    fn new() -> Self {
        let directory = TestDirectory::create();
        let bootstrap = b"#!/bin/sh\nset -eu\n";
        let bootstrap_path = directory.0.join("bootstrap.sh");
        fs::write(&bootstrap_path, bootstrap).expect("bootstrap fixture is written");
        let executor = ActorRef::service("service://cenetex/executor/aws-v1");
        let environment = environment(executor.clone());
        let mut package = package(&environment, bootstrap);
        let price = AwsPriceEvidence {
            schema: "ilxyr.aws_price_evidence.v1".to_owned(),
            region: "us-east-1".to_owned(),
            machine_type: "c6i.4xlarge".to_owned(),
            hourly_price_microusd: 680_000,
            fixed_cost_microusd: 0,
            minimum_billed_seconds: 60,
            source_url: "https://aws.amazon.com/ec2/pricing/on-demand/".to_owned(),
            recorded_at_ms: 1,
        };
        let price_bytes = serde_json::to_vec(&price).expect("price serializes");
        let price_path = directory.0.join("price.json");
        fs::write(&price_path, &price_bytes).expect("price fixture is written");
        package.budget.price_evidence.sha256 = sha256_hex(&price_bytes);
        package.budget.price_evidence.size_bytes = price_bytes.len() as u64;
        let package_digest = Workspace::digest(&package).expect("package hashes");
        let config = AwsLauncherConfig {
            schema: "ilxyr.aws_launcher.v1".to_owned(),
            executor,
            account_id: "123456789012".to_owned(),
            region: "us-east-1".to_owned(),
            subnet_id: "subnet-0123abcd".to_owned(),
            security_group_ids: vec!["sg-0123abcd".to_owned()],
            iam_instance_profile: "ilxyr-executor-v1".to_owned(),
            root_device_name: "/dev/sda1".to_owned(),
            bootstrap_script: bootstrap_path,
            package_bucket: "ilxyr-packages-example".to_owned(),
            package_key: format!("packages/toy.remote.v1/{package_digest}.json"),
            result_bucket: "ilxyr-results-example".to_owned(),
            result_prefix: "runs/toy.remote.v1".to_owned(),
            price_evidence_file: price_path,
        };
        Self {
            _directory: directory,
            environment,
            package,
            config,
        }
    }
}

#[test]
fn stage_and_preflight_bind_the_exact_aws_request() {
    let fixture = Fixture::new();
    let stage_runner = ScriptedAws::from_outputs([success_bytes(Vec::new())]);
    let mut stage_adapter =
        AwsCliAdapter::with_runner(fixture.config.clone(), stage_runner.clone())
            .expect("config is valid");
    let staged = stage_adapter
        .stage_job_package(&fixture.environment, &fixture.package)
        .expect("package stages");
    assert_eq!(staged.job_package_ref, artifact_ref(&fixture.package));
    let stage_calls = stage_runner.calls();
    assert_eq!(stage_calls.len(), 1);
    assert_eq!(stage_calls[0].0[0..3], ["s3", "cp", "-"]);
    assert_eq!(
        stage_calls[0].1.as_deref(),
        Some(
            Workspace::canonical_json_bytes(&fixture.package)
                .expect("package is canonical")
                .as_slice()
        )
    );

    let package_bytes = Workspace::canonical_json_bytes(&fixture.package).expect("canonical JSON");
    let package_digest = Workspace::digest(&fixture.package).expect("package hashes");
    let preflight_runner = ScriptedAws::from_outputs([
        success_json(json!({"Account":"123456789012","Arn":"arn:aws:iam::123456789012:user/ci"})),
        success_json(json!({"Images":[{
            "ImageId":fixture.package.provider.image_id,
            "State":"available",
            "Architecture":fixture.package.provider.architecture,
            "RootDeviceName":fixture.config.root_device_name,
            "Tags":[{"Key":"IlxyrImageSha256","Value":fixture.package.provider.image_sha256}]
        }]})),
        success_json(json!({"InstanceTypes":[{
            "InstanceType":fixture.package.provider.machine_type,
            "ProcessorInfo":{"SupportedArchitectures":[fixture.package.provider.architecture]}
        }]})),
        success_json(
            json!({"Subnets":[{"SubnetId":fixture.config.subnet_id,"State":"available"}]}),
        ),
        success_json(json!({"SecurityGroups":[{"GroupId":fixture.config.security_group_ids[0]}]})),
        success_json(
            json!({"InstanceProfile":{"InstanceProfileName":fixture.config.iam_instance_profile}}),
        ),
        success_json(json!({
            "ContentLength":package_bytes.len(),
            "Metadata":{"ilxyr-sha256":package_digest}
        })),
        success_bytes(Vec::new()),
        AwsCommandOutput {
            status: 255,
            stdout: Vec::new(),
            stderr: b"An error occurred (DryRunOperation): Request would have succeeded".to_vec(),
        },
    ]);
    let mut adapter = AwsCliAdapter::with_runner(fixture.config.clone(), preflight_runner.clone())
        .expect("config is valid");
    let receipt = preflight_remote_execution(&mut adapter, &fixture.environment, &fixture.package)
        .expect("AWS dry-run preflight succeeds");
    assert_eq!(receipt.adapter, AWS_ADAPTER_ID);
    assert_eq!(receipt.job_package_ref, artifact_ref(&fixture.package));

    let calls = preflight_runner.calls();
    assert_eq!(calls.len(), 9);
    let launch = &calls[8].0;
    assert!(launch.iter().any(|argument| argument == "--dry-run"));
    assert!(launch.iter().any(|argument| argument == "terminate"));
    assert!(
        launch
            .iter()
            .any(|argument| argument.contains("HttpTokens=required"))
    );
    assert!(
        launch
            .iter()
            .any(|argument| argument.contains("AssociatePublicIpAddress\":false"))
    );
    let token = option_value(launch, "--client-token");
    assert!(token.starts_with("ilxyr-"));
    assert_eq!(token.len(), 64);
    let tags = option_value(launch, "--tag-specifications");
    assert!(tags.contains("JobPackageRef"));
    assert!(tags.contains("MaxRuntimeSeconds"));
}

#[test]
fn launch_observe_and_collect_use_one_bound_instance() {
    let fixture = Fixture::new();
    let request = launch_request(&fixture);
    let launch_runner = ScriptedAws::from_outputs([
        success_json(json!({"Instances":[{
            "InstanceId":"i-0123456789abcdef0",
            "ImageId":fixture.package.provider.image_id,
            "InstanceType":fixture.package.provider.machine_type,
            "SubnetId":fixture.config.subnet_id,
            "LaunchTime":"2026-09-02T00:00:00+00:00"
        }]})),
        success_bytes(Vec::new()),
    ]);
    let mut launch_adapter =
        AwsCliAdapter::with_runner(fixture.config.clone(), launch_runner.clone())
            .expect("config is valid");
    let provider_receipt = launch_adapter
        .launch(&request, &fixture.environment, &fixture.package)
        .expect("one instance launches");
    assert_eq!(provider_receipt.provider_instance_id, "i-0123456789abcdef0");
    assert_eq!(provider_receipt.launched_at_ms, 1_788_307_200_000);
    let launch_args = &launch_runner.calls()[0].0;
    assert!(!launch_args.iter().any(|argument| argument == "--dry-run"));
    assert_eq!(option_value(launch_args, "--count"), "1");
    assert_eq!(
        option_value(launch_args, "--user-data"),
        "#!/bin/sh\nset -eu\n"
    );

    let receipt = remote_receipt(&fixture, &request, provider_receipt.launched_at_ms);
    launch_adapter
        .publish_launch_receipt(&receipt)
        .expect("launch receipt is published");
    let published = &launch_runner.calls()[1];
    assert!(
        published
            .0
            .iter()
            .any(|value| value.ends_with("/launch-receipt.json"))
    );
    assert_eq!(
        published.1.as_deref(),
        Some(
            Workspace::canonical_json_bytes(&receipt)
                .expect("receipt serializes")
                .as_slice()
        )
    );
    let status = json!({
        "schema":"ilxyr.aws_execution_status.v1",
        "provider_instance_id":receipt.provider_instance_id,
        "authorization_ref":receipt.authorization_ref,
        "job_package_ref":receipt.job_package_ref,
        "state":"succeeded",
        "updated_at_ms":provider_receipt.launched_at_ms + 1_000
    });
    let observe_runner = ScriptedAws::from_outputs([success_json(status.clone())]);
    let mut observe_adapter = AwsCliAdapter::with_runner(fixture.config.clone(), observe_runner)
        .expect("config is valid");
    let observation = observe_adapter
        .observe(&receipt)
        .expect("status is observed");
    assert_eq!(observation.state, RemoteExecutionState::Succeeded);

    let mut report: ExecutionReport = serde_json::from_str(include_str!(
        "../../../examples/schema/execution-report.json"
    ))
    .expect("report fixture parses");
    report.job_package_ref = receipt.job_package_ref.clone();
    report.authorization_ref = receipt.authorization_ref.clone();
    report.launch_ref = artifact_ref(&receipt);
    report.environment_ref = receipt.environment_ref.clone();
    report.executor = receipt.executor.clone();
    report.provider_instance_id = receipt.provider_instance_id.clone();
    report.machine_image_id = receipt.provider.image_id.clone();
    report.machine_image_sha256 = receipt.provider.image_sha256.clone();
    let report_bytes = serde_json::to_vec(&report).expect("report serializes");
    let collect_runner =
        ScriptedAws::from_outputs([success_json(status), success_bytes(report_bytes)]);
    let mut collect_adapter =
        AwsCliAdapter::with_runner(fixture.config.clone(), collect_runner.clone())
            .expect("config is valid");
    let collected = collect_adapter
        .collect(&receipt, &fixture.environment, &fixture.package)
        .expect("signed report is collected");
    assert_eq!(collected.provider_instance_id, receipt.provider_instance_id);
    let calls = collect_runner.calls();
    assert!(
        calls[0]
            .0
            .iter()
            .any(|value| value.ends_with("/status.json"))
    );
    assert!(
        calls[1]
            .0
            .iter()
            .any(|value| value.ends_with("/execution-report.json"))
    );
}

#[test]
fn observation_uses_ec2_state_while_the_status_record_is_pending() {
    let fixture = Fixture::new();
    let request = launch_request(&fixture);
    let receipt = remote_receipt(&fixture, &request, 1);
    let runner = ScriptedAws::from_outputs([
        AwsCommandOutput {
            status: 1,
            stdout: Vec::new(),
            stderr: b"An error occurred (NoSuchKey)".to_vec(),
        },
        success_json(json!({"Reservations":[{"Instances":[{
            "InstanceId":receipt.provider_instance_id,
            "ImageId":fixture.package.provider.image_id,
            "InstanceType":fixture.package.provider.machine_type,
            "State":{"Name":"running"}
        }]}]})),
    ]);
    let mut adapter = AwsCliAdapter::with_runner(fixture.config, runner).expect("config is valid");
    let observation = adapter.observe(&receipt).expect("EC2 state is observed");
    assert_eq!(observation.state, RemoteExecutionState::Running);
}

#[test]
fn preflight_stops_before_aws_when_the_frozen_cost_is_too_low() {
    let mut fixture = Fixture::new();
    fixture.package.budget.max_cost_microusd = 1;
    fixture.config.package_key = format!(
        "packages/toy.remote.v1/{}.json",
        Workspace::digest(&fixture.package).expect("package hashes")
    );
    let runner = ScriptedAws::default();
    let mut adapter =
        AwsCliAdapter::with_runner(fixture.config, runner.clone()).expect("config is valid");
    let error = preflight_remote_execution(&mut adapter, &fixture.environment, &fixture.package)
        .expect_err("cost ceiling rejects the run");
    assert!(error.to_string().contains("exceeds the frozen limit"));
    assert!(runner.calls().is_empty());
}

#[test]
fn preflight_checks_the_price_file_digest_before_using_its_rate() {
    let fixture = Fixture::new();
    let bytes = fs::read(&fixture.config.price_evidence_file).expect("price file is read");
    let mut price: AwsPriceEvidence = serde_json::from_slice(&bytes).expect("price parses");
    price.hourly_price_microusd = 1;
    fs::write(
        &fixture.config.price_evidence_file,
        serde_json::to_vec(&price).expect("price serializes"),
    )
    .expect("tampered price is written");
    let runner = ScriptedAws::default();
    let mut adapter =
        AwsCliAdapter::with_runner(fixture.config, runner.clone()).expect("config is valid");
    let error = preflight_remote_execution(&mut adapter, &fixture.environment, &fixture.package)
        .expect_err("price drift stops preflight");
    assert!(error.to_string().contains("frozen price evidence"));
    assert!(runner.calls().is_empty());
}

#[test]
fn projected_cost_includes_the_watchdog_grace_period() {
    let mut fixture = Fixture::new();
    fixture.package.budget.max_cost_microusd = 115_000;
    fixture.config.package_key = format!(
        "packages/toy.remote.v1/{}.json",
        Workspace::digest(&fixture.package).expect("package hashes")
    );
    let runner = ScriptedAws::default();
    let mut adapter =
        AwsCliAdapter::with_runner(fixture.config, runner.clone()).expect("config is valid");
    let error = preflight_remote_execution(&mut adapter, &fixture.environment, &fixture.package)
        .expect_err("grace time stays inside the cost check");
    assert!(error.to_string().contains("119000 microusd"));
    assert!(runner.calls().is_empty());
}

#[test]
fn preflight_stops_when_the_ami_digest_tag_has_drifted() {
    let fixture = Fixture::new();
    let runner = ScriptedAws::from_outputs([
        success_json(json!({
            "Account":"123456789012",
            "Arn":"arn:aws:iam::123456789012:user/ci"
        })),
        success_json(json!({"Images":[{
            "ImageId":fixture.package.provider.image_id,
            "State":"available",
            "Architecture":fixture.package.provider.architecture,
            "RootDeviceName":fixture.config.root_device_name,
            "Tags":[{"Key":"IlxyrImageSha256","Value":"f".repeat(64)}]
        }]})),
    ]);
    let mut adapter =
        AwsCliAdapter::with_runner(fixture.config, runner.clone()).expect("config is valid");
    let error = preflight_remote_execution(&mut adapter, &fixture.environment, &fixture.package)
        .expect_err("AMI drift stops preflight");
    assert!(error.to_string().contains("frozen machine identity"));
    assert_eq!(runner.calls().len(), 2);
}

#[test]
fn collection_applies_the_frozen_report_size_limit() {
    let mut fixture = Fixture::new();
    fixture.package.reporting.max_report_bytes = 16;
    let request = launch_request(&fixture);
    let receipt = remote_receipt(&fixture, &request, 1);
    let runner = ScriptedAws::from_outputs([
        success_json(json!({
            "schema":"ilxyr.aws_execution_status.v1",
            "provider_instance_id":receipt.provider_instance_id,
            "authorization_ref":receipt.authorization_ref,
            "job_package_ref":receipt.job_package_ref,
            "state":"succeeded",
            "updated_at_ms":2
        })),
        success_bytes(vec![b'0'; 17]),
    ]);
    let mut adapter = AwsCliAdapter::with_runner(fixture.config, runner).expect("config is valid");
    let error = adapter
        .collect(&receipt, &fixture.environment, &fixture.package)
        .expect_err("oversized report stops collection");
    assert!(error.to_string().contains("size limit"));
}

fn environment(executor: ActorRef) -> ExecutorEnvironmentManifest {
    ExecutorEnvironmentManifest {
        schema: "ilxyr.executor_environment.v1".to_owned(),
        id: "environment://cenetex/aws-test-v1".to_owned(),
        operator: executor,
        source: SourceRelease {
            repository: "https://github.com/cenetex/ilXyr".to_owned(),
            commit: "1".repeat(40),
            archive: resource("source", '1'),
        },
        build_recipe: resource("build", '2'),
        runner: resource("runner", '3'),
        kernel: resource("kernel", '4'),
        rootfs: resource("rootfs", '5'),
        sbom: resource("sbom", '6'),
        provenance: resource("provenance", '7'),
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
        conformance_suite: resource("conformance", '8'),
    }
}

fn package(environment: &ExecutorEnvironmentManifest, bootstrap: &[u8]) -> ExecutorJobPackage {
    ExecutorJobPackage {
        schema: "ilxyr.executor_job_package.v1".to_owned(),
        experiment_id: "toy.remote.v1".to_owned(),
        compiled_ref: format!("artifact://sha256/{}", "9".repeat(64)),
        environment_ref: artifact_ref(environment),
        inputs: vec![resource("dataset", 'a')],
        executable: resource("executable", 'b'),
        arguments: vec!["--seed".to_owned(), "7".to_owned()],
        oracle: resource("oracle", 'c'),
        harness: DigestResource {
            name: "bootstrap".to_owned(),
            uri: "file:///opt/ilxyr/bootstrap.sh".to_owned(),
            sha256: sha256_hex(bootstrap),
            size_bytes: bootstrap.len() as u64,
        },
        provider: ProviderBinding {
            provider: "aws".to_owned(),
            region: "us-east-1".to_owned(),
            machine_type: "c6i.4xlarge".to_owned(),
            architecture: "x86_64".to_owned(),
            image_id: "ami-0123abcd".to_owned(),
            image_sha256: "d".repeat(64),
            storage_gib: 20,
        },
        budget: BudgetPolicy {
            max_runtime_seconds: 600,
            max_cost_microusd: 2_000_000,
            price_evidence: resource("price", 'e'),
            watchdog_grace_seconds: 30,
        },
        targets: vec!["seed:7".to_owned()],
        expected_outputs: vec!["metrics.score".to_owned()],
        allocation: AllocationPolicy {
            concurrency: 1,
            retry_limit: 1,
            failure_policy: "fail_closed".to_owned(),
        },
        network: ExecutionNetworkMode::Denied,
        allowed_hosts: Vec::new(),
        export_policy: ExportPolicy::MetricsOnly,
        weight_class: WeightClass::Public,
        expected_executor: environment.operator.clone(),
        reporting: ReportingPolicy {
            endpoint: "https://submit.ilxyr.example/v1/reports".to_owned(),
            protocol: "ilxyr.execution_report.v1".to_owned(),
            max_report_bytes: 1_048_576,
            expected_verifier: "service://ilxyr/report-verifier-v1".to_owned(),
        },
    }
}

fn launch_request(fixture: &Fixture) -> RemoteLaunchRequest {
    RemoteLaunchRequest {
        schema: "ilxyr.remote_launch_request.v1".to_owned(),
        authorization_ref: format!("artifact://sha256/{}", "0".repeat(64)),
        reservation_ref: format!("artifact://sha256/{}", "1".repeat(64)),
        environment_ref: artifact_ref(&fixture.environment),
        job_package_ref: artifact_ref(&fixture.package),
        idempotency_key: format!("ilxyr-{}", "2".repeat(64)),
        reserved_at_ms: 1,
    }
}

fn remote_receipt(
    fixture: &Fixture,
    request: &RemoteLaunchRequest,
    launched_at_ms: u128,
) -> RemoteLaunchReceipt {
    RemoteLaunchReceipt {
        schema: "ilxyr.remote_launch_receipt.v1".to_owned(),
        id: "remote-launch:test".to_owned(),
        adapter: AWS_ADAPTER_ID.to_owned(),
        executor: fixture.config.executor.clone(),
        authorization_ref: request.authorization_ref.clone(),
        reservation_ref: request.reservation_ref.clone(),
        environment_ref: request.environment_ref.clone(),
        job_package_ref: request.job_package_ref.clone(),
        provider: fixture.package.provider.clone(),
        provider_instance_id: "i-0123456789abcdef0".to_owned(),
        launched_at_ms,
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

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn success_json(value: serde_json::Value) -> AwsCommandOutput {
    success_bytes(serde_json::to_vec(&value).expect("AWS fixture serializes"))
}

fn success_bytes(stdout: Vec<u8>) -> AwsCommandOutput {
    AwsCommandOutput {
        status: 0,
        stdout,
        stderr: Vec::new(),
    }
}

fn option_value<'a>(args: &'a [String], option: &str) -> &'a str {
    let index = args
        .iter()
        .position(|argument| argument == option)
        .expect("option is present");
    args.get(index + 1).expect("option has a value")
}
