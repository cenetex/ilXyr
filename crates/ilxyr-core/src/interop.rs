use std::{collections::BTreeSet, str::FromStr};

use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};

use crate::{
    ActorKind, Certificate, CompiledExperiment, Error, Evidence, EvidenceLane, ExecutorAttestation,
    ExternalRegistrationReceipt, Forecast, ForecastSettlement, RegistrationPackage, Result,
    RetroRegistration, RetroRegistrationSpec, RunRecord, Workspace,
};

const EVIDENCE_RECORDED: &str = "EvidenceRecorded";
const EXPERIMENT_COMPILED: &str = "ExperimentCompiled";
const FORECAST_SUBMITTED: &str = "ForecastSubmitted";
const FORECAST_SETTLED: &str = "ForecastSettled";
const CERTIFICATE_RECORDED: &str = "CertificateRecorded";
const RETRO_PLANNED: &str = "RetroPlanned";
const RETRO_REGISTERED: &str = "RetroRegistered";
const REGISTRATION_PACKAGED: &str = "RegistrationPackaged";
const EXTERNAL_REGISTRATION_RECORDED: &str = "ExternalRegistrationRecorded";
const EXECUTOR_ATTESTATION_RECORDED: &str = "ExecutorAttestationRecorded";

const RO_CRATE_CONTEXT: &str = "https://w3id.org/ro/crate/1.3/context";
const RO_CRATE_PROFILE: &str = "https://w3id.org/ro/crate/1.3";
const IN_TOTO_STATEMENT_TYPE: &str = "https://in-toto.io/Statement/v1";
const ILXYR_EVIDENCE_PREDICATE: &str = "https://ilxyr.dev/attestations/evidence/v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InteropFormat {
    Native,
    RoCrate,
    InToto,
    Mlflow,
}

impl FromStr for InteropFormat {
    type Err = Error;

