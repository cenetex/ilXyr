use std::sync::{Arc, Mutex, MutexGuard};

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, Request, State},
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use ilxyr_core::{
    ActorKind, ActorRef, AzureMlHandoffRequest, CorpusMaterialization, CorpusRelease, Error,
    RegisteredCorpus, RegisteredMaterialization, SageMakerHandoffRequest, Workspace,
    azure_ml_corpus_handoff, corpus_materialization_by_ref, corpus_release_by_ref,
    record_authenticated_corpus_materialization, register_corpus_release, sagemaker_corpus_handoff,
};
use serde::Serialize;
use serde_json::{Value, json};

const MAX_JSON_BYTES: usize = 1024 * 1024;

#[derive(Clone)]
pub struct CorpusServiceState {
    workspace: Arc<Mutex<Workspace>>,
    access_token: Arc<str>,
    materializer_token: Arc<str>,
    materializer_identity: ActorRef,
}

impl CorpusServiceState {
    pub fn new(
        workspace: Workspace,
        access_token: impl Into<String>,
        materializer_token: impl Into<String>,
        materializer_identity: ActorRef,
    ) -> Result<Self, Error> {
        let access_token = access_token.into();
        let materializer_token = materializer_token.into();
        if access_token.len() < 32 {
            return Err(Error::Security(
                "corpus service access token must be at least 32 bytes".to_owned(),
            ));
        }
        if materializer_token.len() < 32 {
            return Err(Error::Security(
                "corpus materializer token must be at least 32 bytes".to_owned(),
            ));
        }
        if constant_time_eq(access_token.as_bytes(), materializer_token.as_bytes()) {
            return Err(Error::Security(
                "corpus access and materializer tokens must be different".to_owned(),
            ));
        }
        if materializer_identity.kind != ActorKind::Service
            || !materializer_identity.id.starts_with("service://")
            || materializer_identity.id.chars().any(char::is_whitespace)
            || materializer_identity.model_ref.is_some()
        {
            return Err(Error::Security(
                "corpus materializer identity must be a service actor".to_owned(),
            ));
        }
        Ok(Self {
            workspace: Arc::new(Mutex::new(workspace)),
            access_token: Arc::from(access_token),
            materializer_token: Arc::from(materializer_token),
            materializer_identity,
        })
    }

    fn lock_workspace(&self) -> ApiResult<MutexGuard<'_, Workspace>> {
        self.workspace
            .lock()
            .map_err(|_| ApiError::internal("corpus workspace lock is poisoned"))
    }
}

pub fn corpus_router(state: CorpusServiceState) -> Router {
    let access_routes = Router::new()
        .route("/v1/corpora", post(register_corpus))
        .route("/v1/corpora/{digest}", get(get_corpus))
        .route("/v1/materializations/{digest}", get(get_materialization))
        .route("/v1/handoffs/sagemaker", post(sagemaker_handoff))
        .route("/v1/handoffs/azure-ml", post(azure_handoff))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            require_access_auth,
        ));
    let materializer_routes = Router::new()
        .route("/v1/materializations", post(record_materialization))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            require_materializer_auth,
        ));
    Router::new()
        .route("/healthz", get(health))
        .merge(access_routes)
        .merge(materializer_routes)
        .layer(DefaultBodyLimit::max(MAX_JSON_BYTES))
        .with_state(state)
}

async fn health() -> Json<Value> {
    Json(json!({
        "schema": "ilxyr.corpus_service_health.v1",
        "status": "ok"
    }))
}

async fn register_corpus(
    State(state): State<CorpusServiceState>,
    Json(release): Json<CorpusRelease>,
) -> ApiResult<Json<RegisteredCorpus>> {
    let workspace = state.lock_workspace()?;
    Ok(Json(register_corpus_release(&workspace, release)?))
}

