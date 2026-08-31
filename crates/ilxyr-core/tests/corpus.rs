use std::{
    collections::BTreeMap,
    fs,
    path::PathBuf,
    process,
    sync::atomic::{AtomicU64, Ordering},
    time::SystemTime,
};

use ilxyr_core::{
    ActorRef, AzureInputMode, AzureMlHandoffRequest, BraidCorpusImport, CorpusFile, CorpusLocation,
    CorpusMaterialization, CorpusRelease, CorpusRights, CorpusSource, MaterializedCorpusFile,
    SageMakerHandoffRequest, SageMakerInputMode, Workspace, azure_ml_corpus_handoff,
    record_corpus_materialization, register_braid_corpus_release, register_corpus_release,
    registered_corpus_release, sagemaker_corpus_handoff,
};
use sha2::{Digest, Sha256};

struct TestDirectory(PathBuf);

static UNIQUE: AtomicU64 = AtomicU64::new(0);

impl TestDirectory {
    fn create(label: &str) -> Self {
        let nonce = u128::from(UNIQUE.fetch_add(1, Ordering::Relaxed))
            + SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .expect("test clock must follow Unix epoch")
                .as_nanos();
        let path =
            std::env::temp_dir().join(format!("ilxyr-corpus-{label}-{}-{nonce}", process::id()));
        fs::create_dir_all(&path).expect("test directory must be created");
        Self(path)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn corpus_registration_is_immutable_and_idempotent() {
    let directory = TestDirectory::create("register");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    let release = release();
    let first = register_corpus_release(&workspace, release.clone()).expect("register corpus");
    let event_count = workspace.events().expect("events must load").len();
    let retry = register_corpus_release(&workspace, release.clone()).expect("retry corpus");
    assert_eq!(retry, first);
    assert_eq!(
        workspace.events().expect("events must load").len(),
        event_count
    );
    assert_eq!(
        registered_corpus_release(&workspace, &release.id).expect("look up corpus"),
        first
    );

    let mut changed = release;
    changed.title = "Changed title".to_owned();
    let error = register_corpus_release(&workspace, changed).expect_err("drift must fail");
    assert!(error.to_string().contains("different content"));
    assert!(workspace.verify().expect("ledger must verify").valid);
}

#[test]
fn released_braid_manifest_imports_as_an_immutable_ilxyr_corpus() {
    let directory = TestDirectory::create("braid-import");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    let release_digest = "d".repeat(64);
    let release_id = format!("feral-7b-sec-v1-{release_digest}");
    let manifest = serde_json::to_vec(&serde_json::json!({
        "schemaVersion": "braid.release/v2",
        "releaseId": release_id,
        "status": "RELEASED",
        "digests": { "release": release_digest },
        "artifacts": [
            { "path": "data/train.jsonl", "sha256": "a".repeat(64), "bytes": 123 },
            { "path": "data/validation.jsonl", "sha256": "b".repeat(64), "bytes": 45 }
        ]
    }))
    .expect("manifest must serialize");
    let manifest_sha256 = format!("{:x}", Sha256::digest(&manifest));
    let import = BraidCorpusImport {
        schema: "ilxyr.braid_corpus_import.v1".to_owned(),
        id: "dataset://braid/feral-7b-sec/v1".to_owned(),
        title: "FERAL-7B SEC training corpus v1".to_owned(),
        version: "v1".to_owned(),
        source: CorpusSource {
            repository: "https://github.com/cenetex/braid".to_owned(),
            revision: "0123456789abcdef0123456789abcdef01234567".to_owned(),
            path: "src/release.ts".to_owned(),
        },
        rights: CorpusRights {
            license: "REVIEWED-TRAINING-RIGHTS".to_owned(),
            use_constraints: vec!["training-only".to_owned()],
        },
        expected_release_id: release_id.clone(),
        expected_manifest_sha256: manifest_sha256.clone(),
        required_files: vec![
            "data/train.jsonl".to_owned(),
            "data/validation.jsonl".to_owned(),
        ],
    };

    let registered = register_braid_corpus_release(&workspace, import.clone(), &manifest)
        .expect("register Braid release");
    assert_eq!(registered.release.id, "dataset://braid/feral-7b-sec/v1");
    assert_eq!(registered.release.files.len(), 3);
    assert_eq!(
        registered.release.metadata.get("braid_release_id"),
        Some(&release_id)
    );
    assert_eq!(
        registered.release.metadata.get("braid_manifest_sha256"),
        Some(&manifest_sha256)
    );
    assert_eq!(
        register_braid_corpus_release(&workspace, import, &manifest)
            .expect("idempotent Braid import")
            .artifact_ref,
        registered.artifact_ref
    );
    assert!(workspace.verify().expect("ledger must verify").valid);
}

#[test]
fn braid_import_rejects_manifest_drift_and_unreleased_data() {
    let directory = TestDirectory::create("braid-reject");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    let release_digest = "d".repeat(64);
    let release_id = format!("feral-7b-sec-v1-{release_digest}");
    let manifest = serde_json::to_vec(&serde_json::json!({
        "schemaVersion": "braid.release/v2",
        "releaseId": release_id,
        "status": "BLOCKED",
        "digests": { "release": release_digest },
        "artifacts": [
            { "path": "data/train.jsonl", "sha256": "a".repeat(64), "bytes": 1 },
            { "path": "data/validation.jsonl", "sha256": "b".repeat(64), "bytes": 1 }
        ]
    }))
    .expect("manifest must serialize");
    let mut import = BraidCorpusImport {
        schema: "ilxyr.braid_corpus_import.v1".to_owned(),
        id: "dataset://braid/feral-7b-sec/v1".to_owned(),
        title: "FERAL-7B SEC training corpus v1".to_owned(),
        version: "v1".to_owned(),
        source: CorpusSource {
            repository: "https://github.com/cenetex/braid".to_owned(),
            revision: "0123456789abcdef0123456789abcdef01234567".to_owned(),
            path: "src/release.ts".to_owned(),
        },
        rights: CorpusRights {
            license: "REVIEWED-TRAINING-RIGHTS".to_owned(),
            use_constraints: vec![],
        },
        expected_release_id: release_id,
        expected_manifest_sha256: "f".repeat(64),
        required_files: vec![
            "data/train.jsonl".to_owned(),
            "data/validation.jsonl".to_owned(),
        ],
    };
    let error = register_braid_corpus_release(&workspace, import.clone(), &manifest)
        .expect_err("manifest drift must fail");
    assert!(error.to_string().contains("SHA-256"));

    import.expected_manifest_sha256 = format!("{:x}", Sha256::digest(&manifest));
    let error = register_braid_corpus_release(&workspace, import, &manifest)
        .expect_err("unreleased Braid data must fail");
    assert!(error.to_string().contains("status must be RELEASED"));
}

#[test]
fn braid_import_rejects_duplicate_required_files() {
    let directory = TestDirectory::create("braid-duplicate-required-files");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    let release_digest = "d".repeat(64);
    let release_id = format!("feral-7b-sec-v1-{release_digest}");
    let manifest = serde_json::to_vec(&serde_json::json!({
        "schemaVersion": "braid.release/v2",
        "releaseId": release_id,
        "status": "RELEASED",
        "digests": { "release": release_digest },
        "artifacts": [
            { "path": "data/train.jsonl", "sha256": "a".repeat(64), "bytes": 123 }
        ]
    }))
    .expect("manifest must serialize");
    let import = BraidCorpusImport {
        schema: "ilxyr.braid_corpus_import.v1".to_owned(),
        id: "dataset://braid/feral-7b-sec/v1".to_owned(),
        title: "FERAL-7B SEC training corpus v1".to_owned(),
        version: "v1".to_owned(),
        source: CorpusSource {
            repository: "https://github.com/cenetex/braid".to_owned(),
            revision: "0123456789abcdef0123456789abcdef01234567".to_owned(),
            path: "src/release.ts".to_owned(),
        },
        rights: CorpusRights {
            license: "REVIEWED-TRAINING-RIGHTS".to_owned(),
            use_constraints: vec!["training-only".to_owned()],
        },
        expected_release_id: release_id,
        expected_manifest_sha256: format!("{:x}", Sha256::digest(&manifest)),
        required_files: vec!["data/train.jsonl".to_owned(), "data/train.jsonl".to_owned()],
    };

    let error = register_braid_corpus_release(&workspace, import, &manifest)
        .expect_err("duplicate required files must fail");
    assert!(error.to_string().contains("required training file"));
}

#[test]
fn sagemaker_handoff_binds_the_exact_corpus_and_s3_materialization() {
    let directory = TestDirectory::create("sagemaker");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    let corpus = register_corpus_release(&workspace, release()).expect("register corpus");
    let receipt = s3_materialization(corpus.artifact_ref.clone());
    let registered =
        record_corpus_materialization(&workspace, receipt.clone()).expect("record materialization");
    assert_eq!(
        record_corpus_materialization(&workspace, receipt)
            .expect("retry materialization")
            .artifact_ref,
        registered.artifact_ref
    );

    let handoff = sagemaker_corpus_handoff(
        &workspace,
        SageMakerHandoffRequest {
            materialization_ref: registered.artifact_ref.clone(),
            channel_name: "training".to_owned(),
            content_type: "application/x-jsonlines".to_owned(),
            input_mode: SageMakerInputMode::File,
        },
    )
    .expect("create SageMaker handoff");
    assert_eq!(handoff.expected_files, corpus.release.files);
    assert_eq!(handoff.materialized_objects.len(), 2);
    assert_eq!(
        handoff.materialized_objects[0].provider_version,
        "aws-version-1"
    );
    assert_eq!(handoff.corpus_ref, corpus.artifact_ref);
    assert_eq!(handoff.materialization_ref, registered.artifact_ref);
    assert_eq!(handoff.region, "us-west-2");
    assert_eq!(handoff.input_data_config[0].channel_name, "training");
    assert_eq!(
        handoff.input_data_config[0]
            .data_source
            .s3_data_source
            .s3_uri,
        "s3://example-corpora/braid/corpus-five/v0.3.0"
    );
    assert_eq!(handoff.tags.len(), 2);
}

#[test]
fn azure_handoff_uses_the_corpus_digest_as_the_data_asset_version() {
    let directory = TestDirectory::create("azure");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    let corpus = register_corpus_release(&workspace, release()).expect("register corpus");
    let registered = record_corpus_materialization(
        &workspace,
        azure_materialization(corpus.artifact_ref.clone()),
    )
    .expect("record materialization");

    let handoff = azure_ml_corpus_handoff(
        &workspace,
        AzureMlHandoffRequest {
            materialization_ref: registered.artifact_ref,
            asset_name: "braid-corpus-five".to_owned(),
            input_name: "training_data".to_owned(),
            mode: AzureInputMode::RoMount,
        },
    )
    .expect("create Azure handoff");
    assert_eq!(handoff.expected_files, corpus.release.files);
    assert_eq!(handoff.materialized_objects.len(), 2);
    let digest = corpus
        .artifact_ref
        .strip_prefix("artifact://sha256/")
        .expect("corpus ref must have digest");
    assert_eq!(handoff.data_asset.version, digest);
    assert_eq!(handoff.data_asset.asset_type, "uri_folder");
    assert_eq!(
        handoff.job_input.path,
        format!("azureml:braid-corpus-five:{digest}")
    );
}

#[test]
fn materialization_rejects_tampered_or_incomplete_object_sets() {
    let directory = TestDirectory::create("tamper");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    let corpus = register_corpus_release(&workspace, release()).expect("register corpus");
    let mut receipt = s3_materialization(corpus.artifact_ref);
    receipt.objects[0].sha256 = "f".repeat(64);
    let error =
        record_corpus_materialization(&workspace, receipt).expect_err("tampered receipt must fail");
    assert!(
        error
            .to_string()
            .contains("does not match the corpus digest and size")
    );
}

fn release() -> CorpusRelease {
    CorpusRelease {
        schema: "ilxyr.corpus_release.v1".to_owned(),
        id: "dataset://example/braid-corpus-five/statebridge/v0.3.0".to_owned(),
        title: "Example Braid-style Corpus Five StateBridge".to_owned(),
        version: "v0.3.0".to_owned(),
        source: CorpusSource {
            repository: "https://example.com/braid".to_owned(),
            revision: "0123456789abcdef0123456789abcdef01234567".to_owned(),
            path: "datasets/corpus-five".to_owned(),
        },
        rights: CorpusRights {
            license: "EXAMPLE-ONLY".to_owned(),
            use_constraints: vec!["preserve-attribution".to_owned()],
        },
        files: vec![
            CorpusFile {
                path: "train/statebridge.jsonl".to_owned(),
                sha256: "a".repeat(64),
                size_bytes: 100,
                media_type: "application/x-jsonlines".to_owned(),
            },
            CorpusFile {
                path: "validation/statebridge.jsonl".to_owned(),
                sha256: "b".repeat(64),
                size_bytes: 25,
                media_type: "application/x-jsonlines".to_owned(),
            },
        ],
        metadata: BTreeMap::from([
            ("split_policy".to_owned(), "deterministic-v1".to_owned()),
            ("generator".to_owned(), "braid".to_owned()),
        ]),
    }
}

fn s3_materialization(corpus_ref: String) -> CorpusMaterialization {
    CorpusMaterialization {
        schema: "ilxyr.corpus_materialization.v1".to_owned(),
        id: "materialization://aws/example-corpora/braid-corpus-five-v030".to_owned(),
        corpus_ref,
        location: CorpusLocation::AmazonS3 {
            region: "us-west-2".to_owned(),
            uri: "s3://example-corpora/braid/corpus-five/v0.3.0".to_owned(),
        },
        objects: vec![
            MaterializedCorpusFile {
                path: "train/statebridge.jsonl".to_owned(),
                uri: "s3://example-corpora/braid/corpus-five/v0.3.0/train/statebridge.jsonl"
                    .to_owned(),
                sha256: "a".repeat(64),
                size_bytes: 100,
                provider_version: "aws-version-1".to_owned(),
            },
            MaterializedCorpusFile {
                path: "validation/statebridge.jsonl".to_owned(),
                uri: "s3://example-corpora/braid/corpus-five/v0.3.0/validation/statebridge.jsonl"
                    .to_owned(),
                sha256: "b".repeat(64),
                size_bytes: 25,
                provider_version: "aws-version-2".to_owned(),
            },
        ],
        verified_by: ActorRef::service("service://example/s3-materializer-v1"),
        verified_at_ms: 1,
    }
}

fn azure_materialization(corpus_ref: String) -> CorpusMaterialization {
    CorpusMaterialization {
        schema: "ilxyr.corpus_materialization.v1".to_owned(),
        id: "materialization://azure/example/braid-corpus-five-v030".to_owned(),
        corpus_ref,
        location: CorpusLocation::AzureBlob {
            uri: "https://example.blob.core.windows.net/corpora/braid/corpus-five/v0.3.0"
                .to_owned(),
        },
        objects: vec![
            MaterializedCorpusFile {
                path: "train/statebridge.jsonl".to_owned(),
                uri: "https://example.blob.core.windows.net/corpora/braid/corpus-five/v0.3.0/train/statebridge.jsonl".to_owned(),
                sha256: "a".repeat(64),
                size_bytes: 100,
                provider_version: "azure-etag-1".to_owned(),
            },
            MaterializedCorpusFile {
                path: "validation/statebridge.jsonl".to_owned(),
                uri: "https://example.blob.core.windows.net/corpora/braid/corpus-five/v0.3.0/validation/statebridge.jsonl".to_owned(),
                sha256: "b".repeat(64),
                size_bytes: 25,
                provider_version: "azure-etag-2".to_owned(),
            },
        ],
        verified_by: ActorRef::service("service://example/azure-materializer-v1"),
        verified_at_ms: 1,
    }
}
