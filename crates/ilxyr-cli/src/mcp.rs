use std::io::{self, BufRead, Write};

use ilxyr_core::{Error, ResearchRegistry, Result};
use serde_json::{Value, json};

const PROTOCOL_VERSION: &str = "2025-06-18";

pub fn serve(registry: &ResearchRegistry) -> Result<()> {
    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();
    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<Value>(&line) {
            Ok(request) => handle_request(registry, &request),
            Err(error) => Some(json!({
                "jsonrpc": "2.0",
                "id": null,
                "error": { "code": -32700, "message": format!("parse error: {error}") }
            })),
        };
        let Some(response) = response else {
            continue;
        };
        serde_json::to_writer(&mut stdout, &response)?;
        stdout.write_all(b"\n")?;
        stdout.flush()?;
    }
    Ok(())
}

fn handle_request(registry: &ResearchRegistry, request: &Value) -> Option<Value> {
    let id = request.get("id")?.clone();
    let method = request.get("method").and_then(Value::as_str).unwrap_or("");
    let result: Result<Value> = match method {
        "initialize" => Ok(json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": { "name": "ilxyr-discovery", "version": env!("CARGO_PKG_VERSION") },
            "instructions": "Read-only discovery over ilXyr registry records. Registration and lifecycle changes are not exposed."
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tool_definitions() })),
        "tools/call" => Ok(call_tool(
            registry,
            request.get("params").unwrap_or(&Value::Null),
        )),
        _ => {
            return Some(json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": { "code": -32601, "message": format!("method not found: {method}") }
            }));
        }
    };

    Some(match result {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err(error) => json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": -32602, "message": error.to_string() }
        }),
    })
}

fn call_tool(registry: &ResearchRegistry, params: &Value) -> Value {
    match execute_tool(registry, params) {
        Ok(value) => json!({
            "content": [{ "type": "text", "text": serde_json::to_string_pretty(&value).expect("JSON values serialize") }],
            "structuredContent": value,
            "isError": false
        }),
        Err(error) => json!({
            "content": [{ "type": "text", "text": error.to_string() }],
            "isError": true
        }),
    }
}

fn execute_tool(registry: &ResearchRegistry, params: &Value) -> Result<Value> {
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| Error::Validation(vec!["tools/call requires a tool name".to_owned()]))?;
    let arguments = params.get("arguments").unwrap_or(&Value::Null);
    let value = match name {
        "ilxyr.search" => {
            let query = string_argument(arguments, "query")?;
            serde_json::to_value(registry.search(query)?)?
        }
        "ilxyr.status" => {
            let project_id = string_argument(arguments, "project_id")?;
            serde_json::to_value(registry.status(project_id)?)?
        }
        "ilxyr.lineage" => {
            let experiment_id = string_argument(arguments, "experiment_id")?;
            serde_json::to_value(registry.lineage(experiment_id)?)?
        }
        "ilxyr.artifact_metadata" => {
            let artifact_id = string_argument(arguments, "artifact_id")?;
            serde_json::to_value(registry.artifact_metadata(artifact_id)?)?
        }
        _ => {
            return Err(Error::NotFound(format!("MCP tool {name}")));
        }
    };
    Ok(value)
}

fn string_argument<'a>(arguments: &'a Value, name: &str) -> Result<&'a str> {
    arguments
        .get(name)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            Error::Validation(vec![format!("argument {name} must be a non-empty string")])
        })
}

fn tool_definitions() -> Vec<Value> {
    vec![
        tool(
            "ilxyr.search",
            "Find a research project by canonical name, alias, project ID, or experiment ID.",
            "query",
            "Search term such as qwen-sec or FERAL-7B.",
        ),
        tool(
            "ilxyr.status",
            "Return project lifecycle state, completed work, running work, blockers, missing requirements, costs, and evidence references.",
            "project_id",
            "Canonical project ID or exact alias.",
        ),
        tool(
            "ilxyr.lineage",
            "Return the model, corpora, experiment, dispatches, evaluations, and output artifacts joined for one experiment.",
            "experiment_id",
            "Exact experiment ID.",
        ),
        tool(
            "ilxyr.artifact_metadata",
            "Return visibility-safe metadata for an indexed artifact without retrieving its content.",
            "artifact_id",
            "Artifact ID or SHA-256 digest.",
        ),
    ]
}

fn tool(name: &str, description: &str, argument: &str, argument_description: &str) -> Value {
    json!({
        "name": name,
        "description": description,
        "inputSchema": {
            "type": "object",
            "additionalProperties": false,
            "required": [argument],
            "properties": {
                (argument): { "type": "string", "minLength": 1, "description": argument_description }
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exposes_only_the_four_read_tools() {
        let registry = ResearchRegistry::builtin().expect("registry");
        let response = handle_request(
            &registry,
            &json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }),
        )
        .expect("response");
        let tools = response["result"]["tools"].as_array().expect("tools");
        assert_eq!(tools.len(), 4);
        assert!(tools.iter().all(|tool| {
            tool["name"]
                .as_str()
                .is_some_and(|name| name.starts_with("ilxyr."))
        }));
    }

    #[test]
    fn status_tool_returns_the_same_read_model() {
        let registry = ResearchRegistry::builtin().expect("registry");
        let response = handle_request(
            &registry,
            &json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": "ilxyr.status",
                    "arguments": { "project_id": "qwen-sec" }
                }
            }),
        )
        .expect("response");
        assert_eq!(
            response["result"]["structuredContent"]["project"]["project_id"],
            "project://runner-watch/feral-7b-sec"
        );
        assert_eq!(
            response["result"]["structuredContent"]["running"]
                .as_array()
                .expect("running")
                .len(),
            0
        );
    }

    #[test]
    fn notifications_do_not_produce_responses() {
        let registry = ResearchRegistry::builtin().expect("registry");
        assert!(
            handle_request(
                &registry,
                &json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })
            )
            .is_none()
        );
    }

    #[test]
    fn tool_failures_are_mcp_error_results() {
        let registry = ResearchRegistry::builtin().expect("registry");
        let response = handle_request(
            &registry,
            &json!({
                "jsonrpc": "2.0",
                "id": 4,
                "method": "tools/call",
                "params": { "name": "ilxyr.status", "arguments": {} }
            }),
        )
        .expect("response");
        assert_eq!(response["result"]["isError"], true);
        assert!(response.get("error").is_none());
    }
}
