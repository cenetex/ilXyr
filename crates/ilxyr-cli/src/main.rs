use std::{env, fs, path::Path, process::ExitCode};

use ilxyr_core::{
    ActorKind, ActorRef, Certificate, EpochBudget, ExperimentSpec, Forecast, FundingCommitment,
    LoopCycle, ResearchContribution, Result, RetroRegistrationSpec, SandboxSpec,
    SharedTaskContract, Workspace, allocate_epoch, authorize_unattended_run, calibration_for,
    commit_funding, compile_experiment, decide_admission, epoch_budget_signing_payload,
    execute_loop_cycle, experiment_status, record_certificate, register_epoch_budget,
    register_shared_task, retro_register, run_experiment, run_experiment_unattended, run_sandbox,
    submit_contribution, submit_forecast, trust_policy_key,
};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::json;

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

fn usage() {
    println!(
        "ilxyr v1 — Fund uncertainty. Settle in evidence.\n\n\
         Commands:\n\
           ilxyr init <workspace>\n\
           ilxyr contribute <workspace> <contribution.json>\n\
           ilxyr shared-task-register <workspace> <shared-task.json>\n\
           ilxyr compile <workspace> <experiment.json>\n\
           ilxyr retro <workspace> <retro-registration.json> --execute\n\
           ilxyr forecast <workspace> <forecast.json>\n\
           ilxyr fund <workspace> <funding.json>\n\
           ilxyr trust-key <workspace> <human-id> <key-id> <public-key-base64>\n\
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
           ilxyr calibration <workspace> <actor-handle>\n\
           ilxyr status <workspace> <experiment-id>\n\
           ilxyr verify <workspace>"
    );
}
