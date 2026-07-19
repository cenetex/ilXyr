use std::{
    collections::{BTreeMap, BTreeSet},
    io::{self, Read},
    path::Path,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use serde::Deserialize;

use crate::{
    CodePolicy, Error, ExperimentSpec, ExportPolicy, NetworkPolicy, Result, RunRecord,
    SourceSnapshot, WeightClass, store::now_ms,
};

const OUTPUT_LIMIT_BYTES: usize = 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ExecutorOutput {
    metrics: BTreeMap<String, f64>,
    #[serde(default)]
    source: Option<SourceSnapshot>,
}

pub fn execute_local(spec: &ExperimentSpec, workspace_root: &Path) -> Result<RunRecord> {
    if spec.execution.executor != "local-command" {
        return Err(Error::Execution(format!(
            "executor adapter {} is not installed",
            spec.execution.executor
        )));
    }
    if spec.security.weight_class != WeightClass::Public {
        return Err(Error::Security(
            "the local executor accepts public weights only".to_owned(),
        ));
    }
    if spec.security.code_policy != CodePolicy::Arbitrary {
        return Err(Error::Security(
            "the local executor cannot enforce approved-image-only code".to_owned(),
        ));
    }
    if spec.security.export_policy != ExportPolicy::Artifacts {
        return Err(Error::Security(
            "the local executor records stdout and stderr and therefore requires artifacts export"
                .to_owned(),
        ));
    }
    if spec.execution.network != NetworkPolicy::Open {
        return Err(Error::Security(
            "the local executor cannot attest network isolation".to_owned(),
        ));
    }
    if !Path::new(&spec.execution.program).is_absolute() {
        return Err(Error::Security(
            "local execution requires an absolute program path".to_owned(),
        ));
    }

    let started_at_ms = now_ms()?;
    let run_id = format!("run:{}:{started_at_ms}", spec.id);
    let mut command = Command::new(&spec.execution.program);
    command
        .args(&spec.execution.args)
        .current_dir(workspace_root)
        .env_clear()
        .env("ILXYR_EXPERIMENT_ID", &spec.id)
        .env("ILXYR_RUN_ID", &run_id)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|error| {
        Error::Execution(format!(
            "could not start {}: {error}",
            spec.execution.program
        ))
    })?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| Error::Execution("executor did not provide stdout".to_owned()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| Error::Execution("executor did not provide stderr".to_owned()))?;
    let stdout_reader = thread::spawn(move || read_capped(stdout));
    let stderr_reader = thread::spawn(move || read_capped(stderr));

    let deadline = Duration::from_secs(spec.execution.timeout_seconds);
    let began_waiting = Instant::now();
    let mut timed_out = false;
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if began_waiting.elapsed() >= deadline {
            timed_out = true;
            child.kill()?;
            break child.wait()?;
        }
        thread::sleep(Duration::from_millis(25));
    };

    let (stdout, stdout_truncated) = join_reader(stdout_reader, "stdout")?;
    let (stderr, stderr_truncated) = join_reader(stderr_reader, "stderr")?;
    let stdout = String::from_utf8_lossy(&stdout).into_owned();
    let stderr = String::from_utf8_lossy(&stderr).into_owned();
    let exit_code = status.code().unwrap_or(-1);
    let (metrics, output_error, source_attestation) = if exit_code == 0 && !timed_out {
        validate_output(spec, &stdout, stdout_truncated)
    } else {
        (BTreeMap::new(), None, None)
    };

    Ok(RunRecord {
        schema: "ilxyr.run.v1".to_owned(),
        id: run_id,
        experiment_id: spec.id.clone(),
        started_at_ms,
        completed_at_ms: now_ms()?,
        exit_code,
        timed_out,
        stdout,
        stderr,
        output_truncated: stdout_truncated || stderr_truncated,
        output_error,
        metrics,
        source_attestation,
    })
}

fn validate_output(
    spec: &ExperimentSpec,
    stdout: &str,
    stdout_truncated: bool,
) -> (
    BTreeMap<String, f64>,
    Option<String>,
    Option<SourceSnapshot>,
) {
    if stdout_truncated {
        return (
            BTreeMap::new(),
            Some(
                "executor stdout was truncated before its metric contract could be verified"
                    .to_owned(),
            ),
            None,
        );
    }
    let output = match serde_json::from_str::<ExecutorOutput>(stdout.trim()) {
        Ok(output) => output,
        Err(error) => {
            return (
                BTreeMap::new(),
                Some(format!("executor output is not valid metric JSON: {error}")),
                None,
            );
        }
    };
    let declared = spec
        .metrics
        .iter()
        .map(|metric| metric.name.as_str())
        .collect::<BTreeSet<_>>();
    let actual = output
        .metrics
        .keys()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    if actual != declared {
        let missing = declared.difference(&actual).copied().collect::<Vec<_>>();
        let undeclared = actual.difference(&declared).copied().collect::<Vec<_>>();
        return (
            BTreeMap::new(),
            Some(format!(
                "executor metrics do not match the frozen contract; missing: [{}]; undeclared: [{}]",
                missing.join(", "),
                undeclared.join(", ")
            )),
            None,
        );
    }
    (output.metrics, None, output.source)
}

fn read_capped(mut reader: impl Read) -> io::Result<(Vec<u8>, bool)> {
    let mut output = Vec::new();
    let mut buffer = [0_u8; 8192];
    let mut truncated = false;
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        let remaining = OUTPUT_LIMIT_BYTES.saturating_sub(output.len());
        let keep = count.min(remaining);
        output.extend_from_slice(&buffer[..keep]);
        truncated |= keep < count;
    }
    Ok((output, truncated))
}

fn join_reader(
    handle: thread::JoinHandle<io::Result<(Vec<u8>, bool)>>,
    stream: &str,
) -> Result<(Vec<u8>, bool)> {
    handle
        .join()
        .map_err(|_| Error::Execution(format!("{stream} reader panicked")))?
        .map_err(Error::from)
}
