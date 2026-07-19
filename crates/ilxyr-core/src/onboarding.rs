use serde::{Serialize, de::DeserializeOwned};

use crate::{
    ActorRef, CodePolicy, ComparisonOperator, CompletedRetroRegistration, Evidence, EvidenceLane,
    ExecutionSpec, ExperimentSpec, ExportPolicy, FundingPolicy, LoopCycle, LoopCycleResult,
    OutcomeContract, OutcomeDefinition, OutcomePredicate, ResearchLineage, Result,
    RetroRegistration, RetroRegistrationSpec, SecurityPolicy, SharedTaskContract, WeightClass,
    Workspace, allocate_epoch, autonomy, compile_experiment, executor, run_experiment_unattended,
    store::now_ms, submit_contribution, submit_forecast, validation,
};
use crate::{Error, RunRecord};

const SHARED_TASK_REGISTERED: &str = "SharedTaskRegistered";
const RETRO_PLANNED: &str = "RetroPlanned";
const RETRO_EXECUTION_STARTED: &str = "RetroExecutionStarted";
const RETRO_RUN_COMPLETED: &str = "RetroRunCompleted";
const EVIDENCE_RECORDED: &str = "EvidenceRecorded";
const RETRO_REGISTERED: &str = "RetroRegistered";

pub fn register_shared_task(workspace: &Workspace, contract: SharedTaskContract) -> Result<String> {
    validation::shared_task(&contract)?;
    if let Some(event) = workspace.latest_event(SHARED_TASK_REGISTERED, &contract.id)? {
        let artifact_ref = required_artifact(&event.event_type, event.artifact_ref)?;
        let existing: SharedTaskContract = workspace.get(&artifact_ref)?;
        if existing == contract {
            return Ok(artifact_ref);
        }
        return Err(Error::Conflict(format!(
            "shared task {} is immutable",
            contract.id
        )));
    }
    let artifact_ref = workspace.put(&contract)?;
    workspace.append_event(
        SHARED_TASK_REGISTERED,
        &contract.id,
        ActorRef::service("service://ilxyr/shared-task-registry-v1"),
        Some(artifact_ref.clone()),
    )?;
    Ok(artifact_ref)
}

pub(crate) fn registered_shared_task(
    workspace: &Workspace,
    task_id: &str,
) -> Result<(String, SharedTaskContract)> {
    let event = workspace
        .latest_event(SHARED_TASK_REGISTERED, task_id)?
        .ok_or_else(|| Error::NotFound(format!("shared task {task_id}")))?;
    let artifact_ref = required_artifact(&event.event_type, event.artifact_ref)?;
    let contract = workspace.get(&artifact_ref)?;
    Ok((artifact_ref, contract))
}

