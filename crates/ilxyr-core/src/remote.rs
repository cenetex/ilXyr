use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::{
    ActorKind, ActorRef, DsseEnvelope, Error, ExportPolicy, Result, RunRecord,
    TrustedAttestationKey, WeightClass, Workspace, verify_executor_envelope_candidate,
};

const ENVIRONMENT_SCHEMA: &str = "ilxyr.executor_environment.v1";
const JOB_PACKAGE_SCHEMA: &str = "ilxyr.executor_job_package.v1";
const EXECUTION_REPORT_SCHEMA: &str = "ilxyr.execution_report.v1";
const VERIFIED_REPORT_SCHEMA: &str = "ilxyr.verified_execution_report.v1";
const SLSA_PROVENANCE_V1: &str = "https://slsa.dev/provenance/v1";
const REMOTE_EXECUTION_BUILD_TYPE: &str = "https://ilxyr.dev/buildtypes/remote-execution/v1";
const REPORT_VERIFIER_ID: &str = "service://ilxyr/report-verifier-v1";
const ARTIFACT_PREFIX: &str = "artifact://sha256/";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct DigestResource {
    pub name: String,
    pub uri: String,
    pub sha256: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SourceRelease {
    pub repository: String,
    pub commit: String,
    pub archive: DigestResource,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionNetworkMode {
    Denied,
    Allowlist,
    Open,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct IsolationProfile {
    pub boundary: String,
    pub one_job_per_vm: bool,
    pub read_only_rootfs: bool,
    pub host_mounts: bool,
    pub interactive_access: bool,
    pub metadata_service_in_guest: bool,
    pub signing_key_in_guest: bool,
    pub reporting_outside_guest: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct EnvironmentCapabilities {
    pub weight_classes: Vec<WeightClass>,
    pub network_modes: Vec<ExecutionNetworkMode>,
    pub export_policies: Vec<ExportPolicy>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ExecutorEnvironmentManifest {
    pub schema: String,
    pub id: String,
    pub operator: ActorRef,
    pub source: SourceRelease,
    pub build_recipe: DigestResource,
    pub runner: DigestResource,
    pub kernel: DigestResource,
    pub rootfs: DigestResource,
    pub sbom: DigestResource,
    pub provenance: DigestResource,
    pub isolation: IsolationProfile,
    pub capabilities: EnvironmentCapabilities,
    pub conformance_suite: DigestResource,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProviderBinding {
    pub provider: String,
    pub region: String,
    pub machine_type: String,
    pub architecture: String,
    pub image_id: String,
    pub image_sha256: String,
    pub storage_gib: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct BudgetPolicy {
    pub max_runtime_seconds: u64,
    pub max_cost_microusd: u64,
    pub price_evidence: DigestResource,
    pub watchdog_grace_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AllocationPolicy {
    pub concurrency: u64,
    pub retry_limit: u64,
    pub failure_policy: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ReportingPolicy {
    pub endpoint: String,
    pub protocol: String,
    pub max_report_bytes: u64,
    pub expected_verifier: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ExecutorJobPackage {
    pub schema: String,
    pub experiment_id: String,
    pub compiled_ref: String,
    pub environment_ref: String,
    pub inputs: Vec<DigestResource>,
    pub executable: DigestResource,
    pub oracle: DigestResource,
    pub harness: DigestResource,
    pub provider: ProviderBinding,
    pub budget: BudgetPolicy,
    pub targets: Vec<String>,
    pub allocation: AllocationPolicy,
    pub network: ExecutionNetworkMode,
    pub allowed_hosts: Vec<String>,
    pub export_policy: ExportPolicy,
    pub weight_class: WeightClass,
    pub expected_executor: ActorRef,
    pub reporting: ReportingPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExecutionReport {
    pub schema: String,
    pub job_package_ref: String,
    pub authorization_ref: String,
    pub launch_ref: String,
    pub environment_ref: String,
    pub executor: ActorRef,
    pub provider_instance_id: String,
    pub machine_image_id: String,
    pub machine_image_sha256: String,
    pub run: RunRecord,
    pub run_ref: String,
    pub outputs: Vec<DigestResource>,
    pub attestation: DsseEnvelope,
    pub reported_at_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct VerifiedExecutionReport {
    pub schema: String,
    pub report_ref: String,
    pub job_package_ref: String,
    pub environment_ref: String,
    pub authorization_ref: String,
    pub launch_ref: String,
    pub run_ref: String,
    pub executor: ActorRef,
    pub verified_key_ids: Vec<String>,
    pub verification_policy: String,
}

#[derive(Debug, Default)]
pub struct ReportReplayGuard {
    accepted_by_launch: BTreeMap<String, String>,
}

impl ReportReplayGuard {
    pub fn admit(&mut self, verified: &VerifiedExecutionReport) -> Result<bool> {
        if let Some(existing) = self.accepted_by_launch.get(&verified.launch_ref) {
            if existing == &verified.report_ref {
                return Ok(false);
            }
            return Err(Error::Conflict(format!(
                "launch {} is already bound to report {existing}",
                verified.launch_ref
            )));
        }
        self.accepted_by_launch
            .insert(verified.launch_ref.clone(), verified.report_ref.clone());
        Ok(true)
    }
}

pub fn verify_environment_manifest(environment: &ExecutorEnvironmentManifest) -> Result<String> {
    if environment.schema != ENVIRONMENT_SCHEMA {
        return validation(format!(
            "unsupported environment schema {}; expected {ENVIRONMENT_SCHEMA}",
            environment.schema
        ));
    }
    if !environment.id.starts_with("environment://")
        || environment.id.len() == "environment://".len()
    {
        return validation("environment ID must start with environment://");
    }
    validate_service_actor(&environment.operator, "environment operator")?;
    if !environment.source.repository.starts_with("https://")
        || environment.source.repository.len() == "https://".len()
    {
        return validation("environment source repository must use https");
    }
    if !matches!(environment.source.commit.len(), 40 | 64)
        || !is_lower_hex(&environment.source.commit)
    {
        return validation(
            "environment source commit must be a 40- or 64-character lowercase digest",
        );
    }
    for resource in environment_resources(environment) {
        validate_resource(resource)?;
    }
    validate_nonempty(&environment.isolation.boundary, "isolation boundary")?;
    if !environment.isolation.one_job_per_vm
        || !environment.isolation.read_only_rootfs
        || environment.isolation.host_mounts
        || environment.isolation.interactive_access
        || environment.isolation.metadata_service_in_guest
        || environment.isolation.signing_key_in_guest
        || !environment.isolation.reporting_outside_guest
    {
        return Err(Error::Security(
            "environment does not satisfy the public remote-execution isolation baseline"
                .to_owned(),
        ));
    }
    if environment.capabilities.weight_classes.is_empty()
        || environment.capabilities.network_modes.is_empty()
        || environment.capabilities.export_policies.is_empty()
    {
        return validation("environment capabilities must not be empty");
    }
    validate_unique(
        &environment.capabilities.weight_classes,
        "environment weight classes",
    )?;
    validate_unique(
        &environment.capabilities.network_modes,
        "environment network modes",
    )?;
    validate_unique(
        &environment.capabilities.export_policies,
        "environment export policies",
    )?;
    object_ref(environment)
}

pub fn verify_job_package(
    environment: &ExecutorEnvironmentManifest,
    package: &ExecutorJobPackage,
) -> Result<String> {
    let environment_ref = verify_environment_manifest(environment)?;
    if package.schema != JOB_PACKAGE_SCHEMA {
        return validation(format!(
            "unsupported job package schema {}; expected {JOB_PACKAGE_SCHEMA}",
            package.schema
        ));
    }
    validate_nonempty(&package.experiment_id, "experiment ID")?;
    validate_artifact_ref(&package.compiled_ref, "compiled experiment reference")?;
    if package.environment_ref != environment_ref {
        return Err(Error::Conflict(
            "job package environment reference does not match the supplied manifest".to_owned(),
        ));
    }
    if package.inputs.is_empty() {
        return validation("job package must contain at least one input");
    }
    let mut input_names = BTreeSet::new();
    for resource in
        package
            .inputs
            .iter()
            .chain([&package.executable, &package.oracle, &package.harness])
    {
        validate_resource(resource)?;
        if !input_names.insert(resource.name.as_str()) {
            return validation(format!("duplicate job resource name {}", resource.name));
        }
    }
    validate_resource(&package.budget.price_evidence)?;
    validate_lower_sha256(&package.provider.image_sha256, "machine image digest")?;
    for (value, label) in [
        (&package.provider.provider, "provider"),
        (&package.provider.region, "region"),
        (&package.provider.machine_type, "machine type"),
        (&package.provider.architecture, "architecture"),
        (&package.provider.image_id, "machine image ID"),
    ] {
        validate_nonempty(value, label)?;
    }
    if package.provider.storage_gib == 0
        || package.budget.max_runtime_seconds == 0
        || package.budget.max_cost_microusd == 0
        || package.reporting.max_report_bytes == 0
    {
        return validation("storage, runtime, cost, and report limits must be positive");
    }
    if package.budget.watchdog_grace_seconds >= package.budget.max_runtime_seconds {
        return validation("watchdog grace must be shorter than the maximum runtime");
    }
    if package.targets.is_empty() {
        return validation("job package must contain at least one ordered target");
    }
    let unique_targets = package.targets.iter().collect::<BTreeSet<_>>();
    if unique_targets.len() != package.targets.len() {
        return validation("job package targets must be unique");
    }
    for target in &package.targets {
        validate_nonempty(target, "job target")?;
    }
    if package.allocation.concurrency == 0
        || package.allocation.concurrency as usize > package.targets.len()
        || package.allocation.retry_limit > 3
    {
        return validation(
            "allocation concurrency or retry limit is outside the supported boundary",
        );
    }
    if package.allocation.failure_policy != "fail_closed" {
        return validation("remote execution requires failure_policy=fail_closed");
    }
    match package.network {
        ExecutionNetworkMode::Denied if !package.allowed_hosts.is_empty() => {
            return validation("network=denied cannot declare allowed hosts");
        }
        ExecutionNetworkMode::Allowlist if package.allowed_hosts.is_empty() => {
            return validation("network=allowlist requires at least one host");
        }
        _ => {}
    }
    let unique_hosts = package.allowed_hosts.iter().collect::<BTreeSet<_>>();
    if unique_hosts.len() != package.allowed_hosts.len() {
        return validation("allowed network hosts must be unique");
    }
    for host in &package.allowed_hosts {
        validate_nonempty(host, "allowed network host")?;
    }
    if !environment
        .capabilities
        .network_modes
        .contains(&package.network)
        || !environment
            .capabilities
            .export_policies
            .contains(&package.export_policy)
        || !environment
            .capabilities
            .weight_classes
            .contains(&package.weight_class)
    {
        return Err(Error::Security(
            "job package requests a capability the environment does not declare".to_owned(),
        ));
    }
    validate_service_actor(&package.expected_executor, "expected executor")?;
    if package.expected_executor != environment.operator {
        return Err(Error::Security(
            "job package executor does not match the environment operator".to_owned(),
        ));
    }
    if package.weight_class != WeightClass::Public
        || package.network != ExecutionNetworkMode::Denied
        || package.export_policy != ExportPolicy::MetricsOnly
    {
        return Err(Error::Security(
            "remote execution v1 accepts only public weights, denied networking, and metrics-only export"
                .to_owned(),
        ));
    }
    if !package.reporting.endpoint.starts_with("https://")
        || package.reporting.endpoint.len() == "https://".len()
    {
        return validation("reporting endpoint must use https");
    }
    if package.reporting.protocol != EXECUTION_REPORT_SCHEMA {
        return validation(format!(
            "reporting protocol must be {EXECUTION_REPORT_SCHEMA}"
        ));
    }
    if package.reporting.expected_verifier != REPORT_VERIFIER_ID {
        return validation(format!("expected verifier must be {REPORT_VERIFIER_ID}"));
    }
    object_ref(package)
}

pub fn verify_execution_report(
    environment: &ExecutorEnvironmentManifest,
    package: &ExecutorJobPackage,
    trusted_keys: &[TrustedAttestationKey],
    report: &ExecutionReport,
) -> Result<VerifiedExecutionReport> {
    let environment_ref = verify_environment_manifest(environment)?;
    let package_ref = verify_job_package(environment, package)?;
    if report.schema != EXECUTION_REPORT_SCHEMA {
        return validation(format!(
            "unsupported execution report schema {}; expected {EXECUTION_REPORT_SCHEMA}",
            report.schema
        ));
    }
    if report.job_package_ref != package_ref || report.environment_ref != environment_ref {
        return Err(Error::Conflict(
            "execution report does not bind the supplied package and environment".to_owned(),
        ));
    }
    for (value, label) in [
        (&report.authorization_ref, "authorization reference"),
        (&report.launch_ref, "launch reference"),
    ] {
        validate_artifact_ref(value, label)?;
    }
    validate_service_actor(&report.executor, "report executor")?;
    if report.executor != package.expected_executor {
        return Err(Error::Security(
            "execution report identity does not match the package executor".to_owned(),
        ));
    }
    if report.provider_instance_id.trim().is_empty()
        || report.machine_image_id != package.provider.image_id
        || report.machine_image_sha256 != package.provider.image_sha256
        || report.run.schema != "ilxyr.run.v1"
        || report.run.experiment_id != package.experiment_id
        || report.run.id.trim().is_empty()
        || report.run.completed_at_ms < report.run.started_at_ms
        || report.reported_at_ms == 0
        || report.reported_at_ms < report.run.completed_at_ms
    {
        return Err(Error::Conflict(
            "execution report run or provider fields do not match the frozen package".to_owned(),
        ));
    }
    let run_ref = object_ref(&report.run)?;
    if report.run_ref != run_ref {
        return Err(Error::Conflict(
            "execution report run reference does not match the canonical run bytes".to_owned(),
        ));
    }
    let mut output_names = BTreeSet::new();
    if report.outputs.is_empty() {
        return validation("execution report must contain at least one output");
    }
    for output in &report.outputs {
        validate_resource(output)?;
        if !output_names.insert(output.name.as_str()) {
            return validation(format!("duplicate output resource name {}", output.name));
        }
    }

    let verified = verify_executor_envelope_candidate(&run_ref, &report.attestation, trusted_keys)?;
    if verified.predicate_type != SLSA_PROVENANCE_V1 {
        return validation("remote execution reports require SLSA provenance v1");
    }
    if !trusted_keys.iter().any(|key| {
        verified.verified_key_ids.contains(&key.key_id) && key.executor == report.executor
    }) {
        return Err(Error::Security(
            "execution report has no verified signature from its declared executor".to_owned(),
        ));
    }
    let definition = verified
        .statement
        .get("predicate")
        .and_then(|value| value.get("buildDefinition"))
        .ok_or_else(|| {
            Error::Validation(vec!["remote provenance has no buildDefinition".to_owned()])
        })?;
    if definition
        .get("buildType")
        .and_then(serde_json::Value::as_str)
        != Some(REMOTE_EXECUTION_BUILD_TYPE)
    {
        return validation(format!(
            "remote provenance buildType must be {REMOTE_EXECUTION_BUILD_TYPE}"
        ));
    }
    let parameters = definition.get("externalParameters").ok_or_else(|| {
        Error::Validation(vec![
            "remote provenance has no externalParameters".to_owned(),
        ])
    })?;
    let outputs_ref = object_ref(&report.outputs)?;
    for (field, expected) in [
        ("ilxyrRunRef", report.run_ref.as_str()),
        ("ilxyrJobPackageRef", report.job_package_ref.as_str()),
        ("ilxyrEnvironmentRef", report.environment_ref.as_str()),
        ("ilxyrAuthorizationRef", report.authorization_ref.as_str()),
        ("ilxyrLaunchRef", report.launch_ref.as_str()),
        ("ilxyrOutputsRef", outputs_ref.as_str()),
        (
            "ilxyrProviderInstanceId",
            report.provider_instance_id.as_str(),
        ),
        ("ilxyrMachineImageId", report.machine_image_id.as_str()),
        (
            "ilxyrMachineImageSha256",
            report.machine_image_sha256.as_str(),
        ),
    ] {
        if parameters.get(field).and_then(serde_json::Value::as_str) != Some(expected) {
            return Err(Error::Conflict(format!(
                "remote provenance {field} does not match the execution report"
            )));
        }
    }

    Ok(VerifiedExecutionReport {
        schema: VERIFIED_REPORT_SCHEMA.to_owned(),
        report_ref: object_ref(report)?,
        job_package_ref: package_ref,
        environment_ref,
        authorization_ref: report.authorization_ref.clone(),
        launch_ref: report.launch_ref.clone(),
        run_ref,
        executor: report.executor.clone(),
        verified_key_ids: verified.verified_key_ids,
        verification_policy: "https://ilxyr.dev/policies/remote-execution-report/v1".to_owned(),
    })
}

fn environment_resources(environment: &ExecutorEnvironmentManifest) -> [&DigestResource; 8] {
    [
        &environment.source.archive,
        &environment.build_recipe,
        &environment.runner,
        &environment.kernel,
        &environment.rootfs,
        &environment.sbom,
        &environment.provenance,
        &environment.conformance_suite,
    ]
}

fn validate_resource(resource: &DigestResource) -> Result<()> {
    validate_nonempty(&resource.name, "resource name")?;
    validate_nonempty(&resource.uri, "resource URI")?;
    validate_lower_sha256(&resource.sha256, "resource digest")?;
    if resource.size_bytes == 0 {
        return validation(format!(
            "resource {} must have a positive size",
            resource.name
        ));
    }
    Ok(())
}

fn validate_service_actor(actor: &ActorRef, label: &str) -> Result<()> {
    if actor.kind != ActorKind::Service
        || !actor.id.starts_with("service://")
        || actor.model_ref.is_some()
    {
        return validation(format!("{label} must be a service:// actor"));
    }
    Ok(())
}

fn validate_artifact_ref(value: &str, label: &str) -> Result<()> {
    let digest = value
        .strip_prefix(ARTIFACT_PREFIX)
        .ok_or_else(|| Error::Validation(vec![format!("{label} must be an artifact reference")]))?;
    validate_lower_sha256(digest, label)
}

fn validate_lower_sha256(value: &str, label: &str) -> Result<()> {
    if value.len() != 64 || !is_lower_hex(value) {
        return validation(format!("{label} must be a lowercase SHA-256 digest"));
    }
    Ok(())
}

fn validate_nonempty(value: &str, label: &str) -> Result<()> {
    if value.trim().is_empty() {
        return validation(format!("{label} must not be empty"));
    }
    Ok(())
}

fn validate_unique<T: PartialEq>(values: &[T], label: &str) -> Result<()> {
    for (index, value) in values.iter().enumerate() {
        if values[..index].contains(value) {
            return validation(format!("{label} must be unique"));
        }
    }
    Ok(())
}

fn is_lower_hex(value: &str) -> bool {
    value
        .bytes()
        .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn object_ref<T: Serialize>(value: &T) -> Result<String> {
    Ok(format!("{ARTIFACT_PREFIX}{}", Workspace::digest(value)?))
}

fn validation<T>(message: impl Into<String>) -> Result<T> {
    Err(Error::Validation(vec![message.into()]))
}
