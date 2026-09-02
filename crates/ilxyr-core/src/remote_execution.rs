use std::collections::BTreeSet;

use serde::{Deserialize, Serialize, de::DeserializeOwned};

use crate::{
    ActorRef, CodePolicy, CompiledExperiment, Error, ExecutionNetworkMode, ExecutionReport,
    ExecutorEnvironmentManifest, ExecutorJobPackage, ExportPolicy, ProviderBinding, Result,
    VerifiedExecutionReport, WeightClass, Workspace, attestation::trusted_attestation_keys,
    authorize_unattended_run, store::now_ms, verify_environment_manifest, verify_execution_report,
    verify_job_package, workflow::resolve_outcome,
};

const EXPERIMENT_COMPILED: &str = "ExperimentCompiled";
const REMOTE_EXECUTION_AUTHORIZED: &str = "RemoteExecutionAuthorized";
const REMOTE_LAUNCH_RESERVED: &str = "RemoteLaunchReserved";
const REMOTE_LAUNCH_RECORDED: &str = "RemoteLaunchRecorded";
const REMOTE_REPORT_ACCEPTED: &str = "RemoteReportAccepted";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RemotePreflightReceipt {
    pub schema: String,
    pub adapter: String,
    pub executor: ActorRef,
    pub environment_ref: String,
    pub job_package_ref: String,
    pub provider: ProviderBinding,
    pub checked_at_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RemoteExecutionAuthorization {
    pub schema: String,
    pub id: String,
    pub experiment_id: String,
    pub budget_id: String,
    pub compiled_ref: String,
    pub environment_ref: String,
    pub job_package_ref: String,
    pub allocated_compute_credits: u64,
    pub authorized_at_ms: u128,
    pub expires_at_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RemoteLaunchReservation {
    pub schema: String,
    pub id: String,
    #[serde(default)]
    pub adapter: String,
    #[serde(default)]
    pub adapter_configuration_ref: String,
    pub authorization_ref: String,
    pub environment_ref: String,
    pub job_package_ref: String,
    pub idempotency_key: String,
    pub reserved_at_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RemoteLaunchRequest {
    pub schema: String,
    pub authorization_ref: String,
    pub reservation_ref: String,
    pub environment_ref: String,
    pub job_package_ref: String,
    pub idempotency_key: String,
    pub reserved_at_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProviderLaunchReceipt {
    pub schema: String,
    pub provider_instance_id: String,
    pub machine_image_id: String,
    pub machine_image_sha256: String,
    pub launched_at_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RemoteLaunchReceipt {
    pub schema: String,
    pub id: String,
    pub adapter: String,
    pub executor: ActorRef,
    pub authorization_ref: String,
    pub reservation_ref: String,
    pub environment_ref: String,
    pub job_package_ref: String,
    pub provider: ProviderBinding,
    pub provider_instance_id: String,
    pub launched_at_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RemoteExecutionState {
    Pending,
    Running,
    Succeeded,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RemoteExecutionObservation {
    pub schema: String,
    pub launch_ref: String,
    pub provider_instance_id: String,
    pub state: RemoteExecutionState,
    pub observed_at_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AcceptedRemoteReport {
    pub schema: String,
    pub experiment_id: String,
    pub report_ref: String,
    pub verified: VerifiedExecutionReport,
    pub resolved_outcome: String,
    pub accepted_at_ms: u128,
}

/// Provider implementations expose only these four operations. In particular,
/// observation and collection have no launch or restart authority.
pub trait RemoteExecutorAdapter {
    fn adapter_id(&self) -> &str;
    fn executor(&self) -> &ActorRef;
    fn configuration_ref(&self) -> Result<String>;

    fn preflight(
        &mut self,
        environment: &ExecutorEnvironmentManifest,
        package: &ExecutorJobPackage,
    ) -> Result<RemotePreflightReceipt>;

    fn launch(
        &mut self,
        request: &RemoteLaunchRequest,
        environment: &ExecutorEnvironmentManifest,
        package: &ExecutorJobPackage,
    ) -> Result<ProviderLaunchReceipt>;

    fn observe(&mut self, receipt: &RemoteLaunchReceipt) -> Result<RemoteExecutionObservation>;

    fn collect(
        &mut self,
        receipt: &RemoteLaunchReceipt,
        environment: &ExecutorEnvironmentManifest,
        package: &ExecutorJobPackage,
    ) -> Result<ExecutionReport>;
}

pub fn preflight_remote_execution<A: RemoteExecutorAdapter>(
    adapter: &mut A,
    environment: &ExecutorEnvironmentManifest,
    package: &ExecutorJobPackage,
) -> Result<RemotePreflightReceipt> {
    let environment_ref = verify_environment_manifest(environment)?;
    let package_ref = verify_job_package(environment, package)?;
    if adapter.executor() != &package.expected_executor {
        return Err(Error::Security(
            "remote adapter identity does not match the frozen executor".to_owned(),
        ));
    }
    let receipt = adapter.preflight(environment, package)?;
    if receipt.schema != "ilxyr.remote_preflight.v1"
        || receipt.adapter != adapter.adapter_id()
        || receipt.executor != *adapter.executor()
        || receipt.environment_ref != environment_ref
        || receipt.job_package_ref != package_ref
        || receipt.provider != package.provider
        || receipt.checked_at_ms == 0
    {
        return Err(Error::Conflict(
            "remote preflight receipt does not match the frozen package or adapter".to_owned(),
        ));
    }
    Ok(receipt)
}

pub fn verify_compiled_job_package(
    workspace: &Workspace,
    environment: &ExecutorEnvironmentManifest,
    package: &ExecutorJobPackage,
) -> Result<String> {
    let (_, package_ref) = compiled_for_package(workspace, environment, package)?;
    Ok(package_ref)
}

pub fn authorize_remote_execution(
    workspace: &Workspace,
    environment: &ExecutorEnvironmentManifest,
    package: &ExecutorJobPackage,
    budget_id: &str,
    authorization_id: &str,
    expires_at_ms: u128,
) -> Result<RemoteExecutionAuthorization> {
    if authorization_id.trim().is_empty() {
        return validation("remote authorization ID must not be empty");
    }
    let (compiled, package_ref) = compiled_for_package(workspace, environment, package)?;
    let environment_ref = verify_environment_manifest(environment)?;
    let now = now_ms()?;
    if expires_at_ms <= now {
        return Err(Error::Security(
            "remote authorization expiry must be in the future".to_owned(),
        ));
    }

    if let Some(existing) = latest_typed::<RemoteExecutionAuthorization>(
        workspace,
        REMOTE_EXECUTION_AUTHORIZED,
        authorization_id,
    )? {
        if existing.experiment_id == package.experiment_id
            && existing.budget_id == budget_id
            && existing.compiled_ref == package.compiled_ref
            && existing.environment_ref == environment_ref
            && existing.job_package_ref == package_ref
            && existing.expires_at_ms == expires_at_ms
        {
            return Ok(existing);
        }
        return Err(Error::Conflict(format!(
            "remote authorization {authorization_id} is immutable"
        )));
    }

    for event in workspace
        .events()?
        .into_iter()
        .filter(|event| event.event_type == REMOTE_EXECUTION_AUTHORIZED)
    {
        let prior: RemoteExecutionAuthorization =
            workspace.get(&required_artifact(&event.event_type, event.artifact_ref)?)?;
        if prior.experiment_id == package.experiment_id {
            return Err(Error::Conflict(format!(
                "experiment {} already has remote authorization {}",
                package.experiment_id, prior.id
            )));
        }
    }

    let policy = authorize_unattended_run(workspace, budget_id, &package.experiment_id)?;
    if !policy.unattended {
        return Err(Error::Security(format!(
            "human acknowledgement required: {}",
            policy.acknowledgement_reasons.join("; ")
        )));
    }
    if policy.allocated_compute_credits < compiled.spec.funding.required_compute_credits {
        return Err(Error::Security(
            "remote authorization has insufficient allocated compute credits".to_owned(),
        ));
    }

    let stored_environment_ref = workspace.put(environment)?;
    let stored_package_ref = workspace.put(package)?;
    if stored_environment_ref != environment_ref || stored_package_ref != package_ref {
        return Err(Error::Conflict(
            "stored remote inputs changed canonical identity".to_owned(),
        ));
    }
    let authorization = RemoteExecutionAuthorization {
        schema: "ilxyr.remote_execution_authorization.v1".to_owned(),
        id: authorization_id.to_owned(),
        experiment_id: package.experiment_id.clone(),
        budget_id: budget_id.to_owned(),
        compiled_ref: package.compiled_ref.clone(),
        environment_ref,
        job_package_ref: package_ref,
        allocated_compute_credits: policy.allocated_compute_credits,
        authorized_at_ms: now,
        expires_at_ms,
    };
    let authorization_ref = workspace.put(&authorization)?;
    workspace.append_event(
        REMOTE_EXECUTION_AUTHORIZED,
        authorization_id,
        ActorRef::service("service://ilxyr/remote-authorizer-v1"),
        Some(authorization_ref),
    )?;
    Ok(authorization)
}

pub fn launch_remote_execution<A: RemoteExecutorAdapter>(
    workspace: &Workspace,
    adapter: &mut A,
    authorization_id: &str,
) -> Result<RemoteLaunchReceipt> {
    if let Some(receipt) =
        latest_typed::<RemoteLaunchReceipt>(workspace, REMOTE_LAUNCH_RECORDED, authorization_id)?
    {
        ensure_adapter_matches_receipt(adapter, &receipt)?;
        let reservation: RemoteLaunchReservation = workspace.get(&receipt.reservation_ref)?;
        if reservation.adapter != adapter.adapter_id()
            || reservation.adapter_configuration_ref != adapter.configuration_ref()?
        {
            return Err(Error::Conflict(
                "remote launch retry requires the reserved adapter configuration".to_owned(),
            ));
        }
        return Ok(receipt);
    }
    let (authorization_ref, authorization) = latest_typed_with_ref::<RemoteExecutionAuthorization>(
        workspace,
        REMOTE_EXECUTION_AUTHORIZED,
        authorization_id,
    )?
    .ok_or_else(|| Error::NotFound(format!("remote authorization {authorization_id}")))?;
    if authorization.expires_at_ms <= now_ms()? {
        return Err(Error::Security(format!(
            "remote authorization {authorization_id} has expired"
        )));
    }
    let environment: ExecutorEnvironmentManifest = workspace.get(&authorization.environment_ref)?;
    let package: ExecutorJobPackage = workspace.get(&authorization.job_package_ref)?;
    ensure_authorization_bindings(
        workspace,
        &authorization_ref,
        &authorization,
        &environment,
        &package,
    )?;
    preflight_remote_execution(adapter, &environment, &package)?;
    let adapter_configuration_ref = adapter.configuration_ref()?;

    let (reservation_ref, reservation) = match latest_typed_with_ref::<RemoteLaunchReservation>(
        workspace,
        REMOTE_LAUNCH_RESERVED,
        authorization_id,
    )? {
        Some(existing) => existing,
        None => {
            let reservation = RemoteLaunchReservation {
                schema: "ilxyr.remote_launch_reservation.v1".to_owned(),
                id: format!("remote-launch-reservation:{authorization_id}"),
                adapter: adapter.adapter_id().to_owned(),
                adapter_configuration_ref: adapter_configuration_ref.clone(),
                authorization_ref: authorization_ref.clone(),
                environment_ref: authorization.environment_ref.clone(),
                job_package_ref: authorization.job_package_ref.clone(),
                idempotency_key: format!(
                    "ilxyr-{}",
                    authorization_ref
                        .strip_prefix("artifact://sha256/")
                        .expect("workspace references use the artifact prefix")
                ),
                reserved_at_ms: now_ms()?,
            };
            let reservation_ref = workspace.put(&reservation)?;
            workspace.append_event(
                REMOTE_LAUNCH_RESERVED,
                authorization_id,
                ActorRef::service("service://ilxyr/remote-dispatcher-v1"),
                Some(reservation_ref.clone()),
            )?;
            (reservation_ref, reservation)
        }
    };
    if reservation.adapter != adapter.adapter_id()
        || reservation.adapter_configuration_ref != adapter_configuration_ref
    {
        return Err(Error::Conflict(
            "remote launch retry requires the reserved adapter configuration".to_owned(),
        ));
    }
    if reservation.authorization_ref != authorization_ref
        || reservation.environment_ref != authorization.environment_ref
        || reservation.job_package_ref != authorization.job_package_ref
    {
        return Err(Error::Conflict(
            "remote launch reservation does not match its authorization".to_owned(),
        ));
    }
    let request = RemoteLaunchRequest {
        schema: "ilxyr.remote_launch_request.v1".to_owned(),
        authorization_ref: authorization_ref.clone(),
        reservation_ref: reservation_ref.clone(),
        environment_ref: authorization.environment_ref.clone(),
        job_package_ref: authorization.job_package_ref.clone(),
        idempotency_key: reservation.idempotency_key.clone(),
        reserved_at_ms: reservation.reserved_at_ms,
    };
    let provider_receipt = adapter.launch(&request, &environment, &package)?;
    if provider_receipt.schema != "ilxyr.provider_launch_receipt.v1"
        || provider_receipt.provider_instance_id.trim().is_empty()
        || provider_receipt.machine_image_id != package.provider.image_id
        || provider_receipt.machine_image_sha256 != package.provider.image_sha256
        || provider_receipt.launched_at_ms < authorization.authorized_at_ms
        || provider_receipt.launched_at_ms >= authorization.expires_at_ms
    {
        return Err(Error::Conflict(
            "provider launch receipt does not match the frozen machine image".to_owned(),
        ));
    }
    let receipt = RemoteLaunchReceipt {
        schema: "ilxyr.remote_launch_receipt.v1".to_owned(),
        id: format!("remote-launch:{authorization_id}"),
        adapter: adapter.adapter_id().to_owned(),
        executor: adapter.executor().clone(),
        authorization_ref,
        reservation_ref,
        environment_ref: authorization.environment_ref,
        job_package_ref: authorization.job_package_ref,
        provider: package.provider,
        provider_instance_id: provider_receipt.provider_instance_id,
        launched_at_ms: provider_receipt.launched_at_ms,
    };
    let receipt_ref = workspace.put(&receipt)?;
    workspace.append_event(
        REMOTE_LAUNCH_RECORDED,
        authorization_id,
        ActorRef::service("service://ilxyr/remote-dispatcher-v1"),
        Some(receipt_ref),
    )?;
    Ok(receipt)
}

pub fn observe_remote_execution<A: RemoteExecutorAdapter>(
    workspace: &Workspace,
    adapter: &mut A,
    authorization_id: &str,
) -> Result<RemoteExecutionObservation> {
    let (launch_ref, receipt) = latest_typed_with_ref::<RemoteLaunchReceipt>(
        workspace,
        REMOTE_LAUNCH_RECORDED,
        authorization_id,
    )?
    .ok_or_else(|| Error::NotFound(format!("remote launch {authorization_id}")))?;
    ensure_adapter_matches_receipt(adapter, &receipt)?;
    let observation = adapter.observe(&receipt)?;
    if observation.schema != "ilxyr.remote_execution_observation.v1"
        || observation.launch_ref != launch_ref
        || observation.provider_instance_id != receipt.provider_instance_id
        || observation.observed_at_ms == 0
    {
        return Err(Error::Conflict(
            "remote observation does not match the launch receipt".to_owned(),
        ));
    }
    Ok(observation)
}

pub fn collect_remote_execution_report<A: RemoteExecutorAdapter>(
    workspace: &Workspace,
    adapter: &mut A,
    authorization_id: &str,
) -> Result<ExecutionReport> {
    let (launch_ref, receipt) = latest_typed_with_ref::<RemoteLaunchReceipt>(
        workspace,
        REMOTE_LAUNCH_RECORDED,
        authorization_id,
    )?
    .ok_or_else(|| Error::NotFound(format!("remote launch {authorization_id}")))?;
    ensure_adapter_matches_receipt(adapter, &receipt)?;
    let environment: ExecutorEnvironmentManifest = workspace.get(&receipt.environment_ref)?;
    let package: ExecutorJobPackage = workspace.get(&receipt.job_package_ref)?;
    let report = adapter.collect(&receipt, &environment, &package)?;
    if report.authorization_ref != receipt.authorization_ref
        || report.launch_ref != launch_ref
        || report.environment_ref != receipt.environment_ref
        || report.job_package_ref != receipt.job_package_ref
        || report.executor != receipt.executor
        || report.provider_instance_id != receipt.provider_instance_id
    {
        return Err(Error::Conflict(
            "collected report does not match the recorded launch".to_owned(),
        ));
    }
    Ok(report)
}

pub fn accept_remote_execution_report(
    workspace: &Workspace,
    report: &ExecutionReport,
) -> Result<AcceptedRemoteReport> {
    let authorization: RemoteExecutionAuthorization = workspace.get(&report.authorization_ref)?;
    ensure_event_artifact(
        workspace,
        REMOTE_EXECUTION_AUTHORIZED,
        &authorization.id,
        &report.authorization_ref,
    )?;
    let (launch_ref, receipt) = latest_typed_with_ref::<RemoteLaunchReceipt>(
        workspace,
        REMOTE_LAUNCH_RECORDED,
        &authorization.id,
    )?
    .ok_or_else(|| Error::NotFound(format!("remote launch {}", authorization.id)))?;
    if report.launch_ref != launch_ref {
        return Err(Error::Conflict(
            "execution report does not bind the ledgered launch receipt".to_owned(),
        ));
    }
    if let Some(existing) =
        latest_typed::<AcceptedRemoteReport>(workspace, REMOTE_REPORT_ACCEPTED, &authorization.id)?
    {
        let report_ref = object_ref(report)?;
        if existing.report_ref == report_ref {
            return Ok(existing);
        }
        return Err(Error::Conflict(format!(
            "remote launch {launch_ref} is already bound to report {}",
            existing.report_ref
        )));
    }

    let environment: ExecutorEnvironmentManifest = workspace.get(&authorization.environment_ref)?;
    let package: ExecutorJobPackage = workspace.get(&authorization.job_package_ref)?;
    let compiled = ensure_authorization_bindings(
        workspace,
        &report.authorization_ref,
        &authorization,
        &environment,
        &package,
    )?;
    if receipt.authorization_ref != report.authorization_ref
        || receipt.environment_ref != report.environment_ref
        || receipt.job_package_ref != report.job_package_ref
        || receipt.executor != report.executor
        || receipt.provider_instance_id != report.provider_instance_id
        || receipt.provider.image_id != report.machine_image_id
        || receipt.provider.image_sha256 != report.machine_image_sha256
        || report.run.started_at_ms < receipt.launched_at_ms
    {
        return Err(Error::Conflict(
            "execution report provider identity does not match the launch receipt".to_owned(),
        ));
    }
    let encoded_report = serde_json::to_vec(report)?;
    if encoded_report.len() as u64 > package.reporting.max_report_bytes {
        return Err(Error::Security(
            "execution report exceeds the frozen size limit".to_owned(),
        ));
    }
    let trusted_keys = trusted_attestation_keys(workspace)?;
    let verified = verify_execution_report(&environment, &package, &trusted_keys, report)?;
    let expected_metrics = compiled
        .spec
        .metrics
        .iter()
        .map(|metric| metric.name.as_str())
        .collect::<BTreeSet<_>>();
    let reported_metrics = report
        .run
        .metrics
        .keys()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    if reported_metrics != expected_metrics {
        return Err(Error::Conflict(
            "remote run metrics do not exactly match the compiled experiment".to_owned(),
        ));
    }
    let expected_outputs = package
        .expected_outputs
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let reported_outputs = report
        .outputs
        .iter()
        .map(|output| output.name.as_str())
        .collect::<BTreeSet<_>>();
    if reported_outputs != expected_outputs
        || !report.run.stdout.is_empty()
        || !report.run.stderr.is_empty()
        || report.run.output_truncated
        || report.run.output_error.is_some()
        || report.run.source_attestation.is_some()
    {
        return Err(Error::Security(
            "remote metrics-only report contains undeclared output".to_owned(),
        ));
    }
    let duration_ms = report
        .run
        .completed_at_ms
        .saturating_sub(report.run.started_at_ms);
    if duration_ms > u128::from(package.budget.max_runtime_seconds) * 1_000 {
        return Err(Error::Security(
            "remote run exceeded the frozen runtime limit".to_owned(),
        ));
    }
    let resolved_outcome = resolve_outcome(&compiled.spec, &report.run)?;
    let report_ref = workspace.put(report)?;
    if report_ref != verified.report_ref {
        return Err(Error::Conflict(
            "verified report identity changed while storing it".to_owned(),
        ));
    }
    let accepted = AcceptedRemoteReport {
        schema: "ilxyr.accepted_remote_report.v1".to_owned(),
        experiment_id: authorization.experiment_id,
        report_ref,
        verified,
        resolved_outcome,
        accepted_at_ms: now_ms()?,
    };
    let accepted_ref = workspace.put(&accepted)?;
    workspace.append_event(
        REMOTE_REPORT_ACCEPTED,
        &authorization.id,
        ActorRef::service("service://ilxyr/report-intake-v1"),
        Some(accepted_ref),
    )?;
    Ok(accepted)
}

fn compiled_for_package(
    workspace: &Workspace,
    environment: &ExecutorEnvironmentManifest,
    package: &ExecutorJobPackage,
) -> Result<(CompiledExperiment, String)> {
    let package_ref = verify_job_package(environment, package)?;
    let (compiled_ref, compiled) = latest_typed_with_ref::<CompiledExperiment>(
        workspace,
        EXPERIMENT_COMPILED,
        &package.experiment_id,
    )?
    .ok_or_else(|| Error::NotFound(format!("compiled experiment {}", package.experiment_id)))?;
    if package.compiled_ref != compiled_ref || compiled.spec.id != package.experiment_id {
        return Err(Error::Conflict(
            "job package does not bind the ledgered compiled experiment".to_owned(),
        ));
    }
    let spec = &compiled.spec;
    let targets = spec
        .seeds
        .iter()
        .map(|seed| format!("seed:{seed}"))
        .collect::<Vec<_>>();
    if spec.execution.executor != "remote-v1"
        || spec.security.weight_class != WeightClass::Public
        || spec.security.code_policy != CodePolicy::ApprovedImageOnly
        || spec.security.export_policy != ExportPolicy::MetricsOnly
        || spec.execution.network != crate::NetworkPolicy::Denied
        || package.weight_class != spec.security.weight_class
        || package.export_policy != spec.security.export_policy
        || package.network != ExecutionNetworkMode::Denied
        || package.executable.uri != spec.execution.program
        || package.arguments != spec.execution.args
        || package.budget.max_runtime_seconds != spec.execution.timeout_seconds
        || package.targets != targets
    {
        return Err(Error::Security(
            "job package does not exactly match the remote-v1 compiled experiment".to_owned(),
        ));
    }
    let primary_output = format!("metrics.{}", spec.outcome_contract.primary_metric);
    if !package
        .expected_outputs
        .iter()
        .all(|output| spec.expected_outputs.contains(output))
        || !package.expected_outputs.contains(&primary_output)
    {
        return Err(Error::Security(
            "job package outputs do not match the compiled experiment's executable outputs"
                .to_owned(),
        ));
    }
    let input_uris = package
        .inputs
        .iter()
        .map(|input| input.uri.as_str())
        .collect::<BTreeSet<_>>();
    if spec
        .datasets
        .iter()
        .chain(&spec.models)
        .any(|handle| !input_uris.contains(handle.as_str()))
    {
        return Err(Error::Security(
            "job package inputs do not cover every compiled dataset and model handle".to_owned(),
        ));
    }
    Ok((compiled, package_ref))
}

fn ensure_authorization_bindings(
    workspace: &Workspace,
    authorization_ref: &str,
    authorization: &RemoteExecutionAuthorization,
    environment: &ExecutorEnvironmentManifest,
    package: &ExecutorJobPackage,
) -> Result<CompiledExperiment> {
    ensure_event_artifact(
        workspace,
        REMOTE_EXECUTION_AUTHORIZED,
        &authorization.id,
        authorization_ref,
    )?;
    let (compiled, package_ref) = compiled_for_package(workspace, environment, package)?;
    let environment_ref = verify_environment_manifest(environment)?;
    if authorization.experiment_id != package.experiment_id
        || authorization.compiled_ref != package.compiled_ref
        || authorization.environment_ref != environment_ref
        || authorization.job_package_ref != package_ref
    {
        return Err(Error::Conflict(
            "remote authorization no longer matches its immutable inputs".to_owned(),
        ));
    }
    let current_policy = authorize_unattended_run(
        workspace,
        &authorization.budget_id,
        &authorization.experiment_id,
    )?;
    if !current_policy.unattended
        || current_policy.allocated_compute_credits != authorization.allocated_compute_credits
    {
        return Err(Error::Security(
            "remote execution no longer satisfies its signed budget authorization".to_owned(),
        ));
    }
    Ok(compiled)
}

fn ensure_adapter_matches_receipt<A: RemoteExecutorAdapter>(
    adapter: &A,
    receipt: &RemoteLaunchReceipt,
) -> Result<()> {
    if adapter.adapter_id() != receipt.adapter || adapter.executor() != &receipt.executor {
        return Err(Error::Security(
            "remote adapter does not own the recorded launch".to_owned(),
        ));
    }
    Ok(())
}

fn ensure_event_artifact(
    workspace: &Workspace,
    event_type: &str,
    aggregate_id: &str,
    artifact_ref: &str,
) -> Result<()> {
    let event = workspace
        .latest_event(event_type, aggregate_id)?
        .ok_or_else(|| Error::NotFound(format!("{event_type} {aggregate_id}")))?;
    if event.artifact_ref.as_deref() != Some(artifact_ref) {
        return Err(Error::Conflict(format!(
            "{event_type} does not bind artifact {artifact_ref}"
        )));
    }
    Ok(())
}

fn latest_typed<T: DeserializeOwned>(
    workspace: &Workspace,
    event_type: &str,
    aggregate_id: &str,
) -> Result<Option<T>> {
    latest_typed_with_ref(workspace, event_type, aggregate_id)
        .map(|object| object.map(|(_, value)| value))
}

fn latest_typed_with_ref<T: DeserializeOwned>(
    workspace: &Workspace,
    event_type: &str,
    aggregate_id: &str,
) -> Result<Option<(String, T)>> {
    workspace
        .latest_event(event_type, aggregate_id)?
        .map(|event| {
            let artifact_ref = required_artifact(&event.event_type, event.artifact_ref)?;
            let object = workspace.get(&artifact_ref)?;
            Ok((artifact_ref, object))
        })
        .transpose()
}

fn required_artifact(event_type: &str, artifact_ref: Option<String>) -> Result<String> {
    artifact_ref.ok_or_else(|| {
        Error::Conflict(format!(
            "{event_type} event is missing its artifact reference"
        ))
    })
}

fn object_ref<T: Serialize>(value: &T) -> Result<String> {
    Ok(format!("artifact://sha256/{}", Workspace::digest(value)?))
}

fn validation<T>(message: impl Into<String>) -> Result<T> {
    Err(Error::Validation(vec![message.into()]))
}
