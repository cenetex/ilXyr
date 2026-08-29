use std::{env, fs, path::Path, process::ExitCode};

use ilxyr_core::{
    ActorKind, ActorRef, Certificate, ClaimNode, DsseEnvelope, EpochBudget, EvidenceGraphEdge,
    ExperimentSpec, ExternalRegistrationReceipt, Forecast, FundingCommitment, HuggingFaceModel,
    InteropFormat, LoopCycle, NsrlGateEvidence, NsrlRegistration, ReplicationContract,
    ResearchContribution, Result, RetroRegistrationSpec, SandboxSpec, SharedTaskContract,
    Workspace, allocate_epoch, allocate_replication, authorize_unattended_run, calibration_for,
    claim_status, claim_support, commit_funding, compile_experiment, decide_admission,
    epoch_budget_signing_payload, execute_loop_cycle, experiment_status, export_evidence,
    load_paper_contract, prepare_registration, program_status, record_certificate,
    record_evidence_edge, record_executor_attestation, record_external_registration,
    register_claim, register_epoch_budget, register_nsrl_model, register_replication_contract,
    register_shared_task, retro_register, run_experiment, run_experiment_unattended, run_sandbox,
    settle_replication, submit_contribution, submit_forecast, trust_attestation_key,
    trust_policy_key,
};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::json;

