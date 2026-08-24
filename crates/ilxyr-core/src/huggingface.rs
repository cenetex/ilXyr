use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use crate::{ActorKind, ActorRef, Error, Result, Workspace};

pub(crate) const HUGGING_FACE_MODEL_REGISTERED: &str = "HuggingFaceModelRegistered";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HuggingFaceFile {
    pub path: String,
    pub size: u64,
    pub blob_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HuggingFaceModel {
    pub schema: String,
    pub model_ref: String,
    pub weight_ref: String,
    pub repo_id: String,
    pub repository: String,
    pub revision: String,
    pub pipeline_tag: String,
    pub library_name: String,
    pub license: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parameter_count: Option<u64>,
    pub files: Vec<HuggingFaceFile>,
}

impl HuggingFaceModel {
    #[must_use]
    pub fn model_ref_for(repo_id: &str, revision: &str) -> String {
        format!("model://huggingface/{repo_id}@{revision}")
    }

    #[must_use]
    pub fn weight_ref_for(repo_id: &str, revision: &str) -> String {
        format!("weight://huggingface/{repo_id}@{revision}")
    }
}

pub fn register_huggingface_model(
    workspace: &Workspace,
    model: HuggingFaceModel,
) -> Result<String> {
    validate_huggingface_model(&model)?;

    if let Some(event) = workspace.latest_event(HUGGING_FACE_MODEL_REGISTERED, &model.model_ref)? {
        let artifact_ref = event.artifact_ref.ok_or_else(|| {
            Error::Conflict(format!(
                "{HUGGING_FACE_MODEL_REGISTERED} event has no artifact"
            ))
        })?;
        let existing: HuggingFaceModel = workspace.get(&artifact_ref)?;
        if existing == model {
            return Ok(artifact_ref);
        }
        return Err(Error::Conflict(format!(
            "Hugging Face model {} is already registered with different metadata",
            model.model_ref
        )));
    }

    let artifact_ref = workspace.put(&model)?;
    workspace.append_event(
        HUGGING_FACE_MODEL_REGISTERED,
        &model.model_ref,
        ActorRef::service("service://ilxyr/huggingface-hub-v1"),
        Some(artifact_ref.clone()),
    )?;
    Ok(artifact_ref)
}

pub fn registered_huggingface_model(
    workspace: &Workspace,
    model_ref: &str,
) -> Result<HuggingFaceModel> {
    let event = workspace
        .latest_event(HUGGING_FACE_MODEL_REGISTERED, model_ref)?
        .ok_or_else(|| Error::NotFound(format!("Hugging Face model {model_ref}")))?;
    let artifact_ref = event.artifact_ref.ok_or_else(|| {
        Error::Conflict(format!(
            "{HUGGING_FACE_MODEL_REGISTERED} event has no artifact"
        ))
    })?;
    workspace.get(&artifact_ref)
}

pub fn require_registered_huggingface_actor(workspace: &Workspace, actor: &ActorRef) -> Result<()> {
    if actor.kind != ActorKind::Model {
        return Ok(());
    }
    let Some(model_ref) = actor.model_ref.as_deref() else {
        return Ok(());
    };
    if !model_ref.starts_with("model://huggingface/") {
        return Ok(());
    }
    registered_huggingface_model(workspace, model_ref)?;
    Ok(())
}

pub fn require_registered_huggingface_weight(
    workspace: &Workspace,
    weight_ref: &str,
) -> Result<()> {
    let Some(suffix) = weight_ref.strip_prefix("weight://huggingface/") else {
        return Ok(());
    };
    let model_ref = format!("model://huggingface/{suffix}");
    let model = registered_huggingface_model(workspace, &model_ref)?;
    if model.weight_ref != weight_ref {
        return Err(Error::Conflict(format!(
            "registered Hugging Face model {model_ref} does not bind weight handle {weight_ref}"
        )));
    }
    Ok(())
}

pub fn validate_huggingface_model(model: &HuggingFaceModel) -> Result<()> {
    let mut errors = Vec::new();
    if model.schema != "ilxyr.huggingface_model.v1" {
        errors.push("hugging_face_model.schema must be ilxyr.huggingface_model.v1".to_owned());
    }
    if !valid_repo_id(&model.repo_id) {
        errors
            .push("hugging_face_model.repo_id must be a namespace/name Hub identifier".to_owned());
    }
    if !is_lower_hex(&model.revision, 40) {
        errors.push(
            "hugging_face_model.revision must be a full lowercase 40-character commit SHA"
                .to_owned(),
        );
    }

    let expected_model_ref = HuggingFaceModel::model_ref_for(&model.repo_id, &model.revision);
    if model.model_ref != expected_model_ref {
        errors.push(format!(
            "hugging_face_model.model_ref must equal {expected_model_ref}"
        ));
    }
    let expected_weight_ref = HuggingFaceModel::weight_ref_for(&model.repo_id, &model.revision);
    if model.weight_ref != expected_weight_ref {
        errors.push(format!(
            "hugging_face_model.weight_ref must equal {expected_weight_ref}"
        ));
    }
    let expected_repository = format!("https://huggingface.co/{}", model.repo_id);
    if model.repository != expected_repository {
        errors.push(format!(
            "hugging_face_model.repository must equal {expected_repository}"
        ));
    }
    for (value, field) in [
        (&model.pipeline_tag, "pipeline_tag"),
        (&model.library_name, "library_name"),
        (&model.license, "license"),
    ] {
        if value.trim().is_empty() {
            errors.push(format!("hugging_face_model.{field} must not be empty"));
        }
    }
    if model.parameter_count == Some(0) {
        errors.push("hugging_face_model.parameter_count must be positive".to_owned());
    }
    if model.files.is_empty() {
        errors.push("hugging_face_model.files must not be empty".to_owned());
    }

    let mut paths = BTreeSet::new();
    for file in &model.files {
        if !valid_repo_path(&file.path) {
            errors.push(format!(
                "hugging_face_model file path is not safe: {}",
                file.path
            ));
        }
        if !paths.insert(&file.path) {
            errors.push(format!(
                "hugging_face_model contains duplicate file path {}",
                file.path
            ));
        }
        if !is_lower_hex(&file.blob_id, 40) && !is_lower_hex(&file.blob_id, 64) {
            errors.push(format!(
                "hugging_face_model file {} has an invalid blob_id",
                file.path
            ));
        }
        if let Some(sha256) = &file.sha256 {
            if !is_lower_hex(sha256, 64) {
                errors.push(format!(
                    "hugging_face_model file {} has an invalid SHA-256 digest",
                    file.path
                ));
            }
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(Error::Validation(errors))
    }
}

fn valid_repo_id(value: &str) -> bool {
    let mut parts = value.split('/');
    let Some(namespace) = parts.next() else {
        return false;
    };
    let Some(name) = parts.next() else {
        return false;
    };
    parts.next().is_none() && valid_repo_component(namespace) && valid_repo_component(name)
}

fn valid_repo_component(value: &str) -> bool {
    !value.is_empty()
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
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

#[cfg(test)]
mod tests {
    use std::{fs, process, time::SystemTime};

    use super::*;

    fn workspace() -> Workspace {
        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("ilxyr-huggingface-test-{}-{nonce}", process::id()));
        fs::create_dir(&root).expect("test workspace root");
        Workspace::init(root).expect("workspace")
    }

    #[test]
    fn pinned_hugging_face_model_registration_is_idempotent() {
        let workspace = workspace();
        let model: HuggingFaceModel = serde_json::from_str(include_str!(
            "../../../examples/schema/huggingface-model.json"
        ))
        .expect("fixture");

        let first = register_huggingface_model(&workspace, model.clone()).expect("register");
        let second = register_huggingface_model(&workspace, model.clone()).expect("repeat");

        assert_eq!(first, second);
        assert_eq!(
            registered_huggingface_model(&workspace, &model.model_ref).expect("lookup"),
            model
        );
        assert!(workspace.verify().expect("verify").valid);
    }

    #[test]
    fn mutable_or_mismatched_hub_references_are_rejected() {
        let mut model: HuggingFaceModel = serde_json::from_str(include_str!(
            "../../../examples/schema/huggingface-model.json"
        ))
        .expect("fixture");
        model.revision = "main".to_owned();

        let error = validate_huggingface_model(&model).expect_err("mutable revision");
        assert!(error.to_string().contains("40-character commit SHA"));
        assert!(error.to_string().contains("model_ref must equal"));
    }

    #[test]
    fn hugging_face_actor_and_weight_handles_must_resolve_to_the_registry() {
        let workspace = workspace();
        let model: HuggingFaceModel = serde_json::from_str(include_str!(
            "../../../examples/schema/huggingface-model.json"
        ))
        .expect("fixture");
        let actor = ActorRef {
            id: "model://research/qwen35-assimilated".to_owned(),
            kind: ActorKind::Model,
            model_ref: Some(model.model_ref.clone()),
        };

        assert!(require_registered_huggingface_actor(&workspace, &actor).is_err());
        assert!(require_registered_huggingface_weight(&workspace, &model.weight_ref).is_err());

        register_huggingface_model(&workspace, model.clone()).expect("register");
        require_registered_huggingface_actor(&workspace, &actor).expect("actor binding");
        require_registered_huggingface_weight(&workspace, &model.weight_ref)
            .expect("weight binding");
    }
}
