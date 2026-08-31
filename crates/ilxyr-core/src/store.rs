use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::{ActorRef, Error, ResearchEvent, Result, VerificationReport};

const ARTIFACT_PREFIX: &str = "artifact://sha256/";
const BLOB_PREFIX: &str = "blob://sha256/";
const EVENT_SCHEMA: &str = "ilxyr.event.v1";

#[derive(Debug, Clone)]
pub struct Workspace {
    root: PathBuf,
    state: PathBuf,
}

impl Workspace {
    pub fn init(root: impl AsRef<Path>) -> Result<Self> {
        let root = root.as_ref().to_path_buf();
        let state = root.join(".ilxyr");
        fs::create_dir_all(state.join("objects/sha256"))?;
        fs::create_dir_all(state.join("blobs/sha256"))?;
        let config = state.join("config.json");
        if !config.exists() {
            let contents = serde_json::to_vec_pretty(&json!({
                "schema": "ilxyr.workspace.v1",
                "ledger_mode": "single_writer",
                "object_hash": "sha256"
            }))?;
            fs::write(config, contents)?;
        }
        let events = state.join("events.jsonl");
        if !events.exists() {
            OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(events)?;
        }
        Ok(Self { root, state })
    }

    pub fn open(root: impl AsRef<Path>) -> Result<Self> {
        let root = root.as_ref().to_path_buf();
        let state = root.join(".ilxyr");
        if !state.join("config.json").is_file() {
            return Err(Error::NotFound(format!(
                "{} is not an ilxyr workspace; run `ilxyr init` first",
                root.display()
            )));
        }
        Ok(Self { root, state })
    }

    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    pub(crate) fn put<T: Serialize>(&self, object: &T) -> Result<String> {
        let bytes = canonical_bytes(object)?;
        let digest = sha256_hex(&bytes);
        let path = self.object_path(&digest)?;
        if path.exists() {
            let existing = fs::read(&path)?;
            if sha256_hex(trim_one_newline(&existing)) != digest {
                return Err(Error::Conflict(format!(
                    "object at {} does not match its digest",
                    path.display()
                )));
            }
        } else {
            let mut file = OpenOptions::new().create_new(true).write(true).open(path)?;
            file.write_all(&bytes)?;
            file.write_all(b"\n")?;
            file.sync_all()?;
        }
        Ok(format!("{ARTIFACT_PREFIX}{digest}"))
    }

    pub fn get<T: DeserializeOwned>(&self, artifact_ref: &str) -> Result<T> {
        let digest = parse_artifact_ref(artifact_ref)?;
        let path = self.object_path(digest)?;
        if !path.is_file() {
            return Err(Error::NotFound(format!("artifact {artifact_ref}")));
        }
        let bytes = fs::read(path)?;
        if sha256_hex(trim_one_newline(&bytes)) != digest {
            return Err(Error::Conflict(format!(
                "artifact digest mismatch for {artifact_ref}"
            )));
        }
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn digest<T: Serialize>(object: &T) -> Result<String> {
        Ok(sha256_hex(&canonical_bytes(object)?))
    }

    pub fn put_blob(&self, source: impl AsRef<Path>, expected_sha256: &str) -> Result<String> {
        validate_lower_sha256(expected_sha256)?;
        let source = source.as_ref();
        if !source.is_file() {
            return Err(Error::NotFound(format!("blob source {}", source.display())));
        }
        let directory = self.state.join("blobs/sha256");
        fs::create_dir_all(&directory)?;
        let destination = directory.join(expected_sha256);
        if destination.exists() {
            verify_blob_path(&destination, expected_sha256)?;
            return Ok(format!("{BLOB_PREFIX}{expected_sha256}"));
        }

        let mut input = OpenOptions::new().read(true).open(source)?;
        let mut output = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&destination)?;
        let mut digest = Sha256::new();
        let mut buffer = [0_u8; 64 * 1024];
        let write_result = (|| -> Result<()> {
            loop {
                let count = input.read(&mut buffer)?;
                if count == 0 {
                    break;
                }
                digest.update(&buffer[..count]);
                output.write_all(&buffer[..count])?;
            }
            output.sync_all()?;
            Ok(())
        })();
        if let Err(error) = write_result {
            drop(output);
            let _ = fs::remove_file(&destination);
            return Err(error);
        }
        let actual = format!("{:x}", digest.finalize());
        if actual != expected_sha256 {
            drop(output);
            let _ = fs::remove_file(&destination);
            return Err(Error::Conflict(format!(
                "blob source {} has digest {actual}, expected {expected_sha256}",
                source.display()
            )));
        }
        Ok(format!("{BLOB_PREFIX}{expected_sha256}"))
    }