pub fn retro_register(
    workspace: &Workspace,
    spec: RetroRegistrationSpec,
) -> Result<CompletedRetroRegistration> {
    validation::retro_registration(&spec)?;
    autonomy::ensure_authority_artifacts_exist(workspace, &spec.authority)?;
    let aggregate_id = retro_aggregate_id(&spec.id);
    let shared_task_ref = validate_retro_shared_task(workspace, &spec)?;
    let plan_ref = freeze_retro_plan(workspace, &aggregate_id, &spec)?;

    if let Some(registration) =
        latest_typed::<RetroRegistration>(workspace, RETRO_REGISTERED, &aggregate_id)?
    {
        return load_completed_retro(workspace, &spec, registration);
    }

    let (run_ref, run) = if let Some(existing) =
        latest_typed_with_ref::<RunRecord>(workspace, RETRO_RUN_COMPLETED, &aggregate_id)?
    {
        existing
    } else {
        if workspace
            .latest_event(RETRO_EXECUTION_STARTED, &aggregate_id)?
            .is_some()
        {
            return Err(Error::Conflict(format!(
                "retro replay {} started without a terminal run; human acknowledgement is required",
                spec.id
            )));
        }
        let runner = ActorRef::service("service://ilxyr/retro-replay-v1");
        workspace.append_event(RETRO_EXECUTION_STARTED, &aggregate_id, runner.clone(), None)?;
        let run = executor::execute_local(&retro_execution_spec(&spec), workspace.root())?;
        let run_ref = workspace.put(&run)?;
        workspace.append_event(
            RETRO_RUN_COMPLETED,
            &aggregate_id,
            runner,
            Some(run_ref.clone()),
        )?;
        (run_ref, run)
    };

    validate_retro_run(&spec, &run)?;

    if run.exit_code != 0 || run.timed_out {
        return Err(Error::Execution(format!(
            "retro replay {} failed with exit code {}{}",
            spec.id,
            run.exit_code,
            if run.timed_out { " after timeout" } else { "" }
        )));
    }
    if let Some(output_error) = &run.output_error {
        return Err(Error::Execution(format!(
            "retro replay {} did not satisfy its metric contract: {output_error}",
            spec.id
        )));
    }
    if run.source_attestation.as_ref() != Some(&spec.source) {
        return Err(Error::Execution(format!(
            "retro replay {} did not attest the exact frozen source snapshot",
            spec.id
        )));
    }

    let evidence = if let Some(existing) =
        latest_typed::<Evidence>(workspace, EVIDENCE_RECORDED, &aggregate_id)?
    {
        validate_retro_evidence(&existing, &run_ref, &run)?;
        existing
    } else {
        let mut authority = spec.authority.clone();
        add_authority_artifact(&mut authority, &plan_ref);
        if let Some(shared_task_ref) = &shared_task_ref {
            add_authority_artifact(&mut authority, shared_task_ref);
        }
        add_authority_artifact(&mut authority, &run_ref);
        let evidence = Evidence {
            schema: "ilxyr.evidence.v1".to_owned(),
            id: format!("evidence:retro:{}", spec.id),
            experiment_id: aggregate_id.clone(),
            run_ref: run_ref.clone(),
            resolved_outcome: "retro_grounded".to_owned(),
            metrics: run.metrics.clone(),
            recorded_at_ms: now_ms()?,
            authority,
            lane: EvidenceLane::Retro,
        };
        let evidence_ref = workspace.put(&evidence)?;
        workspace.append_event(
            EVIDENCE_RECORDED,
            &aggregate_id,
            ActorRef::service("service://ilxyr/retro-resolver-v1"),
            Some(evidence_ref),
        )?;
        evidence
    };
    let evidence_ref = latest_artifact_ref(workspace, EVIDENCE_RECORDED, &aggregate_id)?;
    let registration = RetroRegistration {
        schema: "ilxyr.retro_registration.v1".to_owned(),
        id: spec.id.clone(),
        claim: spec.claim.clone(),
        family: spec.family.clone(),
        plan_ref,
        run_ref,
        evidence_ref,
        grounded: true,
        forecast_risked: false,
        registered_at_ms: now_ms()?,
    };
    let registration_ref = workspace.put(&registration)?;
    workspace.append_event(
        RETRO_REGISTERED,
        &aggregate_id,
        ActorRef::service("service://ilxyr/retro-registry-v1"),
        Some(registration_ref),
    )?;
    Ok(CompletedRetroRegistration {
        run,
        evidence,
        registration,
    })
}

