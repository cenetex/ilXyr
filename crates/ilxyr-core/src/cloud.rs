use std::collections::BTreeSet;

use crate::{
    ActorKind, AdmissionDecision, CompletedExperiment, Error, ExperimentSpec, OciJobCompletion,
    OciJobDispatch, Result, RunOutputArtifact, RunRecord, Workspace, corpus,
    has_verified_executor_attestation, lifecycle, workflow,
};

const ADMISSION_DECIDED: &str = "AdmissionDecided";
const EXECUTION_STARTED: &str = "ExecutionStarted";
const EXPERIMENT_COMPILED: &str = "ExperimentCompiled";
const EXPERIMENT_COMPLETED: &str = "ExperimentCompleted";

/// Records a provider job after submission. The object is also the immutable
/// ExecutionStarted payload, so a retry either returns the same ref or fails.
pub fn record_oci_job_dispatch(workspace: &Workspace, dispatch: OciJobDispatch) -> Result<String> {
    validate_dispatch_shape(&dispatch)?;
    let compiled = workflow::load_compiled(workspace, &dispatch.experiment_id)?;
    if compiled.spec.execution.executor != "oci-job" {
        return Err(Error::Conflict(
            "experiment is not configured for the oci-job executor".to_owned(),
        ));
    }
    let compiled_event = workspace
        .latest_event(EXPERIMENT_COMPILED, &dispatch.experiment_id)?
        .ok_or_else(|| {
            Error::NotFound(format!("compiled experiment {}", dispatch.experiment_id))
        })?;
    let current_compiled_ref = required_artifact(EXPERIMENT_COMPILED, compiled_event.artifact_ref)?;
    if dispatch.compiled_ref != current_compiled_ref {
        return Err(Error::Conflict(format!(
            "dispatch compiled_ref {} does not match frozen experiment {}",
            dispatch.compiled_ref, current_compiled_ref
        )));
    }

    if let Some(existing_event) =
        workspace.latest_event(EXECUTION_STARTED, &dispatch.experiment_id)?
    {
        let existing_ref = required_artifact(EXECUTION_STARTED, existing_event.artifact_ref)?;
        let existing: OciJobDispatch = workspace.get(&existing_ref)?;
        if existing == dispatch {
            return Ok(existing_ref);
        }
        return Err(Error::Conflict(format!(
            "experiment {} already has a different OCI dispatch",
            dispatch.experiment_id
        )));
    }

    let admission_event = workspace
        .latest_event(ADMISSION_DECIDED, &dispatch.experiment_id)?
        .ok_or_else(|| Error::Conflict("experiment has no admission decision".to_owned()))?;
    let admission_ref = required_artifact(ADMISSION_DECIDED, admission_event.artifact_ref)?;
    let admission: AdmissionDecision = workspace.get(&admission_ref)?;
    if !admission.accepted {
        return Err(Error::Conflict(
            "latest admission decision rejected this experiment".to_owned(),
        ));
    }
    lifecycle::ensure_test_access_allowed(workspace, &dispatch.experiment_id)?;
    if workflow::evaluate_admission(workspace, &compiled)?
        .iter()
        .any(|gate| !gate.passed)
    {
        return Err(Error::Conflict(
            "experiment no longer satisfies admission gates".to_owned(),
        ));
    }

    let expected_datasets = compiled
        .resolved_datasets
        .keys()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let supplied_datasets = dispatch
        .materializations
        .keys()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    if supplied_datasets != expected_datasets {
        return Err(Error::Conflict(
            "dispatch materializations must match every frozen dataset binding exactly".to_owned(),
        ));
    }
    for (dataset, materialization_ref) in &dispatch.materializations {
        let materialization =
            corpus::corpus_materialization_by_ref(workspace, materialization_ref)?;
        let expected_corpus_ref = compiled.resolved_datasets.get(dataset).ok_or_else(|| {
            Error::Conflict(format!("dataset {dataset} is not frozen by the experiment"))
        })?;
        if materialization.corpus_ref != *expected_corpus_ref {
            return Err(Error::Conflict(format!(
                "materialization for {dataset} binds {}, expected {expected_corpus_ref}",
                materialization.corpus_ref
            )));
        }
    }

    let artifact_ref = workspace.put(&dispatch)?;
    workspace.append_event(
        EXECUTION_STARTED,
        &dispatch.experiment_id,
        dispatch.executor,
        Some(artifact_ref.clone()),
    )?;
    Ok(artifact_ref)
}