    pub fn verify_blob(&self, blob_ref: &str) -> Result<u64> {
        let digest = parse_blob_ref(blob_ref)?;
        let path = self.state.join("blobs/sha256").join(digest);
        verify_blob_path(&path, digest)
    }

    pub fn events(&self) -> Result<Vec<ResearchEvent>> {
        let contents = fs::read_to_string(self.state.join("events.jsonl"))?;
        contents
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(|line| {
                let event: ResearchEvent = serde_json::from_str(line)?;
                validate_event_envelope(&event)?;
                Ok(event)
            })
            .collect()
    }

    pub(crate) fn append_event(
        &self,
        event_type: &str,
        aggregate_id: &str,
        actor: ActorRef,
        artifact_ref: Option<String>,
    ) -> Result<ResearchEvent> {
        validate_event_type(event_type)?;
        let events = self.events()?;
        self.verify_event_chain(&events)?;
        if let Some(artifact_ref) = artifact_ref.as_deref() {
            let _: Value = self.get(artifact_ref)?;
        }
        let previous_event = events.last().map(|event| event.event_hash.clone());
        let occurred_at_ms = now_ms()?;
        let event_hash = hash_event(
            EVENT_SCHEMA,
            event_type,
            aggregate_id,
            &actor,
            artifact_ref.as_deref(),
            occurred_at_ms,
            previous_event.as_deref(),
        )?;
        let event = ResearchEvent {
            schema: EVENT_SCHEMA.to_owned(),
            event_type: event_type.to_owned(),
            aggregate_id: aggregate_id.to_owned(),
            actor,
            artifact_ref,
            occurred_at_ms,
            previous_event,
            event_hash,
        };
        let bytes = canonical_bytes(&event)?;
        let mut file = OpenOptions::new()
            .append(true)
            .open(self.state.join("events.jsonl"))?;
        file.write_all(&bytes)?;
        file.write_all(b"\n")?;
        file.sync_all()?;
        Ok(event)
    }

    pub fn latest_event(
        &self,
        event_type: &str,
        aggregate_id: &str,
    ) -> Result<Option<ResearchEvent>> {
        Ok(self
            .events()?
            .into_iter()
            .rev()
            .find(|event| event.event_type == event_type && event.aggregate_id == aggregate_id))
    }

    pub fn verify(&self) -> Result<VerificationReport> {
        let object_dir = self.state.join("objects/sha256");
        let mut objects_checked = 0;
        for entry in fs::read_dir(object_dir)? {
            let entry = entry?;
            if !entry.file_type()?.is_file() {
                continue;
            }
            let expected = entry.file_name().to_string_lossy().into_owned();
            let bytes = fs::read(entry.path())?;
            let actual = sha256_hex(trim_one_newline(&bytes));
            if actual != expected {
                return Err(Error::Conflict(format!(
                    "object {} has digest {actual}, expected {expected}",
                    entry.path().display()
                )));
            }
            let _: Value = serde_json::from_slice(&bytes)?;
            objects_checked += 1;
        }

        let events = self.events()?;
        self.verify_event_chain(&events)?;

        let blob_dir = self.state.join("blobs/sha256");
        let mut blobs_checked = 0;
        if blob_dir.is_dir() {
            for entry in fs::read_dir(blob_dir)? {
                let entry = entry?;
                if !entry.file_type()?.is_file() {
                    continue;
                }
                let expected = entry.file_name().to_string_lossy().into_owned();
                validate_lower_sha256(&expected)?;
                verify_blob_path(&entry.path(), &expected)?;
                blobs_checked += 1;
            }
        }

        Ok(VerificationReport {
            objects_checked,
            blobs_checked,
            events_checked: events.len(),
            valid: true,
        })
    }

    fn verify_event_chain(&self, events: &[ResearchEvent]) -> Result<()> {
        let mut previous: Option<&str> = None;
        for event in events {
            validate_event_envelope(event)?;
            if event.previous_event.as_deref() != previous {
                return Err(Error::Conflict(format!(
                    "event chain break at {}",
                    event.event_hash
                )));
            }
            let expected = hash_event(
                &event.schema,
                &event.event_type,
                &event.aggregate_id,
                &event.actor,
                event.artifact_ref.as_deref(),
                event.occurred_at_ms,
                event.previous_event.as_deref(),
            )?;
            if expected != event.event_hash {
                return Err(Error::Conflict(format!(
                    "event digest mismatch at {}",
                    event.event_hash
                )));
            }
            if let Some(artifact_ref) = &event.artifact_ref {
                let _: Value = self.get(artifact_ref)?;
            }
            previous = Some(&event.event_hash);
        }
        Ok(())
    }

