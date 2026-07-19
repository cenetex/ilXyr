use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::{ActorRef, Error, ResearchEvent, Result, VerificationReport};

const ARTIFACT_PREFIX: &str = "artifact://sha256/";

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

    pub fn events(&self) -> Result<Vec<ResearchEvent>> {
        let contents = fs::read_to_string(self.state.join("events.jsonl"))?;
        contents
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(|line| serde_json::from_str(line).map_err(Error::from))
            .collect()
    }

    pub(crate) fn append_event(
        &self,
        event_type: &str,
        aggregate_id: &str,
        actor: ActorRef,
        artifact_ref: Option<String>,
    ) -> Result<ResearchEvent> {
        let events = self.events()?;
        self.verify_event_chain(&events)?;
        if let Some(artifact_ref) = artifact_ref.as_deref() {
            let _: Value = self.get(artifact_ref)?;
        }
        let previous_event = events.last().map(|event| event.event_hash.clone());
        let occurred_at_ms = now_ms()?;
        let event_hash = hash_event(
            event_type,
            aggregate_id,
            &actor,
            artifact_ref.as_deref(),
            occurred_at_ms,
            previous_event.as_deref(),
        )?;
        let event = ResearchEvent {
            schema: "ilxyr.event.v1".to_owned(),
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

        Ok(VerificationReport {
            objects_checked,
            events_checked: events.len(),
            valid: true,
        })
    }

    fn verify_event_chain(&self, events: &[ResearchEvent]) -> Result<()> {
        let mut previous: Option<&str> = None;
        for event in events {
            if event.previous_event.as_deref() != previous {
                return Err(Error::Conflict(format!(
                    "event chain break at {}",
                    event.event_hash
                )));
            }
            let expected = hash_event(
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

fn hash_event(
    event_type: &str,
    aggregate_id: &str,
    actor: &ActorRef,
    artifact_ref: Option<&str>,
    occurred_at_ms: u128,
    previous_event: Option<&str>,
) -> Result<String> {
    let unsigned = json!({
        "schema": "ilxyr.event.v1",
        "event_type": event_type,
        "aggregate_id": aggregate_id,
        "actor": actor,
        "artifact_ref": artifact_ref,
        "occurred_at_ms": occurred_at_ms,
        "previous_event": previous_event,
    });
    Ok(sha256_hex(&canonical_bytes(&unsigned)?))
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
