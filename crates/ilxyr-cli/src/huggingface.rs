use std::{env, time::Duration};

use ilxyr_core::{Error, HuggingFaceFile, HuggingFaceModel, Result, validate_huggingface_model};
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
struct HubModelInfo {
    #[serde(rename = "modelId")]
    model_id: String,
    sha: String,
    private: bool,
    #[serde(default)]
    gated: Value,
    #[serde(default)]
    disabled: bool,
    pipeline_tag: Option<String>,
    library_name: Option<String>,
    #[serde(rename = "cardData")]
    card_data: Option<HubCardData>,
    safetensors: Option<HubSafetensors>,
    siblings: Vec<HubFile>,
}

#[derive(Debug, Deserialize)]
struct HubCardData {
    license: Option<String>,
    base_model: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct HubSafetensors {
    total: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct HubFile {
    rfilename: String,
    #[serde(rename = "blobId")]
    blob_id: Option<String>,
    size: Option<u64>,
    lfs: Option<HubLfs>,
}

#[derive(Debug, Deserialize)]
struct HubLfs {
    sha256: String,
}

pub fn import_model(repo_id: &str, requested_revision: Option<&str>) -> Result<HuggingFaceModel> {
    validate_repo_id(repo_id)?;
    if let Some(revision) = requested_revision {
        validate_revision(revision)?;
    }

    let mut url = format!("https://huggingface.co/api/models/{repo_id}");
    if let Some(revision) = requested_revision {
        url.push_str("/revision/");
        url.push_str(revision);
    }
    url.push_str("?blobs=true");

    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(30))
        .build();
    let mut request = agent.get(&url).set("User-Agent", "ilxyr/0.1");
    if let Ok(token) = env::var("HF_TOKEN")
        && !token.trim().is_empty()
    {
        request = request.set("Authorization", &format!("Bearer {token}"));
    }
    let response = request.call().map_err(hub_error)?;
    let info: HubModelInfo = response.into_json().map_err(|error| {
        Error::Execution(format!(
            "Hugging Face returned invalid model metadata: {error}"
        ))
    })?;
    let model = from_hub_info(repo_id, info)?;
    if let Some(requested_revision) = requested_revision
        && model.revision != requested_revision.to_ascii_lowercase()
    {
        return Err(Error::Security(format!(
            "Hugging Face returned revision {} when {} was requested",
            model.revision, requested_revision
        )));
    }
    Ok(model)
}

fn from_hub_info(repo_id: &str, info: HubModelInfo) -> Result<HuggingFaceModel> {
    if info.model_id != repo_id {
        return Err(Error::Security(format!(
            "Hugging Face resolved {repo_id} as unexpected repository {}",
            info.model_id
        )));
    }
    if info.private || info.gated != Value::Bool(false) {
        return Err(Error::Security(
            "the v1 Hugging Face importer accepts only public, ungated model weights".to_owned(),
        ));
    }
    if info.disabled {
        return Err(Error::Security(
            "the Hugging Face model repository is disabled".to_owned(),
        ));
    }

    let revision = info.sha.to_ascii_lowercase();
    validate_revision(&revision)?;
    let card_data = info.card_data.ok_or_else(|| {
        Error::Validation(vec![
            "Hugging Face model card metadata is required".to_owned(),
        ])
    })?;
    let license = card_data.license.ok_or_else(|| {
        Error::Validation(vec![
            "Hugging Face model card must declare a license".to_owned(),
        ])
    })?;
    let mut files = info
        .siblings
        .into_iter()
        .map(|file| {
            Ok(HuggingFaceFile {
                path: file.rfilename,
                size: file.size.ok_or_else(|| {
                    Error::Validation(vec![
                        "Hugging Face API omitted file sizes; blobs=true is required".to_owned(),
                    ])
                })?,
                blob_id: file.blob_id.ok_or_else(|| {
                    Error::Validation(vec![
                        "Hugging Face API omitted file blob IDs; blobs=true is required".to_owned(),
                    ])
                })?,
                sha256: file.lfs.map(|lfs| lfs.sha256),
            })
        })
        .collect::<Result<Vec<_>>>()?;
    files.sort_by(|left, right| left.path.cmp(&right.path));

    let model = HuggingFaceModel {
        schema: "ilxyr.huggingface_model.v1".to_owned(),
        model_ref: HuggingFaceModel::model_ref_for(repo_id, &revision),
        weight_ref: HuggingFaceModel::weight_ref_for(repo_id, &revision),
        repo_id: repo_id.to_owned(),
        repository: format!("https://huggingface.co/{repo_id}"),
        revision,
        pipeline_tag: info.pipeline_tag.ok_or_else(|| {
            Error::Validation(vec![
                "Hugging Face model must declare a pipeline tag".to_owned(),
            ])
        })?,
        library_name: info.library_name.ok_or_else(|| {
            Error::Validation(vec!["Hugging Face model must declare a library".to_owned()])
        })?,
        license,
        base_model: card_data.base_model.and_then(first_string),
        parameter_count: info.safetensors.and_then(|value| value.total),
        files,
    };
    validate_huggingface_model(&model)?;
    Ok(model)
}

fn first_string(value: Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value),
        Value::Array(values) => values
            .into_iter()
            .find_map(|value| value.as_str().map(str::to_owned)),
        _ => None,
    }
}

