use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

use crate::{
    AcceptedRemoteReport, ActorRef, Error, ExecutionReport, ExecutorJobPackage,
    RemoteExecutionAuthorization, RemoteLaunchReceipt, Result, Workspace,
    accept_remote_execution_report, store::now_ms,
};

const REMOTE_EXECUTION_AUTHORIZED: &str = "RemoteExecutionAuthorized";
const REMOTE_LAUNCH_RECORDED: &str = "RemoteLaunchRecorded";
const REMOTE_REPORT_ACCEPTED: &str = "RemoteReportAccepted";
const CREDENTIAL_ISSUED: &str = "ReportIntakeCredentialIssued";
const CREDENTIAL_USED: &str = "ReportIntakeCredentialUsed";
const INTAKE_REJECTED: &str = "ReportIntakeRejected";
const TOKEN_BYTES: usize = 32;
const TOKEN_TEXT_BYTES: usize = 43;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ReportIntakeCredential {
    pub schema: String,
    pub id: String,
    pub authorization_ref: String,
    pub launch_ref: String,
    pub token_sha256: String,
    pub issued_at_ms: u128,
    pub expires_at_ms: u128,
    pub max_report_bytes: u64,
    pub max_rejected_attempts: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct IssuedReportIntakeCredential {
    pub credential: ReportIntakeCredential,
    pub bearer_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ReportIntakeUseReceipt {
    pub schema: String,
    pub credential_ref: String,
    pub authorization_ref: String,
    pub launch_ref: String,
    pub report_ref: String,
    pub accepted_ref: String,
    pub used_at_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ReportIntakeRejection {
    pub schema: String,
    pub credential_ref: String,
    pub report_ref: String,
    pub reason_class: String,
    pub rejected_at_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthenticatedReportAcceptance {
    pub schema: String,
    pub accepted: AcceptedRemoteReport,
    pub intake: ReportIntakeUseReceipt,
    pub idempotent: bool,
}

/// Issues a secret for one recorded remote launch. The ledger stores only its
/// SHA-256 digest. An exact retry returns the credential without the secret.
pub fn issue_report_intake_credential(
    workspace: &Workspace,
    authorization_id: &str,
    expires_at_ms: u128,
    max_rejected_attempts: u8,
) -> Result<IssuedReportIntakeCredential> {
    if !(1..=10).contains(&max_rejected_attempts) {
        return validation("maximum rejected attempts must be between 1 and 10");
    }
    let (authorization_ref, authorization) = latest_typed_with_ref::<RemoteExecutionAuthorization>(
        workspace,
        REMOTE_EXECUTION_AUTHORIZED,
        authorization_id,
    )?
    .ok_or_else(|| Error::NotFound(format!("remote authorization {authorization_id}")))?;
    let (launch_ref, launch) = latest_typed_with_ref::<RemoteLaunchReceipt>(
        workspace,
        REMOTE_LAUNCH_RECORDED,
        authorization_id,
    )?
    .ok_or_else(|| Error::NotFound(format!("remote launch {authorization_id}")))?;
    if launch.authorization_ref != authorization_ref {
        return Err(Error::Conflict(
            "remote launch no longer matches its authorization".to_owned(),
        ));
    }
    let now = now_ms()?;
    if expires_at_ms <= now || expires_at_ms > authorization.expires_at_ms {
        return Err(Error::Security(
            "report credential expiry must be in the future and no later than its authorization"
                .to_owned(),
        ));
    }
    let package: ExecutorJobPackage = workspace.get(&authorization.job_package_ref)?;
    let credential_id = format!("report-intake:{authorization_id}");
    if let Some(existing) =
        latest_typed::<ReportIntakeCredential>(workspace, CREDENTIAL_ISSUED, authorization_id)?
    {
        if existing.id == credential_id
            && existing.authorization_ref == authorization_ref
            && existing.launch_ref == launch_ref
            && existing.expires_at_ms == expires_at_ms
            && existing.max_report_bytes == package.reporting.max_report_bytes
            && existing.max_rejected_attempts == max_rejected_attempts
        {
            return Ok(IssuedReportIntakeCredential {
                credential: existing,
                bearer_token: None,
            });
        }
        return Err(Error::Conflict(format!(
            "report intake credential for {authorization_id} is immutable"
        )));
    }

    let mut token_bytes = [0_u8; TOKEN_BYTES];
    getrandom::fill(&mut token_bytes).map_err(|_| {
        Error::Execution("operating system random source is unavailable".to_owned())
    })?;
    let bearer_token = URL_SAFE_NO_PAD.encode(token_bytes);
    let credential = ReportIntakeCredential {
        schema: "ilxyr.report_intake_credential.v1".to_owned(),
        id: credential_id,
        authorization_ref,
        launch_ref,
        token_sha256: token_digest(&bearer_token),
        issued_at_ms: now,
        expires_at_ms,
        max_report_bytes: package.reporting.max_report_bytes,
        max_rejected_attempts,
    };
    let credential_ref = workspace.put(&credential)?;
    workspace.append_event(
        CREDENTIAL_ISSUED,
        authorization_id,
        ActorRef::service("service://ilxyr/report-intake-credential-issuer-v1"),
        Some(credential_ref),
    )?;
    Ok(IssuedReportIntakeCredential {
        credential,
        bearer_token: Some(bearer_token),
    })
}

/// Authenticates a bearer token without writing to the ledger.
pub fn authenticate_report_intake_credential(
    workspace: &Workspace,
    bearer_token: &str,
) -> Result<ReportIntakeCredential> {
    if bearer_token.len() != TOKEN_TEXT_BYTES || !bearer_token.is_ascii() {
        return Err(invalid_credential());
    }
    let presented = token_digest(bearer_token);
    let mut matched = None;
    for event in workspace
        .events()?
        .into_iter()
        .filter(|event| event.event_type == CREDENTIAL_ISSUED)
    {
        let credential_ref = required_artifact(&event.event_type, event.artifact_ref)?;
        let credential: ReportIntakeCredential = workspace.get(&credential_ref)?;
        let equal: bool = credential
            .token_sha256
            .as_bytes()
            .ct_eq(presented.as_bytes())
            .into();
        if equal {
            if matched.is_some() {
                return Err(Error::Conflict(
                    "multiple report credentials share one token digest".to_owned(),
                ));
            }
            matched = Some(credential);
        }
    }
    let credential = matched.ok_or_else(invalid_credential)?;
    if credential.expires_at_ms <= now_ms()? {
        return Err(Error::Security(
            "report intake credential has expired".to_owned(),
        ));
    }
    ensure_credential_bindings(workspace, &credential)?;
    Ok(credential)
}

/// Accepts one signed report for the launch bound to the bearer token.
pub fn accept_authenticated_remote_report(
    workspace: &Workspace,
    bearer_token: &str,
    report: &ExecutionReport,
) -> Result<AuthenticatedReportAcceptance> {
    let credential = authenticate_report_intake_credential(workspace, bearer_token)?;
    let credential_ref = object_ref(&credential)?;
    let report_ref = object_ref(report)?;
    if let Some((_, intake)) =
        latest_typed_with_ref::<ReportIntakeUseReceipt>(workspace, CREDENTIAL_USED, &credential.id)?
    {
        if intake.report_ref != report_ref {
            return Err(Error::Conflict(
                "report intake credential has already been used".to_owned(),
            ));
        }
        let accepted: AcceptedRemoteReport = workspace.get(&intake.accepted_ref)?;
        return Ok(AuthenticatedReportAcceptance {
            schema: "ilxyr.authenticated_report_acceptance.v1".to_owned(),
            accepted,
            intake,
            idempotent: true,
        });
    }
    ensure_rejection_limit_available(workspace, &credential)?;
    if report.authorization_ref != credential.authorization_ref
        || report.launch_ref != credential.launch_ref
    {
        return reject_authenticated_attempt(
            workspace,
            &credential,
            &credential_ref,
            &report_ref,
            Error::Security(
                "report does not match the credential's one recorded launch".to_owned(),
            ),
        );
    }

    let accepted = match accept_remote_execution_report(workspace, report) {
        Ok(accepted) => accepted,
        Err(error) => {
            return reject_authenticated_attempt(
                workspace,
                &credential,
                &credential_ref,
                &report_ref,
                error,
            );
        }
    };
    let authorization: RemoteExecutionAuthorization =
        workspace.get(&credential.authorization_ref)?;
    let (accepted_ref, ledgered) = latest_typed_with_ref::<AcceptedRemoteReport>(
        workspace,
        REMOTE_REPORT_ACCEPTED,
        &authorization.id,
    )?
    .ok_or_else(|| Error::Conflict("accepted report has no ledger event".to_owned()))?;
    if ledgered.report_ref != accepted.report_ref {
        return Err(Error::Conflict(
            "accepted report event changed during intake".to_owned(),
        ));
    }
    let intake = ReportIntakeUseReceipt {
        schema: "ilxyr.report_intake_use_receipt.v1".to_owned(),
        credential_ref,
        authorization_ref: credential.authorization_ref,
        launch_ref: credential.launch_ref,
        report_ref,
        accepted_ref,
        used_at_ms: now_ms()?,
    };
    let intake_ref = workspace.put(&intake)?;
    workspace.append_event(
        CREDENTIAL_USED,
        &credential.id,
        ActorRef::service("service://ilxyr/report-intake-v1"),
        Some(intake_ref),
    )?;
    Ok(AuthenticatedReportAcceptance {
        schema: "ilxyr.authenticated_report_acceptance.v1".to_owned(),
        accepted,
        intake,
        idempotent: false,
    })
}

/// Counts an authenticated malformed body without storing the body itself.
pub fn record_authenticated_report_rejection(
    workspace: &Workspace,
    bearer_token: &str,
    body: &[u8],
    reason_class: &str,
) -> Result<()> {
    if !matches!(reason_class, "invalid_json" | "invalid_report") {
        return validation("unsupported intake rejection class");
    }
    let credential = authenticate_report_intake_credential(workspace, bearer_token)?;
    ensure_rejection_limit_available(workspace, &credential)?;
    let credential_ref = object_ref(&credential)?;
    let report_ref = format!("body://sha256/{:x}", Sha256::digest(body));
    let rejection = ReportIntakeRejection {
        schema: "ilxyr.report_intake_rejection.v1".to_owned(),
        credential_ref,
        report_ref,
        reason_class: reason_class.to_owned(),
        rejected_at_ms: now_ms()?,
    };
    let rejection_ref = workspace.put(&rejection)?;
    workspace.append_event(
        INTAKE_REJECTED,
        &credential.id,
        ActorRef::service("service://ilxyr/report-intake-v1"),
        Some(rejection_ref),
    )?;
    Ok(())
}

fn reject_authenticated_attempt<T>(
    workspace: &Workspace,
    credential: &ReportIntakeCredential,
    credential_ref: &str,
    report_ref: &str,
    error: Error,
) -> Result<T> {
    let rejection = ReportIntakeRejection {
        schema: "ilxyr.report_intake_rejection.v1".to_owned(),
        credential_ref: credential_ref.to_owned(),
        report_ref: report_ref.to_owned(),
        reason_class: error_class(&error).to_owned(),
        rejected_at_ms: now_ms()?,
    };
    let rejection_ref = workspace.put(&rejection)?;
    workspace.append_event(
        INTAKE_REJECTED,
        &credential.id,
        ActorRef::service("service://ilxyr/report-intake-v1"),
        Some(rejection_ref),
    )?;
    Err(error)
}

fn ensure_rejection_limit_available(
    workspace: &Workspace,
    credential: &ReportIntakeCredential,
) -> Result<()> {
    let rejected_attempts = workspace
        .events()?
        .into_iter()
        .filter(|event| event.event_type == INTAKE_REJECTED && event.aggregate_id == credential.id)
        .count();
    if rejected_attempts >= usize::from(credential.max_rejected_attempts) {
        return Err(Error::Security(
            "report intake credential has reached its rejected-attempt limit".to_owned(),
        ));
    }
    Ok(())
}

fn ensure_credential_bindings(
    workspace: &Workspace,
    credential: &ReportIntakeCredential,
) -> Result<()> {
    let authorization: RemoteExecutionAuthorization =
        workspace.get(&credential.authorization_ref)?;
    let authorization_event = workspace
        .latest_event(REMOTE_EXECUTION_AUTHORIZED, &authorization.id)?
        .ok_or_else(|| Error::NotFound(format!("remote authorization {}", authorization.id)))?;
    if authorization_event.artifact_ref.as_deref() != Some(&credential.authorization_ref) {
        return Err(Error::Conflict(
            "report credential authorization is not the ledgered authorization".to_owned(),
        ));
    }
    let launch_event = workspace
        .latest_event(REMOTE_LAUNCH_RECORDED, &authorization.id)?
        .ok_or_else(|| Error::NotFound(format!("remote launch {}", authorization.id)))?;
    if launch_event.artifact_ref.as_deref() != Some(&credential.launch_ref) {
        return Err(Error::Conflict(
            "report credential launch is not the ledgered launch".to_owned(),
        ));
    }
    let launch: RemoteLaunchReceipt = workspace.get(&credential.launch_ref)?;
    if launch.authorization_ref != credential.authorization_ref {
        return Err(Error::Conflict(
            "report credential launch does not match its authorization".to_owned(),
        ));
    }
    Ok(())
}

fn latest_typed<T: DeserializeOwned>(
    workspace: &Workspace,
    event_type: &str,
    aggregate_id: &str,
) -> Result<Option<T>> {
    latest_typed_with_ref(workspace, event_type, aggregate_id)
        .map(|object| object.map(|(_, value)| value))
}

fn latest_typed_with_ref<T: DeserializeOwned>(
    workspace: &Workspace,
    event_type: &str,
    aggregate_id: &str,
) -> Result<Option<(String, T)>> {
    workspace
        .latest_event(event_type, aggregate_id)?
        .map(|event| {
            let artifact_ref = required_artifact(&event.event_type, event.artifact_ref)?;
            let object = workspace.get(&artifact_ref)?;
            Ok((artifact_ref, object))
        })
        .transpose()
}

fn required_artifact(event_type: &str, artifact_ref: Option<String>) -> Result<String> {
    artifact_ref.ok_or_else(|| {
        Error::Conflict(format!(
            "{event_type} event is missing its artifact reference"
        ))
    })
}

fn object_ref<T: Serialize>(value: &T) -> Result<String> {
    Ok(format!("artifact://sha256/{}", Workspace::digest(value)?))
}

fn token_digest(token: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(b"ilxyr.report-intake-token.v1\0");
    digest.update(token.as_bytes());
    format!("{:x}", digest.finalize())
}

fn error_class(error: &Error) -> &'static str {
    match error {
        Error::Io(_) | Error::Execution(_) => "internal",
        Error::Json(_) | Error::Validation(_) => "invalid",
        Error::NotFound(_) => "not_found",
        Error::Conflict(_) => "conflict",
        Error::Security(_) => "security",
    }
}

fn invalid_credential() -> Error {
    Error::Security("invalid report intake credential".to_owned())
}

fn validation<T>(message: impl Into<String>) -> Result<T> {
    Err(Error::Validation(vec![message.into()]))
}