pub fn execute_loop_cycle(
    workspace: &Workspace,
    budget_id: &str,
    cycle: LoopCycle,
) -> Result<LoopCycleResult> {
    if cycle.schema != "ilxyr.loop_cycle.v1" {
        return Err(Error::Validation(vec![format!(
            "loop cycle schema must be ilxyr.loop_cycle.v1, got {}",
            cycle.schema
        )]));
    }
    let experiment_id = cycle.experiment.id.clone();
    let contribution_ids = cycle
        .contributions
        .iter()
        .map(|contribution| contribution.id.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    let lineage_ids = [
        cycle.experiment.lineage.hypothesis.as_str(),
        cycle.experiment.lineage.mathematical_foundation.as_str(),
        cycle.experiment.lineage.engineering_review.as_str(),
        cycle.experiment.lineage.experiment_design.as_str(),
    ];
    if !lineage_ids
        .iter()
        .all(|lineage_id| contribution_ids.contains(lineage_id))
    {
        return Err(Error::Validation(vec![
            "loop cycle must include every contribution referenced by experiment lineage"
                .to_owned(),
        ]));
    }
    for contribution in &cycle.contributions {
        ensure_exact_object(
            workspace,
            "ContributionSubmitted",
            &contribution.id,
            contribution,
            || submit_contribution(workspace, contribution.clone()),
        )?;
    }
    let compiled_ref =
        if let Some(event) = workspace.latest_event("ExperimentCompiled", &experiment_id)? {
            let artifact_ref = required_artifact(&event.event_type, event.artifact_ref)?;
            let compiled: crate::CompiledExperiment = workspace.get(&artifact_ref)?;
            if compiled.source_digest != Workspace::digest(&cycle.experiment)? {
                return Err(Error::Conflict(format!(
                    "loop experiment {experiment_id} does not match its frozen compilation"
                )));
            }
            artifact_ref
        } else {
            compile_experiment(workspace, cycle.experiment.clone())?
        };

    let mut forecast_refs = Vec::new();
    for forecast in &cycle.forecasts {
        if forecast.experiment_id != experiment_id {
            return Err(Error::Validation(vec![format!(
                "loop forecast {} belongs to {}, expected {experiment_id}",
                forecast.id, forecast.experiment_id
            )]));
        }
        forecast_refs.push(ensure_exact_object(
            workspace,
            "ForecastSubmitted",
            &forecast.id,
            forecast,
            || submit_forecast(workspace, forecast.clone()),
        )?);
    }

    let allocation = if workspace
        .latest_event("ExecutionStarted", &experiment_id)?
        .is_none()
    {
        let report = allocate_epoch(workspace, budget_id, std::slice::from_ref(&experiment_id))?;
        let allocated = report
            .decisions
            .iter()
            .find(|decision| decision.experiment_id == experiment_id)
            .is_some_and(|decision| decision.allocated);
        if !allocated {
            let detail = report
                .decisions
                .iter()
                .find(|decision| decision.experiment_id == experiment_id)
                .map_or("allocator returned no decision", |decision| {
                    decision.detail.as_str()
                });
            return Err(Error::Conflict(format!(
                "loop could not allocate {experiment_id}: {detail}"
            )));
        }
        Some(report)
    } else {
        None
    };
    let completed = run_experiment_unattended(workspace, budget_id, &experiment_id)?;
    Ok(LoopCycleResult {
        experiment_id,
        compiled_ref,
        forecast_refs,
        allocation,
        completed,
    })
}

fn validate_retro_shared_task(
    workspace: &Workspace,
    spec: &RetroRegistrationSpec,
) -> Result<Option<String>> {
    let Some(task_id) = &spec.shared_task_id else {
        return Ok(None);
    };
    let (task_ref, task) = registered_shared_task(workspace, task_id)?;
    if task.seeds != spec.seeds {
        return Err(Error::Validation(vec![
            "retro-registration seeds do not match the shared task".to_owned(),
        ]));
    }
    if task.metrics != spec.metrics {
        return Err(Error::Validation(vec![
            "retro-registration metric definitions do not match the shared task".to_owned(),
        ]));
    }
    if !task
        .family_bindings
        .iter()
        .any(|binding| binding.family == spec.family)
    {
        return Err(Error::Validation(vec![
            "retro-registration family is not bound by the shared task".to_owned(),
        ]));
    }
    if spec.authority.scope.eval_set.as_deref() != Some(task.eval_set.handle.as_str()) {
        return Err(Error::Validation(vec![
            "retro-registration authority eval_set does not match the shared task".to_owned(),
        ]));
    }
    Ok(Some(task_ref))
}

fn freeze_retro_plan(
    workspace: &Workspace,
    aggregate_id: &str,
    spec: &RetroRegistrationSpec,
) -> Result<String> {
    if let Some(event) = workspace.latest_event(RETRO_PLANNED, aggregate_id)? {
        let artifact_ref = required_artifact(&event.event_type, event.artifact_ref)?;
        let existing: RetroRegistrationSpec = workspace.get(&artifact_ref)?;
        if existing == *spec {
            return Ok(artifact_ref);
        }
        return Err(Error::Conflict(format!(
            "retro-registration plan {} is immutable",
            spec.id
        )));
    }
    let artifact_ref = workspace.put(spec)?;
    workspace.append_event(
        RETRO_PLANNED,
        aggregate_id,
        ActorRef::service("service://ilxyr/retro-registry-v1"),
        Some(artifact_ref.clone()),
    )?;
    Ok(artifact_ref)
}

fn retro_execution_spec(spec: &RetroRegistrationSpec) -> ExperimentSpec {
    ExperimentSpec {
        schema: "ilxyr.experiment.v1".to_owned(),
        id: retro_aggregate_id(&spec.id),
        title: spec.claim.clone(),
        hypothesis: spec.claim.clone(),
        rationale: "deterministic replay of a frozen prior claim".to_owned(),
        proposer: ActorRef::service("service://ilxyr/retro-registry-v1"),
        family: Some(spec.family.clone()),
        shared_task_id: None,
        lineage: ResearchLineage {
            hypothesis: "retro".to_owned(),
            mathematical_foundation: "retro".to_owned(),
            engineering_review: "retro".to_owned(),
            experiment_design: "retro".to_owned(),
        },
        baseline: "evidence://historical/frozen".to_owned(),
        datasets: Vec::new(),
        models: Vec::new(),
        metrics: spec.metrics.clone(),
        seeds: spec.seeds.clone(),
        outcome_contract: OutcomeContract {
            primary_metric: spec.metrics[0].name.clone(),
            success_outcome: "replayed".to_owned(),
            outcomes: vec![
                OutcomeDefinition {
                    id: "replayed".to_owned(),
                    description: "frozen replay completed".to_owned(),
                    predicate: OutcomePredicate::Metric {
                        metric: spec.metrics[0].name.clone(),
                        operator: ComparisonOperator::Gte,
                        threshold: f64::MIN,
                    },
                },
                OutcomeDefinition {
                    id: "execution_failure".to_owned(),
                    description: "replay process failed".to_owned(),
                    predicate: OutcomePredicate::ExecutionFailure,
                },
            ],
        },
        execution: ExecutionSpec {
            executor: "local-command".to_owned(),
            program: spec.replay.program.clone(),
            args: spec.replay.args.clone(),
            timeout_seconds: spec.replay.timeout_seconds,
            max_cost_credits: 1,
            network: spec.replay.network.clone(),
        },
        funding: FundingPolicy {
            required_compute_credits: 1,
            minimum_forecasters: 1,
            minimum_total_stake: 1,
        },
        security: SecurityPolicy {
            weight_class: WeightClass::Public,
            code_policy: CodePolicy::Arbitrary,
            export_policy: ExportPolicy::Artifacts,
        },
        evidence_authority: spec.authority.clone(),
        expected_outputs: spec
            .metrics
            .iter()
            .map(|metric| format!("metrics.{}", metric.name))
            .collect(),
    }
}

fn load_completed_retro(
    workspace: &Workspace,
    spec: &RetroRegistrationSpec,
    registration: RetroRegistration,
) -> Result<CompletedRetroRegistration> {
    let expected_plan_ref = format!("artifact://sha256/{}", Workspace::digest(spec)?);
    if registration.id != spec.id
        || registration.claim != spec.claim
        || registration.family != spec.family
        || registration.plan_ref != expected_plan_ref
        || !registration.grounded
        || registration.forecast_risked
    {
        return Err(Error::Conflict(format!(
            "retro-registration {} does not match its frozen plan",
            spec.id
        )));
    }
    let run: RunRecord = workspace.get(&registration.run_ref)?;
    let evidence: Evidence = workspace.get(&registration.evidence_ref)?;
    validate_retro_run(spec, &run)?;
    if run.source_attestation.as_ref() != Some(&spec.source) {
        return Err(Error::Conflict(format!(
            "completed retro run {} does not attest its frozen source snapshot",
            run.id
        )));
    }
    validate_retro_evidence(&evidence, &registration.run_ref, &run)?;
    Ok(CompletedRetroRegistration {
        run,
        evidence,
        registration,
    })
}

fn validate_retro_evidence(existing: &Evidence, run_ref: &str, run: &RunRecord) -> Result<()> {
    if existing.run_ref != run_ref
        || existing.experiment_id != run.experiment_id
        || existing.metrics != run.metrics
        || existing.resolved_outcome != "retro_grounded"
        || existing.lane != EvidenceLane::Retro
    {
        return Err(Error::Conflict(
            "recorded retro evidence does not match the completed replay".to_owned(),
        ));
    }
    Ok(())
}

fn validate_retro_run(spec: &RetroRegistrationSpec, run: &RunRecord) -> Result<()> {
    if run.experiment_id != retro_aggregate_id(&spec.id) {
        return Err(Error::Conflict(format!(
            "completed retro run {} belongs to {}",
            run.id, run.experiment_id
        )));
    }
    Ok(())
}

fn ensure_exact_object<T: Serialize + DeserializeOwned>(
    workspace: &Workspace,
    event_type: &str,
    id: &str,
    expected: &T,
    create: impl FnOnce() -> Result<String>,
) -> Result<String> {
    if let Some(event) = workspace.latest_event(event_type, id)? {
        let artifact_ref = required_artifact(&event.event_type, event.artifact_ref)?;
        let expected_ref = format!("artifact://sha256/{}", Workspace::digest(expected)?);
        if artifact_ref == expected_ref {
            let _: T = workspace.get(&artifact_ref)?;
            return Ok(artifact_ref);
        }
        return Err(Error::Conflict(format!(
            "{event_type} object {id} does not match the frozen loop input"
        )));
    }
    create()
}

fn latest_typed<T: DeserializeOwned>(
    workspace: &Workspace,
    event_type: &str,
    aggregate_id: &str,
) -> Result<Option<T>> {
    workspace
        .latest_event(event_type, aggregate_id)?
        .map(|event| {
            let artifact_ref = required_artifact(&event.event_type, event.artifact_ref)?;
            workspace.get(&artifact_ref)
        })
        .transpose()
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

fn latest_artifact_ref(
    workspace: &Workspace,
    event_type: &str,
    aggregate_id: &str,
) -> Result<String> {
    let event = workspace
        .latest_event(event_type, aggregate_id)?
        .ok_or_else(|| Error::NotFound(format!("{event_type} for {aggregate_id}")))?;
    required_artifact(&event.event_type, event.artifact_ref)
}

fn required_artifact(event_type: &str, artifact_ref: Option<String>) -> Result<String> {
    artifact_ref.ok_or_else(|| {
        Error::Conflict(format!(
            "{event_type} event is missing its artifact reference"
        ))
    })
}

fn add_authority_artifact(authority: &mut crate::GroundingAuthority, artifact_ref: &str) {
    if !authority
        .provenance
        .artifact_hashes
        .iter()
        .any(|artifact| artifact == artifact_ref)
    {
        authority
            .provenance
            .artifact_hashes
            .push(artifact_ref.to_owned());
        authority.provenance.artifact_hashes.sort();
    }
}

fn retro_aggregate_id(id: &str) -> String {
    format!("retro:{id}")
}