/// Reconciles a completed provider job into a ledgered run. Evidence is not
/// promoted here; settlement separately requires a trusted DSSE attestation.
pub fn record_oci_job_completion(
    workspace: &Workspace,
    completion: OciJobCompletion,
) -> Result<String> {
    validate_completion_shape(&completion)?;
    let dispatch: OciJobDispatch = workspace.get(&completion.dispatch_ref)?;
    let started_event = workspace
        .latest_event(EXECUTION_STARTED, &dispatch.experiment_id)?
        .ok_or_else(|| Error::NotFound(format!("OCI dispatch {}", completion.dispatch_ref)))?;
    if started_event.artifact_ref.as_deref() != Some(completion.dispatch_ref.as_str()) {
        return Err(Error::Conflict(
            "completion does not reference the active OCI dispatch".to_owned(),
        ));
    }
    if completion.executor != dispatch.executor {
        return Err(Error::Security(
            "completion executor does not match the dispatched executor".to_owned(),
        ));
    }
    if completion.completed_at_ms < dispatch.dispatched_at_ms {
        return Err(Error::Validation(vec![
            "completion.completed_at_ms cannot precede dispatch".to_owned(),
        ]));
    }
    let compiled = workflow::load_compiled(workspace, &dispatch.experiment_id)?;
    validate_completion_contract(&compiled.spec, &completion)?;
    let expected_run = RunRecord {
        schema: "ilxyr.run.v1".to_owned(),
        id: completion.id.clone(),
        experiment_id: dispatch.experiment_id.clone(),
        started_at_ms: dispatch.dispatched_at_ms,
        completed_at_ms: completion.completed_at_ms,
        exit_code: completion.exit_code,
        timed_out: completion.timed_out,
        stdout: String::new(),
        stderr: String::new(),
        output_truncated: false,
        output_error: None,
        metrics: completion.metrics,
        artifacts: completion.artifacts,
        source_attestation: None,
    };

    if let Some(existing_event) =
        workspace.latest_event(EXPERIMENT_COMPLETED, &dispatch.experiment_id)?
    {
        let existing_ref = required_artifact(EXPERIMENT_COMPLETED, existing_event.artifact_ref)?;
        let existing: RunRecord = workspace.get(&existing_ref)?;
        if runs_match(&existing, &expected_run) {
            return Ok(existing_ref);
        }
        return Err(Error::Conflict(format!(
            "experiment {} already has a different completion",
            dispatch.experiment_id
        )));
    }

    let run_ref = workspace.put(&expected_run)?;
    workspace.append_event(
        EXPERIMENT_COMPLETED,
        &dispatch.experiment_id,
        dispatch.executor,
        Some(run_ref.clone()),
    )?;
    Ok(run_ref)
}

pub fn settle_oci_job(workspace: &Workspace, experiment_id: &str) -> Result<CompletedExperiment> {
    let compiled = workflow::load_compiled(workspace, experiment_id)?;
    if compiled.spec.execution.executor != "oci-job" {
        return Err(Error::Conflict(
            "experiment is not configured for the oci-job executor".to_owned(),
        ));
    }
    let dispatch_event = workspace
        .latest_event(EXECUTION_STARTED, experiment_id)?
        .ok_or_else(|| Error::NotFound(format!("OCI dispatch for {experiment_id}")))?;
    let dispatch_ref = required_artifact(EXECUTION_STARTED, dispatch_event.artifact_ref)?;
    let dispatch: OciJobDispatch = workspace.get(&dispatch_ref)?;
    let completed_event = workspace
        .latest_event(EXPERIMENT_COMPLETED, experiment_id)?
        .ok_or_else(|| Error::NotFound(format!("completed OCI run for {experiment_id}")))?;
    let run_ref = required_artifact(EXPERIMENT_COMPLETED, completed_event.artifact_ref)?;
    let run: RunRecord = workspace.get(&run_ref)?;
    if !has_verified_executor_attestation(workspace, &run_ref, &dispatch.executor)? {
        return Err(Error::Security(format!(
            "run {run_ref} has no trusted attestation from {}",
            dispatch.executor.id
        )));
    }
    workflow::finalize_completed_run(workspace, &compiled, run_ref, run)
}

fn validate_dispatch_shape(dispatch: &OciJobDispatch) -> Result<()> {
    let mut errors = Vec::new();
    if dispatch.schema != "ilxyr.oci_job_dispatch.v1" {
        errors.push("dispatch.schema must be ilxyr.oci_job_dispatch.v1".to_owned());
    }
    if dispatch.id.trim().is_empty() || dispatch.experiment_id.trim().is_empty() {
        errors.push("dispatch id and experiment_id must not be empty".to_owned());
    }
    if !valid_artifact_ref(&dispatch.compiled_ref) {
        errors.push("dispatch.compiled_ref must be an artifact reference".to_owned());
    }
    if dispatch.executor.kind != ActorKind::Service
        || !dispatch.executor.id.starts_with("service://")
        || dispatch.executor.model_ref.is_some()
    {
        errors.push("dispatch.executor must be a service actor".to_owned());
    }
    if !valid_handle(&dispatch.provider_job_ref) {
        errors.push("dispatch.provider_job_ref must be a non-file provider handle".to_owned());
    }
    if dispatch.idempotency_key.trim().is_empty()
        || dispatch.idempotency_key.chars().any(char::is_whitespace)
    {
        errors.push("dispatch.idempotency_key must not be empty or contain whitespace".to_owned());
    }
    if dispatch.dispatched_at_ms == 0 {
        errors.push("dispatch.dispatched_at_ms must be positive".to_owned());
    }
    for materialization_ref in dispatch.materializations.values() {
        if !valid_artifact_ref(materialization_ref) {
            errors.push("dispatch materialization values must be artifact references".to_owned());
        }
    }
    finish(errors)
}