mod family;
mod huggingface;
mod nsrl;

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<()> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    let Some(command) = args.first().map(String::as_str) else {
        usage();
        return Ok(());
    };
    match command {
        "help" | "--help" | "-h" => usage(),
        "init" => {
            require_len(&args, 2, "ilxyr init <workspace>")?;
            Workspace::init(&args[1])?;
            print_json(&json!({ "workspace": args[1], "initialized": true }))?;
        }
        "family" => match args.get(1).map(String::as_str) {
            Some("freeze") => {
                require_len(
                    &args,
                    4,
                    "ilxyr family freeze <workspace> <family-manifest.json>",
                )?;
                let workspace = Workspace::open(&args[2])?;
                print_json(&family::freeze(&workspace, Path::new(&args[3]))?)?;
            }
            Some("check") => {
                require_len(
                    &args,
                    4,
                    "ilxyr family check <workspace> <family-manifest.json>",
                )?;
                let workspace = Workspace::open(&args[2])?;
                print_json(&family::check(&workspace, Path::new(&args[3]))?)?;
            }
            Some("run") => {
                require_len(
                    &args,
                    5,
                    "ilxyr family run <workspace> <family-manifest.json> --execute",
                )?;
                if args[4] != "--execute" {
                    return Err(ilxyr_core::Error::Security(
                        "family run requires the explicit --execute acknowledgement".to_owned(),
                    ));
                }
                let workspace = Workspace::open(&args[2])?;
                let report = family::run(&workspace, Path::new(&args[3]))?;
                let has_errors = report.has_errors();
                print_json(&report)?;
                if has_errors {
                    return Err(ilxyr_core::Error::Execution(
                        "one or more family members could not complete; every member was still attempted"
                            .to_owned(),
                    ));
                }
            }
            Some("settle") => {
                require_len(
                    &args,
                    4,
                    "ilxyr family settle <workspace> <family-manifest.json>",
                )?;
                let workspace = Workspace::open(&args[2])?;
                print_json(&family::settle(&workspace, Path::new(&args[3]))?)?;
            }
            _ => {
                return Err(ilxyr_core::Error::Validation(vec![
                    "usage: ilxyr family <freeze|check|run|settle> ...".to_owned(),
                ]));
            }
        },
        "contribute" => {
            require_len(&args, 3, "ilxyr contribute <workspace> <contribution.json>")?;
            let workspace = Workspace::open(&args[1])?;
            let contribution = read_json::<ResearchContribution>(&args[2])?;
            let artifact_ref = submit_contribution(&workspace, contribution)?;
            print_json(&json!({ "artifact_ref": artifact_ref }))?;
        }
        "compile" => {
            require_len(&args, 3, "ilxyr compile <workspace> <experiment.json>")?;
            let workspace = Workspace::open(&args[1])?;
            let experiment = read_json::<ExperimentSpec>(&args[2])?;
            let artifact_ref = compile_experiment(&workspace, experiment)?;
            print_json(&json!({ "artifact_ref": artifact_ref }))?;
        }
        "preregister-package" => {
            require_len(
                &args,
                3,
                "ilxyr preregister-package <workspace> <experiment-id>",
            )?;
            let workspace = Workspace::open(&args[1])?;
            print_json(&prepare_registration(&workspace, &args[2])?)?;
        }
        "preregister-record" => {
            require_len(
                &args,
                3,
                "ilxyr preregister-record <workspace> <receipt.json>",
            )?;
            let workspace = Workspace::open(&args[1])?;
            let receipt = read_json::<ExternalRegistrationReceipt>(&args[2])?;
            let artifact_ref = record_external_registration(&workspace, receipt)?;
            print_json(&json!({ "artifact_ref": artifact_ref }))?;
        }
        "shared-task-register" => {
            require_len(
                &args,
                3,
                "ilxyr shared-task-register <workspace> <shared-task.json>",
            )?;
            let workspace = Workspace::open(&args[1])?;
            let contract = read_json::<SharedTaskContract>(&args[2])?;
            let artifact_ref = register_shared_task(&workspace, contract)?;
            print_json(&json!({ "artifact_ref": artifact_ref }))?;
        }
        "huggingface-import" => {
            require_min_max(
                &args,
                3,
                4,
                "ilxyr huggingface-import <workspace> <repo-id> [commit-sha]",
            )?;
            let workspace = Workspace::open(&args[1])?;
            let model = huggingface::import_model(&args[2], args.get(3).map(String::as_str))?;
            let artifact_ref = ilxyr_core::register_huggingface_model(&workspace, model.clone())?;
            print_json(&json!({
                "artifact_ref": artifact_ref,
                "model_ref": model.model_ref,
                "weight_ref": model.weight_ref,
                "revision": model.revision
            }))?;
        }
        "huggingface-register" => {
            require_len(
                &args,
                3,
                "ilxyr huggingface-register <workspace> <model.json>",
            )?;
            let workspace = Workspace::open(&args[1])?;
            let model = read_json::<HuggingFaceModel>(&args[2])?;
            let artifact_ref = ilxyr_core::register_huggingface_model(&workspace, model.clone())?;
            print_json(&json!({
                "artifact_ref": artifact_ref,
                "model_ref": model.model_ref,
                "weight_ref": model.weight_ref,
                "revision": model.revision
            }))?;
        }
        "huggingface-show" => {
            require_len(&args, 3, "ilxyr huggingface-show <workspace> <model-ref>")?;
            let workspace = Workspace::open(&args[1])?;
            print_json(&ilxyr_core::registered_huggingface_model(
                &workspace, &args[2],
            )?)?;
        }
        "nsrl-register" => {
            require_len(
                &args,
                5,
                "ilxyr nsrl-register <workspace> <registration.json> <source-root> --execute",
            )?;
            if args[4] != "--execute" {
                return Err(ilxyr_core::Error::Security(
                    "nsrl-register requires the explicit --execute acknowledgement".to_owned(),
                ));
            }
            let workspace = Workspace::open(&args[1])?;
            let registration = read_json::<NsrlRegistration>(&args[2])?;
            let verification = nsrl::verify_local_registration(&registration, Path::new(&args[3]))?;
            let blob_refs =
                nsrl::import_registration_blobs(&workspace, &registration, Path::new(&args[3]))?;
            let refs = register_nsrl_model(&workspace, registration.clone())?;
            print_json(&json!({
                "model_ref": registration.checkpoint.model_ref,
                "weight_ref": registration.checkpoint.weight_ref,
                "registration": refs,
                "blob_refs": blob_refs,
                "local_verification": verification
            }))?;
        }
        "nsrl-show" => {
            require_len(&args, 3, "ilxyr nsrl-show <workspace> <model-ref>")?;
            let workspace = Workspace::open(&args[1])?;
            print_json(&ilxyr_core::registered_nsrl_model(&workspace, &args[2])?)?;
        }
        "nsrl-gate-record" => {
            require_len(
                &args,
                4,
                "ilxyr nsrl-gate-record <workspace> <gate-evidence.json> <evidence-root>",
            )?;
            let workspace = Workspace::open(&args[1])?;
            let evidence = read_json::<NsrlGateEvidence>(&args[2])?;
            let verification =
                nsrl::verify_gate_evidence_artifacts(&evidence, Path::new(&args[3]))?;
            let blob_refs =
                nsrl::import_gate_evidence_blobs(&workspace, &evidence, Path::new(&args[3]))?;
            let artifact_ref = ilxyr_core::record_nsrl_gate_evidence(&workspace, evidence)?;
            print_json(&json!({
                "artifact_ref": artifact_ref,
                "blob_refs": blob_refs,
                "local_verification": verification
            }))?;
        }
        "nsrl-status" => {
            require_len(&args, 3, "ilxyr nsrl-status <workspace> <model-ref>")?;
            let workspace = Workspace::open(&args[1])?;
            print_json(&ilxyr_core::nsrl_status(&workspace, &args[2])?)?;
        }
        "retro" => {
            require_len(
                &args,
                4,
                "ilxyr retro <workspace> <retro-registration.json> --execute",
            )?;
            if args[3] != "--execute" {
                return Err(ilxyr_core::Error::Security(
                    "retro requires the explicit --execute acknowledgement".to_owned(),
                ));
            }
            let workspace = Workspace::open(&args[1])?;
            let spec = read_json::<RetroRegistrationSpec>(&args[2])?;
            print_json(&retro_register(&workspace, spec)?)?;
        }
        "forecast" => {
            require_len(&args, 3, "ilxyr forecast <workspace> <forecast.json>")?;
            let workspace = Workspace::open(&args[1])?;
            let forecast = read_json::<Forecast>(&args[2])?;
            let artifact_ref = submit_forecast(&workspace, forecast)?;
            print_json(&json!({ "artifact_ref": artifact_ref }))?;
        }
        "fund" => {
            require_len(&args, 3, "ilxyr fund <workspace> <funding.json>")?;
            let workspace = Workspace::open(&args[1])?;
            let funding = read_json::<FundingCommitment>(&args[2])?;
            let artifact_ref = commit_funding(&workspace, funding)?;
            print_json(&json!({ "artifact_ref": artifact_ref }))?;
        }
        "trust-key" => {
            require_len(
                &args,
                5,
                "ilxyr trust-key <workspace> <human-id> <key-id> <public-key-base64>",
            )?;
            let workspace = Workspace::open(&args[1])?;
            let key = trust_policy_key(
                &workspace,
                &args[3],
                ActorRef {
                    id: args[2].clone(),
                    kind: ActorKind::Human,
                    model_ref: None,
                },
                args[4].clone(),
            )?;
            print_json(&key)?;
        }
        "trust-attestation-key" => {
            require_len(
                &args,
                5,
                "ilxyr trust-attestation-key <workspace> <service-id> <key-id> <public-key-base64>",
            )?;
            let workspace = Workspace::open(&args[1])?;
            let key = trust_attestation_key(
                &workspace,
                &args[3],
                ActorRef {
                    id: args[2].clone(),
                    kind: ActorKind::Service,
                    model_ref: None,
                },
                args[4].clone(),
            )?;
            print_json(&key)?;
        }
        "budget-payload" => {
            require_len(&args, 2, "ilxyr budget-payload <budget.json>")?;
            let budget = read_json::<EpochBudget>(&args[1])?;
            let payload = epoch_budget_signing_payload(&budget)?;
            println!("{}", String::from_utf8_lossy(&payload));
        }
        "budget-register" => {
            require_len(&args, 3, "ilxyr budget-register <workspace> <budget.json>")?;
            let workspace = Workspace::open(&args[1])?;
            let budget = read_json::<EpochBudget>(&args[2])?;
            let artifact_ref = register_epoch_budget(&workspace, budget)?;
            print_json(&json!({ "artifact_ref": artifact_ref }))?;
        }
        "allocate" => {
            require_min(
                &args,
                4,
                "ilxyr allocate <workspace> <budget-id> <experiment-id>...",
            )?;
            let workspace = Workspace::open(&args[1])?;
            print_json(&allocate_epoch(&workspace, &args[2], &args[3..])?)?;
        }
        "admit" => {
            require_len(&args, 3, "ilxyr admit <workspace> <experiment-id>")?;
            let workspace = Workspace::open(&args[1])?;
            print_json(&decide_admission(&workspace, &args[2])?)?;
        }
        "run" => {
            require_len(&args, 4, "ilxyr run <workspace> <experiment-id> --execute")?;
            if args[3] != "--execute" {
                return Err(ilxyr_core::Error::Security(
                    "run requires the explicit --execute acknowledgement".to_owned(),
                ));
            }
            let workspace = Workspace::open(&args[1])?;
            print_json(&run_experiment(&workspace, &args[2])?)?;
        }
        "authorize" => {
            require_len(
                &args,
                4,
                "ilxyr authorize <workspace> <budget-id> <experiment-id>",
            )?;
            let workspace = Workspace::open(&args[1])?;
            print_json(&authorize_unattended_run(&workspace, &args[2], &args[3])?)?;
        }
        "run-auto" => {
            require_len(
                &args,
                4,
                "ilxyr run-auto <workspace> <budget-id> <experiment-id>",
            )?;
            let workspace = Workspace::open(&args[1])?;
            print_json(&run_experiment_unattended(&workspace, &args[2], &args[3])?)?;
        }
        "loop-cycle" => {
            require_len(
                &args,
                4,
                "ilxyr loop-cycle <workspace> <budget-id> <cycle.json>",
            )?;
            let workspace = Workspace::open(&args[1])?;
            let cycle = read_json::<LoopCycle>(&args[3])?;
            print_json(&execute_loop_cycle(&workspace, &args[2], cycle)?)?;
        }
        "sandbox" => {
            require_len(
                &args,
                4,
                "ilxyr sandbox <workspace> <budget-id> <sandbox-spec.json>",
            )?;
            let workspace = Workspace::open(&args[1])?;
            let spec = read_json::<SandboxSpec>(&args[3])?;
            print_json(&run_sandbox(&workspace, &args[2], spec)?)?;
        }
        "certify" => {
            require_len(&args, 3, "ilxyr certify <workspace> <certificate.json>")?;
            let workspace = Workspace::open(&args[1])?;
            let certificate = read_json::<Certificate>(&args[2])?;
            let artifact_ref = record_certificate(&workspace, certificate)?;
            print_json(&json!({ "artifact_ref": artifact_ref }))?;
        }
        "claim-register" => {
            require_len(&args, 3, "ilxyr claim-register <workspace> <claim.json>")?;
            let workspace = Workspace::open(&args[1])?;
            let claim = read_json::<ClaimNode>(&args[2])?;
            let artifact_ref = register_claim(&workspace, claim)?;
            print_json(&json!({ "artifact_ref": artifact_ref }))?;
        }
        "edge-record" => {
            require_len(&args, 3, "ilxyr edge-record <workspace> <edge.json>")?;
            let workspace = Workspace::open(&args[1])?;
            let edge = read_json::<EvidenceGraphEdge>(&args[2])?;
            let artifact_ref = record_evidence_edge(&workspace, edge)?;
            print_json(&json!({ "artifact_ref": artifact_ref }))?;
        }
        "replication-register" => {
            require_len(
                &args,
                3,
                "ilxyr replication-register <workspace> <contract.json>",
            )?;
            let workspace = Workspace::open(&args[1])?;
            let contract = read_json::<ReplicationContract>(&args[2])?;
            let artifact_ref = register_replication_contract(&workspace, contract)?;
            print_json(&json!({ "artifact_ref": artifact_ref }))?;
        }
        "replication-allocate" => {
            require_len(
                &args,
                4,
                "ilxyr replication-allocate <workspace> <budget-id> <contract-ref>",
            )?;
            let workspace = Workspace::open(&args[1])?;
            print_json(&allocate_replication(&workspace, &args[2], &args[3])?)?;
        }
        "replication-settle" => {
            require_len(
                &args,
                4,
                "ilxyr replication-settle <workspace> <contract-ref> <evidence-ref>",
            )?;
            let workspace = Workspace::open(&args[1])?;
            print_json(&settle_replication(&workspace, &args[2], &args[3])?)?;
        }
        "claim-status" => {
            require_len(&args, 3, "ilxyr claim-status <workspace> <claim-id>")?;
            let workspace = Workspace::open(&args[1])?;
            print_json(&claim_status(&workspace, &args[2])?)?;
        }
        "claim-support" => {
            require_len(&args, 3, "ilxyr claim-support <workspace> <claim-id>")?;
            let workspace = Workspace::open(&args[1])?;
            print_json(&claim_support(&workspace, &args[2])?)?;
        }
        "program-status" => {
            // ilxyr program-status <workspace> [paper-contract.json]
            require_len(
                &args,
                2,
                "ilxyr program-status <workspace> [paper-contract.json]",
            )?;
            let workspace = Workspace::open(&args[1])?;
            let paper = if args.len() == 3 {
                Some(load_paper_contract(std::path::Path::new(&args[2]))?)
            } else {
                None
            };
            print_json(&program_status(&workspace, paper.as_ref())?)?;
        }
        "attest" => {
            require_len(
                &args,
                4,
                "ilxyr attest <workspace> <run-ref> <dsse-envelope.json>",
            )?;
            let workspace = Workspace::open(&args[1])?;
            let envelope = read_json::<DsseEnvelope>(&args[3])?;
            let artifact_ref = record_executor_attestation(&workspace, &args[2], envelope)?;
            print_json(&json!({ "artifact_ref": artifact_ref }))?;
        }
        "calibration" => {
            require_len(&args, 3, "ilxyr calibration <workspace> <actor-handle>")?;
            let workspace = Workspace::open(&args[1])?;
            print_json(&calibration_for(&workspace, &args[2])?)?;
        }
        "status" => {
            require_len(&args, 3, "ilxyr status <workspace> <experiment-id>")?;
            let workspace = Workspace::open(&args[1])?;
            print_json(&experiment_status(&workspace, &args[2])?)?;
        }
        "export-evidence" => {
            require_len(
                &args,
                4,
                "ilxyr export-evidence <workspace> <evidence-ref> <native|ro-crate|in-toto|mlflow>",
            )?;
            let workspace = Workspace::open(&args[1])?;
            let format = args[3].parse::<InteropFormat>()?;
            print_json(&export_evidence(&workspace, &args[2], format)?)?;
        }
        "verify" => {
            require_len(&args, 2, "ilxyr verify <workspace>")?;
            let workspace = Workspace::open(&args[1])?;
            print_json(&workspace.verify()?)?;
        }
        _ => {
            return Err(ilxyr_core::Error::Validation(vec![format!(
                "unknown command {command}"
            )]));
        }
    }
    Ok(())
}