fn validate_repo_id(repo_id: &str) -> Result<()> {
    let mut parts = repo_id.split('/');
    let components = [parts.next(), parts.next()];
    let valid = parts.next().is_none()
        && components.into_iter().all(|component| {
            component.is_some_and(|component| {
                !component.is_empty()
                    && component != "."
                    && component != ".."
                    && component.bytes().all(|byte| {
                        byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.')
                    })
            })
        });
    if valid {
        Ok(())
    } else {
        Err(Error::Validation(vec![
            "Hugging Face repo ID must be namespace/name".to_owned(),
        ]))
    }
}

fn validate_revision(revision: &str) -> Result<()> {
    if revision.len() == 40 && revision.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(Error::Validation(vec![
            "Hugging Face revision must be a full 40-character commit SHA".to_owned(),
        ]))
    }
}

fn hub_error(error: ureq::Error) -> Error {
    match error {
        ureq::Error::Status(status, _) => Error::Execution(format!(
            "Hugging Face model metadata request failed with HTTP {status}"
        )),
        ureq::Error::Transport(error) => Error::Execution(format!(
            "Hugging Face model metadata request failed: {error}"
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hub_metadata_becomes_a_pinned_model_manifest() {
        let info: HubModelInfo = serde_json::from_value(serde_json::json!({
            "modelId": "staccs/lecore-qwen35-9b-assimilated",
            "sha": "4e14e0ee3d5b6936dfd3dd0fa7454d9118fe88c5",
            "private": false,
            "gated": false,
            "disabled": false,
            "pipeline_tag": "image-text-to-text",
            "library_name": "transformers",
            "cardData": {
                "license": "apache-2.0",
                "base_model": "Qwen/Qwen3.5-9B"
            },
            "safetensors": { "total": 9_653_104_368_u64 },
            "siblings": [{
                "rfilename": "model.safetensors",
                "blobId": "0123456789abcdef0123456789abcdef01234567",
                "size": 42,
                "lfs": {
                    "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
                }
            }]
        }))
        .expect("metadata");

        let model = from_hub_info("staccs/lecore-qwen35-9b-assimilated", info).expect("model");
        assert!(model.model_ref.ends_with(&format!("@{}", model.revision)));
        assert!(model.weight_ref.starts_with("weight://huggingface/"));
        assert_eq!(
            model.files[0].sha256.as_deref(),
            Some("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
        );
    }

    #[test]
    fn gated_hub_models_are_not_imported_as_public_weights() {
        let info: HubModelInfo = serde_json::from_value(serde_json::json!({
            "modelId": "owner/model",
            "sha": "0123456789abcdef0123456789abcdef01234567",
            "private": false,
            "gated": "manual",
            "pipeline_tag": "text-generation",
            "library_name": "transformers",
            "cardData": { "license": "apache-2.0" },
            "siblings": []
        }))
        .expect("metadata");

        let error = from_hub_info("owner/model", info).expect_err("gated model");
        assert!(error.to_string().contains("public, ungated"));
    }

    #[test]
    fn repository_path_components_cannot_traverse_the_hub_api() {
        assert!(validate_repo_id("owner/model").is_ok());
        assert!(validate_repo_id("../model").is_err());
        assert!(validate_repo_id("owner/..").is_err());
        assert!(validate_repo_id("owner/model/extra").is_err());
    }
}
