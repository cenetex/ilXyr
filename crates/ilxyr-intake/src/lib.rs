use std::{
    collections::BTreeMap,
    net::IpAddr,
    sync::Mutex,
    time::{Duration, Instant},
};

use ilxyr_intake_boundary::{
    AuthenticatedReportAcceptance, Error, ExecutionReport, Workspace,
    accept_authenticated_remote_report, authenticate_report_intake_credential,
    record_authenticated_report_rejection,
};
use serde::Serialize;
use serde_json::json;
use tiny_http::{Header, Request, Response, StatusCode};

pub const DEFAULT_MAX_BODY_BYTES: usize = 1_048_576;
pub const DEFAULT_REQUESTS_PER_MINUTE: u32 = 60;

pub struct IntakeService {
    workspace: Mutex<Workspace>,
    max_body_bytes: usize,
    rate_limiter: Mutex<RateLimiter>,
}

impl IntakeService {
    #[must_use]
    pub fn new(workspace: Workspace, max_body_bytes: usize, requests_per_minute: u32) -> Self {
        Self {
            workspace: Mutex::new(workspace),
            max_body_bytes,
            rate_limiter: Mutex::new(RateLimiter::new(requests_per_minute)),
        }
    }

    pub fn serve_request(&self, mut request: Request) {
        let peer = request
            .remote_addr()
            .map(|address| address.ip())
            .unwrap_or(IpAddr::from([0, 0, 0, 0]));
        if !self.allow_request(peer) {
            respond(
                request,
                wire_error(429, "rate_limited", "request rate limit reached"),
            );
            return;
        }
        let method = request.method().as_str().to_owned();
        let path = request.url().to_owned();
        if method == "GET" && path == "/healthz" {
            respond(
                request,
                WireResponse::json(
                    200,
                    &json!({
                        "schema": "ilxyr.report_intake_health.v1",
                        "status": "ok",
                        "launch_authority": false
                    }),
                ),
            );
            return;
        }
        if method != "POST" || path != "/v1/reports" {
            respond(request, wire_error(404, "not_found", "route not found"));
            return;
        }
        if request
            .headers()
            .iter()
            .any(|header| header.field.equiv("Transfer-Encoding"))
        {
            respond(
                request,
                wire_error(
                    400,
                    "fixed_length_required",
                    "chunked request bodies are not accepted",
                ),
            );
            return;
        }
        let Some(body_length) = request.body_length() else {
            respond(
                request,
                wire_error(411, "length_required", "Content-Length is required"),
            );
            return;
        };
        if body_length > self.max_body_bytes {
            respond(
                request,
                wire_error(413, "body_too_large", "request body is too large"),
            );
            return;
        }
        let content_type = header_value(&request, "Content-Type");
        if content_type.as_deref() != Some("application/json") {
            respond(
                request,
                wire_error(
                    415,
                    "unsupported_media_type",
                    "Content-Type must be application/json",
                ),
            );
            return;
        }
        let Some(token) = bearer_token(&request) else {
            respond(
                request,
                wire_error(401, "unauthorized", "valid bearer credentials are required"),
            );
            return;
        };
        let workspace = match self.workspace.lock() {
            Ok(workspace) => workspace,
            Err(_) => {
                respond(
                    request,
                    wire_error(503, "unavailable", "intake is unavailable"),
                );
                return;
            }
        };
        let credential = match authenticate_report_intake_credential(&workspace, &token) {
            Ok(credential) => credential,
            Err(_) => {
                respond(
                    request,
                    wire_error(401, "unauthorized", "valid bearer credentials are required"),
                );
                return;
            }
        };
        if u64::try_from(body_length).unwrap_or(u64::MAX) > credential.max_report_bytes {
            respond(
                request,
                wire_error(413, "body_too_large", "request body is too large"),
            );
            return;
        }
        let mut body = Vec::with_capacity(body_length);
        if request.as_reader().read_to_end(&mut body).is_err() || body.len() != body_length {
            respond(
                request,
                wire_error(400, "invalid_body", "request body is incomplete"),
            );
            return;
        }
        let report: ExecutionReport = match serde_json::from_slice(&body) {
            Ok(report) => report,
            Err(_) => {
                let _ = record_authenticated_report_rejection(
                    &workspace,
                    &token,
                    &body,
                    "invalid_json",
                );
                respond(
                    request,
                    wire_error(400, "invalid_json", "body is not a valid execution report"),
                );
                return;
            }
        };
        let response = match accept_authenticated_remote_report(&workspace, &token, &report) {
            Ok(accepted) => acceptance_response(&accepted),
            Err(error) => core_error_response(&error),
        };
        respond(request, response);
    }

    fn allow_request(&self, peer: IpAddr) -> bool {
        self.rate_limiter
            .lock()
            .map(|mut limiter| limiter.allow(peer, Instant::now()))
            .unwrap_or(false)
    }
}

struct RateWindow {
    started: Instant,
    count: u32,
}

struct RateLimiter {
    requests_per_minute: u32,
    peers: BTreeMap<IpAddr, RateWindow>,
}

impl RateLimiter {
    fn new(requests_per_minute: u32) -> Self {
        Self {
            requests_per_minute: requests_per_minute.max(1),
            peers: BTreeMap::new(),
        }
    }

