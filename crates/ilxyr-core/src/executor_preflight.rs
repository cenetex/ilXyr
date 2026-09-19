use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File},
    io::Read,
    path::{Component, Path},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    DigestResource, Error, ExecutionNetworkMode, ExecutorEnvironmentManifest, ExecutorJobPackage,
    ExportPolicy, Result, WeightClass, verify_environment_manifest, verify_job_package,
};

const MATERIALIZATION_SCHEMA: &str = "ilxyr.executor_artifact_materialization.v1";
const PREFLIGHT_RECEIPT_SCHEMA: &str = "ilxyr.executor_preflight_receipt.v1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum ExecutorResourceScope {
    Environment,
    Job,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ExecutorMaterializationEntry {
    pub scope: ExecutorResourceScope,
    pub name: String,
    pub uri: String,
    pub relative_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ExecutorArtifactMaterialization {
    pub schema: String,
    pub environment_ref: String,
    pub job_package_ref: String,
    pub resources: Vec<ExecutorMaterializationEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct VerifiedExecutorResource {
    pub scope: ExecutorResourceScope,
    pub name: String,
    pub uri: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub relative_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ExecutorPreflightReceipt {
    pub schema: String,
    pub environment_ref: String,
    pub job_package_ref: String,
    pub verified_resources: Vec<VerifiedExecutorResource>,
    pub weight_class: WeightClass,
    pub network: ExecutionNetworkMode,
    pub export_policy: ExportPolicy,
    pub guest_credentials_included: bool,
    pub launch_authorized: bool,
}

pub fn verify_executor_materialization(
    environment: &ExecutorEnvironmentManifest,
    package: &ExecutorJobPackage,
    materialization: &ExecutorArtifactMaterialization,
    root: &Path,
) -> Result<ExecutorPreflightReceipt> {
    let environment_ref = verify_environment_manifest(environment)?;
    let job_package_ref = verify_job_package(environment, package)?;
    if materialization.schema != MATERIALIZATION_SCHEMA {
        return validation(format!(
            "unsupported materialization schema {}; expected {MATERIALIZATION_SCHEMA}",
            materialization.schema
        ));
    }
    if materialization.environment_ref != environment_ref
        || materialization.job_package_ref != job_package_ref
    {
        return Err(Error::Conflict(
            "materialization does not bind the supplied environment and job package".to_owned(),
        ));
    }
    validate_root(root)?;

    let expected = expected_resources(environment, package)?;
    let mut supplied = BTreeMap::new();
    for entry in &materialization.resources {
        let key = (entry.scope.clone(), entry.name.clone());
        if supplied.insert(key, entry).is_some() {
            return validation("materialization resource scope and name must be unique");
        }
    }
    if supplied.len() != expected.len()
        || supplied.keys().collect::<BTreeSet<_>>() != expected.keys().collect::<BTreeSet<_>>()
    {
        return Err(Error::Conflict(
            "materialization must contain every frozen environment and job resource exactly once"
                .to_owned(),
        ));
    }

    let mut verified_resources = Vec::with_capacity(expected.len());
    for (key, resource) in expected {
        let entry = supplied.get(&key).expect("materialization key set matches");
        if entry.uri != resource.uri {
            return Err(Error::Conflict(format!(
                "materialized URI for {} does not match the frozen resource",
                resource.name
            )));
        }
        let path = checked_resource_path(root, &entry.relative_path)?;
        let (sha256, size_bytes) = digest_regular_file(&path)?;
        if sha256 != resource.sha256 || size_bytes != resource.size_bytes {
            return Err(Error::Conflict(format!(
                "materialized resource {} has digest or size drift",
                resource.name
            )));
        }
        verified_resources.push(VerifiedExecutorResource {
            scope: key.0,
            name: resource.name.clone(),
            uri: resource.uri.clone(),
            sha256,
            size_bytes,
            relative_path: entry.relative_path.clone(),
        });
    }

    Ok(ExecutorPreflightReceipt {
        schema: PREFLIGHT_RECEIPT_SCHEMA.to_owned(),
        environment_ref,
        job_package_ref,
        verified_resources,
        weight_class: WeightClass::Public,
        network: ExecutionNetworkMode::Denied,
        export_policy: ExportPolicy::MetricsOnly,
        guest_credentials_included: false,
        launch_authorized: false,
    })
}

fn expected_resources<'a>(
    environment: &'a ExecutorEnvironmentManifest,
    package: &'a ExecutorJobPackage,
) -> Result<BTreeMap<(ExecutorResourceScope, String), &'a DigestResource>> {
    let environment_resources = [
        &environment.source.archive,
        &environment.build_recipe,
        &environment.runner,
        &environment.kernel,
        &environment.rootfs,
        &environment.sbom,
        &environment.provenance,
        &environment.conformance_suite,
    ];
    let job_resources = package
        .inputs
        .iter()
        .chain([
            &package.executable,
            &package.oracle,
            &package.harness,
            &package.budget.price_evidence,
        ])
        .collect::<Vec<_>>();
    let mut resources = BTreeMap::new();
    for (scope, values) in [
        (
            ExecutorResourceScope::Environment,
            environment_resources.as_slice(),
        ),
        (ExecutorResourceScope::Job, job_resources.as_slice()),
    ] {
        for resource in values {
            let key = (scope.clone(), resource.name.clone());
            if resources.insert(key, *resource).is_some() {
                return validation(format!(
                    "duplicate {:?} resource name {}",
                    scope, resource.name
                ));
            }
        }
    }
    Ok(resources)
}

fn validate_root(root: &Path) -> Result<()> {
    if !root.is_absolute() {
        return validation("artifact root must be an absolute path");
    }
    let metadata = fs::symlink_metadata(root)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(Error::Security(
            "artifact root must be a real directory, not a symlink".to_owned(),
        ));
    }
    Ok(())
}

