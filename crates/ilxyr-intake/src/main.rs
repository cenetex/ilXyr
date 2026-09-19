use std::{env, net::IpAddr, process, str::FromStr, sync::Arc};

use ilxyr_intake::{DEFAULT_MAX_BODY_BYTES, DEFAULT_REQUESTS_PER_MINUTE, IntakeService};
use ilxyr_intake_boundary::{Workspace, issue_report_intake_credential};
use tiny_http::Server;

const DEFAULT_BIND: &str = "127.0.0.1:8087";
const DEFAULT_CREDENTIAL_TTL_SECONDS: u64 = 3_600;
const DEFAULT_MAX_REJECTED_ATTEMPTS: u8 = 5;

fn main() {
    if let Err(message) = run() {
        eprintln!("ilxyr-intake: {message}");
        process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    match args.first().map(String::as_str) {
        Some("issue") => issue(&args[1..]),
        Some("serve") => serve(&args[1..]),
        _ => Err(usage()),
    }
}

fn issue(args: &[String]) -> Result<(), String> {
    if !(2..=4).contains(&args.len()) {
        return Err(usage());
    }
    let workspace = Workspace::open(&args[0]).map_err(|error| error.to_string())?;
    let ttl_seconds = parse_or_default(args.get(2), DEFAULT_CREDENTIAL_TTL_SECONDS, "TTL")?;
    if !(60..=86_400).contains(&ttl_seconds) {
        return Err("credential TTL must be between 60 and 86400 seconds".to_owned());
    }
    let max_attempts = parse_or_default(
        args.get(3),
        DEFAULT_MAX_REJECTED_ATTEMPTS,
        "maximum rejected attempts",
    )?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let expires_at_ms = now
        .checked_add(u128::from(ttl_seconds) * 1_000)
        .ok_or_else(|| "credential expiry overflowed".to_owned())?;
    let issued = issue_report_intake_credential(&workspace, &args[1], expires_at_ms, max_attempts)
        .map_err(|error| error.to_string())?;
    println!(
        "{}",
        serde_json::to_string_pretty(&issued).map_err(|error| error.to_string())?
    );
    Ok(())
}

fn serve(args: &[String]) -> Result<(), String> {
    let Some(workspace_path) = args.first() else {
        return Err(usage());
    };
    let mut bind = DEFAULT_BIND.to_owned();
    let mut max_body_bytes = DEFAULT_MAX_BODY_BYTES;
    let mut requests_per_minute = DEFAULT_REQUESTS_PER_MINUTE;
    let mut allow_public_bind = false;
    let mut index = 1;
    while index < args.len() {
        match args[index].as_str() {
            "--bind" => {
                bind = option_value(args, &mut index, "--bind")?.to_owned();
            }
            "--max-body-bytes" => {
                max_body_bytes = option_value(args, &mut index, "--max-body-bytes")?
                    .parse()
                    .map_err(|error| format!("invalid body limit: {error}"))?;
            }
            "--requests-per-minute" => {
                requests_per_minute = option_value(args, &mut index, "--requests-per-minute")?
                    .parse()
                    .map_err(|error| format!("invalid requests per minute: {error}"))?;
            }
            "--allow-public-bind" => allow_public_bind = true,
            option => return Err(format!("unknown serve option {option}\n{}", usage())),
        }
        index += 1;
    }
    let workspace = Workspace::open(workspace_path).map_err(|error| error.to_string())?;
    let host = bind
        .rsplit_once(':')
        .ok_or_else(|| "bind address must include a port".to_owned())?
        .0
        .trim_matches(['[', ']']);
    let ip = IpAddr::from_str(host).map_err(|_| "bind host must be an IP address".to_owned())?;
    if !ip.is_loopback() && !allow_public_bind {
        return Err(
            "public binding requires --allow-public-bind and a TLS reverse proxy".to_owned(),
        );
    }
    if !(1_024..=16 * 1_048_576).contains(&max_body_bytes) {
        return Err("body limit must be between 1024 and 16777216 bytes".to_owned());
    }
    if !(1..=10_000).contains(&requests_per_minute) {
        return Err("requests per minute must be between 1 and 10000".to_owned());
    }
    let server = Server::http(&bind).map_err(|error| format!("cannot bind {bind}: {error}"))?;
    let service = Arc::new(IntakeService::new(
        workspace,
        max_body_bytes,
        requests_per_minute,
    ));
    eprintln!("ilxyr-intake listening on {bind}");
    for request in server.incoming_requests() {
        Arc::clone(&service).serve_request(request);
    }
    Ok(())
}

fn option_value<'a>(
    args: &'a [String],
    index: &mut usize,
    option: &str,
) -> Result<&'a str, String> {
    *index += 1;
    args.get(*index)
        .map(String::as_str)
        .ok_or_else(|| format!("{option} requires a value"))
}

fn parse_or_default<T>(value: Option<&String>, default: T, name: &str) -> Result<T, String>
where
    T: FromStr,
    T::Err: std::fmt::Display,
{
    value.map_or(Ok(default), |value| {
        value
            .parse::<T>()
            .map_err(|error| format!("invalid {name}: {error}"))
    })
}

fn usage() -> String {
    "usage:\n  ilxyr-intake issue <workspace> <authorization-id> [ttl-seconds] [max-rejected-attempts]\n  ilxyr-intake serve <workspace> [--bind <ip:port>] [--max-body-bytes <bytes>] [--requests-per-minute <count>] [--allow-public-bind]"
        .to_owned()
}
