use std::{env, net::SocketAddr, process::ExitCode};

use ilxyr_core::{ActorRef, Workspace};
use ilxyr_corpus_service::{CorpusServiceState, corpus_router};

#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error}");
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args.is_empty() || args.len() > 2 {
        return Err("usage: ilxyr-corpus-service <workspace> [bind-address]".into());
    }
    let token = env::var("ILXYR_CORPUS_TOKEN")
        .map_err(|_| "ILXYR_CORPUS_TOKEN must contain the corpus access token")?;
    if token.len() < 32 {
        return Err("ILXYR_CORPUS_TOKEN must be at least 32 bytes".into());
    }
    let materializer_token = env::var("ILXYR_CORPUS_MATERIALIZER_TOKEN").map_err(
        |_| "ILXYR_CORPUS_MATERIALIZER_TOKEN must contain the materializer bearer token",
    )?;
    let materializer_id = env::var("ILXYR_CORPUS_MATERIALIZER_ID")
        .map_err(|_| "ILXYR_CORPUS_MATERIALIZER_ID must contain a service:// identity")?;
    let bind = args
        .get(1)
        .map(String::as_str)
        .unwrap_or("127.0.0.1:8787")
        .parse::<SocketAddr>()?;
    if !bind.ip().is_loopback() && env::var("ILXYR_CORPUS_ALLOW_REMOTE").as_deref() != Ok("true") {
        return Err(
            "non-loopback binding requires ILXYR_CORPUS_ALLOW_REMOTE=true and a TLS proxy".into(),
        );
    }

    let workspace = Workspace::open(&args[0])?;
    let state = CorpusServiceState::new(
        workspace,
        token,
        materializer_token,
        ActorRef::service(&materializer_id),
    )?;
    let listener = tokio::net::TcpListener::bind(bind).await?;
    println!("ilxyr corpus service listening on http://{bind}");
    axum::serve(listener, corpus_router(state))
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn shutdown_signal() {
    if tokio::signal::ctrl_c().await.is_err() {
        eprintln!("warning: could not install shutdown signal handler");
    }
}
