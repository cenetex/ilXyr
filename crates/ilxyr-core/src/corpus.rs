use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::{ActorKind, ActorRef, Error, Result, Workspace, store::now_ms};

pub const CORPUS_RELEASE_REGISTERED: &str = "CorpusReleaseRegistered";
pub const CORPUS_MATERIALIZATION_RECORDED: &str = "CorpusMaterializationRecorded";

const CORPUS_SCHEMA: &str = "ilxyr.corpus_release.v1";
const MATERIALIZATION_SCHEMA: &str = "ilxyr.corpus_materialization.v1";
const ARTIFACT_PREFIX: &str = "artifact://sha256/";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CorpusSource {
    pub repository: String,
    pub revision: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CorpusRights {
    pub license: String,
    #[serde(default)]
    pub use_constraints: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CorpusFile {
    pub path: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub media_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CorpusRelease {
    pub schema: String,
    pub id: String,
    pub title: String,
    pub version: String,
    pub source: CorpusSource,
    pub rights: CorpusRights,
    pub files: Vec<CorpusFile>,
    #[serde(default)]
    pub metadata: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CorpusProvider {
    AmazonS3,
    AzureBlob,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CorpusLocation {
    AmazonS3 { region: String, uri: String },
    AzureBlob { uri: String },
}

impl CorpusLocation {
    #[must_use]
    pub fn provider(&self) -> CorpusProvider {
        match self {
            Self::AmazonS3 { .. } => CorpusProvider::AmazonS3,
            Self::AzureBlob { .. } => CorpusProvider::AzureBlob,
        }
    }

    #[must_use]
    pub fn base_uri(&self) -> &str {
        match self {
            Self::AmazonS3 { uri, .. } | Self::AzureBlob { uri } => uri,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct MaterializedCorpusFile {
    pub path: String,
    pub uri: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub provider_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CorpusMaterialization {
    pub schema: String,
    pub id: String,
    pub corpus_ref: String,
    pub location: CorpusLocation,
    pub objects: Vec<MaterializedCorpusFile>,
    pub verified_by: ActorRef,
    pub verified_at_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RegisteredCorpus {
    pub artifact_ref: String,
    pub release: CorpusRelease,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RegisteredMaterialization {
    pub artifact_ref: String,
    pub materialization: CorpusMaterialization,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "PascalCase")]
pub enum SageMakerInputMode {
    File,
    FastFile,
    Pipe,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SageMakerHandoffRequest {
    pub materialization_ref: String,
    pub channel_name: String,
    pub content_type: String,
    pub input_mode: SageMakerInputMode,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "PascalCase")]
pub struct SageMakerS3DataSource {
    pub s3_data_type: String,
    pub s3_uri: String,
    pub s3_data_distribution_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "PascalCase")]
pub struct SageMakerDataSource {
    pub s3_data_source: SageMakerS3DataSource,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "PascalCase")]
pub struct SageMakerChannel {
    pub channel_name: String,
    pub content_type: String,
    pub input_mode: SageMakerInputMode,
    pub data_source: SageMakerDataSource,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "PascalCase")]
pub struct SageMakerTag {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SageMakerCorpusHandoff {
    pub schema: String,
    pub corpus_ref: String,
    pub materialization_ref: String,
    pub expected_files: Vec<CorpusFile>,
    pub materialized_objects: Vec<MaterializedCorpusFile>,
    pub region: String,
    pub input_data_config: Vec<SageMakerChannel>,
    pub tags: Vec<SageMakerTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AzureInputMode {
    Download,
    RoMount,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AzureMlHandoffRequest {
    pub materialization_ref: String,
    pub asset_name: String,
    pub input_name: String,
    pub mode: AzureInputMode,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AzureMlDataAsset {
    pub name: String,
    pub version: String,
    #[serde(rename = "type")]
    pub asset_type: String,
    pub path: String,
    pub properties: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AzureMlJobInput {
    pub name: String,
    #[serde(rename = "type")]
    pub input_type: String,
    pub path: String,
    pub mode: AzureInputMode,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AzureMlCorpusHandoff {
    pub schema: String,
    pub corpus_ref: String,
    pub materialization_ref: String,
    pub expected_files: Vec<CorpusFile>,
    pub materialized_objects: Vec<MaterializedCorpusFile>,
    pub data_asset: AzureMlDataAsset,
    pub job_input: AzureMlJobInput,
}

pub fn register_corpus_release(
    workspace: &Workspace,
    release: CorpusRelease,
) -> Result<RegisteredCorpus> {
    validate_corpus_release(&release)?;
    if let Some(event) = workspace.latest_event(CORPUS_RELEASE_REGISTERED, &release.id)? {
        let artifact_ref = required_artifact_ref(event.artifact_ref, CORPUS_RELEASE_REGISTERED)?;
        let existing: CorpusRelease = workspace.get(&artifact_ref)?;
        if existing != release {
            return Err(Error::Conflict(format!(
                "corpus {} is already registered with different content",
                release.id
            )));
        }
        return Ok(RegisteredCorpus {
            artifact_ref,
            release: existing,
        });
    }

    let artifact_ref = workspace.put(&release)?;
    workspace.append_event(
        CORPUS_RELEASE_REGISTERED,
        &release.id,
        ActorRef::service("service://ilxyr/corpus-registry-v1"),
        Some(artifact_ref.clone()),
    )?;
    Ok(RegisteredCorpus {
        artifact_ref,
        release,
    })
}

pub fn registered_corpus_release(workspace: &Workspace, id: &str) -> Result<RegisteredCorpus> {
    let event = workspace
        .latest_event(CORPUS_RELEASE_REGISTERED, id)?
        .ok_or_else(|| Error::NotFound(format!("corpus {id}")))?;
    let artifact_ref = required_artifact_ref(event.artifact_ref, CORPUS_RELEASE_REGISTERED)?;
    let release = corpus_release_by_ref(workspace, &artifact_ref)?;
    Ok(RegisteredCorpus {
        artifact_ref,
        release,
    })
}

pub fn corpus_release_by_ref(workspace: &Workspace, artifact_ref: &str) -> Result<CorpusRelease> {
    validate_artifact_ref(artifact_ref, "corpus_ref")?;
    let release: CorpusRelease = workspace.get(artifact_ref)?;
    validate_corpus_release(&release)?;
    Ok(release)
}

pub fn record_corpus_materialization(
    workspace: &Workspace,
    materialization: CorpusMaterialization,
) -> Result<RegisteredMaterialization> {
    let release = corpus_release_by_ref(workspace, &materialization.corpus_ref)?;
    validate_corpus_materialization(&materialization, &release)?;
    if let Some(event) =
        workspace.latest_event(CORPUS_MATERIALIZATION_RECORDED, &materialization.id)?
    {
        let artifact_ref =
            required_artifact_ref(event.artifact_ref, CORPUS_MATERIALIZATION_RECORDED)?;
        let existing: CorpusMaterialization = workspace.get(&artifact_ref)?;
        if existing != materialization {
            return Err(Error::Conflict(format!(
                "materialization {} is already recorded with different content",
                materialization.id
            )));
        }
        return Ok(RegisteredMaterialization {
            artifact_ref,
            materialization: existing,
        });
    }

    let artifact_ref = workspace.put(&materialization)?;
    workspace.append_event(
        CORPUS_MATERIALIZATION_RECORDED,
        &materialization.id,
        ActorRef::service("service://ilxyr/corpus-materialization-v1"),
        Some(artifact_ref.clone()),
    )?;
    Ok(RegisteredMaterialization {
        artifact_ref,
        materialization,
    })
}

pub fn registered_corpus_materialization(
    workspace: &Workspace,
    id: &str,
) -> Result<RegisteredMaterialization> {
    let event = workspace
        .latest_event(CORPUS_MATERIALIZATION_RECORDED, id)?
        .ok_or_else(|| Error::NotFound(format!("corpus materialization {id}")))?;
    let artifact_ref = required_artifact_ref(event.artifact_ref, CORPUS_MATERIALIZATION_RECORDED)?;
    let materialization = corpus_materialization_by_ref(workspace, &artifact_ref)?;
    Ok(RegisteredMaterialization {
        artifact_ref,
        materialization,
    })
}

pub fn corpus_materialization_by_ref(
    workspace: &Workspace,
    artifact_ref: &str,
) -> Result<CorpusMaterialization> {
    validate_artifact_ref(artifact_ref, "materialization_ref")?;
    let materialization: CorpusMaterialization = workspace.get(artifact_ref)?;
    let release = corpus_release_by_ref(workspace, &materialization.corpus_ref)?;
    validate_corpus_materialization(&materialization, &release)?;
    Ok(materialization)
}

pub fn sagemaker_corpus_handoff(
    workspace: &Workspace,
    request: SageMakerHandoffRequest,
) -> Result<SageMakerCorpusHandoff> {
    validate_name(&request.channel_name, "channel_name")?;
    validate_nonempty(&request.content_type, "content_type")?;
    let materialization = corpus_materialization_by_ref(workspace, &request.materialization_ref)?;
    let release = corpus_release_by_ref(workspace, &materialization.corpus_ref)?;
    let (region, uri) = match &materialization.location {
        CorpusLocation::AmazonS3 { region, uri } => (region.clone(), uri.clone()),
        CorpusLocation::AzureBlob { .. } => {
            return Err(Error::Validation(vec![
                "SageMaker handoff requires an amazon_s3 materialization".to_owned(),
            ]));
        }
    };
    let corpus_digest = artifact_digest(&materialization.corpus_ref)?;
    let materialization_digest = artifact_digest(&request.materialization_ref)?.to_owned();
    Ok(SageMakerCorpusHandoff {
        schema: "ilxyr.sagemaker_corpus_handoff.v1".to_owned(),
        corpus_ref: materialization.corpus_ref.clone(),
        materialization_ref: request.materialization_ref,
        expected_files: release.files,
        materialized_objects: materialization.objects.clone(),
        region,
        input_data_config: vec![SageMakerChannel {
            channel_name: request.channel_name,
            content_type: request.content_type,
            input_mode: request.input_mode,
            data_source: SageMakerDataSource {
                s3_data_source: SageMakerS3DataSource {
                    s3_data_type: "S3Prefix".to_owned(),
                    s3_uri: uri,
                    s3_data_distribution_type: "FullyReplicated".to_owned(),
                },
            },
        }],
        tags: vec![
            SageMakerTag {
                key: "ilxyr:corpus-sha256".to_owned(),
                value: corpus_digest.to_owned(),
            },
            SageMakerTag {
                key: "ilxyr:materialization-sha256".to_owned(),
                value: materialization_digest,
            },
        ],
    })
}

pub fn azure_ml_corpus_handoff(
    workspace: &Workspace,
    request: AzureMlHandoffRequest,
) -> Result<AzureMlCorpusHandoff> {
    validate_name(&request.asset_name, "asset_name")?;
    validate_name(&request.input_name, "input_name")?;
    let materialization = corpus_materialization_by_ref(workspace, &request.materialization_ref)?;
    let release = corpus_release_by_ref(workspace, &materialization.corpus_ref)?;
    let uri = match &materialization.location {
        CorpusLocation::AzureBlob { uri } => uri.clone(),
        CorpusLocation::AmazonS3 { .. } => {
            return Err(Error::Validation(vec![
                "Azure ML handoff requires an azure_blob materialization".to_owned(),
            ]));
        }
    };
    let corpus_digest = artifact_digest(&materialization.corpus_ref)?.to_owned();
    let mut properties = BTreeMap::new();
    properties.insert(
        "ilxyr_corpus_ref".to_owned(),
        materialization.corpus_ref.clone(),
    );
    properties.insert(
        "ilxyr_materialization_ref".to_owned(),
        request.materialization_ref.clone(),
    );
    let asset_path = format!("azureml:{}:{corpus_digest}", request.asset_name);
    Ok(AzureMlCorpusHandoff {
        schema: "ilxyr.azure_ml_corpus_handoff.v1".to_owned(),
        corpus_ref: materialization.corpus_ref,
        materialization_ref: request.materialization_ref,
        expected_files: release.files,
        materialized_objects: materialization.objects,
        data_asset: AzureMlDataAsset {
            name: request.asset_name,
            version: corpus_digest,
            asset_type: "uri_folder".to_owned(),
            path: uri,
            properties,
        },
        job_input: AzureMlJobInput {
            name: request.input_name,
            input_type: "uri_folder".to_owned(),
            path: asset_path,
            mode: request.mode,
        },
    })
}

pub fn validate_corpus_release(release: &CorpusRelease) -> Result<()> {
    let mut errors = Vec::new();
    if release.schema != CORPUS_SCHEMA {
        errors.push(format!("corpus.schema must be {CORPUS_SCHEMA}"));
    }
    if !valid_corpus_id(&release.id) {
        errors.push(
            "corpus.id must be an immutable dataset:// or representation:// handle".to_owned(),
        );
    }
    if release.title.trim().is_empty() {
        errors.push("corpus.title must not be empty".to_owned());
    }
    if !valid_version(&release.version) {
        errors
            .push("corpus.version must contain only letters, digits, '.', '_', or '-'".to_owned());
    }
    if !valid_repository(&release.source.repository) {
        errors.push("corpus.source.repository must be an https:// repository URL".to_owned());
    }
    if !is_lower_hex(&release.source.revision, 40) {
        errors.push("corpus.source.revision must be a full lowercase Git commit SHA".to_owned());
    }
    if !valid_portable_path(&release.source.path) {
        errors.push("corpus.source.path must be a safe relative path".to_owned());
    }
    if release.rights.license.trim().is_empty() {
        errors.push("corpus.rights.license must not be empty".to_owned());
    }
    let mut constraints = BTreeSet::new();
    for constraint in &release.rights.use_constraints {
        if constraint.trim().is_empty() {
            errors.push("corpus.rights.use_constraints must not contain empty values".to_owned());
        }
        if !constraints.insert(constraint.as_str()) {
            errors.push(format!(
                "corpus.rights.use_constraints contains duplicate value {constraint}"
            ));
        }
    }
    if release.files.is_empty() {
        errors.push("corpus.files must contain at least one file".to_owned());
    }
    let mut paths = BTreeSet::new();
    let mut total_size = 0_u64;
    for (index, file) in release.files.iter().enumerate() {
        if !valid_portable_path(&file.path) {
            errors.push(format!(
                "corpus.files[{index}].path must be a safe portable path"
            ));
        }
        if !paths.insert(file.path.as_str()) {
            errors.push(format!(
                "corpus.files contains duplicate path {}",
                file.path
            ));
        }
        if !is_lower_sha256(&file.sha256) {
            errors.push(format!(
                "corpus.files[{index}].sha256 must be lowercase SHA-256"
            ));
        }
        if file.media_type.trim().is_empty()
            || !file.media_type.contains('/')
            || file.media_type.chars().any(char::is_whitespace)
        {
            errors.push(format!(
                "corpus.files[{index}].media_type must be a MIME type"
            ));
        }
        match total_size.checked_add(file.size_bytes) {
            Some(value) => total_size = value,
            None => errors.push("corpus file sizes overflow u64".to_owned()),
        }
    }
    for (key, value) in &release.metadata {
        if key.trim().is_empty() || value.trim().is_empty() {
            errors.push("corpus.metadata keys and values must not be empty".to_owned());
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(Error::Validation(errors))
    }
}

pub fn validate_corpus_materialization(
    materialization: &CorpusMaterialization,
    release: &CorpusRelease,
) -> Result<()> {
    let mut errors = Vec::new();
    if materialization.schema != MATERIALIZATION_SCHEMA {
        errors.push(format!(
            "materialization.schema must be {MATERIALIZATION_SCHEMA}"
        ));
    }
    if !materialization.id.starts_with("materialization://")
        || materialization.id.len() <= "materialization://".len()
        || materialization.id.chars().any(char::is_whitespace)
    {
        errors.push("materialization.id must be a materialization:// handle".to_owned());
    }
    if let Err(error) = validate_artifact_ref(&materialization.corpus_ref, "corpus_ref") {
        errors.push(error.to_string());
    }
    if materialization.verified_by.kind != ActorKind::Service
        || !materialization.verified_by.id.starts_with("service://")
        || materialization
            .verified_by
            .id
            .chars()
            .any(char::is_whitespace)
        || materialization.verified_by.model_ref.is_some()
    {
        errors.push("materialization.verified_by must be a service actor".to_owned());
    }
    if materialization.verified_at_ms == 0 {
        errors.push("materialization.verified_at_ms must be positive".to_owned());
    } else if let Ok(current) = now_ms() {
        if materialization.verified_at_ms > current.saturating_add(300_000) {
            errors.push(
                "materialization.verified_at_ms cannot be more than five minutes in the future"
                    .to_owned(),
            );
        }
    }
    if materialization.objects.len() != release.files.len() {
        errors.push(format!(
            "materialization must contain exactly {} objects",
            release.files.len()
        ));
    }
    validate_location(&materialization.location, &mut errors);

    let expected = release
        .files
        .iter()
        .map(|file| (file.path.as_str(), (&file.sha256, file.size_bytes)))
        .collect::<BTreeMap<_, _>>();
    let mut actual_paths = BTreeSet::new();
    let expected_provider = materialization.location.provider();
    let base_uri = materialization.location.base_uri().trim_end_matches('/');
    for (index, object) in materialization.objects.iter().enumerate() {
        if !actual_paths.insert(object.path.as_str()) {
            errors.push(format!(
                "materialization.objects contains duplicate path {}",
                object.path
            ));
        }
        match expected.get(object.path.as_str()) {
            Some((sha256, size_bytes))
                if object.sha256 == **sha256 && object.size_bytes == *size_bytes => {}
            Some(_) => errors.push(format!(
                "materialization.objects[{index}] does not match the corpus digest and size"
            )),
            None => errors.push(format!(
                "materialization.objects[{index}].path is not declared by the corpus"
            )),
        }
        if !is_lower_sha256(&object.sha256) {
            errors.push(format!(
                "materialization.objects[{index}].sha256 must be lowercase SHA-256"
            ));
        }
        if object.provider_version.trim().is_empty() {
            errors.push(format!(
                "materialization.objects[{index}].provider_version must not be empty"
            ));
        }
        if !valid_object_uri(expected_provider.clone(), &object.uri)
            || object.uri != format!("{base_uri}/{}", object.path)
        {
            errors.push(format!(
                "materialization.objects[{index}].uri must equal the base URI plus its corpus path"
            ));
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(Error::Validation(errors))
    }
}

fn validate_location(location: &CorpusLocation, errors: &mut Vec<String>) {
    match location {
        CorpusLocation::AmazonS3 { region, uri } => {
            if !valid_cloud_name(region) {
                errors.push("amazon_s3 region is invalid".to_owned());
            }
            if !valid_s3_uri(uri) {
                errors.push(
                    "amazon_s3 uri must be an s3:// bucket prefix without a trailing slash"
                        .to_owned(),
                );
            }
        }
        CorpusLocation::AzureBlob { uri } => {
            if !valid_azure_uri(uri) {
                errors.push("azure_blob uri must be an HTTPS Blob URL or azureml:// datastore path without a trailing slash".to_owned());
            }
        }
    }
}

fn valid_object_uri(provider: CorpusProvider, uri: &str) -> bool {
    match provider {
        CorpusProvider::AmazonS3 => valid_s3_uri(uri),
        CorpusProvider::AzureBlob => valid_azure_uri(uri),
    }
}

fn required_artifact_ref(value: Option<String>, event_type: &str) -> Result<String> {
    value.ok_or_else(|| Error::Conflict(format!("{event_type} event has no artifact")))
}

fn validate_artifact_ref<'a>(artifact_ref: &'a str, field: &str) -> Result<&'a str> {
    let digest = artifact_ref.strip_prefix(ARTIFACT_PREFIX).ok_or_else(|| {
        Error::Validation(vec![format!("{field} must start with {ARTIFACT_PREFIX}")])
    })?;
    if !is_lower_sha256(digest) {
        return Err(Error::Validation(vec![format!(
            "{field} must contain a lowercase SHA-256 digest"
        )]));
    }
    Ok(digest)
}

fn artifact_digest(artifact_ref: &str) -> Result<&str> {
    validate_artifact_ref(artifact_ref, "artifact_ref")
}

fn validate_name(value: &str, field: &str) -> Result<()> {
    if valid_cloud_name(value) {
        Ok(())
    } else {
        Err(Error::Validation(vec![format!(
            "{field} must contain only letters, digits, '.', '_', or '-'"
        )]))
    }
}

fn validate_nonempty(value: &str, field: &str) -> Result<()> {
    if value.trim().is_empty() {
        Err(Error::Validation(vec![format!(
            "{field} must not be empty"
        )]))
    } else {
        Ok(())
    }
}

fn valid_corpus_id(value: &str) -> bool {
    let rest = value
        .strip_prefix("dataset://")
        .or_else(|| value.strip_prefix("representation://"));
    rest.is_some_and(|rest| {
        !rest.is_empty()
            && !rest.starts_with('/')
            && !rest.ends_with('/')
            && rest
                .split('/')
                .all(|segment| valid_cloud_name(segment) && segment != "." && segment != "..")
    })
}

fn valid_version(value: &str) -> bool {
    valid_cloud_name(value)
}

fn valid_cloud_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

fn valid_repository(value: &str) -> bool {
    value.starts_with("https://") && !value.chars().any(char::is_whitespace)
}

fn valid_portable_path(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('/')
        && !value.ends_with('/')
        && !value.contains('\\')
        && value.split('/').all(|segment| {
            !segment.is_empty()
                && segment != "."
                && segment != ".."
                && segment
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
        })
}

fn valid_s3_uri(value: &str) -> bool {
    let Some(rest) = value.strip_prefix("s3://") else {
        return false;
    };
    !rest.is_empty()
        && !rest.starts_with('/')
        && !value.ends_with('/')
        && !value.chars().any(char::is_whitespace)
}

fn valid_azure_uri(value: &str) -> bool {
    let valid_scheme = value.starts_with("azureml://datastores/")
        || (value.starts_with("https://") && value.contains(".blob.core.windows.net/"));
    valid_scheme && !value.ends_with('/') && !value.chars().any(char::is_whitespace)
}

fn is_lower_sha256(value: &str) -> bool {
    is_lower_hex(value, 64)
}

fn is_lower_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