    fn allow(&mut self, peer: IpAddr, now: Instant) -> bool {
        self.peers
            .retain(|_, window| now.duration_since(window.started) < Duration::from_secs(120));
        let window = self.peers.entry(peer).or_insert(RateWindow {
            started: now,
            count: 0,
        });
        if now.duration_since(window.started) >= Duration::from_secs(60) {
            window.started = now;
            window.count = 0;
        }
        if window.count >= self.requests_per_minute {
            return false;
        }
        window.count += 1;
        true
    }
}

struct WireResponse {
    status: u16,
    body: Vec<u8>,
}

impl WireResponse {
    fn json(status: u16, value: &impl Serialize) -> Self {
        Self {
            status,
            body: serde_json::to_vec(value)
                .unwrap_or_else(|_| b"{\"error\":\"internal\"}".to_vec()),
        }
    }
}

fn acceptance_response(acceptance: &AuthenticatedReportAcceptance) -> WireResponse {
    WireResponse::json(
        if acceptance.idempotent { 200 } else { 202 },
        &json!({
            "schema": "ilxyr.report_intake_response.v1",
            "status": if acceptance.idempotent { "already_accepted" } else { "accepted" },
            "experiment_id": acceptance.accepted.experiment_id,
            "report_ref": acceptance.accepted.report_ref,
            "resolved_outcome": acceptance.accepted.resolved_outcome
        }),
    )
}

fn core_error_response(error: &Error) -> WireResponse {
    match error {
        Error::Conflict(_) => wire_error(409, "conflict", "report conflicts with ledger state"),
        Error::Validation(_) | Error::Json(_) => {
            wire_error(422, "invalid_report", "execution report was rejected")
        }
        Error::NotFound(_) | Error::Security(_) => {
            wire_error(422, "rejected", "execution report was rejected")
        }
        Error::Io(_) | Error::Execution(_) => {
            wire_error(503, "unavailable", "intake is unavailable")
        }
    }
}

fn wire_error(status: u16, code: &str, message: &str) -> WireResponse {
    WireResponse::json(
        status,
        &json!({
            "schema": "ilxyr.report_intake_error.v1",
            "error": code,
            "message": message
        }),
    )
}

fn header_value(request: &Request, name: &'static str) -> Option<String> {
    let mut values = request
        .headers()
        .iter()
        .filter(|header| header.field.equiv(name))
        .map(|header| header.value.as_str().trim().to_owned());
    let first = values.next()?;
    if values.next().is_some() {
        return None;
    }
    Some(first)
}

fn bearer_token(request: &Request) -> Option<String> {
    let value = header_value(request, "Authorization")?;
    let token = value.strip_prefix("Bearer ")?;
    if token.is_empty() || token.bytes().any(|byte| byte.is_ascii_whitespace()) {
        return None;
    }
    Some(token.to_owned())
}

fn respond(request: Request, response: WireResponse) {
    let content_type = Header::from_bytes("Content-Type", "application/json")
        .expect("static response header is valid");
    let cache_control =
        Header::from_bytes("Cache-Control", "no-store").expect("static response header is valid");
    let tiny_response = Response::from_data(response.body)
        .with_status_code(StatusCode(response.status))
        .with_header(content_type)
        .with_header(cache_control);
    let _ = request.respond(tiny_response);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rate_limit_is_per_peer_and_resets() {
        let start = Instant::now();
        let mut limiter = RateLimiter::new(2);
        let first = IpAddr::from([127, 0, 0, 1]);
        let second = IpAddr::from([127, 0, 0, 2]);
        assert!(limiter.allow(first, start));
        assert!(limiter.allow(first, start));
        assert!(!limiter.allow(first, start));
        assert!(limiter.allow(second, start));
        assert!(limiter.allow(first, start + Duration::from_secs(60)));
    }

    #[test]
    fn direct_dependencies_enforce_the_intake_capability_boundary() {
        let metadata = std::process::Command::new(env!("CARGO"))
            .args(["metadata", "--format-version", "1", "--no-deps"])
            .current_dir(env!("CARGO_MANIFEST_DIR"))
            .output()
            .expect("cargo metadata must run");
        assert!(metadata.status.success(), "cargo metadata must succeed");
        let metadata: serde_json::Value =
            serde_json::from_slice(&metadata.stdout).expect("cargo metadata must be JSON");
        let packages = metadata["packages"]
            .as_array()
            .expect("cargo metadata must contain packages");
        assert_dependencies(
            packages,
            "ilxyr-intake",
            &["ilxyr-intake-boundary", "serde", "serde_json", "tiny_http"],
        );
        assert_dependencies(packages, "ilxyr-intake-boundary", &["ilxyr-core"]);
    }

    fn assert_dependencies(packages: &[serde_json::Value], package_name: &str, expected: &[&str]) {
        let package = packages
            .iter()
            .find(|package| package["name"] == package_name)
            .unwrap_or_else(|| panic!("cargo metadata must contain {package_name}"));
        let mut actual = package["dependencies"]
            .as_array()
            .expect("package dependencies must be an array")
            .iter()
            .map(|dependency| {
                dependency["name"]
                    .as_str()
                    .expect("dependency name must be a string")
            })
            .collect::<Vec<_>>();
        actual.sort_unstable();
        let mut expected = expected.to_vec();
        expected.sort_unstable();
        assert_eq!(
            actual, expected,
            "{package_name} dependency boundary changed"
        );
    }
}