fn validate_completion_shape(completion: &OciJobCompletion) -> Result<()> {
    let mut errors = Vec::new();
    if completion.schema != "ilxyr.oci_job_completion.v1" {
        errors.push("completion.schema must be ilxyr.oci_job_completion.v1".to_owned());
    }
    if completion.id.trim().is_empty() {
        errors.push("completion.id must not be empty".to_owned());
    }
    if !valid_artifact_ref(&completion.dispatch_ref) {
        errors.push("completion.dispatch_ref must be an artifact reference".to_owned());
    }
    if completion.executor.kind != ActorKind::Service
        || !completion.executor.id.starts_with("service://")
        || completion.executor.model_ref.is_some()
    {
        errors.push("completion.executor must be a service actor".to_owned());
    }
    if completion.completed_at_ms == 0 {
        errors.push("completion.completed_at_ms must be positive".to_owned());
    }
    finish(errors)
}

fn validate_completion_contract(
    spec: &ExperimentSpec,
    completion: &OciJobCompletion,
) -> Result<()> {
    let succeeded = completion.exit_code == 0 && !completion.timed_out;
    let declared_metrics = spec
        .metrics
        .iter()
        .map(|metric| metric.name.as_str())
        .collect::<BTreeSet<_>>();
    let actual_metrics = completion
        .metrics
        .keys()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    if completion.metrics.values().any(|value| !value.is_finite()) {
        return Err(Error::Validation(vec![
            "completion metrics must be finite".to_owned(),
        ]));
    }
    if (succeeded && actual_metrics != declared_metrics)
        || (!succeeded && !actual_metrics.is_empty())
    {
        return Err(Error::Conflict(
            "completion metrics do not match the frozen successful-run contract".to_owned(),
        ));
    }

    let declared_artifacts = spec
        .expected_outputs
        .iter()
        .filter_map(|output| output.strip_prefix("artifacts."))
        .collect::<BTreeSet<_>>();
    let actual_artifacts = completion
        .artifacts
        .iter()
        .map(|artifact| artifact.name.as_str())
        .collect::<BTreeSet<_>>();
    if actual_artifacts.len() != completion.artifacts.len() {
        return Err(Error::Conflict(
            "completion contains duplicate artifact names".to_owned(),
        ));
    }
    if (succeeded && actual_artifacts != declared_artifacts)
        || (!succeeded && !actual_artifacts.is_empty())
    {
        return Err(Error::Conflict(
            "completion artifacts do not match the frozen successful-run contract".to_owned(),
        ));
    }
    for artifact in &completion.artifacts {
        validate_output_artifact(artifact)?;
    }
    Ok(())
}

fn validate_output_artifact(artifact: &RunOutputArtifact) -> Result<()> {
    let mut errors = Vec::new();
    if artifact.name.trim().is_empty() {
        errors.push("artifact.name must not be empty".to_owned());
    }
    if !valid_handle(&artifact.uri) {
        errors.push("artifact.uri must be a non-file provider handle".to_owned());
    }
    if !valid_digest(&artifact.sha256) {
        errors.push("artifact.sha256 must be a lowercase SHA-256 digest".to_owned());
    }
    if artifact.media_type.trim().is_empty()
        || !artifact.media_type.contains('/')
        || artifact.media_type.chars().any(char::is_whitespace)
    {
        errors.push("artifact.media_type must be a MIME type".to_owned());
    }
    if artifact.provider_version.trim().is_empty() {
        errors.push("artifact.provider_version must not be empty".to_owned());
    }
    finish(errors)
}

fn runs_match(left: &RunRecord, right: &RunRecord) -> bool {
    left.schema == right.schema
        && left.id == right.id
        && left.experiment_id == right.experiment_id
        && left.started_at_ms == right.started_at_ms
        && left.completed_at_ms == right.completed_at_ms
        && left.exit_code == right.exit_code
        && left.timed_out == right.timed_out
        && left.metrics == right.metrics
        && left.artifacts == right.artifacts
}

fn valid_artifact_ref(value: &str) -> bool {
    value
        .strip_prefix("artifact://sha256/")
        .is_some_and(valid_digest)
}

fn valid_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn valid_handle(value: &str) -> bool {
    value.contains("://")
        && !value.starts_with("file://")
        && !value.chars().any(char::is_whitespace)
}

fn required_artifact(event_type: &str, artifact_ref: Option<String>) -> Result<String> {
    artifact_ref.ok_or_else(|| {
        Error::Conflict(format!(
            "{event_type} event is missing its artifact reference"
        ))
    })
}

fn finish(errors: Vec<String>) -> Result<()> {
    if errors.is_empty() {
        Ok(())
    } else {
        Err(Error::Validation(errors))
    }
}