    fn from_str(value: &str) -> Result<Self> {
        match value {
            "native" => Ok(Self::Native),
            "ro-crate" => Ok(Self::RoCrate),
            "in-toto" => Ok(Self::InToto),
            "mlflow" => Ok(Self::Mlflow),
            _ => Err(Error::Validation(vec![format!(
                "unsupported evidence export format {value}; expected native, ro-crate, in-toto, or mlflow"
            )])),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvidenceBundle {
    pub schema: String,
    pub evidence_ref: String,
    pub evidence_event_hash: String,
    pub ledger_head: String,
    pub evidence: Evidence,
    pub run_ref: String,
    pub run: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compiled_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compiled: Option<CompiledExperiment>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub registration_package_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub registration_package: Option<RegistrationPackage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_registration_receipt: Option<ExternalRegistrationReceipt>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retro_plan_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retro_plan: Option<RetroRegistrationSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retro_registration: Option<RetroRegistration>,
    pub forecasts: Vec<Forecast>,
    pub settlements: Vec<ForecastSettlement>,
    pub certificates: Vec<Certificate>,
    pub executor_attestations: Vec<ExecutorAttestation>,
    pub forecast_risked: bool,
    pub source_attested: bool,
    pub executor_attested: bool,
    pub cold_replayable: bool,
}

pub fn export_evidence(
    workspace: &Workspace,
    evidence_ref: &str,
    format: InteropFormat,
) -> Result<Value> {
    let bundle = evidence_bundle(workspace, evidence_ref)?;
    match format {
        InteropFormat::Native => Ok(serde_json::to_value(bundle)?),
        InteropFormat::RoCrate => ro_crate(&bundle),
        InteropFormat::InToto => in_toto_statement(&bundle),
        InteropFormat::Mlflow => mlflow_bridge_manifest(&bundle),
    }
}

pub fn evidence_bundle(workspace: &Workspace, evidence_ref: &str) -> Result<EvidenceBundle> {
    workspace.verify()?;
    let evidence: Evidence = workspace.get(evidence_ref)?;
    let events = workspace.events()?;
    let evidence_event = events
        .iter()
        .find(|event| {
            event.event_type == EVIDENCE_RECORDED
                && event.aggregate_id == evidence.experiment_id
                && event.artifact_ref.as_deref() == Some(evidence_ref)
        })
        .ok_or_else(|| {
            Error::Conflict(format!(
                "{evidence_ref} is an object but is not recorded as evidence on the ledger"
            ))
        })?;
    let ledger_head = events
        .last()
        .map(|event| event.event_hash.clone())
        .ok_or_else(|| Error::Conflict("cannot export evidence from an empty ledger".to_owned()))?;

    let run: Value = workspace.get(&evidence.run_ref)?;
    let run_record = serde_json::from_value::<RunRecord>(run.clone()).ok();
    let source_attested = run_record
        .as_ref()
        .and_then(|run| run.source_attestation.as_ref())
        .is_some();

    let (compiled_ref, compiled) = latest_with_ref::<CompiledExperiment>(
        &events,
        workspace,
        EXPERIMENT_COMPILED,
        &evidence.experiment_id,
    )?
    .map_or((None, None), |(artifact_ref, object)| {
        (Some(artifact_ref), Some(object))
    });
    let (retro_plan_ref, retro_plan) = latest_with_ref::<RetroRegistrationSpec>(
        &events,
        workspace,
        RETRO_PLANNED,
        &evidence.experiment_id,
    )?
    .map_or((None, None), |(artifact_ref, object)| {
        (Some(artifact_ref), Some(object))
    });
    let (registration_package_ref, registration_package) = latest_with_ref::<RegistrationPackage>(
        &events,
        workspace,
        REGISTRATION_PACKAGED,
        &evidence.experiment_id,
    )?
    .map_or((None, None), |(artifact_ref, object)| {
        (Some(artifact_ref), Some(object))
    });
    let external_registration_receipt = latest_with_ref::<ExternalRegistrationReceipt>(
        &events,
        workspace,
        EXTERNAL_REGISTRATION_RECORDED,
        &evidence.experiment_id,
    )?
    .map(|(_, receipt)| receipt);

    if compiled.is_none() && retro_plan.is_none() && evidence.lane != EvidenceLane::Sandbox {
        return Err(Error::Conflict(format!(
            "evidence {} has neither a compiled experiment nor a frozen retro plan",
            evidence.id
        )));
    }

    let retro_registration =
        artifacts_for::<RetroRegistration>(&events, workspace, RETRO_REGISTERED)?
            .into_iter()
            .find(|registration| registration.evidence_ref == evidence_ref);

    let mut forecasts = artifacts_for::<Forecast>(&events, workspace, FORECAST_SUBMITTED)?
        .into_iter()
        .filter(|forecast| forecast.experiment_id == evidence.experiment_id)
        .collect::<Vec<_>>();
    forecasts.sort_by(|left, right| left.id.cmp(&right.id));

    let mut settlements =
        artifacts_for::<ForecastSettlement>(&events, workspace, FORECAST_SETTLED)?
            .into_iter()
            .filter(|settlement| settlement.experiment_id == evidence.experiment_id)
            .collect::<Vec<_>>();
    settlements.sort_by(|left, right| left.forecast_id.cmp(&right.forecast_id));

    let mut certificates = artifacts_for::<Certificate>(&events, workspace, CERTIFICATE_RECORDED)?
        .into_iter()
        .filter(|certificate| certificate.evidence_ref == evidence_ref)
        .collect::<Vec<_>>();
    certificates.sort_by(|left, right| left.id.cmp(&right.id));
    let mut executor_attestations =
        artifacts_for::<ExecutorAttestation>(&events, workspace, EXECUTOR_ATTESTATION_RECORDED)?
            .into_iter()
            .filter(|attestation| attestation.run_ref == evidence.run_ref)
            .collect::<Vec<_>>();
    executor_attestations.sort_by(|left, right| left.id.cmp(&right.id));
    let executor_attested = !executor_attestations.is_empty();

    let settled_forecasts = settlements
        .iter()
        .map(|settlement| settlement.forecast_id.as_str())
        .collect::<BTreeSet<_>>();
    let forecast_risked = evidence.lane == EvidenceLane::Promoted
        && !forecasts.is_empty()
        && forecasts
            .iter()
            .all(|forecast| settled_forecasts.contains(forecast.id.as_str()));

    let cold_replayable = retro_plan.as_ref().is_some_and(|plan| {
        run_record.as_ref().is_some_and(|run| {
            run.source_attestation.as_ref() == Some(&plan.source)
                && run.exit_code == 0
                && !run.timed_out
                && run.output_error.is_none()
        })
    }) && retro_registration.as_ref().is_some_and(|registration| {
        registration.grounded
            && !registration.forecast_risked
            && registration.evidence_ref == evidence_ref
    });

    Ok(EvidenceBundle {
        schema: "ilxyr.evidence_bundle.v1".to_owned(),
        evidence_ref: evidence_ref.to_owned(),
        evidence_event_hash: evidence_event.event_hash.clone(),
        ledger_head,
        run_ref: evidence.run_ref.clone(),
        evidence,
        run,
        compiled_ref,
        compiled,
        registration_package_ref,
        registration_package,
        external_registration_receipt,
        retro_plan_ref,
        retro_plan,
        retro_registration,
        forecasts,
        settlements,
        certificates,
        executor_attestations,
        forecast_risked,
        source_attested,
        executor_attested,
        cold_replayable,
    })
}

fn ro_crate(bundle: &EvidenceBundle) -> Result<Value> {
    let title = bundle_title(bundle);
    let plan_ref = plan_ref(bundle);
    let mut graph = vec![
        json!({
            "@id": "ro-crate-metadata.json",
            "@type": "CreativeWork",
            "about": {"@id": "./"},
            "conformsTo": {"@id": RO_CRATE_PROFILE}
        }),
        json!({
            "@id": "./",
            "@type": ["Dataset", "prov:Entity"],
            "name": format!("ilXyr evidence bundle — {title}"),
            "description": "A ledger-verified ilXyr evidence bundle exported for discovery, preservation, and reuse.",
            "hasPart": crate_parts(bundle),
            "mainEntity": {"@id": bundle.evidence_ref},
            "ilxyr:ledgerHead": bundle.ledger_head
        }),
    ];

    if let Some(compiled_ref) = &bundle.compiled_ref {
        let compiled = bundle.compiled.as_ref().ok_or_else(|| {
            Error::Conflict("compiled reference has no compiled object".to_owned())
        })?;
        graph.push(json!({
            "@id": compiled_ref,
            "@type": ["CreativeWork", "prov:Plan"],
            "identifier": compiled.spec.id,
            "name": compiled.spec.title,
            "description": compiled.spec.hypothesis,
            "author": actor_entity(&compiled.spec.proposer),
            "isBasedOn": compiled.resolved_lineage.values().map(|value| json!({"@id": value})).collect::<Vec<_>>(),
            "ilxyr:sharedTask": compiled.spec.shared_task_id,
            "ilxyr:sourceDigest": compiled.source_digest
        }));
    }
    if let Some(retro_plan_ref) = &bundle.retro_plan_ref {
        let plan = bundle
            .retro_plan
            .as_ref()
            .ok_or_else(|| Error::Conflict("retro plan reference has no plan object".to_owned()))?;
        graph.push(json!({
            "@id": retro_plan_ref,
            "@type": ["CreativeWork", "prov:Plan"],
            "identifier": plan.id,
            "name": plan.claim,
            "description": "Frozen deterministic replay plan for a prior claim.",
            "isBasedOn": {"@id": plan.source.repository},
            "ilxyr:sourceCommit": plan.source.commit,
            "ilxyr:sharedTask": plan.shared_task_id
        }));
    }
    if let Some(package_ref) = &bundle.registration_package_ref {
        let package = bundle.registration_package.as_ref().ok_or_else(|| {
            Error::Conflict("registration package reference has no package object".to_owned())
        })?;
        graph.push(json!({
            "@id": package_ref,
            "@type": ["DigitalDocument", "prov:Entity"],
            "identifier": package.id,
            "name": format!("Executable registration package for {}", package.experiment_id),
            "about": {"@id": package.compiled_ref},
            "ilxyr:registrationProvider": package.requirement.provider,
            "ilxyr:registrationVisibility": package.requirement.visibility
        }));
    }
    if let Some(receipt) = &bundle.external_registration_receipt {
        graph.push(json!({
            "@id": receipt.url,
            "@type": ["CreativeWork", "prov:Entity"],
            "identifier": receipt.registration_id,
            "name": format!("External registration for {}", receipt.experiment_id),
            "isBasedOn": {"@id": receipt.package_ref},
            "author": actor_entity(&receipt.registered_by),
            "sameAs": receipt.doi.as_ref().map(|doi| format!("https://doi.org/{doi}")),
            "ilxyr:registrationProvider": receipt.provider,
            "ilxyr:registrationVisibility": receipt.visibility,
            "ilxyr:registeredAtMs": receipt.registered_at_ms
        }));
    }

    graph.push(json!({
        "@id": bundle.run_ref,
        "@type": ["CreateAction", "prov:Activity"],
        "name": format!("Execution for {}", bundle.evidence.experiment_id),
        "actionStatus": "CompletedActionStatus",
        "object": plan_ref.map(|value| json!({"@id": value})),
        "result": {"@id": bundle.evidence_ref},
        "ilxyr:sourceAttested": bundle.source_attested,
        "ilxyr:run": bundle.run
    }));
    graph.push(json!({
        "@id": bundle.evidence_ref,
        "@type": ["Dataset", "prov:Entity"],
        "identifier": bundle.evidence.id,
        "name": format!("Evidence for {title}"),
        "description": format!("Resolved outcome: {}", bundle.evidence.resolved_outcome),
        "prov:wasGeneratedBy": {"@id": bundle.run_ref},
        "isBasedOn": plan_ref.map(|value| json!({"@id": value})),
        "additionalProperty": metric_properties(bundle),
        "ilxyr:authority": bundle.evidence.authority,
        "ilxyr:evidenceLane": bundle.evidence.lane,
        "ilxyr:forecastRisked": bundle.forecast_risked,
        "ilxyr:externallyPreregistered": bundle.external_registration_receipt.is_some(),
        "ilxyr:executorAttested": bundle.executor_attested,
        "ilxyr:coldReplayable": bundle.cold_replayable,
        "ilxyr:evidenceEventHash": bundle.evidence_event_hash
    }));

    for forecast in &bundle.forecasts {
        graph.push(json!({
            "@id": forecast_entity_id(&forecast.id),
            "@type": ["CreativeWork", "prov:Entity"],
            "identifier": forecast.id,
            "name": format!("Forecast for {}", forecast.experiment_id),
            "author": actor_entity(&forecast.forecaster),
            "about": plan_ref.map(|value| json!({"@id": value})),
            "ilxyr:probabilities": forecast.probabilities,
            "ilxyr:stake": forecast.stake
        }));
    }
    for settlement in &bundle.settlements {
        graph.push(json!({
            "@id": settlement_entity_id(&settlement.forecast_id),
            "@type": ["CreateAction", "prov:Activity"],
            "name": format!("Forecast settlement for {}", settlement.forecast_id),
            "object": {"@id": forecast_entity_id(&settlement.forecast_id)},
            "result": {"@id": bundle.evidence_ref},
            "ilxyr:resolvedOutcome": settlement.resolved_outcome,
            "ilxyr:brierScore": settlement.brier_score
        }));
    }
    for certificate in &bundle.certificates {
        graph.push(json!({
            "@id": certificate_entity_id(&certificate.id),
            "@type": ["CreativeWork", "prov:Entity"],
            "identifier": certificate.id,
            "name": format!("Certificate for {}", bundle.evidence.id),
            "about": {"@id": bundle.evidence_ref},
            "isBasedOn": certificate.checked_artifacts.iter().map(|value| json!({"@id": value})).collect::<Vec<_>>(),
            "ilxyr:predicate": certificate.predicate,
            "ilxyr:domain": certificate.domain,
            "ilxyr:checker": certificate.checker,
            "ilxyr:issuedAtMs": certificate.issued_at_ms
        }));
    }
    for attestation in &bundle.executor_attestations {
        graph.push(json!({
            "@id": attestation_entity_id(&attestation.id),
            "@type": ["DigitalDocument", "prov:Entity"],
            "identifier": attestation.id,
            "name": format!("Verified executor attestation for {}", bundle.run_ref),
            "about": {"@id": bundle.run_ref},
            "ilxyr:predicateType": attestation.predicate_type,
            "ilxyr:verifiedKeyIds": attestation.verified_key_ids,
            "ilxyr:statement": attestation.statement
        }));
    }
    if let Some(registration) = &bundle.retro_registration {
        graph.push(json!({
            "@id": registration_entity_id(&registration.id),
            "@type": ["CreativeWork", "prov:Entity"],
            "identifier": registration.id,
            "name": format!("Retro registration for {}", registration.claim),
            "about": {"@id": registration.evidence_ref},
            "isBasedOn": {"@id": registration.plan_ref},
            "ilxyr:grounded": registration.grounded,
            "ilxyr:forecastRisked": registration.forecast_risked,
            "ilxyr:registeredAtMs": registration.registered_at_ms
        }));
    }

    let reserved = graph
        .iter()
        .filter_map(|entity| entity.get("@id").and_then(Value::as_str))
        .map(ToOwned::to_owned)
        .collect::<BTreeSet<_>>();
    for artifact_ref in &bundle.evidence.authority.provenance.artifact_hashes {
        if !reserved.contains(artifact_ref.as_str()) {
            graph.push(json!({
                "@id": artifact_ref,
                "@type": ["MediaObject", "prov:Entity"],
                "sha256": artifact_digest(artifact_ref)?
            }));
        }
    }

    Ok(json!({
        "@context": [
            RO_CRATE_CONTEXT,
            {
                "prov": "http://www.w3.org/ns/prov#",
                "ilxyr": "https://ilxyr.dev/ns#"
            }
        ],
        "@graph": graph
    }))
}

fn in_toto_statement(bundle: &EvidenceBundle) -> Result<Value> {
    Ok(json!({
        "_type": IN_TOTO_STATEMENT_TYPE,
        "subject": [{
            "name": bundle.evidence.id,
            "digest": {
                "sha256": artifact_digest(&bundle.evidence_ref)?
            }
        }],
        "predicateType": ILXYR_EVIDENCE_PREDICATE,
        "predicate": bundle
    }))
}

fn mlflow_bridge_manifest(bundle: &EvidenceBundle) -> Result<Value> {
    let recorded_at = i64::try_from(bundle.evidence.recorded_at_ms).map_err(|_| {
        Error::Conflict("evidence timestamp cannot be represented by MLflow INT64".to_owned())
    })?;
    let start_time = serde_json::from_value::<RunRecord>(bundle.run.clone())
        .ok()
        .and_then(|run| i64::try_from(run.started_at_ms).ok())
        .unwrap_or(recorded_at);
    let metrics = bundle
        .evidence
        .metrics
        .iter()
        .map(|(key, value)| {
            json!({
                "key": key,
                "value": value,
                "timestamp": recorded_at,
                "step": 0
            })
        })
        .collect::<Vec<_>>();
    let tags = vec![
        ("ilxyr.evidence_ref", bundle.evidence_ref.clone()),
        (
            "ilxyr.resolved_outcome",
            bundle.evidence.resolved_outcome.clone(),
        ),
        ("ilxyr.evidence_lane", enum_json(&bundle.evidence.lane)?),
        ("ilxyr.forecast_risked", bundle.forecast_risked.to_string()),
        ("ilxyr.source_attested", bundle.source_attested.to_string()),
        (
            "ilxyr.executor_attested",
            bundle.executor_attested.to_string(),
        ),
        ("ilxyr.cold_replayable", bundle.cold_replayable.to_string()),
        ("ilxyr.ledger_head", bundle.ledger_head.clone()),
    ]
    .into_iter()
    .map(|(key, value)| json!({"key": key, "value": value}))
    .collect::<Vec<_>>();
    let bundle_digest = Workspace::digest(bundle)?;

    Ok(json!({
        "schema": "ilxyr.mlflow_bridge.v1",
        "api": "MLflow REST API 2.0",
        "required_inputs": ["experiment_id"],
        "create_run": {
            "endpoint": "/api/2.0/mlflow/runs/create",
            "request_template": {
                "experiment_id": {"$input": "experiment_id"},
                "run_name": bundle_title(bundle),
                "start_time": start_time,
                "tags": tags
            }
        },
        "after_create": {
            "run_id_from": "create_run.response.run.info.run_id",
            "log_batch": {
                "endpoint": "/api/2.0/mlflow/runs/log-batch",
                "request_template": {
                    "run_id": {"$from": "create_run.response.run.info.run_id"},
                    "metrics": metrics,
                    "params": [
                        {"key": "ilxyr.experiment_id", "value": bundle.evidence.experiment_id},
                        {"key": "ilxyr.evidence_id", "value": bundle.evidence.id},
                        {"key": "ilxyr.run_ref", "value": bundle.run_ref}
                    ],
                    "tags": []
                }
            },
            "artifacts": [{
                "path": "ilxyr/evidence-bundle.json",
                "media_type": "application/json",
                "sha256": bundle_digest,
                "content": bundle
            }]
        }
    }))
}

fn crate_parts(bundle: &EvidenceBundle) -> Vec<Value> {
    let mut parts = vec![
        json!({"@id": bundle.evidence_ref}),
        json!({"@id": bundle.run_ref}),
    ];
    if let Some(compiled_ref) = &bundle.compiled_ref {
        parts.push(json!({"@id": compiled_ref}));
    }
    if let Some(retro_plan_ref) = &bundle.retro_plan_ref {
        parts.push(json!({"@id": retro_plan_ref}));
    }
    if let Some(package_ref) = &bundle.registration_package_ref {
        parts.push(json!({"@id": package_ref}));
    }
    if let Some(receipt) = &bundle.external_registration_receipt {
        parts.push(json!({"@id": receipt.url}));
    }
    for forecast in &bundle.forecasts {
        parts.push(json!({"@id": forecast_entity_id(&forecast.id)}));
    }
    for settlement in &bundle.settlements {
        parts.push(json!({"@id": settlement_entity_id(&settlement.forecast_id)}));
    }
    for certificate in &bundle.certificates {
        parts.push(json!({"@id": certificate_entity_id(&certificate.id)}));
    }
    for attestation in &bundle.executor_attestations {
        parts.push(json!({"@id": attestation_entity_id(&attestation.id)}));
    }
    if let Some(registration) = &bundle.retro_registration {
        parts.push(json!({"@id": registration_entity_id(&registration.id)}));
    }
    for artifact_ref in &bundle.evidence.authority.provenance.artifact_hashes {
        parts.push(json!({"@id": artifact_ref}));
    }
    parts
}

fn forecast_entity_id(forecast_id: &str) -> String {
    format!("urn:ilxyr:forecast:{forecast_id}")
}

fn settlement_entity_id(forecast_id: &str) -> String {
    format!("urn:ilxyr:settlement:{forecast_id}")
}

fn certificate_entity_id(certificate_id: &str) -> String {
    format!("urn:ilxyr:certificate:{certificate_id}")
}

fn registration_entity_id(registration_id: &str) -> String {
    format!("urn:ilxyr:registration:{registration_id}")
}

fn attestation_entity_id(attestation_id: &str) -> String {
    format!("urn:ilxyr:{attestation_id}")
}

fn metric_properties(bundle: &EvidenceBundle) -> Vec<Value> {
    bundle
        .evidence
        .metrics
        .iter()
        .map(|(name, value)| {
            json!({
                "@type": "PropertyValue",
                "name": name,
                "value": value
            })
        })
        .collect()
}

fn actor_entity(actor: &crate::ActorRef) -> Value {
    let entity_type = match actor.kind {
        ActorKind::Human => "Person",
        ActorKind::Model | ActorKind::Service => "SoftwareApplication",
    };
    json!({
        "@id": actor.model_ref.as_deref().unwrap_or(&actor.id),
        "@type": entity_type,
        "identifier": actor.id
    })
}

fn bundle_title(bundle: &EvidenceBundle) -> String {
    bundle
        .compiled
        .as_ref()
        .map(|compiled| compiled.spec.title.clone())
        .or_else(|| bundle.retro_plan.as_ref().map(|plan| plan.claim.clone()))
        .unwrap_or_else(|| bundle.evidence.experiment_id.clone())
}

fn plan_ref(bundle: &EvidenceBundle) -> Option<&str> {
    bundle
        .compiled_ref
        .as_deref()
        .or(bundle.retro_plan_ref.as_deref())
}

fn enum_json<T: Serialize>(value: &T) -> Result<String> {
    serde_json::to_value(value)?
        .as_str()
        .map(ToOwned::to_owned)
        .ok_or_else(|| Error::Conflict("enum did not serialize as a string".to_owned()))
}

fn artifact_digest(artifact_ref: &str) -> Result<&str> {
    let digest = artifact_ref
        .strip_prefix("artifact://sha256/")
        .ok_or_else(|| {
            Error::Validation(vec![format!("invalid artifact reference {artifact_ref}")])
        })?;
    if digest.len() != 64 || !digest.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(Error::Validation(vec![format!(
            "invalid SHA-256 artifact reference {artifact_ref}"
        )]));
    }
    Ok(digest)
}

fn latest_with_ref<T: DeserializeOwned>(
    events: &[crate::ResearchEvent],
    workspace: &Workspace,
    event_type: &str,
    aggregate_id: &str,
) -> Result<Option<(String, T)>> {
    events
        .iter()
        .rev()
        .find(|event| event.event_type == event_type && event.aggregate_id == aggregate_id)
        .map(|event| {
            let artifact_ref = required_artifact(event)?;
            let object = workspace.get(&artifact_ref)?;
            Ok((artifact_ref, object))
        })
        .transpose()
}

fn artifacts_for<T: DeserializeOwned>(
    events: &[crate::ResearchEvent],
    workspace: &Workspace,
    event_type: &str,
) -> Result<Vec<T>> {
    events
        .iter()
        .filter(|event| event.event_type == event_type)
        .map(|event| {
            let artifact_ref = required_artifact(event)?;
            workspace.get(&artifact_ref)
        })
        .collect()
}

fn required_artifact(event: &crate::ResearchEvent) -> Result<String> {
    event.artifact_ref.clone().ok_or_else(|| {
        Error::Conflict(format!(
            "{} event {} is missing its artifact reference",
            event.event_type, event.event_hash
        ))
    })
}
