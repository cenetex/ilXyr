use std::collections::BTreeSet;

use base64::{
    Engine as _,
    engine::general_purpose::{STANDARD, STANDARD_NO_PAD, URL_SAFE, URL_SAFE_NO_PAD},
};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::{
    ActorKind, ActorRef, DsseEnvelope, Error, ExecutorAttestation, Result, TrustedAttestationKey,
    Workspace, store::now_ms,
};

const ATTESTATION_KEY_TRUSTED: &str = "AttestationKeyTrusted";
const EXECUTOR_ATTESTATION_RECORDED: &str = "ExecutorAttestationRecorded";
const EXPERIMENT_COMPLETED: &str = "ExperimentCompleted";
const RETRO_RUN_COMPLETED: &str = "RetroRunCompleted";
const SANDBOX_RUN_COMPLETED: &str = "SandboxRunCompleted";
const IN_TOTO_PAYLOAD_TYPE: &str = "application/vnd.in-toto+json";
const IN_TOTO_PROVENANCE_PAYLOAD_TYPE: &str = "application/vnd.in-toto.provenance+json";
const IN_TOTO_STATEMENT_V1: &str = "https://in-toto.io/Statement/v1";
const SLSA_PROVENANCE_V1: &str = "https://slsa.dev/provenance/v1";
const ILXYR_EXECUTOR_V1: &str = "https://ilxyr.dev/attestations/executor/v1";

pub fn trust_attestation_key(
    workspace: &Workspace,
    key_id: &str,
    executor: ActorRef,
    public_key: String,
) -> Result<TrustedAttestationKey> {
    if executor.kind != ActorKind::Service {
        return Err(Error::Validation(vec![
            "attestation key executor must be a service actor".to_owned(),
        ]));
    }
    if !executor.id.starts_with("service://") || executor.model_ref.is_some() {
        return Err(Error::Validation(vec![
            "attestation key executor must use a service:// ID and must not declare model_ref"
                .to_owned(),
        ]));
    }
    if !key_id.starts_with("key://") {
        return Err(Error::Validation(vec![
            "attestation key ID must start with key://".to_owned(),
        ]));
    }
    decode_verifying_key(&public_key)?;
    if let Some(existing) =
        latest_typed::<TrustedAttestationKey>(workspace, ATTESTATION_KEY_TRUSTED, key_id)?
    {
        if existing.executor == executor && existing.public_key == public_key {
            return Ok(existing);
        }
        return Err(Error::Conflict(format!(
            "trusted attestation key {key_id} is immutable"
        )));
    }
    let key = TrustedAttestationKey {
        schema: "ilxyr.trusted_attestation_key.v1".to_owned(),
        key_id: key_id.to_owned(),
        executor: executor.clone(),
        algorithm: "ed25519".to_owned(),
        public_key,
        trusted_at_ms: now_ms()?,
    };
    let artifact_ref = workspace.put(&key)?;
    workspace.append_event(
        ATTESTATION_KEY_TRUSTED,
        key_id,
        executor,
        Some(artifact_ref),
    )?;
    Ok(key)
}

pub fn record_executor_attestation(
    workspace: &Workspace,
    run_ref: &str,
    envelope: DsseEnvelope,
) -> Result<String> {
    ensure_ledgered_run(workspace, run_ref)?;
    if envelope.payload_type != IN_TOTO_PAYLOAD_TYPE
        && envelope.payload_type != IN_TOTO_PROVENANCE_PAYLOAD_TYPE
    {
        return Err(Error::Validation(vec![format!(
            "unsupported DSSE payloadType {}; expected an in-toto JSON media type",
            envelope.payload_type
        )]));
    }
    if envelope.signatures.is_empty() {
        return Err(Error::Validation(vec![
            "DSSE envelope must contain at least one signature".to_owned(),
        ]));
    }

    let payload = decode_base64(&envelope.payload, "DSSE payload")?;
    let pae = dsse_pae(&envelope.payload_type, &payload);
    let trusted_keys = trusted_attestation_keys(workspace)?;
    let mut verified_key_ids = BTreeSet::new();
    for envelope_signature in &envelope.signatures {
        let signature_bytes = decode_base64(&envelope_signature.sig, "DSSE signature")?;
        let signature_bytes: [u8; 64] = signature_bytes.try_into().map_err(|_| {
            Error::Security("Ed25519 DSSE signature must contain 64 bytes".to_owned())
        })?;
        let signature = Signature::from_bytes(&signature_bytes);
        for key in &trusted_keys {
            if verified_key_ids.contains(&key.key_id) {
                continue;
            }
            let verifying_key = decode_verifying_key(&key.public_key)?;
            if verifying_key.verify_strict(&pae, &signature).is_ok() {
                verified_key_ids.insert(key.key_id.clone());
            }
        }
    }
    if verified_key_ids.is_empty() {
        return Err(Error::Security(
            "DSSE envelope has no signature from a trusted attestation key".to_owned(),
        ));
    }

    let statement: Value = serde_json::from_slice(&payload)
        .map_err(|error| Error::Validation(vec![format!("invalid in-toto statement: {error}")]))?;
    let predicate_type = validate_statement(&statement, run_ref, &trusted_keys, &verified_key_ids)?;
    let envelope_digest = Workspace::digest(&envelope)?;
    let id = format!("attestation:{envelope_digest}");
    let record = ExecutorAttestation {
        schema: "ilxyr.executor_attestation.v1".to_owned(),
        id: id.clone(),
        run_ref: run_ref.to_owned(),
        envelope,
        statement,
        predicate_type,
        verified_key_ids: verified_key_ids.into_iter().collect(),
        recorded_at_ms: now_ms()?,
    };

    if let Some(event) = workspace.latest_event(EXECUTOR_ATTESTATION_RECORDED, &id)? {
        return required_artifact(&event.event_type, event.artifact_ref);
    }
    let artifact_ref = workspace.put(&record)?;
    workspace.append_event(
        EXECUTOR_ATTESTATION_RECORDED,
        &id,
        ActorRef::service("service://ilxyr/attestation-verifier-v1"),
        Some(artifact_ref.clone()),
    )?;
    Ok(artifact_ref)
}