fn checked_resource_path(root: &Path, relative_path: &str) -> Result<std::path::PathBuf> {
    if relative_path.trim().is_empty() {
        return validation("materialized resource path must not be empty");
    }
    let relative = Path::new(relative_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(Error::Security(
            "materialized resource paths must be normal relative paths".to_owned(),
        ));
    }
    let mut path = root.to_path_buf();
    let component_count = relative.components().count();
    for (index, component) in relative.components().enumerate() {
        path.push(component.as_os_str());
        let metadata = fs::symlink_metadata(&path)?;
        if metadata.file_type().is_symlink() {
            return Err(Error::Security(format!(
                "materialized resource path {} crosses a symlink",
                relative.display()
            )));
        }
        if index + 1 < component_count && !metadata.is_dir() {
            return validation(format!(
                "materialized resource parent {} is not a directory",
                path.display()
            ));
        }
    }
    Ok(path)
}

fn digest_regular_file(path: &Path) -> Result<(String, u64)> {
    let mut file = File::open(path)?;
    let before = file.metadata()?;
    if !before.is_file() {
        return Err(Error::Security(format!(
            "materialized resource {} is not a regular file",
            path.display()
        )));
    }
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    let mut size_bytes = 0_u64;
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        size_bytes = size_bytes
            .checked_add(count as u64)
            .ok_or_else(|| Error::Security("materialized resource is too large".to_owned()))?;
        digest.update(&buffer[..count]);
    }
    let after = file.metadata()?;
    if before.len() != after.len() || after.len() != size_bytes {
        return Err(Error::Security(format!(
            "materialized resource {} changed while it was being checked",
            path.display()
        )));
    }
    Ok((format!("{:x}", digest.finalize()), size_bytes))
}

fn validation<T>(message: impl Into<String>) -> Result<T> {
    Err(Error::Validation(vec![message.into()]))
}
