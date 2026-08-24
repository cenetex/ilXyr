//! Golden-ledger replay conformance (issue #27).
//!
//! `tests/fixtures/golden-ledger-v1/` contains a frozen v0.1-era workspace:
//! a complete propose -> forecast -> fund -> admit -> run -> settle lifecycle
//! over the toy experiment, 17 events, 16 objects. Its byte contents and
//! `MANIFEST.sha256` are immutable.
//!
//! The contract under docs/LEDGER-VERSIONING.md: every future protocol
//! version must open, verify, and replay this ledger identically. If a change
//! breaks this test, the change is wrong — old ledgers never migrate.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use ilxyr_core::{Workspace, workflow::experiment_status};

const FIXTURE: &str = "tests/fixtures/golden-ledger-v1";
const EXPECTED_EVENTS: usize = 17;
const EXPECTED_OBJECTS: usize = 16;

fn fixture_root() -> PathBuf {
    // Tests run with CWD = crate root (ilxyr-core); fixture lives at workspace root.
    let candidates = [
        Path::new(FIXTURE).to_path_buf(),
        Path::new("../..").join(FIXTURE),
        Path::new("../../..").join(FIXTURE),
    ];
    candidates
        .into_iter()
        .find(|path| path.join("MANIFEST.sha256").is_file())
        .expect("golden fixture must exist")
}

fn temp_copy() -> PathBuf {
    // Monotonic per-process counter: parallel tests can read the same coarse
    // clock tick, and a shared directory would race copy against verify.
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let unique = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::SystemTime::UNIX_EPOCH)
        .expect("clock follows epoch")
        .as_nanos();
    let dest = std::env::temp_dir().join(format!("ilxyr-golden-{nonce}-{unique}"));
    let source = fixture_root().join("ilxyr");
    fs::create_dir_all(&dest).expect("temp dir must be created");
    copy_dir(&source, &dest.join(".ilxyr"));
    dest
}

fn copy_dir(source: &Path, dest: &Path) {
    fs::create_dir_all(dest).expect("dir must be created");
    for entry in fs::read_dir(source).expect("dir must be readable") {
        let entry = entry.expect("entry must be readable");
        let target = dest.join(entry.file_name());
        if entry.file_type().expect("type must be known").is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), &target).expect("file must be copied");
        }
    }
}

#[test]
fn manifest_files_are_unmodified() {
    let root = fixture_root();
    let output = Command::new("shasum")
        .arg("-a")
        .arg("256")
        .arg("-c")
        .arg("MANIFEST.sha256")
        .current_dir(&root)
        .output()
        .expect("shasum must run");
    assert!(
        output.status.success(),
        "golden fixture bytes drifted; the fixture is immutable:\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn golden_ledger_opens_and_verifies() {
    let dir = temp_copy();
    let workspace = Workspace::open(&dir).expect("v0.1 ledger must open under current code");
    let report = workspace.verify().expect("verify must succeed");
    assert!(report.valid, "chain verification must pass: {report:?}");
    assert_eq!(report.events_checked, EXPECTED_EVENTS);
    assert_eq!(report.objects_checked, EXPECTED_OBJECTS);
    fs::remove_dir_all(dir).ok();
}

#[test]
fn golden_ledger_replays_derived_state() {
    let dir = temp_copy();
    let workspace = Workspace::open(&dir).expect("v0.1 ledger must open under current code");
    let status =
        experiment_status(&workspace, "toy.score.v1").expect("toy experiment must resolve");
    // The derived state must be identical on every protocol version: the toy
    // lifecycle ends admitted, executed, completed, with settled forecasts.
    assert_eq!(status.experiment_id, "toy.score.v1");
    assert_eq!(status.forecasts, 2, "two forecasters must replay");
    assert_eq!(status.funding_commitments, 2, "two funders must replay");
    assert!(status.latest_admission.is_some(), "admission must replay");
    assert!(status.execution_started, "execution must replay");
    let run = status.latest_run.expect("run record must replay");
    assert_eq!(run.exit_code, 0, "toy run must have exited cleanly");
    assert!(!run.timed_out, "toy run must not have timed out");
    assert!(status.latest_evidence.is_some(), "evidence must replay");
    fs::remove_dir_all(dir).ok();
}
