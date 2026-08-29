use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::{ActorKind, ActorRef, Error, Result, Workspace};

const NSRL_MODEL_REGISTERED: &str = "NsrlModelRegistered";
const NSRL_CONTINUATION_REGISTERED: &str = "NsrlContinuationRegistered";
const NSRL_GATE_EVALUATED: &str = "NsrlGateEvaluated";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct NsrlArtifact {
    pub path: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub blob_ref: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct NsrlSource {
    pub repository: String,
    pub commit: String,
    pub tree: String,
    pub published: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct NsrlArchitecture {
    pub artifact_format: String,
    pub profile: String,
    pub parameter_count: u64,
    pub vocabulary_size: u64,
    pub context_tokens: u64,
    pub layers: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct NsrlGenerationDefaults {
    pub context_tokens: u64,
    pub max_new_tokens: u64,
    pub top_k: u64,
    pub seed: u64,
    pub stop_on_eos: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct NsrlLicences {
    pub weights: Option<String>,
    pub training_data: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NsrlLifecycle {
    Experimental,
    Candidate,
    Frozen,
    Retired,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct NsrlCheckpoint {
    pub schema: String,
    pub model_ref: String,
    pub weight_ref: String,
    pub lineage: String,
    pub lifecycle: NsrlLifecycle,
    pub source: NsrlSource,
    pub architecture: NsrlArchitecture,
    pub model: NsrlArtifact,
    pub tokenizer: NsrlArtifact,
    pub model_card: NsrlArtifact,
    pub executable: NsrlArtifact,
    pub generation_defaults: NsrlGenerationDefaults,
    pub licences: NsrlLicences,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_checkpoint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub continuation_ref: Option<String>,
    #[serde(default)]
    pub evidence_refs: Vec<String>,
    #[serde(default)]
    pub experiment_refs: Vec<String>,
}

impl NsrlCheckpoint {
    #[must_use]
    pub fn model_ref_for(lineage: &str, model_sha256: &str) -> String {
        format!("model://nsrl/{lineage}@{model_sha256}")
    }

    #[must_use]
    pub fn weight_ref_for(lineage: &str, model_sha256: &str) -> String {
        format!("weight://nsrl/{lineage}@{model_sha256}")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct NsrlContinuation {
    pub schema: String,
    pub continuation_ref: String,
    pub checkpoint_ref: String,
    pub source_model_sha256: String,
    pub optimizer_format: String,
    pub optimizer: NsrlArtifact,
}

impl NsrlContinuation {
    #[must_use]
    pub fn continuation_ref_for(lineage: &str, optimizer_sha256: &str) -> String {
        format!("continuation://nsrl/{lineage}@{optimizer_sha256}")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct NsrlRegistration {
    pub schema: String,
    pub checkpoint: NsrlCheckpoint,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub continuation: Option<NsrlContinuation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct NsrlRegistrationRefs {
    pub checkpoint_ref: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub continuation_ref: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum NsrlGate {
    Integrity,
    NumericHealth,
    Learning,
    Generation,
    Context,
    Serving,
    Provenance,
    IndependentEvidence,
}

impl NsrlGate {
    pub const ALL: [Self; 8] = [
        Self::Integrity,
        Self::NumericHealth,
        Self::Learning,
        Self::Generation,
        Self::Context,
        Self::Serving,
        Self::Provenance,
        Self::IndependentEvidence,
    ];
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NsrlGateOutcome {
    Passed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct NsrlGateEvidence {
    pub schema: String,
    pub id: String,
    pub model_ref: String,
    pub gate: NsrlGate,
    pub outcome: NsrlGateOutcome,
    pub detail: String,
    pub artifacts: Vec<NsrlArtifact>,
    #[serde(default)]
    pub evidence_refs: Vec<String>,
    #[serde(default)]
    pub experiment_refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NsrlGateStatusValue {
    Unopened,
    Passed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct NsrlGateStatus {
    pub status: NsrlGateStatusValue,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evaluation_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct NsrlStatus {
    pub schema: String,
    pub model_ref: String,
    pub lifecycle: NsrlLifecycle,
    pub gates: BTreeMap<NsrlGate, NsrlGateStatus>,
    pub candidate_eligible: bool,
}

pub fn register_nsrl_model(
    workspace: &Workspace,
    registration: NsrlRegistration,
) -> Result<NsrlRegistrationRefs> {
    validate_nsrl_registration(&registration)?;
    require_registration_blobs(workspace, &registration)?;

    let checkpoint_ref = register_checkpoint(workspace, &registration.checkpoint)?;
    let continuation_ref = registration
        .continuation
        .as_ref()
        .map(|continuation| register_continuation(workspace, continuation))
        .transpose()?;

    Ok(NsrlRegistrationRefs {
        checkpoint_ref,
        continuation_ref,
    })
}

pub fn registered_nsrl_model(workspace: &Workspace, model_ref: &str) -> Result<NsrlCheckpoint> {
    let event = workspace
        .latest_event(NSRL_MODEL_REGISTERED, model_ref)?
        .ok_or_else(|| Error::NotFound(format!("NSRL model {model_ref}")))?;
    let artifact_ref = event
        .artifact_ref
        .ok_or_else(|| Error::Conflict(format!("{NSRL_MODEL_REGISTERED} event has no artifact")))?;
    workspace.get(&artifact_ref)
}

pub fn registered_nsrl_continuation(
    workspace: &Workspace,
    continuation_ref: &str,
) -> Result<NsrlContinuation> {
    let event = workspace
        .latest_event(NSRL_CONTINUATION_REGISTERED, continuation_ref)?
        .ok_or_else(|| Error::NotFound(format!("NSRL continuation {continuation_ref}")))?;
    let artifact_ref = event.artifact_ref.ok_or_else(|| {
        Error::Conflict(format!(
            "{NSRL_CONTINUATION_REGISTERED} event has no artifact"
        ))
    })?;
    workspace.get(&artifact_ref)
}

pub fn record_nsrl_gate_evidence(
    workspace: &Workspace,
    evaluation: NsrlGateEvidence,
) -> Result<String> {
    validate_gate_evidence(&evaluation)?;
    let checkpoint = registered_nsrl_model(workspace, &evaluation.model_ref)?;
    for artifact in &evaluation.artifacts {
        require_blob(workspace, artifact)?;
    }
    if evaluation.gate == NsrlGate::Provenance
        && evaluation.outcome == NsrlGateOutcome::Passed
        && (!checkpoint.source.published || checkpoint.licences.weights.is_none())
    {
        return Err(Error::Validation(vec![
            "the provenance gate cannot pass without published source and an explicit weight licence"
                .to_owned(),
        ]));
    }

    if let Some(event) = workspace.latest_event(NSRL_GATE_EVALUATED, &evaluation.id)? {
        let artifact_ref = event.artifact_ref.ok_or_else(|| {
            Error::Conflict(format!("{NSRL_GATE_EVALUATED} event has no artifact"))
        })?;
        let existing: NsrlGateEvidence = workspace.get(&artifact_ref)?;
        if existing == evaluation {
            return Ok(artifact_ref);
        }
        return Err(Error::Conflict(format!(
            "NSRL gate evaluation {} is already registered with different evidence",
            evaluation.id
        )));
    }

    let artifact_ref = workspace.put(&evaluation)?;
    workspace.append_event(
        NSRL_GATE_EVALUATED,
        &evaluation.id,
        ActorRef::service("service://ilxyr/nsrl-pilot-v1"),
        Some(artifact_ref.clone()),
    )?;
    Ok(artifact_ref)
}

pub fn nsrl_status(workspace: &Workspace, model_ref: &str) -> Result<NsrlStatus> {
    let checkpoint = registered_nsrl_model(workspace, model_ref)?;
    let mut gates = NsrlGate::ALL
        .into_iter()
        .map(|gate| {
            (
                gate,
                NsrlGateStatus {
                    status: NsrlGateStatusValue::Unopened,
                    evaluation_ref: None,
                    detail: None,
                },
            )
        })
        .collect::<BTreeMap<_, _>>();

    for event in workspace.events()? {
        if event.event_type != NSRL_GATE_EVALUATED {
            continue;
        }
        let artifact_ref = event.artifact_ref.ok_or_else(|| {
            Error::Conflict(format!("{NSRL_GATE_EVALUATED} event has no artifact"))
        })?;
        let evaluation: NsrlGateEvidence = workspace.get(&artifact_ref)?;
        if evaluation.model_ref != model_ref {
            continue;
        }
        let status = match evaluation.outcome {
            NsrlGateOutcome::Passed => NsrlGateStatusValue::Passed,
            NsrlGateOutcome::Failed => NsrlGateStatusValue::Failed,
        };
        gates.insert(
            evaluation.gate,
            NsrlGateStatus {
                status,
                evaluation_ref: Some(artifact_ref),
                detail: Some(evaluation.detail),
            },
        );
    }

    let candidate_eligible = checkpoint.lifecycle == NsrlLifecycle::Experimental
        && gates
            .values()
            .all(|gate| gate.status == NsrlGateStatusValue::Passed);
    Ok(NsrlStatus {
        schema: "ilxyr.nsrl_status.v1".to_owned(),
        model_ref: model_ref.to_owned(),
        lifecycle: checkpoint.lifecycle,
        gates,
        candidate_eligible,
    })
}

pub fn require_registered_nsrl_actor(workspace: &Workspace, actor: &ActorRef) -> Result<()> {
    if actor.kind != ActorKind::Model {
        return Ok(());
    }
    let Some(model_ref) = actor.model_ref.as_deref() else {
        return Ok(());
    };
    if model_ref.starts_with("model://nsrl/") {
        registered_nsrl_model(workspace, model_ref)?;
    }
    Ok(())
}

pub fn require_registered_nsrl_weight(workspace: &Workspace, weight_ref: &str) -> Result<()> {
    let Some(suffix) = weight_ref.strip_prefix("weight://nsrl/") else {
        return Ok(());
    };
    let model_ref = format!("model://nsrl/{suffix}");
    let checkpoint = registered_nsrl_model(workspace, &model_ref)?;
    if checkpoint.weight_ref != weight_ref {
        return Err(Error::Conflict(format!(
            "registered NSRL model {model_ref} does not bind weight handle {weight_ref}"
        )));
    }
    Ok(())
}

pub fn validate_nsrl_registration(registration: &NsrlRegistration) -> Result<()> {
    let mut errors = Vec::new();
    if registration.schema != "ilxyr.nsrl_registration.v1" {
        errors.push("nsrl_registration.schema must be ilxyr.nsrl_registration.v1".to_owned());
    }
    validate_checkpoint(&registration.checkpoint, &mut errors);

    match (
        registration.checkpoint.continuation_ref.as_deref(),
        registration.continuation.as_ref(),
    ) {
        (Some(expected_ref), Some(continuation)) => {
            validate_continuation(continuation, &registration.checkpoint, &mut errors);
            if continuation.continuation_ref != expected_ref {
                errors.push(
                    "nsrl checkpoint continuation_ref must match the continuation object"
                        .to_owned(),
                );
            }
        }
        (None, None) => {}
        _ => errors.push(
            "nsrl checkpoint and registration must either both declare a continuation or neither"
                .to_owned(),
        ),
    }

    finish_validation(errors)
}

fn register_checkpoint(workspace: &Workspace, checkpoint: &NsrlCheckpoint) -> Result<String> {
    if let Some(event) = workspace.latest_event(NSRL_MODEL_REGISTERED, &checkpoint.model_ref)? {
        let artifact_ref = event.artifact_ref.ok_or_else(|| {
            Error::Conflict(format!("{NSRL_MODEL_REGISTERED} event has no artifact"))
        })?;
        let existing: NsrlCheckpoint = workspace.get(&artifact_ref)?;
        if existing == *checkpoint {
            return Ok(artifact_ref);
        }
        return Err(Error::Conflict(format!(
            "NSRL model {} is already registered with different metadata",
            checkpoint.model_ref
        )));
    }

    let artifact_ref = workspace.put(checkpoint)?;
    workspace.append_event(
        NSRL_MODEL_REGISTERED,
        &checkpoint.model_ref,
        ActorRef::service("service://ilxyr/nsrl-intake-v1"),
        Some(artifact_ref.clone()),
    )?;
    Ok(artifact_ref)
}

fn require_registration_blobs(
    workspace: &Workspace,
    registration: &NsrlRegistration,
) -> Result<()> {
    for artifact in [
        &registration.checkpoint.model,
        &registration.checkpoint.tokenizer,
        &registration.checkpoint.model_card,
        &registration.checkpoint.executable,
    ] {
        require_blob(workspace, artifact)?;
    }
    if let Some(continuation) = &registration.continuation {
        require_blob(workspace, &continuation.optimizer)?;
    }
    Ok(())
}

fn require_blob(workspace: &Workspace, artifact: &NsrlArtifact) -> Result<()> {
    let actual_size = workspace.verify_blob(&artifact.blob_ref)?;
    if actual_size != artifact.size_bytes {
        return Err(Error::Conflict(format!(
            "NSRL blob {} has {actual_size} bytes, expected {}",
            artifact.blob_ref, artifact.size_bytes
        )));
    }
    Ok(())
}

fn register_continuation(workspace: &Workspace, continuation: &NsrlContinuation) -> Result<String> {
    if let Some(event) =
        workspace.latest_event(NSRL_CONTINUATION_REGISTERED, &continuation.continuation_ref)?
    {
        let artifact_ref = event.artifact_ref.ok_or_else(|| {
            Error::Conflict(format!(
                "{NSRL_CONTINUATION_REGISTERED} event has no artifact"
            ))
        })?;
        let existing: NsrlContinuation = workspace.get(&artifact_ref)?;
        if existing == *continuation {
            return Ok(artifact_ref);
        }
        return Err(Error::Conflict(format!(
            "NSRL continuation {} is already registered with different metadata",
            continuation.continuation_ref
        )));
    }

    let artifact_ref = workspace.put(continuation)?;
    workspace.append_event(
        NSRL_CONTINUATION_REGISTERED,
        &continuation.continuation_ref,
        ActorRef::service("service://ilxyr/nsrl-intake-v1"),
        Some(artifact_ref.clone()),
    )?;
    Ok(artifact_ref)
}

fn validate_checkpoint(checkpoint: &NsrlCheckpoint, errors: &mut Vec<String>) {
    if checkpoint.schema != "ilxyr.nsrl_checkpoint.v1" {
        errors.push("nsrl checkpoint schema must be ilxyr.nsrl_checkpoint.v1".to_owned());
    }
    if checkpoint.lifecycle != NsrlLifecycle::Experimental {
        errors.push("new NSRL checkpoints must register as experimental".to_owned());
    }
    if !valid_slug(&checkpoint.lineage) {
        errors.push("nsrl checkpoint lineage must be a safe lowercase slug".to_owned());
    }
    if !checkpoint.source.repository.starts_with("https://") {
        errors.push("nsrl checkpoint source repository must use https".to_owned());
    }
    for (value, field) in [
        (&checkpoint.source.commit, "source.commit"),
        (&checkpoint.source.tree, "source.tree"),
    ] {
        if !is_lower_hex(value, 40) {
            errors.push(format!(
                "nsrl checkpoint {field} must be a full lowercase Git hash"
            ));
        }
    }
    if checkpoint.architecture.artifact_format != "NSRLPM1" {
        errors.push("nsrl checkpoint architecture.artifact_format must be NSRLPM1".to_owned());
    }
    for (value, field) in [
        (checkpoint.architecture.parameter_count, "parameter_count"),
        (checkpoint.architecture.vocabulary_size, "vocabulary_size"),
        (checkpoint.architecture.context_tokens, "context_tokens"),
        (checkpoint.architecture.layers, "layers"),
    ] {
        if value == 0 {
            errors.push(format!(
                "nsrl checkpoint architecture.{field} must be positive"
            ));
        }
    }
    if checkpoint.generation_defaults.context_tokens == 0
        || checkpoint.generation_defaults.context_tokens > checkpoint.architecture.context_tokens
    {
        errors.push(
            "nsrl generation context must be positive and no larger than the training context"
                .to_owned(),
        );
    }
    if checkpoint.generation_defaults.max_new_tokens == 0
        || checkpoint.generation_defaults.top_k == 0
        || checkpoint.generation_defaults.top_k > checkpoint.architecture.vocabulary_size
    {
        errors.push("nsrl generation max_new_tokens/top_k must be within bounds".to_owned());
    }

    let artifacts = [
        (&checkpoint.model, "model"),
        (&checkpoint.tokenizer, "tokenizer"),
        (&checkpoint.model_card, "model_card"),
        (&checkpoint.executable, "executable"),
    ];
    let mut paths = BTreeSet::new();
    for (artifact, field) in artifacts {
        validate_artifact(artifact, field, errors);
        if !paths.insert(&artifact.path) {
            errors.push(format!(
                "nsrl checkpoint contains duplicate artifact path {}",
                artifact.path
            ));
        }
    }
    if !checkpoint.model.path.ends_with(".nsrlpm") {
        errors.push("nsrl checkpoint model path must end with .nsrlpm".to_owned());
    }
    if !checkpoint.tokenizer.path.ends_with(".nsrlbpe") {
        errors.push("nsrl checkpoint tokenizer path must end with .nsrlbpe".to_owned());
    }

    let expected_model_ref =
        NsrlCheckpoint::model_ref_for(&checkpoint.lineage, &checkpoint.model.sha256);
    if checkpoint.model_ref != expected_model_ref {
        errors.push(format!(
            "nsrl checkpoint model_ref must equal {expected_model_ref}"
        ));
    }
    let expected_weight_ref =
        NsrlCheckpoint::weight_ref_for(&checkpoint.lineage, &checkpoint.model.sha256);
    if checkpoint.weight_ref != expected_weight_ref {
        errors.push(format!(
            "nsrl checkpoint weight_ref must equal {expected_weight_ref}"
        ));
    }
    validate_refs(&checkpoint.evidence_refs, "evidence_refs", errors);
    validate_nonempty_unique(&checkpoint.experiment_refs, "experiment_refs", errors);
    validate_nonempty_unique(
        &checkpoint.licences.training_data,
        "licences.training_data",
        errors,
    );
    if checkpoint
        .licences
        .weights
        .as_ref()
        .is_some_and(|licence| licence.trim().is_empty())
    {
        errors.push("nsrl checkpoint weight licence must not be empty".to_owned());
    }
}

fn validate_continuation(
    continuation: &NsrlContinuation,
    checkpoint: &NsrlCheckpoint,
    errors: &mut Vec<String>,
) {
    if continuation.schema != "ilxyr.nsrl_continuation.v1" {
        errors.push("nsrl continuation schema must be ilxyr.nsrl_continuation.v1".to_owned());
    }
    if continuation.checkpoint_ref != checkpoint.model_ref {
        errors.push("nsrl continuation checkpoint_ref must match the checkpoint".to_owned());
    }
    if continuation.source_model_sha256 != checkpoint.model.sha256 {
        errors.push("nsrl continuation source_model_sha256 must match the checkpoint".to_owned());
    }
    if continuation.optimizer_format != "NSRLPO1" {
        errors.push("nsrl continuation optimizer_format must be NSRLPO1".to_owned());
    }
    validate_artifact(&continuation.optimizer, "continuation.optimizer", errors);
    if !continuation.optimizer.path.ends_with(".nsrlpo") {
        errors.push("nsrl continuation optimizer path must end with .nsrlpo".to_owned());
    }
    let expected =
        NsrlContinuation::continuation_ref_for(&checkpoint.lineage, &continuation.optimizer.sha256);
    if continuation.continuation_ref != expected {
        errors.push(format!("nsrl continuation_ref must equal {expected}"));
    }
}

fn validate_gate_evidence(evaluation: &NsrlGateEvidence) -> Result<()> {
    let mut errors = Vec::new();
    if evaluation.schema != "ilxyr.nsrl_gate_evidence.v1" {
        errors.push("nsrl gate evidence schema must be ilxyr.nsrl_gate_evidence.v1".to_owned());
    }
    if evaluation.id.trim().is_empty() {
        errors.push("nsrl gate evidence id must not be empty".to_owned());
    }
    if !evaluation.model_ref.starts_with("model://nsrl/") {
        errors.push("nsrl gate evidence model_ref must be an NSRL model handle".to_owned());
    }
    if evaluation.detail.trim().is_empty() {
        errors.push("nsrl gate evidence detail must not be empty".to_owned());
    }
    if evaluation.artifacts.is_empty() && evaluation.evidence_refs.is_empty() {
        errors
            .push("nsrl gate evidence must bind at least one artifact or evidence ref".to_owned());
    }
    let mut paths = BTreeSet::new();
    for artifact in &evaluation.artifacts {
        validate_artifact(artifact, "gate_evidence.artifacts[]", &mut errors);
        if !paths.insert(&artifact.path) {
            errors.push(format!(
                "nsrl gate evidence contains duplicate path {}",
                artifact.path
            ));
        }
    }
    validate_refs(&evaluation.evidence_refs, "evidence_refs", &mut errors);
    validate_nonempty_unique(&evaluation.experiment_refs, "experiment_refs", &mut errors);
    finish_validation(errors)
}

fn validate_artifact(artifact: &NsrlArtifact, field: &str, errors: &mut Vec<String>) {
    if !valid_repo_path(&artifact.path) {
        errors.push(format!(
            "nsrl {field}.path is not a safe repository-relative path"
        ));
    }
    if !is_lower_hex(&artifact.sha256, 64) {
        errors.push(format!(
            "nsrl {field}.sha256 must be a lowercase SHA-256 digest"
        ));
    }
    if artifact.size_bytes == 0 {
        errors.push(format!("nsrl {field}.size_bytes must be positive"));
    }
    let expected_blob_ref = format!("blob://sha256/{}", artifact.sha256);
    if artifact.blob_ref != expected_blob_ref {
        errors.push(format!(
            "nsrl {field}.blob_ref must equal {expected_blob_ref}"
        ));
    }
}

fn validate_refs(values: &[String], field: &str, errors: &mut Vec<String>) {
    validate_nonempty_unique(values, field, errors);
    for value in values {
        let Some(digest) = value.strip_prefix("artifact://sha256/") else {
            errors.push(format!("nsrl {field} entries must be artifact references"));
            continue;
        };
        if !is_lower_hex(digest, 64) {
            errors.push(format!("nsrl {field} contains an invalid artifact digest"));
        }
    }
}

fn validate_nonempty_unique(values: &[String], field: &str, errors: &mut Vec<String>) {
    let mut seen = BTreeSet::new();
    for value in values {
        if value.trim().is_empty() {
            errors.push(format!("nsrl {field} entries must not be empty"));
        }
        if !seen.insert(value) {
            errors.push(format!("nsrl {field} entries must be unique"));
        }
    }
}

fn valid_slug(value: &str) -> bool {
    !value.is_empty()
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b'_' | b'.')
        })
}

fn valid_repo_path(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('/')
        && !value.contains('\0')
        && value
            .split('/')
            .all(|component| !component.is_empty() && component != "." && component != "..")
}

fn is_lower_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn finish_validation(errors: Vec<String>) -> Result<()> {
    if errors.is_empty() {
        Ok(())
    } else {
        Err(Error::Validation(errors))
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, process, time::SystemTime};

    use sha2::{Digest, Sha256};

    use super::*;

    fn workspace() -> Workspace {
        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("ilxyr-nsrl-test-{}-{nonce}", process::id()));
        fs::create_dir(&root).expect("test workspace root");
        Workspace::init(root).expect("workspace")
    }

    fn registration() -> NsrlRegistration {
        serde_json::from_str(include_str!(
            "../../../examples/nsrl/p10m-v10-registration.json"
        ))
        .expect("fixture")
    }

    fn hydrated_registration(workspace: &Workspace) -> NsrlRegistration {
        let mut registration = registration();
        import_test_artifact(
            workspace,
            &mut registration.checkpoint.model,
            "test/model.nsrlpm",
            b"model bytes",
        );
        import_test_artifact(
            workspace,
            &mut registration.checkpoint.tokenizer,
            "test/tokenizer.nsrlbpe",
            b"tokenizer bytes",
        );
        import_test_artifact(
            workspace,
            &mut registration.checkpoint.model_card,
            "test/MODEL_CARD.md",
            b"model card",
        );
        import_test_artifact(
            workspace,
            &mut registration.checkpoint.executable,
            "test/nsrl-production-model",
            b"executable bytes",
        );
        let model_ref = NsrlCheckpoint::model_ref_for(
            &registration.checkpoint.lineage,
            &registration.checkpoint.model.sha256,
        );
        registration.checkpoint.model_ref = model_ref.clone();
        registration.checkpoint.weight_ref = NsrlCheckpoint::weight_ref_for(
            &registration.checkpoint.lineage,
            &registration.checkpoint.model.sha256,
        );
        registration.checkpoint.parent_checkpoint = None;

        let continuation = registration.continuation.as_mut().expect("continuation");
        import_test_artifact(
            workspace,
            &mut continuation.optimizer,
            "test/optimizer.nsrlpo",
            b"optimizer bytes",
        );
        continuation.checkpoint_ref = model_ref;
        continuation.source_model_sha256 = registration.checkpoint.model.sha256.clone();
        continuation.continuation_ref = NsrlContinuation::continuation_ref_for(
            &registration.checkpoint.lineage,
            &continuation.optimizer.sha256,
        );
        registration.checkpoint.continuation_ref = Some(continuation.continuation_ref.clone());
        registration
    }

    fn import_test_artifact(
        workspace: &Workspace,
        artifact: &mut NsrlArtifact,
        path: &str,
        bytes: &[u8],
    ) {
        let source = workspace.root().join(path);
        fs::create_dir_all(source.parent().expect("parent")).expect("artifact directory");
        fs::write(&source, bytes).expect("artifact source");
        let sha256 = format!("{:x}", Sha256::digest(bytes));
        let blob_ref = workspace.put_blob(&source, &sha256).expect("import blob");
        *artifact = NsrlArtifact {
            path: path.to_owned(),
            sha256,
            size_bytes: u64::try_from(bytes.len()).expect("test bytes fit"),
            blob_ref,
        };
    }

    #[test]
    fn checkpoint_and_continuation_registration_are_idempotent() {
        let workspace = workspace();
        let registration = hydrated_registration(&workspace);
        let first = register_nsrl_model(&workspace, registration.clone()).expect("register");
        let second = register_nsrl_model(&workspace, registration.clone()).expect("repeat");

        assert_eq!(first, second);
        assert_eq!(
            registered_nsrl_model(&workspace, &registration.checkpoint.model_ref)
                .expect("checkpoint"),
            registration.checkpoint
        );
        let continuation = registration.continuation.expect("continuation");
        assert_eq!(
            registered_nsrl_continuation(&workspace, &continuation.continuation_ref)
                .expect("continuation"),
            continuation
        );
        assert!(workspace.verify().expect("verify").valid);
    }

    #[test]
    fn mutable_or_mismatched_nsrl_bindings_are_rejected() {
        let mut registration = registration();
        registration.checkpoint.source.commit = "main".to_owned();
        registration.checkpoint.model_ref = "model://nsrl/p10m@mutable".to_owned();

        let error = validate_nsrl_registration(&registration).expect_err("mutable source");
        assert!(error.to_string().contains("full lowercase Git hash"));
        assert!(error.to_string().contains("model_ref must equal"));
    }

    #[test]
    fn registration_requires_custodied_blobs() {
        let workspace = workspace();
        let error = register_nsrl_model(&workspace, registration()).expect_err("missing blobs");

        assert!(error.to_string().contains("blob"));
        assert!(error.to_string().contains("not found"));
    }

    #[test]
    fn gate_status_is_fail_closed_and_provenance_cannot_overclaim() {
        let workspace = workspace();
        let registration = hydrated_registration(&workspace);
        let model_ref = registration.checkpoint.model_ref.clone();
        register_nsrl_model(&workspace, registration).expect("register");

        let unopened = nsrl_status(&workspace, &model_ref).expect("status");
        assert!(!unopened.candidate_eligible);
        assert!(
            unopened
                .gates
                .values()
                .all(|gate| gate.status == NsrlGateStatusValue::Unopened)
        );

        let mut evaluation: NsrlGateEvidence = serde_json::from_str(include_str!(
            "../../../examples/nsrl/p10m-v10-generation-gate.json"
        ))
        .expect("gate fixture");
        evaluation.model_ref = model_ref.clone();
        import_test_artifact(
            &workspace,
            &mut evaluation.artifacts[0],
            "test/pilot-evidence.json",
            b"pilot evidence",
        );
        record_nsrl_gate_evidence(&workspace, evaluation.clone()).expect("record failure");
        let status = nsrl_status(&workspace, &model_ref).expect("status");
        assert_eq!(
            status.gates[&NsrlGate::Generation].status,
            NsrlGateStatusValue::Failed
        );

        evaluation.id = "nsrl.p10m.v10.provenance.invalid-pass".to_owned();
        evaluation.gate = NsrlGate::Provenance;
        evaluation.outcome = NsrlGateOutcome::Passed;
        let error = record_nsrl_gate_evidence(&workspace, evaluation)
            .expect_err("unpublished source and unlicensed weights must fail closed");
        assert!(error.to_string().contains("provenance gate cannot pass"));
    }
}
