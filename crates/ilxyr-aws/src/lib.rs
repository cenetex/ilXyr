use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Read, Write},
    path::PathBuf,
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

use ilxyr_core::{
    ActorKind, ActorRef, Error, ExecutionReport, ExecutorEnvironmentManifest, ExecutorJobPackage,
    ProviderLaunchReceipt, RemoteExecutionObservation, RemoteExecutionState, RemoteExecutorAdapter,
    RemoteLaunchReceipt, RemoteLaunchRequest, RemotePreflightReceipt, Result, Workspace,
    verify_job_package,
};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::json;
use sha2::{Digest, Sha256};

pub const AWS_ADAPTER_ID: &str = "aws-ec2-v1";
const CONFIG_SCHEMA: &str = "ilxyr.aws_launcher.v1";
const STATUS_SCHEMA: &str = "ilxyr.aws_execution_status.v1";
const MAX_USER_DATA_BYTES: usize = 16 * 1024;
const MAX_AWS_RESPONSE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_STATUS_BYTES: u64 = 64 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AwsLauncherConfig {
    pub schema: String,
    pub executor: ActorRef,
    pub account_id: String,
    pub region: String,
    pub subnet_id: String,
    pub security_group_ids: Vec<String>,
    pub iam_instance_profile: String,
    pub root_device_name: String,
    pub bootstrap_script: PathBuf,
    pub package_bucket: String,
    pub package_key: String,
    pub result_bucket: String,
    pub result_prefix: String,
    pub price_evidence_file: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AwsPriceEvidence {
    pub schema: String,
    pub region: String,
    pub machine_type: String,
    pub hourly_price_microusd: u64,
    pub fixed_cost_microusd: u64,
    pub minimum_billed_seconds: u64,
    pub source_url: String,
    pub recorded_at_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct StagedAwsJobPackage {
    pub schema: String,
    pub job_package_ref: String,
    pub bucket: String,
    pub key: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AwsCommandOutput {
    pub status: i32,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

pub trait AwsCommandRunner {
    fn run(&mut self, args: &[String], stdin: Option<&[u8]>) -> Result<AwsCommandOutput>;

    fn run_limited(
        &mut self,
        args: &[String],
        stdin: Option<&[u8]>,
        max_stdout_bytes: u64,
    ) -> Result<AwsCommandOutput> {
        let output = self.run(args, stdin)?;
        if output.stdout.len() as u64 > max_stdout_bytes.min(MAX_AWS_RESPONSE_BYTES) {
            return Err(Error::Security(
                "AWS response exceeds its size limit".to_owned(),
            ));
        }
        Ok(output)
    }
}

#[derive(Debug, Clone)]
pub struct ProcessAwsCli {
    program: PathBuf,
}

impl Default for ProcessAwsCli {
    fn default() -> Self {
        Self {
            program: PathBuf::from("aws"),
        }
    }
}

impl AwsCommandRunner for ProcessAwsCli {
    fn run(&mut self, args: &[String], stdin: Option<&[u8]>) -> Result<AwsCommandOutput> {
        self.run_limited(args, stdin, MAX_AWS_RESPONSE_BYTES)
    }

    fn run_limited(
        &mut self,
        args: &[String],
        stdin: Option<&[u8]>,
        max_stdout_bytes: u64,
    ) -> Result<AwsCommandOutput> {
        let mut command = Command::new(&self.program);
        command
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if stdin.is_some() {
            command.stdin(Stdio::piped());
        }
        let mut child = command.spawn().map_err(|error| {
            Error::Execution(format!(
                "could not start {}: {error}",
                self.program.display()
            ))
        })?;
        if let Some(input) = stdin {
            child
                .stdin
                .take()
                .ok_or_else(|| Error::Execution("AWS CLI stdin was unavailable".to_owned()))?
                .write_all(input)?;
        }
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| Error::Execution("AWS CLI stdout was unavailable".to_owned()))?;
        let mut stderr = child
            .stderr
            .take()
            .ok_or_else(|| Error::Execution("AWS CLI stderr was unavailable".to_owned()))?;
        let max_stdout_bytes = max_stdout_bytes.min(MAX_AWS_RESPONSE_BYTES);
        let (status, stdout, stderr) = std::thread::scope(|scope| -> Result<_> {
            let stderr_reader = scope.spawn(move || -> std::io::Result<Vec<u8>> {
                let mut captured = Vec::new();
                let mut buffer = [0_u8; 8_192];
                loop {
                    let size = stderr.read(&mut buffer)?;
                    if size == 0 {
                        break;
                    }
                    let keep = size.min(65_536_usize.saturating_sub(captured.len()));
                    captured.extend_from_slice(&buffer[..keep]);
                }
                Ok(captured)
            });
            let mut bytes = Vec::new();
            let read_result = stdout.take(max_stdout_bytes + 1).read_to_end(&mut bytes);
            let oversized = bytes.len() as u64 > max_stdout_bytes;
            if read_result.is_err() || oversized {
                let _ = child.kill();
            }
            let status = child.wait()?;
            let stderr = stderr_reader.join().map_err(|_| {
                Error::Execution("AWS error reader stopped unexpectedly".to_owned())
            })??;
            read_result?;
            if oversized {
                return Err(Error::Security(
                    "AWS response exceeds its size limit".to_owned(),
                ));
            }
            Ok((status, bytes, stderr))
        })?;
        Ok(AwsCommandOutput {
            status: status.code().unwrap_or(-1),
            stdout,
            stderr,
        })
    }
}

pub struct AwsCliAdapter<C = ProcessAwsCli> {
    config: AwsLauncherConfig,
    command: C,
}

impl AwsCliAdapter<ProcessAwsCli> {
    pub fn new(config: AwsLauncherConfig) -> Result<Self> {
        Self::with_runner(config, ProcessAwsCli::default())
    }
}

impl<C: AwsCommandRunner> AwsCliAdapter<C> {
    pub fn with_runner(config: AwsLauncherConfig, command: C) -> Result<Self> {
        config.validate()?;
        Ok(Self { config, command })
    }

    pub fn stage_job_package(
        &mut self,
        environment: &ExecutorEnvironmentManifest,
        package: &ExecutorJobPackage,
    ) -> Result<StagedAwsJobPackage> {
        verify_job_package(environment, package)?;
        self.validate_package(package)?;
        let bytes = Workspace::canonical_json_bytes(package)?;
        let digest = Workspace::digest(package)?;
        let destination = self.package_uri();
        let args = strings([
            "s3",
            "cp",
            "-",
            destination.as_str(),
            "--region",
            self.config.region.as_str(),
            "--content-type",
            "application/json",
            "--metadata",
            &format!("ilxyr-sha256={digest}"),
            "--sse",
            "AES256",
            "--only-show-errors",
            "--no-cli-pager",
        ]);
        self.run_success(&args, Some(&bytes))?;
        Ok(StagedAwsJobPackage {
            schema: "ilxyr.staged_aws_job_package.v1".to_owned(),
            job_package_ref: artifact_ref(package)?,
            bucket: self.config.package_bucket.clone(),
            key: self.config.package_key.clone(),
            size_bytes: bytes.len() as u64,
        })
    }

    pub fn publish_launch_receipt(&mut self, receipt: &RemoteLaunchReceipt) -> Result<()> {
        if receipt.adapter != AWS_ADAPTER_ID
            || receipt.executor != self.config.executor
            || receipt.provider.region != self.config.region
            || !valid_prefixed_hex(&receipt.provider_instance_id, "i-")
        {
            return validation("AWS launch receipt must match this adapter");
        }
        let bytes = Workspace::canonical_json_bytes(receipt)?;
        let digest = Workspace::digest(receipt)?;
        let uri = format!(
            "s3://{}/{}/{}/launch-receipt.json",
            self.config.result_bucket, self.config.result_prefix, receipt.provider_instance_id
        );
        self.run_success(
            &strings([
                "s3",
                "cp",
                "-",
                uri.as_str(),
                "--region",
                self.config.region.as_str(),
                "--content-type",
                "application/json",
                "--metadata",
                &format!("ilxyr-sha256={digest}"),
                "--sse",
                "AES256",
                "--only-show-errors",
                "--no-cli-pager",
            ]),
            Some(&bytes),
        )?;
        Ok(())
    }

    fn validate_package(&self, package: &ExecutorJobPackage) -> Result<Vec<u8>> {
        if package.provider.provider != "aws" {
            return validation("AWS launcher requires provider=aws");
        }
        if package.provider.region != self.config.region {
            return Err(Error::Conflict(
                "AWS launcher region does not match the frozen package".to_owned(),
            ));
        }
        if package.expected_executor != self.config.executor {
            return Err(Error::Security(
                "AWS launcher identity does not match the frozen executor".to_owned(),
            ));
        }
        let price_bytes = fs::read(&self.config.price_evidence_file)?;
        if price_bytes.len() as u64 != package.budget.price_evidence.size_bytes
            || sha256_hex(&price_bytes) != package.budget.price_evidence.sha256
        {
            return Err(Error::Conflict(
                "AWS price file must match the frozen price evidence".to_owned(),
            ));
        }
        let price: AwsPriceEvidence = serde_json::from_slice(&price_bytes)?;
        if price.schema != "ilxyr.aws_price_evidence.v1"
            || price.region != package.provider.region
            || price.machine_type != package.provider.machine_type
            || price.hourly_price_microusd == 0
            || price.minimum_billed_seconds < 60
            || !price.source_url.starts_with("https://")
            || price.recorded_at_ms == 0
        {
            return validation(
                "AWS price evidence must describe the frozen machine and billing terms",
            );
        }
        let package_digest = Workspace::digest(package)?;
        let expected_suffix = format!("/{package_digest}.json");
        if !self.config.package_key.ends_with(&expected_suffix) {
            return Err(Error::Conflict(
                "AWS package key must end with the frozen package digest".to_owned(),
            ));
        }
        let billable_seconds = package
            .budget
            .max_runtime_seconds
            .checked_add(package.budget.watchdog_grace_seconds)
            .map(|seconds| seconds.max(price.minimum_billed_seconds))
            .ok_or_else(|| {
                Error::Validation(vec!["AWS runtime calculation overflowed".to_owned()])
            })?;
        let projected_cost = u128::from(billable_seconds)
            .checked_mul(u128::from(price.hourly_price_microusd))
            .and_then(|value| value.checked_add(3_599))
            .map(|value| value / 3_600)
            .and_then(|value| value.checked_add(u128::from(price.fixed_cost_microusd)))
            .ok_or_else(|| {
                Error::Validation(vec!["AWS price calculation overflowed".to_owned()])
            })?;
        if projected_cost > u128::from(package.budget.max_cost_microusd) {
            return Err(Error::Security(format!(
                "projected AWS cost {projected_cost} microusd exceeds the frozen limit {}",
                package.budget.max_cost_microusd
            )));
        }
        let bootstrap = fs::read(&self.config.bootstrap_script)?;
        if bootstrap.len() > MAX_USER_DATA_BYTES {
            return validation("AWS bootstrap script exceeds the EC2 user-data limit");
        }
        if !bootstrap.starts_with(b"#!")
            || bootstrap.contains(&0)
            || std::str::from_utf8(&bootstrap).is_err()
        {
            return validation("AWS bootstrap must be a UTF-8 shell script with a shebang");
        }
        if bootstrap.len() as u64 != package.harness.size_bytes
            || sha256_hex(&bootstrap) != package.harness.sha256
        {
            return Err(Error::Conflict(
                "AWS bootstrap script does not match the frozen harness".to_owned(),
            ));
        }
        Ok(bootstrap)
    }

    fn verify_aws_context(&mut self, package: &ExecutorJobPackage) -> Result<()> {
        let identity: CallerIdentity = self.run_json(&strings([
            "sts",
            "get-caller-identity",
            "--output",
            "json",
            "--no-cli-pager",
        ]))?;
        if identity.account != self.config.account_id || identity.arn.trim().is_empty() {
            return Err(Error::Security(
                "AWS caller must belong to the configured account".to_owned(),
            ));
        }

        let images: DescribeImages = self.run_json(&strings([
            "ec2",
            "describe-images",
            "--image-ids",
            package.provider.image_id.as_str(),
            "--region",
            self.config.region.as_str(),
            "--output",
            "json",
            "--no-cli-pager",
        ]))?;
        let [image] = images.images.as_slice() else {
            return Err(Error::Conflict(
                "AWS image lookup must return exactly one image".to_owned(),
            ));
        };
        let image_digest = image
            .tags
            .iter()
            .find(|tag| tag.key == "IlxyrImageSha256")
            .map(|tag| tag.value.as_str());
        if image.image_id != package.provider.image_id
            || image.state != "available"
            || image.architecture != package.provider.architecture
            || image.root_device_name != self.config.root_device_name
            || image_digest != Some(package.provider.image_sha256.as_str())
        {
            return Err(Error::Conflict(
                "AWS image does not match the frozen machine identity".to_owned(),
            ));
        }

        let types: DescribeInstanceTypes = self.run_json(&strings([
            "ec2",
            "describe-instance-types",
            "--instance-types",
            package.provider.machine_type.as_str(),
            "--region",
            self.config.region.as_str(),
            "--output",
            "json",
            "--no-cli-pager",
        ]))?;
        let [instance_type] = types.instance_types.as_slice() else {
            return Err(Error::Conflict(
                "AWS machine lookup must return exactly one instance type".to_owned(),
            ));
        };
        if instance_type.instance_type != package.provider.machine_type
            || !instance_type
                .processor_info
                .supported_architectures
                .contains(&package.provider.architecture)
        {
            return Err(Error::Conflict(
                "AWS machine type does not support the frozen architecture".to_owned(),
            ));
        }

        let subnets: DescribeSubnets = self.run_json(&strings([
            "ec2",
            "describe-subnets",
            "--subnet-ids",
            self.config.subnet_id.as_str(),
            "--region",
            self.config.region.as_str(),
            "--output",
            "json",
            "--no-cli-pager",
        ]))?;
        let [subnet] = subnets.subnets.as_slice() else {
            return Err(Error::Conflict(
                "AWS subnet lookup must return exactly one subnet".to_owned(),
            ));
        };
        if subnet.subnet_id != self.config.subnet_id || subnet.state != "available" {
            return Err(Error::Conflict(
                "AWS subnet is outside the frozen launch boundary".to_owned(),
            ));
        }

        let mut security_args = strings(["ec2", "describe-security-groups", "--group-ids"]);
        security_args.extend(self.config.security_group_ids.clone());
        security_args.extend(strings([
            "--region",
            self.config.region.as_str(),
            "--output",
            "json",
            "--no-cli-pager",
        ]));
        let groups: DescribeSecurityGroups = self.run_json(&security_args)?;
        let actual_groups = groups
            .security_groups
            .into_iter()
            .map(|group| group.group_id)
            .collect::<BTreeSet<_>>();
        let expected_groups = self
            .config
            .security_group_ids
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>();
        if actual_groups != expected_groups {
            return Err(Error::Conflict(
                "AWS security groups do not match the launcher config".to_owned(),
            ));
        }

        let profile: GetInstanceProfile = self.run_json(&strings([
            "iam",
            "get-instance-profile",
            "--instance-profile-name",
            self.config.iam_instance_profile.as_str(),
            "--output",
            "json",
            "--no-cli-pager",
        ]))?;
        if profile.instance_profile.instance_profile_name != self.config.iam_instance_profile {
            return Err(Error::Conflict(
                "AWS instance profile does not match the launcher config".to_owned(),
            ));
        }

        let head: HeadObject = self.run_json(&strings([
            "s3api",
            "head-object",
            "--bucket",
            self.config.package_bucket.as_str(),
            "--key",
            self.config.package_key.as_str(),
            "--region",
            self.config.region.as_str(),
            "--output",
            "json",
            "--no-cli-pager",
        ]))?;
        let canonical_size = Workspace::canonical_json_bytes(package)?.len() as u64;
        let package_digest = Workspace::digest(package)?;
        if head.content_length != canonical_size
            || head.metadata.get("ilxyr-sha256") != Some(&package_digest)
        {
            return Err(Error::Conflict(
                "staged AWS package does not match the frozen job package".to_owned(),
            ));
        }

        self.run_success(
            &strings([
                "s3api",
                "head-bucket",
                "--bucket",
                self.config.result_bucket.as_str(),
                "--region",
                self.config.region.as_str(),
                "--no-cli-pager",
            ]),
            None,
        )?;
        Ok(())
    }

    fn launch_arguments(
        &self,
        request: &RemoteLaunchRequest,
        package: &ExecutorJobPackage,
        bootstrap: &[u8],
        dry_run: bool,
    ) -> Result<Vec<String>> {
        let network_interfaces = serde_json::to_string(&json!([{
            "DeviceIndex": 0,
            "SubnetId": self.config.subnet_id,
            "Groups": self.config.security_group_ids,
            "AssociatePublicIpAddress": false,
            "DeleteOnTermination": true
        }]))?;
        let block_devices = serde_json::to_string(&json!([{
            "DeviceName": self.config.root_device_name,
            "Ebs": {
                "VolumeSize": package.provider.storage_gib,
                "VolumeType": "gp3",
                "Encrypted": true,
                "DeleteOnTermination": true
            }
        }]))?;
        let tags = self.launch_tags(request, package)?;
        let tag_specifications = serde_json::to_string(&json!([
            {"ResourceType": "instance", "Tags": tags},
            {"ResourceType": "volume", "Tags": [
                {"Key": "Project", "Value": "ilxyr"},
                {"Key": "Experiment", "Value": package.experiment_id}
            ]}
        ]))?;
        let user_data = std::str::from_utf8(bootstrap)
            .map_err(|_| Error::Validation(vec!["AWS bootstrap must use UTF-8".to_owned()]))?;
        let profile = format!("Name={}", self.config.iam_instance_profile);
        let client_token = ec2_client_token(&request.idempotency_key);
        let mut args = strings([
            "ec2",
            "run-instances",
            "--image-id",
            package.provider.image_id.as_str(),
            "--instance-type",
            package.provider.machine_type.as_str(),
            "--count",
            "1",
            "--iam-instance-profile",
            profile.as_str(),
            "--network-interfaces",
            network_interfaces.as_str(),
            "--instance-initiated-shutdown-behavior",
            "terminate",
            "--metadata-options",
            "HttpEndpoint=enabled,HttpTokens=required,InstanceMetadataTags=enabled,HttpPutResponseHopLimit=1",
            "--block-device-mappings",
            block_devices.as_str(),
            "--user-data",
            user_data,
            "--tag-specifications",
            tag_specifications.as_str(),
            "--client-token",
            client_token.as_str(),
            "--region",
            self.config.region.as_str(),
            "--output",
            "json",
            "--no-cli-pager",
        ]);
        if dry_run {
            args.push("--dry-run".to_owned());
        }
        Ok(args)
    }

    fn launch_tags(
        &self,
        request: &RemoteLaunchRequest,
        package: &ExecutorJobPackage,
    ) -> Result<Vec<serde_json::Value>> {
        let package_digest = Workspace::digest(package)?;
        let mut values = BTreeMap::from([
            ("Project", "ilxyr".to_owned()),
            ("Experiment", package.experiment_id.clone()),
            ("Adapter", AWS_ADAPTER_ID.to_owned()),
            ("PackageBucket", self.config.package_bucket.clone()),
            ("PackageKey", self.config.package_key.clone()),
            ("PackageSha256", package_digest),
            ("ResultBucket", self.config.result_bucket.clone()),
            ("ResultPrefix", self.config.result_prefix.clone()),
            ("AuthorizationRef", request.authorization_ref.clone()),
            ("ReservationRef", request.reservation_ref.clone()),
            ("JobPackageRef", request.job_package_ref.clone()),
            ("EnvironmentRef", request.environment_ref.clone()),
            ("LaunchReservedAtMs", request.reserved_at_ms.to_string()),
            ("ExpectedExecutor", package.expected_executor.id.clone()),
            ("ReportEndpoint", package.reporting.endpoint.clone()),
            (
                "MaxRuntimeSeconds",
                package.budget.max_runtime_seconds.to_string(),
            ),
            (
                "WatchdogGraceSeconds",
                package.budget.watchdog_grace_seconds.to_string(),
            ),
        ]);
        values.insert(
            "LaunchKeySha256",
            sha256_hex(request.idempotency_key.as_bytes()),
        );
        for (key, value) in &values {
            if value.is_empty() || value.len() > 256 {
                return validation(format!("AWS tag {key} is outside the supported size"));
            }
        }
        Ok(values
            .into_iter()
            .map(|(key, value)| json!({"Key": key, "Value": value}))
            .collect())
    }

    fn read_status(&mut self, receipt: &RemoteLaunchReceipt) -> Result<Option<AwsExecutionStatus>> {
        let uri = format!(
            "s3://{}/{}",
            self.config.result_bucket,
            self.status_key(&receipt.provider_instance_id)
        );
        let args = strings([
            "s3",
            "cp",
            uri.as_str(),
            "-",
            "--region",
            self.config.region.as_str(),
            "--only-show-errors",
            "--no-cli-pager",
        ]);
        let output = self.command.run_limited(&args, None, MAX_STATUS_BYTES)?;
        if output.status != 0 {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("NoSuchKey")
                || stderr.contains("404")
                || stderr.contains("Not Found")
            {
                return Ok(None);
            }
            return Err(aws_command_error(&args, &output));
        }
        let status: AwsExecutionStatus = serde_json::from_slice(&output.stdout)?;
        if status.schema != STATUS_SCHEMA
            || status.provider_instance_id != receipt.provider_instance_id
            || status.authorization_ref != receipt.authorization_ref
            || status.job_package_ref != receipt.job_package_ref
            || status.updated_at_ms == 0
            || status.updated_at_ms < receipt.launched_at_ms
        {
            return Err(Error::Conflict(
                "AWS status does not match the recorded launch".to_owned(),
            ));
        }
        Ok(Some(status))
    }

    fn status_key(&self, instance_id: &str) -> String {
        format!(
            "{}/{instance_id}/status.json",
            self.config.result_prefix.trim_end_matches('/')
        )
    }

    fn report_key(&self, instance_id: &str) -> String {
        format!(
            "{}/{instance_id}/execution-report.json",
            self.config.result_prefix.trim_end_matches('/')
        )
    }

    fn package_uri(&self) -> String {
        format!(
            "s3://{}/{}",
            self.config.package_bucket, self.config.package_key
        )
    }

    fn run_success(&mut self, args: &[String], stdin: Option<&[u8]>) -> Result<AwsCommandOutput> {
        let output = self.command.run(args, stdin)?;
        if output.status == 0 {
            Ok(output)
        } else {
            Err(aws_command_error(args, &output))
        }
    }

    fn run_json<T: DeserializeOwned>(&mut self, args: &[String]) -> Result<T> {
        let output = self.run_success(args, None)?;
        Ok(serde_json::from_slice(&output.stdout)?)
    }
}

impl<C: AwsCommandRunner> RemoteExecutorAdapter for AwsCliAdapter<C> {
    fn adapter_id(&self) -> &str {
        AWS_ADAPTER_ID
    }

    fn executor(&self) -> &ActorRef {
        &self.config.executor
    }

    fn configuration_ref(&self) -> Result<String> {
        artifact_ref(&self.config)
    }

    fn preflight(
        &mut self,
        environment: &ExecutorEnvironmentManifest,
        package: &ExecutorJobPackage,
    ) -> Result<RemotePreflightReceipt> {
        let bootstrap = self.validate_package(package)?;
        self.verify_aws_context(package)?;
        let package_ref = artifact_ref(package)?;
        let request = RemoteLaunchRequest {
            schema: "ilxyr.remote_launch_request.v1".to_owned(),
            authorization_ref: format!("artifact://sha256/{}", "0".repeat(64)),
            reservation_ref: format!("artifact://sha256/{}", "1".repeat(64)),
            environment_ref: artifact_ref(environment)?,
            job_package_ref: package_ref.clone(),
            idempotency_key: format!("ilxyr-preflight-{package_ref}"),
            reserved_at_ms: now_ms()?,
        };
        let args = self.launch_arguments(&request, package, &bootstrap, true)?;
        let output = self.command.run(&args, None)?;
        let combined = format!(
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        if output.status == 0 || !combined.contains("DryRunOperation") {
            return Err(aws_command_error(&args, &output));
        }
        Ok(RemotePreflightReceipt {
            schema: "ilxyr.remote_preflight.v1".to_owned(),
            adapter: AWS_ADAPTER_ID.to_owned(),
            executor: self.config.executor.clone(),
            environment_ref: artifact_ref(environment)?,
            job_package_ref: package_ref,
            provider: package.provider.clone(),
            checked_at_ms: now_ms()?,
        })
    }

    fn launch(
        &mut self,
        request: &RemoteLaunchRequest,
        _environment: &ExecutorEnvironmentManifest,
        package: &ExecutorJobPackage,
    ) -> Result<ProviderLaunchReceipt> {
        let bootstrap = self.validate_package(package)?;
        let result: RunInstances =
            self.run_json(&self.launch_arguments(request, package, &bootstrap, false)?)?;
        let [instance] = result.instances.as_slice() else {
            return Err(Error::Execution(
                "AWS launch must return exactly one instance".to_owned(),
            ));
        };
        if instance.image_id != package.provider.image_id
            || instance.instance_type != package.provider.machine_type
            || instance.subnet_id != self.config.subnet_id
        {
            return Err(Error::Conflict(
                "AWS launch response does not match the frozen machine".to_owned(),
            ));
        }
        Ok(ProviderLaunchReceipt {
            schema: "ilxyr.provider_launch_receipt.v1".to_owned(),
            provider_instance_id: instance.instance_id.clone(),
            machine_image_id: instance.image_id.clone(),
            machine_image_sha256: package.provider.image_sha256.clone(),
            launched_at_ms: aws_timestamp_ms(&instance.launch_time)?,
        })
    }

    fn observe(&mut self, receipt: &RemoteLaunchReceipt) -> Result<RemoteExecutionObservation> {
        if let Some(status) = self.read_status(receipt)? {
            return Ok(RemoteExecutionObservation {
                schema: "ilxyr.remote_execution_observation.v1".to_owned(),
                launch_ref: artifact_ref(receipt)?,
                provider_instance_id: receipt.provider_instance_id.clone(),
                state: status.state,
                observed_at_ms: status.updated_at_ms,
            });
        }
        let described: DescribeInstances = self.run_json(&strings([
            "ec2",
            "describe-instances",
            "--instance-ids",
            receipt.provider_instance_id.as_str(),
            "--region",
            self.config.region.as_str(),
            "--output",
            "json",
            "--no-cli-pager",
        ]))?;
        let instances = described
            .reservations
            .iter()
            .flat_map(|reservation| reservation.instances.iter())
            .collect::<Vec<_>>();
        let [instance] = instances.as_slice() else {
            return Err(Error::Conflict(
                "AWS observation must return exactly one instance".to_owned(),
            ));
        };
        if instance.instance_id != receipt.provider_instance_id
            || instance.image_id != receipt.provider.image_id
            || instance.instance_type != receipt.provider.machine_type
        {
            return Err(Error::Conflict(
                "AWS observation does not match the recorded launch".to_owned(),
            ));
        }
        let state = match instance.state.name.as_str() {
            "pending" => RemoteExecutionState::Pending,
            "running" => RemoteExecutionState::Running,
            "shutting-down" | "terminated" | "stopping" | "stopped" => RemoteExecutionState::Failed,
            value => {
                return Err(Error::Execution(format!(
                    "AWS returned unknown instance state {value}"
                )));
            }
        };
        Ok(RemoteExecutionObservation {
            schema: "ilxyr.remote_execution_observation.v1".to_owned(),
            launch_ref: artifact_ref(receipt)?,
            provider_instance_id: receipt.provider_instance_id.clone(),
            state,
            observed_at_ms: now_ms()?,
        })
    }

    fn collect(
        &mut self,
        receipt: &RemoteLaunchReceipt,
        _environment: &ExecutorEnvironmentManifest,
        package: &ExecutorJobPackage,
    ) -> Result<ExecutionReport> {
        let Some(status) = self.read_status(receipt)? else {
            return Err(Error::Conflict(
                "AWS execution status is still pending".to_owned(),
            ));
        };
        if status.state != RemoteExecutionState::Succeeded {
            return Err(Error::Conflict(
                "AWS execution has not reached succeeded state".to_owned(),
            ));
        }
        let uri = format!(
            "s3://{}/{}",
            self.config.result_bucket,
            self.report_key(&receipt.provider_instance_id)
        );
        let args = strings([
            "s3",
            "cp",
            uri.as_str(),
            "-",
            "--region",
            self.config.region.as_str(),
            "--only-show-errors",
            "--no-cli-pager",
        ]);
        let output = self
            .command
            .run_limited(&args, None, package.reporting.max_report_bytes)?;
        if output.status != 0 {
            return Err(aws_command_error(&args, &output));
        }
        Ok(serde_json::from_slice(&output.stdout)?)
    }
}

impl AwsLauncherConfig {
    pub fn validate(&self) -> Result<()> {
        let mut errors = Vec::new();
        if self.schema != CONFIG_SCHEMA {
            errors.push(format!("config.schema must be {CONFIG_SCHEMA}"));
        }
        if self.account_id.len() != 12 || !self.account_id.bytes().all(|byte| byte.is_ascii_digit())
        {
            errors.push("config.account_id must contain 12 digits".to_owned());
        }
        if self.executor.kind != ActorKind::Service
            || !self.executor.id.starts_with("service://")
            || self.executor.id.len() == "service://".len()
            || self.executor.model_ref.is_some()
        {
            errors.push("config.executor must be a service actor".to_owned());
        }
        if !valid_aws_name(&self.region) || !valid_prefixed_hex(&self.subnet_id, "subnet-") {
            errors.push("config region or subnet has an invalid shape".to_owned());
        }
        if !self.root_device_name.starts_with("/dev/")
            || self.root_device_name.len() <= "/dev/".len()
            || !self.root_device_name["/dev/".len()..]
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric())
        {
            errors.push("config.root_device_name must start with /dev/".to_owned());
        }
        if self.security_group_ids.is_empty()
            || self
                .security_group_ids
                .iter()
                .any(|value| !valid_prefixed_hex(value, "sg-"))
            || self
                .security_group_ids
                .iter()
                .collect::<BTreeSet<_>>()
                .len()
                != self.security_group_ids.len()
        {
            errors.push("config.security_group_ids must contain unique AWS group IDs".to_owned());
        }
        if !valid_profile_name(&self.iam_instance_profile) {
            errors.push("config.iam_instance_profile has an invalid shape".to_owned());
        }
        if self.bootstrap_script.as_os_str().is_empty() {
            errors.push("config.bootstrap_script must name the frozen harness".to_owned());
        }
        if !valid_bucket(&self.package_bucket) || !valid_bucket(&self.result_bucket) {
            errors.push("config package and result buckets must be valid S3 names".to_owned());
        }
        if !valid_object_key(&self.package_key) || !valid_object_key(&self.result_prefix) {
            errors.push("config package key and result prefix must be safe S3 keys".to_owned());
        }
        if self.price_evidence_file.as_os_str().is_empty() {
            errors.push("config.price_evidence_file must name the frozen price file".to_owned());
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(Error::Validation(errors))
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct CallerIdentity {
    account: String,
    arn: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DescribeImages {
    images: Vec<AwsImage>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct AwsImage {
    image_id: String,
    state: String,
    architecture: String,
    root_device_name: String,
    #[serde(default)]
    tags: Vec<AwsTag>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct AwsTag {
    key: String,
    value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DescribeInstanceTypes {
    instance_types: Vec<AwsInstanceType>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct AwsInstanceType {
    instance_type: String,
    processor_info: AwsProcessorInfo,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct AwsProcessorInfo {
    supported_architectures: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DescribeSubnets {
    subnets: Vec<AwsSubnet>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct AwsSubnet {
    subnet_id: String,
    state: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DescribeSecurityGroups {
    security_groups: Vec<AwsSecurityGroup>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct AwsSecurityGroup {
    group_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct GetInstanceProfile {
    instance_profile: AwsInstanceProfile,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct AwsInstanceProfile {
    instance_profile_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct HeadObject {
    content_length: u64,
    metadata: BTreeMap<String, String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct RunInstances {
    instances: Vec<AwsInstance>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct AwsInstance {
    instance_id: String,
    image_id: String,
    instance_type: String,
    subnet_id: String,
    launch_time: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DescribeInstances {
    reservations: Vec<AwsReservation>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct AwsReservation {
    instances: Vec<ObservedInstance>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct ObservedInstance {
    instance_id: String,
    image_id: String,
    instance_type: String,
    state: AwsInstanceState,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct AwsInstanceState {
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AwsExecutionStatus {
    schema: String,
    provider_instance_id: String,
    authorization_ref: String,
    job_package_ref: String,
    state: RemoteExecutionState,
    updated_at_ms: u128,
}

fn strings<const N: usize>(values: [&str; N]) -> Vec<String> {
    values.into_iter().map(str::to_owned).collect()
}

fn artifact_ref<T: Serialize>(value: &T) -> Result<String> {
    Ok(format!("artifact://sha256/{}", Workspace::digest(value)?))
}

fn ec2_client_token(value: &str) -> String {
    let digest = sha256_hex(value.as_bytes());
    format!("ilxyr-{}", &digest[..58])
}

fn aws_timestamp_ms(value: &str) -> Result<u128> {
    let timestamp = chrono::DateTime::parse_from_rfc3339(value)
        .map_err(|error| Error::Execution(format!("AWS launch time is invalid: {error}")))?
        .timestamp_millis();
    u128::try_from(timestamp)
        .map_err(|_| Error::Execution("AWS launch time must follow the Unix epoch".to_owned()))
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn now_ms() -> Result<u128> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| Error::Execution(format!("system clock is before Unix epoch: {error}")))?
        .as_millis())
}

fn aws_command_error(args: &[String], output: &AwsCommandOutput) -> Error {
    let label = args.iter().take(2).cloned().collect::<Vec<_>>().join(" ");
    let message = String::from_utf8_lossy(&output.stderr);
    let message = message.trim().chars().take(1_000).collect::<String>();
    Error::Execution(format!(
        "AWS CLI {label} returned status {}: {message}",
        output.status
    ))
}

fn validation<T>(message: impl Into<String>) -> Result<T> {
    Err(Error::Validation(vec![message.into()]))
}

fn valid_prefixed_hex(value: &str, prefix: &str) -> bool {
    value.strip_prefix(prefix).is_some_and(|rest| {
        !rest.is_empty()
            && rest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

fn valid_aws_name(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn valid_profile_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric()
                || matches!(byte, b'+' | b'=' | b',' | b'.' | b'@' | b'_' | b'-')
        })
}

fn valid_bucket(value: &str) -> bool {
    (3..=63).contains(&value.len())
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'-')
        })
        && value
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
        && value
            .as_bytes()
            .last()
            .is_some_and(u8::is_ascii_alphanumeric)
        && !value.contains("..")
        && !value.contains(".-")
        && !value.contains("-.")
}

fn valid_object_key(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('/')
        && !value.ends_with('/')
        && !value.contains('\\')
        && !value.chars().any(char::is_control)
        && value
            .split('/')
            .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
}

#[cfg(all(test, unix))]
mod tests {
    use super::{AwsCommandRunner, ProcessAwsCli, strings};
    use std::path::PathBuf;

    #[test]
    fn process_transport_caps_stdout() {
        let mut client = ProcessAwsCli {
            program: PathBuf::from("/bin/sh"),
        };
        let error = client
            .run_limited(&strings(["-c", "printf 12345"]), None, 4)
            .expect_err("large response stops the child");
        assert!(error.to_string().contains("size limit"));
    }

    #[test]
    fn process_transport_preserves_staged_bytes() {
        let mut client = ProcessAwsCli {
            program: PathBuf::from("/bin/sh"),
        };
        let output = client
            .run_limited(&strings(["-c", "cat"]), Some(b"package"), 7)
            .expect("stdin reaches the child");
        assert_eq!(output.status, 0);
        assert_eq!(output.stdout, b"package");
    }
}