async fn get_corpus(
    State(state): State<CorpusServiceState>,
    Path(digest): Path<String>,
) -> ApiResult<Json<RegisteredCorpus>> {
    let artifact_ref = artifact_ref(&digest)?;
    let workspace = state.lock_workspace()?;
    let release = corpus_release_by_ref(&workspace, &artifact_ref)?;
    Ok(Json(RegisteredCorpus {
        artifact_ref,
        release,
    }))
}

async fn record_materialization(
    State(state): State<CorpusServiceState>,
    Json(materialization): Json<CorpusMaterialization>,
) -> ApiResult<Json<RegisteredMaterialization>> {
    let workspace = state.lock_workspace()?;
    Ok(Json(record_authenticated_corpus_materialization(
        &workspace,
        materialization,
        &state.materializer_identity,
    )?))
}

async fn get_materialization(
    State(state): State<CorpusServiceState>,
    Path(digest): Path<String>,
) -> ApiResult<Json<RegisteredMaterialization>> {
    let artifact_ref = artifact_ref(&digest)?;
    let workspace = state.lock_workspace()?;
    let materialization = corpus_materialization_by_ref(&workspace, &artifact_ref)?;
    Ok(Json(RegisteredMaterialization {
        artifact_ref,
        materialization,
    }))
}

async fn sagemaker_handoff(
    State(state): State<CorpusServiceState>,
    Json(request): Json<SageMakerHandoffRequest>,
) -> ApiResult<Json<ilxyr_core::SageMakerCorpusHandoff>> {
    let workspace = state.lock_workspace()?;
    Ok(Json(sagemaker_corpus_handoff(&workspace, request)?))
}

async fn azure_handoff(
    State(state): State<CorpusServiceState>,
    Json(request): Json<AzureMlHandoffRequest>,
) -> ApiResult<Json<ilxyr_core::AzureMlCorpusHandoff>> {
    let workspace = state.lock_workspace()?;
    Ok(Json(azure_ml_corpus_handoff(&workspace, request)?))
}

async fn require_access_auth(
    State(state): State<CorpusServiceState>,
    request: Request,
    next: Next,
) -> ApiResult<Response> {
    authorize(request.headers(), &state.access_token)?;
    Ok(next.run(request).await)
}

async fn require_materializer_auth(
    State(state): State<CorpusServiceState>,
    request: Request,
    next: Next,
) -> ApiResult<Response> {
    authorize(request.headers(), &state.materializer_token)?;
    Ok(next.run(request).await)
}

fn authorize(headers: &HeaderMap, expected_token: &str) -> ApiResult<()> {
    let supplied = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .unwrap_or_default();
    if constant_time_eq(supplied.as_bytes(), expected_token.as_bytes()) {
        Ok(())
    } else {
        Err(ApiError::new(StatusCode::UNAUTHORIZED, "unauthorized"))
    }
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    let mut difference = left.len() ^ right.len();
    let maximum = left.len().max(right.len());
    for index in 0..maximum {
        let left_byte = left.get(index).copied().unwrap_or_default();
        let right_byte = right.get(index).copied().unwrap_or_default();
        difference |= usize::from(left_byte ^ right_byte);
    }
    difference == 0
}

fn artifact_ref(digest: &str) -> ApiResult<String> {
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "path digest must be a lowercase SHA-256 value",
        ));
    }
    Ok(format!("artifact://sha256/{digest}"))
}

type ApiResult<T> = std::result::Result<T, ApiError>;

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, message)
    }
}

#[derive(Serialize)]
struct ErrorBody<'a> {
    schema: &'a str,
    error: &'a str,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = ErrorBody {
            schema: "ilxyr.corpus_service_error.v1",
            error: &self.message,
        };
        (self.status, Json(body)).into_response()
    }
}