fn read_json<T: DeserializeOwned>(path: impl AsRef<Path>) -> Result<T> {
    let contents = fs::read(path)?;
    Ok(serde_json::from_slice(&contents)?)
}

fn print_json<T: Serialize>(value: &T) -> Result<()> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}

fn require_len(args: &[String], expected: usize, usage: &str) -> Result<()> {
    if args.len() == expected {
        Ok(())
    } else {
        Err(ilxyr_core::Error::Validation(vec![format!(
            "usage: {usage}"
        )]))
    }
}

fn require_min(args: &[String], minimum: usize, usage: &str) -> Result<()> {
    if args.len() >= minimum {
        Ok(())
    } else {
        Err(ilxyr_core::Error::Validation(vec![format!(
            "usage: {usage}"
        )]))
    }
}

fn require_min_max(args: &[String], minimum: usize, maximum: usize, usage: &str) -> Result<()> {
    if (minimum..=maximum).contains(&args.len()) {
        Ok(())
    } else {
        Err(ilxyr_core::Error::Validation(vec![format!(
            "usage: {usage}"
        )]))
    }
}

fn usage() {
    println!(
        "ilxyr v1 — Fund uncertainty. Settle in evidence.\n\n\
         Commands:\n\
           ilxyr init <workspace>\n\
           ilxyr family freeze <workspace> <family-manifest.json>\n\
           ilxyr family check <workspace> <family-manifest.json>\n\
           ilxyr family run <workspace> <family-manifest.json> --execute\n\
           ilxyr family settle <workspace> <family-manifest.json>\n\
           ilxyr contribute <workspace> <contribution.json>\n\
           ilxyr shared-task-register <workspace> <shared-task.json>\n\
           ilxyr huggingface-import <workspace> <repo-id> [commit-sha]\n\
           ilxyr huggingface-register <workspace> <model.json>\n\
           ilxyr huggingface-show <workspace> <model-ref>\n\
           ilxyr nsrl-register <workspace> <registration.json> <source-root> --execute\n\
           ilxyr nsrl-show <workspace> <model-ref>\n\
           ilxyr nsrl-gate-record <workspace> <gate-evidence.json> <evidence-root>\n\
           ilxyr nsrl-status <workspace> <model-ref>\n\
           ilxyr compile <workspace> <experiment.json>\n\
           ilxyr preregister-package <workspace> <experiment-id>\n\
           ilxyr preregister-record <workspace> <receipt.json>\n\
           ilxyr retro <workspace> <retro-registration.json> --execute\n\
           ilxyr forecast <workspace> <forecast.json>\n\
           ilxyr fund <workspace> <funding.json>\n\
           ilxyr trust-key <workspace> <human-id> <key-id> <public-key-base64>\n\
           ilxyr trust-attestation-key <workspace> <service-id> <key-id> <public-key-base64>\n\
           ilxyr budget-payload <budget.json>\n\
           ilxyr budget-register <workspace> <budget.json>\n\
           ilxyr allocate <workspace> <budget-id> <experiment-id>...\n\
           ilxyr admit <workspace> <experiment-id>\n\
           ilxyr run <workspace> <experiment-id> --execute\n\
           ilxyr authorize <workspace> <budget-id> <experiment-id>\n\
           ilxyr run-auto <workspace> <budget-id> <experiment-id>\n\
           ilxyr loop-cycle <workspace> <budget-id> <cycle.json>\n\
           ilxyr sandbox <workspace> <budget-id> <sandbox-spec.json>\n\
           ilxyr certify <workspace> <certificate.json>\n\
           ilxyr claim-register <workspace> <claim.json>\n\
           ilxyr edge-record <workspace> <edge.json>\n\
           ilxyr replication-register <workspace> <contract.json>\n\
           ilxyr replication-allocate <workspace> <budget-id> <contract-ref>\n\
           ilxyr replication-settle <workspace> <contract-ref> <evidence-ref>\n\
           ilxyr claim-status <workspace> <claim-id>\n\
           ilxyr claim-support <workspace> <claim-id>\n\
           ilxyr program-status <workspace> [paper-contract.json]\n\
           ilxyr attest <workspace> <run-ref> <dsse-envelope.json>\n\
           ilxyr calibration <workspace> <actor-handle>\n\
           ilxyr status <workspace> <experiment-id>\n\
           ilxyr export-evidence <workspace> <evidence-ref> <native|ro-crate|in-toto|mlflow>\n\
           ilxyr verify <workspace>"
    );
}