    fn object_path(&self, digest: &str) -> Result<PathBuf> {
        if digest.len() != 64 || !digest.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(Error::Validation(vec![format!(
                "invalid SHA-256 digest: {digest}"
            )]));
        }
        Ok(self.state.join("objects/sha256").join(digest))
    }
}

pub fn now_ms() -> Result<u128> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .map_err(|error| Error::Conflict(format!("system clock precedes Unix epoch: {error}")))
}

fn parse_artifact_ref(artifact_ref: &str) -> Result<&str> {
    artifact_ref.strip_prefix(ARTIFACT_PREFIX).ok_or_else(|| {
        Error::Validation(vec![format!(
            "artifact reference must start with {ARTIFACT_PREFIX}"
        )])
    })
}

fn parse_blob_ref(blob_ref: &str) -> Result<&str> {
    let digest = blob_ref.strip_prefix(BLOB_PREFIX).ok_or_else(|| {
        Error::Validation(vec![format!(
            "blob reference must start with {BLOB_PREFIX}"
        )])
    })?;
    validate_lower_sha256(digest)?;
    Ok(digest)
}

fn validate_lower_sha256(digest: &str) -> Result<()> {
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(Error::Validation(vec![format!(
            "invalid lowercase SHA-256 digest: {digest}"
        )]));
    }
    Ok(())
}

fn verify_blob_path(path: &Path, expected: &str) -> Result<u64> {
    if !path.is_file() {
        return Err(Error::NotFound(format!("blob {}", path.display())));
    }
    let mut file = OpenOptions::new().read(true).open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    let actual = format!("{:x}", digest.finalize());
    if actual != expected {
        return Err(Error::Conflict(format!(
            "blob {} has digest {actual}, expected {expected}",
            path.display()
        )));
    }
    Ok(fs::metadata(path)?.len())
}

fn hash_event(
    schema: &str,
    event_type: &str,
    aggregate_id: &str,
    actor: &ActorRef,
    artifact_ref: Option<&str>,
    occurred_at_ms: u128,
    previous_event: Option<&str>,
) -> Result<String> {
    let unsigned = json!({
        "schema": schema,
        "event_type": event_type,
        "aggregate_id": aggregate_id,
        "actor": actor,
        "artifact_ref": artifact_ref,
        "occurred_at_ms": occurred_at_ms,
        "previous_event": previous_event,
    });
    Ok(sha256_hex(&canonical_bytes(&unsigned)?))
}

fn validate_event_envelope(event: &ResearchEvent) -> Result<()> {
    if event.schema != EVENT_SCHEMA {
        return Err(Error::Validation(vec![format!(
            "unsupported event schema {}; expected {EVENT_SCHEMA}",
            event.schema
        )]));
    }
    validate_event_type(&event.event_type)
}

fn validate_event_type(event_type: &str) -> Result<()> {
    let supported = matches!(
        event_type,
        "AdmissionDecided"
            | "AllocationCommitted"
            | "AttestationKeyTrusted"
            | "BranchActivated"
            | "BranchPlanRegistered"
            | "CalibrationUpdated"
            | "CertificateRecorded"
            | "ClaimRegistered"
            | "ContributionSubmitted"
            | "CorpusMaterializationRecorded"
            | "CorpusReleaseRegistered"
            | "EpochBudgetRegistered"
            | "EvidenceEdgeRecorded"
            | "EvidenceRecorded"
            | "ExecutionStarted"
            | "ExecutorAttestationRecorded"
            | "ExperimentCompiled"
            | "ExperimentCompleted"
            | "ExperimentFamilyRegistered"
            | "ExperimentFamilySettled"
            | "ExternalRegistrationRecorded"
            | "ForecastSettled"
            | "ForecastSubmitted"
            | "FundingCommitted"
            | "HuggingFaceModelRegistered"
            | "IntentDeclared"
            | "MechanismConditionAttached"
            | "MechanismForecastSettled"
            | "MechanismTournamentRegistered"
            | "MechanismTournamentSettled"
            | "NsrlContinuationRegistered"
            | "NsrlGateEvaluated"
            | "NsrlModelRegistered"
            | "PaperCandidateRegistered"
            | "PaperDecisionReceiptRecorded"
            | "PaperStateResolved"
            | "PaperSubmitted"
            | "PolicyKeyTrusted"
            | "PromotionEvaluated"
            | "ProposalCompiled"
            | "ProposalDrafted"
            | "ProposalFrozen"
            | "ProposalPackaged"
            | "ProposalReviewed"
            | "ProposalRevised"
            | "RegistrationPackaged"
            | "ReplicationContractRegistered"
            | "ReplicationSettled"
            | "RetroExecutionStarted"
            | "RetroPlanned"
            | "RetroRegistered"
            | "RetroRunCompleted"
            | "RemoteExecutionAuthorized"
            | "RemoteLaunchRecorded"
            | "RemoteLaunchReserved"
            | "RemoteReportAccepted"
            | "ReportIntakeCredentialIssued"
            | "ReportIntakeCredentialUsed"
            | "ReportIntakeRejected"
            | "SandboxPlanned"
            | "SandboxRunCompleted"
            | "SharedTaskRegistered"
            | "TestDigestReleased"
            | "TestDigestSealed"
    );
    if supported {
        Ok(())
    } else {
        Err(Error::Validation(vec![format!(
            "unsupported event type {event_type}; upgrade ilxyr before reading this ledger"
        )]))
    }
}