impl From<Error> for ApiError {
    fn from(error: Error) -> Self {
        let status = match error {
            Error::Validation(_) | Error::Json(_) => StatusCode::BAD_REQUEST,
            Error::NotFound(_) => StatusCode::NOT_FOUND,
            Error::Conflict(_) => StatusCode::CONFLICT,
            Error::Security(_) => StatusCode::FORBIDDEN,
            Error::Io(_) | Error::Execution(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        Self::new(status, error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        process,
        sync::atomic::{AtomicU64, Ordering},
        time::SystemTime,
    };

    use axum::{
        body::{Body, to_bytes},
        http::{Request, StatusCode},
    };
    use ilxyr_core::{CorpusMaterialization, CorpusRelease, RegisteredCorpus};
    use serde_json::{Value, json};
    use tower::ServiceExt;

    use super::{CorpusServiceState, corpus_router};

    const ACCESS_TOKEN: &str = "test-access-token-that-is-long-enough-for-service-tests";
    const MATERIALIZER_TOKEN: &str =
        "test-materializer-token-that-is-long-enough-for-service-tests";
    const MATERIALIZER_ID: &str = "service://ilxyr/s3-readback-materializer-v1";
    static UNIQUE: AtomicU64 = AtomicU64::new(0);

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn create() -> Self {
            let sequence = UNIQUE.fetch_add(1, Ordering::Relaxed);
            let timestamp = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .expect("test clock must follow Unix epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "ilxyr-corpus-service-{}-{timestamp}-{sequence}",
                process::id()
            ));
            fs::create_dir(&path).expect("fresh test directory must be created");
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn short_bearer_tokens_are_rejected() {
        let directory = TestDirectory::create();
        let workspace = ilxyr_core::Workspace::init(&directory.0).expect("initialize workspace");
        let error = CorpusServiceState::new(
            workspace.clone(),
            "short",
            MATERIALIZER_TOKEN,
            ilxyr_core::ActorRef::service(MATERIALIZER_ID),
        )
        .err()
        .expect("short token must fail");
        assert!(error.to_string().contains("at least 32 bytes"));

        let error = CorpusServiceState::new(
            workspace,
            ACCESS_TOKEN,
            ACCESS_TOKEN,
            ilxyr_core::ActorRef::service(MATERIALIZER_ID),
        )
        .err()
        .expect("shared credentials must fail");
        assert!(error.to_string().contains("must be different"));
    }

    #[tokio::test]
    async fn health_is_public_but_corpus_routes_require_authentication() {
        let directory = TestDirectory::create();
        let workspace = ilxyr_core::Workspace::init(&directory.0).expect("initialize workspace");
        let app = corpus_router(service_state(workspace));
        let health = app
            .clone()
            .oneshot(
                Request::get("/healthz")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("health response");
        assert_eq!(health.status(), StatusCode::OK);

        let unauthorized = app
            .oneshot(
                Request::post("/v1/corpora")
                    .header("content-type", "application/json")
                    .body(Body::from(include_str!(
                        "../../../examples/corpus/braid-corpus-five.json"
                    )))
                    .expect("request"),
            )
            .await
            .expect("unauthorized response");
        assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn service_registers_a_corpus_and_generates_a_sagemaker_handoff() {
        let directory = TestDirectory::create();
        let workspace = ilxyr_core::Workspace::init(&directory.0).expect("initialize workspace");
        let app = corpus_router(service_state(workspace));
        let corpus_response = authorized_json(
            app.clone(),
            "/v1/corpora",
            serde_json::from_str::<CorpusRelease>(include_str!(
                "../../../examples/corpus/braid-corpus-five.json"
            ))
            .expect("corpus fixture"),
        )
        .await;
        assert_eq!(corpus_response.0, StatusCode::OK);
        let registered: RegisteredCorpus =
            serde_json::from_value(corpus_response.1).expect("registered corpus response");
        let digest = registered
            .artifact_ref
            .strip_prefix("artifact://sha256/")
            .expect("artifact digest");

        let get_response = app
            .clone()
            .oneshot(
                Request::get(format!("/v1/corpora/{digest}"))
                    .header("authorization", format!("Bearer {ACCESS_TOKEN}"))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("get corpus response");
        assert_eq!(get_response.status(), StatusCode::OK);

        let mut receipt = serde_json::from_str::<Value>(include_str!(
            "../../../examples/corpus/s3-materialization.json"
        ))
        .expect("receipt fixture");
        receipt["corpus_ref"] = Value::String(registered.artifact_ref);
        receipt["verified_by"] =
            serde_json::to_value(ilxyr_core::ActorRef::service(MATERIALIZER_ID))
                .expect("verifier serializes");
        let materialization = serde_json::from_value::<CorpusMaterialization>(receipt)
            .expect("materialization fixture");
        let materialization_response = authorized_json_with_token(
            app.clone(),
            "/v1/materializations",
            materialization,
            MATERIALIZER_TOKEN,
        )
        .await;
        assert_eq!(materialization_response.0, StatusCode::OK);
        let materialization_ref = materialization_response.1["artifact_ref"]
            .as_str()
            .expect("materialization ref")
            .to_owned();

        let handoff_response = authorized_json(
            app,
            "/v1/handoffs/sagemaker",
            json!({
                "materialization_ref": materialization_ref,
                "channel_name": "training",
                "content_type": "application/x-jsonlines",
                "input_mode": "File"
            }),
        )
        .await;
        assert_eq!(handoff_response.0, StatusCode::OK);
        assert_eq!(
            handoff_response.1["input_data_config"][0]["DataSource"]["S3DataSource"]["S3Uri"],
            "s3://example-corpora/braid/corpus-five/v0.3.0"
        );
    }

    #[tokio::test]
    async fn materializer_authentication_prevents_verifier_impersonation() {
        let directory = TestDirectory::create();
        let workspace = ilxyr_core::Workspace::init(&directory.0).expect("initialize workspace");
        let app = corpus_router(service_state(workspace));
        let receipt = serde_json::from_str::<CorpusMaterialization>(include_str!(
            "../../../examples/corpus/s3-materialization.json"
        ))
        .expect("receipt fixture");

        let access_attempt = authorized_json_with_token(
            app.clone(),
            "/v1/materializations",
            receipt.clone(),
            ACCESS_TOKEN,
        )
        .await;
        assert_eq!(access_attempt.0, StatusCode::UNAUTHORIZED);

        let impersonation = authorized_json_with_token(
            app.clone(),
            "/v1/materializations",
            receipt,
            MATERIALIZER_TOKEN,
        )
        .await;
        assert_eq!(impersonation.0, StatusCode::FORBIDDEN);
        assert!(
            impersonation.1["error"]
                .as_str()
                .expect("error string")
                .contains("does not match authenticated verifier")
        );

        let materializer_read = app
            .oneshot(
                Request::get(format!("/v1/corpora/{}", "0".repeat(64)))
                    .header("authorization", format!("Bearer {MATERIALIZER_TOKEN}"))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("materializer read response");
        assert_eq!(materializer_read.status(), StatusCode::UNAUTHORIZED);
    }

    fn service_state(workspace: ilxyr_core::Workspace) -> CorpusServiceState {
        CorpusServiceState::new(
            workspace,
            ACCESS_TOKEN,
            MATERIALIZER_TOKEN,
            ilxyr_core::ActorRef::service(MATERIALIZER_ID),
        )
        .expect("valid service state")
    }

    async fn authorized_json<T: serde::Serialize>(
        app: axum::Router,
        uri: &str,
        body: T,
    ) -> (StatusCode, Value) {
        authorized_json_with_token(app, uri, body, ACCESS_TOKEN).await
    }

    async fn authorized_json_with_token<T: serde::Serialize>(
        app: axum::Router,
        uri: &str,
        body: T,
        token: &str,
    ) -> (StatusCode, Value) {
        let response = app
            .oneshot(
                Request::post(uri)
                    .header("authorization", format!("Bearer {token}"))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&body).expect("serialize request"),
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        let status = response.status();
        let bytes = to_bytes(response.into_body(), 1024 * 1024)
            .await
            .expect("response body");
        let value = serde_json::from_slice(&bytes).expect("JSON response");
        (status, value)
    }
}