/// Returns true when a ledgered run has a verified signature from a key that is
/// immutably bound to the expected executor service.
pub fn has_verified_executor_attestation(
    workspace: &Workspace,
    run_ref: &str,
    executor: &ActorRef,
) -> Result<bool> {
    if executor.kind != ActorKind::Service {
        return Ok(false);
    }
    let executor_key_ids = trusted_attestation_keys(workspace)?
        .into_iter()
        .filter(|key| key.executor == *executor)
        .map(|key| key.key_id)
        .collect::<BTreeSet<_>>();
    if executor_key_ids.is_empty() {
        return Ok(false);
    }
    for event in workspace.events()? {
        if event.event_type != EXECUTOR_ATTESTATION_RECORDED {
            continue;
        }
        let artifact_ref = required_artifact(&event.event_type, event.artifact_ref)?;
        let attestation: ExecutorAttestation = workspace.get(&artifact_ref)?;
        if attestation.run_ref == run_ref
            && attestation
                .verified_key_ids
                .iter()
                .any(|key_id| executor_key_ids.contains(key_id))
        {
            return Ok(true);
        }
    }
    Ok(false)
}

#[must_use]
pub fn dsse_pae(payload_type: &str, payload: &[u8]) -> Vec<u8> {
    let mut encoded = format!(
        "DSSEv1 {} {payload_type} {} ",
        payload_type.len(),
        payload.len()
    )
    .into_bytes();
    encoded.extend_from_slice(payload);
    encoded
}

fn validate_statement(
    statement: &Value,
    run_ref: &str,
    trusted_keys: &[TrustedAttestationKey],
    verified_key_ids: &BTreeSet<String>,
) -> Result<String> {
    if statement.get("_type").and_then(Value::as_str) != Some(IN_TOTO_STATEMENT_V1) {
        return Err(Error::Validation(vec![format!(
            "attestation statement _type must be {IN_TOTO_STATEMENT_V1}"
        )]));
    }
    let predicate_type = statement
        .get("predicateType")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            Error::Validation(vec![
                "attestation statement requires predicateType".to_owned(),
            ])
        })?;
    let subjects = statement
        .get("subject")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            Error::Validation(vec![
                "attestation statement requires a subject array".to_owned(),
            ])
        })?;
    if subjects.is_empty() {
        return Err(Error::Validation(vec![
            "attestation statement subject must not be empty".to_owned(),
        ]));
    }
    let run_digest = artifact_digest(run_ref)?;
    let mut binds_run = false;
    for subject in subjects {
        let digest = subject
            .get("digest")
            .and_then(|digest| digest.get("sha256"))
            .and_then(Value::as_str)
            .ok_or_else(|| {
                Error::Validation(vec![
                    "each attestation subject requires digest.sha256".to_owned(),
                ])
            })?;
        validate_digest(digest, "attestation subject SHA-256")?;
        if digest == run_digest {
            binds_run = true;
        }
    }
    if !binds_run {
        return Err(Error::Conflict(format!(
            "attestation subjects do not bind ledgered run {run_ref}"
        )));
    }

    let predicate = statement.get("predicate").ok_or_else(|| {
        Error::Validation(vec![
            "attestation statement requires a predicate".to_owned(),
        ])
    })?;
    let verified_executors = trusted_keys
        .iter()
        .filter(|key| verified_key_ids.contains(&key.key_id))
        .map(|key| key.executor.id.as_str())
        .collect::<BTreeSet<_>>();
    match predicate_type {
        SLSA_PROVENANCE_V1 => validate_slsa(predicate, run_ref, &verified_executors)?,
        ILXYR_EXECUTOR_V1 => validate_ilxyr_executor(predicate, run_ref, &verified_executors)?,
        _ => {
            return Err(Error::Validation(vec![format!(
                "unsupported attestation predicateType {predicate_type}"
            )]));
        }
    }
    Ok(predicate_type.to_owned())
}

