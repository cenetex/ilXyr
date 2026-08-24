use crate::{
    ActorRef, CompiledExperiment, Error, ExternalRegistrationReceipt, GateCheck,
    RegistrationPackage, Result, Workspace, validation,
};

const EXPERIMENT_COMPILED: &str = "ExperimentCompiled";
const EXECUTION_STARTED: &str = "ExecutionStarted";
const REGISTRATION_PACKAGED: &str = "RegistrationPackaged";
const EXTERNAL_REGISTRATION_RECORDED: &str = "ExternalRegistrationRecorded";

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreparedRegistration {
    pub package_ref: String,
    pub package: RegistrationPackage,
}

pub fn prepare_registration(
    workspace: &Workspace,
    experiment_id: &str,
) -> Result<PreparedRegistration> {
    let (compiled_ref, compiled) = compiled_experiment(workspace, experiment_id)?;
    let requirement = compiled.spec.preregistration.clone().ok_or_else(|| {
        Error::Validation(vec![format!(
            "experiment {experiment_id} does not require an external preregistration"
        )])
    })?;
    let package = RegistrationPackage {
        schema: "ilxyr.registration_package.v1".to_owned(),
        id: format!("preregistration:{experiment_id}"),
        experiment_id: experiment_id.to_owned(),
        compiled_ref,
        compiled,
        requirement,
    };
    let expected_ref = artifact_ref_for(&package)?;

    if let Some(event) = workspace.latest_event(REGISTRATION_PACKAGED, experiment_id)? {
        let existing_ref = required_artifact(&event.event_type, event.artifact_ref)?;
        if existing_ref != expected_ref {
            return Err(Error::Conflict(format!(
                "experiment {experiment_id} already has a different registration package"
            )));
        }
        let existing = workspace.get(&existing_ref)?;
        return Ok(PreparedRegistration {
            package_ref: existing_ref,
            package: existing,
        });
    }

    ensure_not_started(workspace, experiment_id)?;
    let package_ref = workspace.put(&package)?;
    workspace.append_event(
        REGISTRATION_PACKAGED,
        experiment_id,
        ActorRef::service("service://ilxyr/registration-packager-v1"),
        Some(package_ref.clone()),
    )?;
    Ok(PreparedRegistration {
        package_ref,
        package,
    })
}

pub fn record_external_registration(
    workspace: &Workspace,
    receipt: ExternalRegistrationReceipt,
) -> Result<String> {
    validation::external_registration_receipt(&receipt)?;
    let expected_ref = artifact_ref_for(&receipt)?;

    if let Some(event) =
        workspace.latest_event(EXTERNAL_REGISTRATION_RECORDED, &receipt.experiment_id)?
    {
        let existing_ref = required_artifact(&event.event_type, event.artifact_ref)?;
        if existing_ref == expected_ref {
            return Ok(existing_ref);
        }
        return Err(Error::Conflict(format!(
            "experiment {} already has a different external registration receipt",
            receipt.experiment_id
        )));
    }

    ensure_not_started(workspace, &receipt.experiment_id)?;
    for event in workspace
        .events()?
        .into_iter()
        .filter(|event| event.event_type == EXTERNAL_REGISTRATION_RECORDED)
    {
        let existing_ref = required_artifact(&event.event_type, event.artifact_ref)?;
        let existing: ExternalRegistrationReceipt = workspace.get(&existing_ref)?;
        if existing.provider == receipt.provider
            && existing.registration_id == receipt.registration_id
            && existing.experiment_id != receipt.experiment_id
        {
            return Err(Error::Conflict(format!(
                "external registration {} is already bound to experiment {}",
                receipt.registration_id, existing.experiment_id
            )));
        }
    }

    let (_, compiled) = compiled_experiment(workspace, &receipt.experiment_id)?;
    validate_receipt_binding(workspace, &compiled, &receipt)?;
    let artifact_ref = workspace.put(&receipt)?;
    workspace.append_event(
        EXTERNAL_REGISTRATION_RECORDED,
        &receipt.experiment_id,
        receipt.registered_by.clone(),
        Some(artifact_ref.clone()),
    )?;
    Ok(artifact_ref)
}