pub(crate) fn canonical_bytes<T: Serialize>(object: &T) -> Result<Vec<u8>> {
    let value = serde_json::to_value(object)?;
    let canonical = canonicalize(value);
    Ok(serde_json::to_vec(&canonical)?)
}

fn canonicalize(value: Value) -> Value {
    match value {
        Value::Object(map) => {
            let sorted = map
                .into_iter()
                .map(|(key, value)| (key, canonicalize(value)))
                .collect::<BTreeMap<_, _>>();
            Value::Object(sorted.into_iter().collect())
        }
        Value::Array(values) => Value::Array(values.into_iter().map(canonicalize).collect()),
        scalar => scalar,
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut output = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write as _;
        write!(output, "{byte:02x}").expect("writing to String cannot fail");
    }
    output
}

fn trim_one_newline(bytes: &[u8]) -> &[u8] {
    bytes.strip_suffix(b"\n").unwrap_or(bytes)
}

#[cfg(test)]
mod tests {
    use std::{fs, process, time::SystemTime};

    use super::*;

    #[test]
    fn blob_import_is_content_addressed_and_verified() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("ilxyr-blob-test-{}-{nonce}", process::id()));
        fs::create_dir(&root).expect("root");
        let source = root.join("source.bin");
        fs::write(&source, b"deterministic NSRL artifact").expect("source");
        let expected = sha256_hex(b"deterministic NSRL artifact");
        let workspace = Workspace::init(&root).expect("workspace");

        let first = workspace.put_blob(&source, &expected).expect("import");
        let second = workspace
            .put_blob(&source, &expected)
            .expect("idempotent import");
        assert_eq!(first, second);
        assert_eq!(workspace.verify_blob(&first).expect("verify blob"), 27);
        let report = workspace.verify().expect("verify workspace");
        assert_eq!(report.blobs_checked, 1);
    }

    #[test]
    fn event_schema_tampering_is_rejected() {
        let root = test_root("event-schema");
        let workspace = Workspace::init(&root).expect("workspace");
        workspace
            .append_event(
                "ExecutionStarted",
                "experiment://test",
                ActorRef::service("service://test/runner"),
                None,
            )
            .expect("event");

        let events_path = root.join(".ilxyr/events.jsonl");
        let mut event: Value =
            serde_json::from_str(fs::read_to_string(&events_path).expect("events").trim())
                .expect("event JSON");
        event["schema"] = Value::String("ilxyr.event.v999".to_owned());
        fs::write(
            &events_path,
            format!("{}\n", serde_json::to_string(&event).expect("serialize")),
        )
        .expect("tamper event");

        let error = workspace
            .verify()
            .expect_err("unknown schema must fail closed");
        assert!(error.to_string().contains("unsupported event schema"));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn unknown_event_types_fail_closed() {
        let root = test_root("event-type");
        let workspace = Workspace::init(&root).expect("workspace");
        let actor = ActorRef::service("service://test/future-writer");
        let event = ResearchEvent {
            schema: EVENT_SCHEMA.to_owned(),
            event_type: "FutureProtocolEvent".to_owned(),
            aggregate_id: "future://test".to_owned(),
            actor: actor.clone(),
            artifact_ref: None,
            occurred_at_ms: 1,
            previous_event: None,
            event_hash: hash_event(
                EVENT_SCHEMA,
                "FutureProtocolEvent",
                "future://test",
                &actor,
                None,
                1,
                None,
            )
            .expect("hash"),
        };
        fs::write(
            root.join(".ilxyr/events.jsonl"),
            format!("{}\n", serde_json::to_string(&event).expect("serialize")),
        )
        .expect("write event");

        let error = workspace
            .verify()
            .expect_err("unknown type must fail closed");
        assert!(error.to_string().contains("unsupported event type"));
        fs::remove_dir_all(root).expect("cleanup");
    }

    fn test_root(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("ilxyr-store-{label}-{}-{nonce}", process::id()));
        fs::create_dir(&root).expect("root");
        root
    }
}