fn validate_slsa(
    predicate: &Value,
    run_ref: &str,
    verified_executors: &BTreeSet<&str>,
) -> Result<()> {
    let definition = predicate.get("buildDefinition").ok_or_else(|| {
        Error::Validation(vec![
            "SLSA provenance requires predicate.buildDefinition".to_owned(),
        ])
    })?;
    if definition
        .get("buildType")
        .and_then(Value::as_str)
        .is_none()
    {
        return Err(Error::Validation(vec![
            "SLSA provenance requires buildDefinition.buildType".to_owned(),
        ]));
    }
    if definition
        .get("externalParameters")
        .and_then(|value| value.get("ilxyrRunRef"))
        .and_then(Value::as_str)
        != Some(run_ref)
    {
        return Err(Error::Conflict(
            "SLSA externalParameters.ilxyrRunRef does not match the ledgered run".to_owned(),
        ));
    }
    let builder_id = predicate
        .get("runDetails")
        .and_then(|details| details.get("builder"))
        .and_then(|builder| builder.get("id"))
        .and_then(Value::as_str)
        .ok_or_else(|| {
            Error::Validation(vec![
                "SLSA provenance requires runDetails.builder.id".to_owned(),
            ])
        })?;
    if !verified_executors.contains(builder_id) {
        return Err(Error::Security(format!(
            "SLSA builder {builder_id} is not the executor bound to a verified signature"
        )));
    }
    Ok(())
}

fn validate_ilxyr_executor(
    predicate: &Value,
    run_ref: &str,
    verified_executors: &BTreeSet<&str>,
) -> Result<()> {
    if predicate.get("runRef").and_then(Value::as_str) != Some(run_ref) {
        return Err(Error::Conflict(
            "executor predicate runRef does not match the ledgered run".to_owned(),
        ));
    }
    let executor = predicate
        .get("executor")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            Error::Validation(vec!["executor predicate requires executor".to_owned()])
        })?;
    if !verified_executors.contains(executor) {
        return Err(Error::Security(format!(
            "executor predicate identity {executor} is not bound to a verified signature"
        )));
    }
    Ok(())
}

fn trusted_attestation_keys(workspace: &Workspace) -> Result<Vec<TrustedAttestationKey>> {
    workspace
        .events()?
        .into_iter()
        .filter(|event| event.event_type == ATTESTATION_KEY_TRUSTED)
        .map(|event| {
            let artifact_ref = required_artifact(&event.event_type, event.artifact_ref)?;
            workspace.get(&artifact_ref)
        })
        .collect()
}

fn ensure_ledgered_run(workspace: &Workspace, run_ref: &str) -> Result<()> {
    let ledgered = workspace.events()?.into_iter().any(|event| {
        matches!(
            event.event_type.as_str(),
            EXPERIMENT_COMPLETED | RETRO_RUN_COMPLETED | SANDBOX_RUN_COMPLETED
        ) && event.artifact_ref.as_deref() == Some(run_ref)
    });
    if !ledgered {
        return Err(Error::NotFound(format!("ledgered run {run_ref}")));
    }
    let _: Value = workspace.get(run_ref)?;
    Ok(())
}

fn latest_typed<T: DeserializeOwned>(
    workspace: &Workspace,
    event_type: &str,
    aggregate_id: &str,
) -> Result<Option<T>> {
    workspace
        .latest_event(event_type, aggregate_id)?
        .map(|event| {
            let artifact_ref = required_artifact(&event.event_type, event.artifact_ref)?;
            workspace.get(&artifact_ref)
        })
        .transpose()
}

fn decode_verifying_key(encoded: &str) -> Result<VerifyingKey> {
    let bytes = decode_base64(encoded, "attestation public key")?;
    let bytes: [u8; 32] = bytes.try_into().map_err(|_| {
        Error::Security("Ed25519 attestation public key must contain 32 bytes".to_owned())
    })?;
    VerifyingKey::from_bytes(&bytes)
        .map_err(|error| Error::Security(format!("invalid attestation public key: {error}")))
}

fn decode_base64(encoded: &str, label: &str) -> Result<Vec<u8>> {
    for engine in [&STANDARD, &STANDARD_NO_PAD, &URL_SAFE, &URL_SAFE_NO_PAD] {
        if let Ok(decoded) = engine.decode(encoded) {
            return Ok(decoded);
        }
    }
    Err(Error::Security(format!("{label} is not valid base64")))
}

fn artifact_digest(artifact_ref: &str) -> Result<&str> {
    let digest = artifact_ref
        .strip_prefix("artifact://sha256/")
        .ok_or_else(|| {
            Error::Validation(vec![format!("invalid artifact reference {artifact_ref}")])
        })?;
    validate_digest(digest, "artifact digest")?;
    Ok(digest)
}

fn validate_digest(digest: &str, label: &str) -> Result<()> {
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(Error::Validation(vec![format!(
            "{label} must be a 64-character lowercase SHA-256 digest"
        )]));
    }
    Ok(())
}

fn required_artifact(event_type: &str, artifact_ref: Option<String>) -> Result<String> {
    artifact_ref.ok_or_else(|| {
        Error::Conflict(format!(
            "{event_type} event is missing its artifact reference"
        ))
    })
}