pub(crate) fn admission_gate(
    workspace: &Workspace,
    compiled: &CompiledExperiment,
) -> Result<GateCheck> {
    let Some(requirement) = &compiled.spec.preregistration else {
        return Ok(GateCheck {
            gate: "external_preregistration".to_owned(),
            passed: true,
            detail: "the frozen experiment does not require an external registration".to_owned(),
        });
    };
    let Some(event) = workspace.latest_event(EXTERNAL_REGISTRATION_RECORDED, &compiled.spec.id)?
    else {
        return Ok(GateCheck {
            gate: "external_preregistration".to_owned(),
            passed: false,
            detail: format!(
                "a {:?} {:?} registration receipt is required",
                requirement.visibility, requirement.provider
            ),
        });
    };
    let receipt_ref = required_artifact(&event.event_type, event.artifact_ref)?;
    let receipt: ExternalRegistrationReceipt = workspace.get(&receipt_ref)?;
    validate_receipt_binding(workspace, compiled, &receipt)?;
    Ok(GateCheck {
        gate: "external_preregistration".to_owned(),
        passed: true,
        detail: format!(
            "{:?} registration {} is bound to the frozen package",
            receipt.provider, receipt.registration_id
        ),
    })
}

fn validate_receipt_binding(
    workspace: &Workspace,
    compiled: &CompiledExperiment,
    receipt: &ExternalRegistrationReceipt,
) -> Result<()> {
    let requirement = compiled.spec.preregistration.as_ref().ok_or_else(|| {
        Error::Validation(vec![format!(
            "experiment {} does not require an external preregistration",
            compiled.spec.id
        )])
    })?;
    if receipt.experiment_id != compiled.spec.id {
        return Err(Error::Conflict(format!(
            "registration receipt belongs to {}, expected {}",
            receipt.experiment_id, compiled.spec.id
        )));
    }
    if receipt.provider != requirement.provider || receipt.visibility != requirement.visibility {
        return Err(Error::Validation(vec![format!(
            "registration receipt provider/visibility does not match the frozen requirement for {}",
            compiled.spec.id
        )]));
    }

    let package_event = workspace
        .latest_event(REGISTRATION_PACKAGED, &compiled.spec.id)?
        .ok_or_else(|| {
            Error::Conflict(format!(
                "experiment {} has no ledgered registration package",
                compiled.spec.id
            ))
        })?;
    let expected_package_ref =
        required_artifact(&package_event.event_type, package_event.artifact_ref)?;
    if receipt.package_ref != expected_package_ref {
        return Err(Error::Conflict(format!(
            "registration receipt package {} does not match ledgered package {expected_package_ref}",
            receipt.package_ref
        )));
    }
    let package: RegistrationPackage = workspace.get(&receipt.package_ref)?;
    let (current_compiled_ref, _) = compiled_experiment(workspace, &compiled.spec.id)?;
    if package.experiment_id != compiled.spec.id
        || package.compiled_ref != current_compiled_ref
        || artifact_ref_for(&package.compiled)? != package.compiled_ref
        || package.requirement != *requirement
    {
        return Err(Error::Conflict(format!(
            "registration package is not bound to the current frozen experiment {}",
            compiled.spec.id
        )));
    }
    Ok(())
}

fn compiled_experiment(
    workspace: &Workspace,
    experiment_id: &str,
) -> Result<(String, CompiledExperiment)> {
    let event = workspace
        .latest_event(EXPERIMENT_COMPILED, experiment_id)?
        .ok_or_else(|| Error::NotFound(format!("compiled experiment {experiment_id}")))?;
    let artifact_ref = required_artifact(&event.event_type, event.artifact_ref)?;
    let compiled = workspace.get(&artifact_ref)?;
    Ok((artifact_ref, compiled))
}

fn ensure_not_started(workspace: &Workspace, experiment_id: &str) -> Result<()> {
    if workspace
        .latest_event(EXECUTION_STARTED, experiment_id)?
        .is_some()
    {
        return Err(Error::Conflict(format!(
            "experiment {experiment_id} has already started execution"
        )));
    }
    Ok(())
}

fn artifact_ref_for<T: serde::Serialize>(value: &T) -> Result<String> {
    Ok(format!("artifact://sha256/{}", Workspace::digest(value)?))
}

fn required_artifact(event_type: &str, artifact_ref: Option<String>) -> Result<String> {
    artifact_ref.ok_or_else(|| {
        Error::Conflict(format!(
            "{event_type} event is missing its artifact reference"
        ))
    })
}
