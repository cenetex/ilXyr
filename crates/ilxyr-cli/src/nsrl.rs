use std::{
    fs::{self, File},
    io::{BufReader, Read},
    path::{Path, PathBuf},
    process::Command,
};

use ilxyr_core::{Error, NsrlArtifact, NsrlGateEvidence, NsrlRegistration, Result, Workspace};
use serde::Serialize;
use sha2::{Digest, Sha256};

#[derive(Debug, Serialize)]
pub struct LocalVerification {
    pub schema: &'static str,
    pub source_commit: String,
    pub source_tree: String,
    pub clean_worktree: bool,
    pub files_verified: usize,
    pub total_bytes: u64,
}

#[derive(Debug, Serialize)]
pub struct ArtifactVerification {
    pub schema: &'static str,
    pub files_verified: usize,
    pub total_bytes: u64,
}

pub fn verify_local_registration(
    registration: &NsrlRegistration,
    source_root: &Path,
) -> Result<LocalVerification> {
    ilxyr_core::validate_nsrl_registration(registration)?;
    let source_root = source_root.canonicalize().map_err(|error| {
        Error::NotFound(format!(
            "NSRL source root {}: {error}",
            source_root.display()
        ))
    })?;
    if !source_root.is_dir() {
        return Err(Error::NotFound(format!(
            "NSRL source root {} is not a directory",
            source_root.display()
        )));
    }

    let commit = git_output(&source_root, &["rev-parse", "HEAD"])?;
    let tree = git_output(&source_root, &["rev-parse", "HEAD^{tree}"])?;
    let status = git_output(
        &source_root,
        &["status", "--porcelain", "--untracked-files=no"],
    )?;
    if commit != registration.checkpoint.source.commit {
        return Err(Error::Conflict(format!(
            "NSRL source HEAD is {commit}, expected {}",
            registration.checkpoint.source.commit
        )));
    }
    if tree != registration.checkpoint.source.tree {
        return Err(Error::Conflict(format!(
            "NSRL source tree is {tree}, expected {}",
            registration.checkpoint.source.tree
        )));
    }
    if !status.is_empty() {
        return Err(Error::Conflict(
            "NSRL source has tracked working-tree changes; intake requires a clean pinned tree"
                .to_owned(),
        ));
    }

    let mut artifacts = vec![
        &registration.checkpoint.model,
        &registration.checkpoint.tokenizer,
        &registration.checkpoint.model_card,
        &registration.checkpoint.executable,
    ];
    if let Some(continuation) = &registration.continuation {
        artifacts.push(&continuation.optimizer);
    }

    let mut total_bytes = 0_u64;
    for artifact in &artifacts {
        verify_artifact(&source_root, artifact)?;
        total_bytes = total_bytes
            .checked_add(artifact.size_bytes)
            .ok_or_else(|| {
                Error::Conflict("NSRL intake artifact byte total overflowed u64".to_owned())
            })?;
    }

    Ok(LocalVerification {
        schema: "ilxyr.nsrl_local_verification.v1",
        source_commit: commit,
        source_tree: tree,
        clean_worktree: true,
        files_verified: artifacts.len(),
        total_bytes,
    })
}

pub fn verify_gate_evidence_artifacts(
    evidence: &NsrlGateEvidence,
    evidence_root: &Path,
) -> Result<ArtifactVerification> {
    let evidence_root = evidence_root.canonicalize().map_err(|error| {
        Error::NotFound(format!(
            "NSRL evidence root {}: {error}",
            evidence_root.display()
        ))
    })?;
    let mut total_bytes = 0_u64;
    for artifact in &evidence.artifacts {
        verify_artifact(&evidence_root, artifact)?;
        total_bytes = total_bytes
            .checked_add(artifact.size_bytes)
            .ok_or_else(|| Error::Conflict("NSRL evidence byte total overflowed u64".to_owned()))?;
    }
    Ok(ArtifactVerification {
        schema: "ilxyr.nsrl_artifact_verification.v1",
        files_verified: evidence.artifacts.len(),
        total_bytes,
    })
}

pub fn import_registration_blobs(
    workspace: &Workspace,
    registration: &NsrlRegistration,
    source_root: &Path,
) -> Result<Vec<String>> {
    let source_root = source_root.canonicalize()?;
    let mut artifacts = vec![
        &registration.checkpoint.model,
        &registration.checkpoint.tokenizer,
        &registration.checkpoint.model_card,
        &registration.checkpoint.executable,
    ];
    if let Some(continuation) = &registration.continuation {
        artifacts.push(&continuation.optimizer);
    }
    import_blobs(workspace, &source_root, &artifacts)
}

pub fn import_gate_evidence_blobs(
    workspace: &Workspace,
    evidence: &NsrlGateEvidence,
    evidence_root: &Path,
) -> Result<Vec<String>> {
    let evidence_root = evidence_root.canonicalize()?;
    let artifacts = evidence.artifacts.iter().collect::<Vec<_>>();
    import_blobs(workspace, &evidence_root, &artifacts)
}

fn import_blobs(
    workspace: &Workspace,
    root: &Path,
    artifacts: &[&NsrlArtifact],
) -> Result<Vec<String>> {
    let mut refs = Vec::with_capacity(artifacts.len());
    for artifact in artifacts {
        let blob_ref = workspace.put_blob(root.join(&artifact.path), &artifact.sha256)?;
        if blob_ref != artifact.blob_ref {
            return Err(Error::Conflict(format!(
                "imported blob ref {blob_ref} does not match declared {}",
                artifact.blob_ref
            )));
        }
        refs.push(blob_ref);
    }
    refs.sort();
    refs.dedup();
    Ok(refs)
}

fn verify_artifact(source_root: &Path, artifact: &NsrlArtifact) -> Result<()> {
    let path = source_root.join(&artifact.path);
    let canonical = path
        .canonicalize()
        .map_err(|error| Error::NotFound(format!("NSRL artifact {}: {error}", artifact.path)))?;
    if !canonical.starts_with(source_root) || !canonical.is_file() {
        return Err(Error::Security(format!(
            "NSRL artifact {} resolves outside the pinned source root or is not a file",
            artifact.path
        )));
    }
    let metadata = fs::metadata(&canonical)?;
    if metadata.len() != artifact.size_bytes {
        return Err(Error::Conflict(format!(
            "NSRL artifact {} has {} bytes, expected {}",
            artifact.path,
            metadata.len(),
            artifact.size_bytes
        )));
    }
    let actual = sha256_file(&canonical)?;
    if actual != artifact.sha256 {
        return Err(Error::Conflict(format!(
            "NSRL artifact {} has SHA-256 {actual}, expected {}",
            artifact.path, artifact.sha256
        )));
    }
    Ok(())
}

fn git_output(source_root: &Path, args: &[&str]) -> Result<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(source_root)
        .args(args)
        .output()
        .map_err(|error| Error::Execution(format!("could not execute git: {error}")))?;
    if !output.status.success() {
        return Err(Error::Execution(format!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn sha256_file(path: &PathBuf) -> Result<String> {
    let file = File::open(path)?;
    let mut reader = BufReader::new(file);
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verifier_rejects_a_missing_source_root() {
        let registration: NsrlRegistration = serde_json::from_str(include_str!(
            "../../../examples/nsrl/p10m-v10-registration.json"
        ))
        .expect("fixture");
        let error = verify_local_registration(
            &registration,
            Path::new("/definitely/missing/ilxyr-nsrl-source"),
        )
        .expect_err("missing source root");
        assert!(error.to_string().contains("NSRL source root"));
    }
}
