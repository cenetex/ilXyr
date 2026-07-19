use std::collections::{BTreeMap, BTreeSet};

use serde::de::DeserializeOwned;

use crate::{
    ActorKind, ActorRef, AdmissionDecision, CodePolicy, ComparisonOperator, CompiledExperiment,
    CompletedExperiment, ContributionStage, Error, Evidence, EvidenceLane, ExperimentSpec,
    ExperimentStatus, ExportPolicy, Forecast, ForecastSettlement, FundingCommitment, GateCheck,
    OutcomePredicate, ResearchContribution, Result, RunRecord, SharedTaskContract, WeightClass,
    Workspace, autonomy, executor, onboarding, store::now_ms, validation,
};

const CONTRIBUTION_SUBMITTED: &str = "ContributionSubmitted";
const EXPERIMENT_COMPILED: &str = "ExperimentCompiled";
const FORECAST_SUBMITTED: &str = "ForecastSubmitted";
const FUNDING_COMMITTED: &str = "FundingCommitted";
const ADMISSION_DECIDED: &str = "AdmissionDecided";
const EXECUTION_STARTED: &str = "ExecutionStarted";
const EXPERIMENT_COMPLETED: &str = "ExperimentCompleted";
const EVIDENCE_RECORDED: &str = "EvidenceRecorded";
const FORECAST_SETTLED: &str = "ForecastSettled";

pub fn submit_contribution(
    workspace: &Workspace,
    contribution: ResearchContribution,
) -> Result<String> {
    validation::contribution(&contribution)?;
    ensure_unique_id(workspace, CONTRIBUTION_SUBMITTED, &contribution.id)?;
    let artifact_ref = workspace.put(&contribution)?;
    workspace.append_event(
        CONTRIBUTION_SUBMITTED,
        &contribution.id,
        contribution.actor.clone(),
        Some(artifact_ref.clone()),
    )?;
    Ok(artifact_ref)
}

pub fn compile_experiment(workspace: &Workspace, spec: ExperimentSpec) -> Result<String> {
    validation::experiment(&spec)?;
    autonomy::ensure_authority_artifacts_exist(workspace, &spec.evidence_authority)?;
    ensure_unique_id(workspace, EXPERIMENT_COMPILED, &spec.id)?;
    let stages = [
        (
            "hypothesis",
            &spec.lineage.hypothesis,
            ContributionStage::Hypothesis,
        ),
        (
            "mathematical_foundation",
            &spec.lineage.mathematical_foundation,
            ContributionStage::MathematicalFoundation,
        ),
        (
            "engineering_review",
            &spec.lineage.engineering_review,
            ContributionStage::EngineeringReview,
        ),
        (
            "experiment_design",
            &spec.lineage.experiment_design,
            ContributionStage::ExperimentDesign,
        ),
    ];
    let mut resolved_lineage = BTreeMap::new();
    for (name, contribution_id, expected_stage) in stages {
        let event = workspace
            .latest_event(CONTRIBUTION_SUBMITTED, contribution_id)?
            .ok_or_else(|| Error::NotFound(format!("contribution {contribution_id}")))?;
        let artifact_ref = required_artifact(&event.event_type, event.artifact_ref)?;
        let contribution: ResearchContribution = workspace.get(&artifact_ref)?;
        if contribution.stage != expected_stage {
            return Err(Error::Validation(vec![format!(
                "lineage.{name} points to {:?}, expected {:?}",
                contribution.stage, expected_stage
            )]));
        }
        resolved_lineage.insert(name.to_owned(), artifact_ref);
    }

    let shared_task = spec
        .shared_task_id
        .as_deref()
        .map(|task_id| onboarding::registered_shared_task(workspace, task_id))
        .transpose()?;
    if let Some((_, contract)) = &shared_task {
        validate_shared_task_experiment(&spec, contract)?;
    }

    let source_digest = Workspace::digest(&spec)?;
    let proposer = spec.proposer.clone();
    let experiment_id = spec.id.clone();
    let mut evidence_authority = spec.evidence_authority.clone();
    for artifact_ref in resolved_lineage.values() {
        if !evidence_authority
            .provenance
            .artifact_hashes
            .contains(artifact_ref)
        {
            evidence_authority
                .provenance
                .artifact_hashes
                .push(artifact_ref.clone());
        }
    }
    let shared_task_ref = shared_task.map(|(artifact_ref, _)| artifact_ref);
    if let Some(artifact_ref) = &shared_task_ref {
        if !evidence_authority
            .provenance
            .artifact_hashes
            .contains(artifact_ref)
        {
            evidence_authority
                .provenance
                .artifact_hashes
                .push(artifact_ref.clone());
        }
    }
    evidence_authority.provenance.artifact_hashes.sort();
    let compiled = CompiledExperiment {
        schema: "ilxyr.compiled_experiment.v1".to_owned(),
        spec,
        source_digest,
        resolved_lineage,
        shared_task_ref,
        evidence_authority,
    };
    let artifact_ref = workspace.put(&compiled)?;
    workspace.append_event(
        EXPERIMENT_COMPILED,
        &experiment_id,
        proposer,
        Some(artifact_ref.clone()),
    )?;
    Ok(artifact_ref)
}

fn validate_shared_task_experiment(
    spec: &ExperimentSpec,
    contract: &SharedTaskContract,
) -> Result<()> {
    let family = spec.family.as_ref().ok_or_else(|| {
        Error::Validation(vec![
            "experiment.family is required for a shared task".to_owned(),
        ])
    })?;
    let binding = contract
        .family_bindings
        .iter()
        .find(|binding| &binding.family == family)
        .ok_or_else(|| {
            Error::Validation(vec![
                "experiment family is not bound by the shared task".to_owned(),
            ])
        })?;
    if actor_identity(&spec.proposer) != actor_identity(&binding.designated_proposer) {
        return Err(Error::Validation(vec![format!(
            "experiment proposer must be the designated {:?} proposer {}",
            family,
            actor_identity(&binding.designated_proposer)
        )]));
    }
    if !spec.datasets.contains(&contract.dataset.handle)
        || !spec.datasets.contains(&contract.eval_set.handle)
    {
        return Err(Error::Validation(vec![
            "experiment datasets must include the shared task dataset and eval set".to_owned(),
        ]));
    }
    if spec.seeds != contract.seeds {
        return Err(Error::Validation(vec![
            "experiment seeds do not match the shared task".to_owned(),
        ]));
    }
    if spec.metrics != contract.metrics {
        return Err(Error::Validation(vec![
            "experiment metric definitions do not match the shared task".to_owned(),
        ]));
    }
    if spec.evidence_authority.scope.eval_set.as_deref() != Some(contract.eval_set.handle.as_str())
    {
        return Err(Error::Validation(vec![
            "experiment evidence authority eval set does not match the shared task".to_owned(),
        ]));
    }
    Ok(())
}

pub fn submit_forecast(workspace: &Workspace, forecast: Forecast) -> Result<String> {
    ensure_unique_id(workspace, FORECAST_SUBMITTED, &forecast.id)?;
    let compiled = load_compiled(workspace, &forecast.experiment_id)?;
    ensure_inputs_open(workspace, &forecast.experiment_id)?;
    validation::forecast(&forecast, &compiled.spec)?;
    let forecaster_identity = actor_identity(&forecast.forecaster);
    if forecasts_for(workspace, &forecast.experiment_id)?
        .iter()
        .any(|existing| actor_identity(&existing.forecaster) == forecaster_identity)
    {
        return Err(Error::Conflict(format!(
            "forecaster {forecaster_identity} already submitted a forecast for {}",
            forecast.experiment_id
        )));
    }
    let artifact_ref = workspace.put(&forecast)?;
    workspace.append_event(
        FORECAST_SUBMITTED,
        &forecast.id,
        forecast.forecaster.clone(),
        Some(artifact_ref.clone()),
    )?;
    Ok(artifact_ref)
}

pub fn commit_funding(workspace: &Workspace, commitment: FundingCommitment) -> Result<String> {
    ensure_unique_id(workspace, FUNDING_COMMITTED, &commitment.id)?;
    let compiled = load_compiled(workspace, &commitment.experiment_id)?;
    ensure_inputs_open(workspace, &commitment.experiment_id)?;
    validation::funding(&commitment, &compiled.spec)?;
    let artifact_ref = workspace.put(&commitment)?;
    workspace.append_event(
        FUNDING_COMMITTED,
        &commitment.id,
        commitment.funder.clone(),
        Some(artifact_ref.clone()),
    )?;
    Ok(artifact_ref)
}

pub fn decide_admission(workspace: &Workspace, experiment_id: &str) -> Result<AdmissionDecision> {
    if workspace
        .latest_event(EXECUTION_STARTED, experiment_id)?
        .is_some()
    {
        return Err(Error::Conflict(format!(
            "experiment {experiment_id} has already started execution"
        )));
    }
    if let Some(decision) =
        latest_typed::<AdmissionDecision>(workspace, ADMISSION_DECIDED, experiment_id)?
    {
        if decision.accepted {
            return Ok(decision);
        }
    }
    let compiled = load_compiled(workspace, experiment_id)?;
    let checks = evaluate_admission(workspace, &compiled)?;
    let accepted = checks.iter().all(|gate| gate.passed);
    let decision = AdmissionDecision {
        schema: "ilxyr.admission.v1".to_owned(),
        experiment_id: experiment_id.to_owned(),
        accepted,
        checks,
        decided_at_ms: now_ms()?,
    };
    let artifact_ref = workspace.put(&decision)?;
    workspace.append_event(
        ADMISSION_DECIDED,
        experiment_id,
        ActorRef::service("service://ilxyr/admission-v1"),
        Some(artifact_ref),
    )?;
    Ok(decision)
}

fn evaluate_admission(
    workspace: &Workspace,
    compiled: &CompiledExperiment,
) -> Result<Vec<GateCheck>> {
    let experiment_id = &compiled.spec.id;
    let forecasts = forecasts_for(workspace, experiment_id)?;
    let commitments = funding_for(workspace, experiment_id)?;
    let distinct_forecasters = forecasts
        .iter()
        .map(|forecast| actor_identity(&forecast.forecaster))
        .collect::<BTreeSet<_>>()
        .len();
    let total_stake = checked_total(
        forecasts.iter().map(|forecast| forecast.stake),
        "forecast stake",
    )?;
    let total_funding = checked_total(
        commitments
            .iter()
            .map(|commitment| commitment.compute_credits),
        "compute funding",
    )?;
    let spec = &compiled.spec;

    Ok(vec![
        check(
            "methodology",
            compiled.resolved_lineage.len() == 4,
            format!(
                "{}/4 required research stages resolved",
                compiled.resolved_lineage.len()
            ),
        ),
        check(
            "outcome_contract",
            spec.outcome_contract.outcomes.len() >= 2,
            format!(
                "{} frozen mutually evaluated outcomes declared",
                spec.outcome_contract.outcomes.len()
            ),
        ),
        check(
            "forecast_participation",
            distinct_forecasters >= spec.funding.minimum_forecasters,
            format!(
                "{distinct_forecasters}/{} distinct forecasters",
                spec.funding.minimum_forecasters
            ),
        ),
        check(
            "forecast_stake",
            total_stake >= spec.funding.minimum_total_stake,
            format!(
                "{total_stake}/{} forecast credits staked",
                spec.funding.minimum_total_stake
            ),
        ),
        check(
            "compute_funding",
            total_funding >= spec.funding.required_compute_credits,
            format!(
                "{total_funding}/{} compute credits committed",
                spec.funding.required_compute_credits
            ),
        ),
        check(
            "executor_available",
            spec.execution.executor == "local-command",
            if spec.execution.executor == "local-command" {
                "local-command adapter is installed".to_owned()
            } else {
                format!("{} adapter is not installed", spec.execution.executor)
            },
        ),
        check(
            "weight_protection",
            spec.security.weight_class == WeightClass::Public,
            if spec.security.weight_class == WeightClass::Public {
                "local execution is limited to public-weight handles".to_owned()
            } else {
                "protected weights require a future attested executor".to_owned()
            },
        ),
        check(
            "local_execution_policy",
            spec.execution.network == crate::NetworkPolicy::Open
                && std::path::Path::new(&spec.execution.program).is_absolute(),
            "local execution requires network=open and an absolute executable path".to_owned(),
        ),
        check(
            "code_policy",
            spec.security.code_policy == CodePolicy::Arbitrary,
            if spec.security.code_policy == CodePolicy::Arbitrary {
                "local-command directly executes the declared program".to_owned()
            } else {
                "approved-image-only execution requires a future image executor".to_owned()
            },
        ),
        check(
            "export_policy",
            spec.security.export_policy == ExportPolicy::Artifacts,
            if spec.security.export_policy == ExportPolicy::Artifacts {
                "local-command records stdout, stderr, and metric artifacts".to_owned()
            } else {
                "local-command cannot enforce restricted output export".to_owned()
            },
        ),
        role_separation_check(workspace, compiled, &forecasts, true)?,
        role_separation_check(workspace, compiled, &forecasts, false)?,
    ])
}

pub fn run_experiment(workspace: &Workspace, experiment_id: &str) -> Result<CompletedExperiment> {
    let compiled = load_compiled(workspace, experiment_id)?;
    if let Some((run_ref, run)) =
        latest_typed_with_ref::<RunRecord>(workspace, EXPERIMENT_COMPLETED, experiment_id)?
    {
        return finalize_completed_run(workspace, &compiled, run_ref, run);
    }
    let admission = latest_typed::<AdmissionDecision>(workspace, ADMISSION_DECIDED, experiment_id)?
        .ok_or_else(|| Error::Conflict("experiment has no admission decision".to_owned()))?;
    if admission.experiment_id != experiment_id || !admission.accepted {
        return Err(Error::Conflict(
            "latest admission decision rejected this experiment".to_owned(),
        ));
    }
    let current_checks = evaluate_admission(workspace, &compiled)?;
    if current_checks.iter().any(|gate| !gate.passed) {
        return Err(Error::Conflict(
            "experiment no longer satisfies local admission gates".to_owned(),
        ));
    }
    let runner = ActorRef::service("service://ilxyr/local-executor-v1");
    workspace.append_event(EXECUTION_STARTED, experiment_id, runner.clone(), None)?;
    let run = executor::execute_local(&compiled.spec, workspace.root())?;
    let run_ref = workspace.put(&run)?;
    workspace.append_event(
        EXPERIMENT_COMPLETED,
        experiment_id,
        runner,
        Some(run_ref.clone()),
    )?;

    finalize_completed_run(workspace, &compiled, run_ref, run)
}

fn finalize_completed_run(
    workspace: &Workspace,
    compiled: &CompiledExperiment,
    run_ref: String,
    run: RunRecord,
) -> Result<CompletedExperiment> {
    let experiment_id = &compiled.spec.id;
    if run.experiment_id != *experiment_id {
        return Err(Error::Conflict(format!(
            "completed run {} belongs to {}, expected {experiment_id}",
            run.id, run.experiment_id
        )));
    }
    let resolved_outcome = resolve_outcome(&compiled.spec, &run)?;
    let expected_evidence = Evidence {
        schema: "ilxyr.evidence.v1".to_owned(),
        id: format!("evidence:{}", run.id),
        experiment_id: experiment_id.clone(),
        run_ref: run_ref.clone(),
        resolved_outcome: resolved_outcome.clone(),
        metrics: run.metrics.clone(),
        recorded_at_ms: now_ms()?,
        authority: autonomy::evidence_authority_for_run(&compiled.evidence_authority, &run_ref),
        lane: EvidenceLane::Promoted,
    };
    let evidence = if let Some(existing) =
        latest_typed::<Evidence>(workspace, EVIDENCE_RECORDED, experiment_id)?
    {
        validate_existing_evidence(&existing, &expected_evidence)?;
        existing
    } else {
        let evidence_ref = workspace.put(&expected_evidence)?;
        workspace.append_event(
            EVIDENCE_RECORDED,
            experiment_id,
            ActorRef::service("service://ilxyr/resolver-v1"),
            Some(evidence_ref),
        )?;
        expected_evidence
    };

    let forecasts = forecasts_for(workspace, experiment_id)?;
    let mut settlements = Vec::new();
    for forecast in &forecasts {
        let expected = settle_forecast(forecast, &resolved_outcome);
        let settlement = if let Some(existing) =
            latest_typed::<ForecastSettlement>(workspace, FORECAST_SETTLED, &forecast.id)?
        {
            validate_existing_settlement(&existing, &expected)?;
            existing
        } else {
            let artifact_ref = workspace.put(&expected)?;
            workspace.append_event(
                FORECAST_SETTLED,
                &forecast.id,
                ActorRef::service("service://ilxyr/scoring-v1"),
                Some(artifact_ref),
            )?;
            expected
        };
        settlements.push(settlement);
    }
    let calibrations = autonomy::refresh_calibrations(workspace, &forecasts)?;

    Ok(CompletedExperiment {
        run,
        evidence,
        settlements,
        calibrations,
    })
}

fn validate_existing_evidence(existing: &Evidence, expected: &Evidence) -> Result<()> {
    if existing.schema != expected.schema
        || existing.id != expected.id
        || existing.experiment_id != expected.experiment_id
        || existing.run_ref != expected.run_ref
        || existing.resolved_outcome != expected.resolved_outcome
        || existing.metrics != expected.metrics
        || existing.authority != expected.authority
        || existing.lane != EvidenceLane::Promoted
    {
        return Err(Error::Conflict(format!(
            "recorded evidence {} does not match completed run",
            existing.id
        )));
    }
    Ok(())
}

fn role_separation_check(
    workspace: &Workspace,
    compiled: &CompiledExperiment,
    forecasts: &[Forecast],
    reviewer: bool,
) -> Result<GateCheck> {
    let proposer = actor_identity(&compiled.spec.proposer);
    if reviewer {
        let review_ref = compiled
            .resolved_lineage
            .get("engineering_review")
            .ok_or_else(|| {
                Error::Conflict("compiled experiment has no engineering review".to_owned())
            })?;
        let review: ResearchContribution = workspace.get(review_ref)?;
        let separated = actor_identity(&review.actor) != proposer;
        Ok(check(
            "reviewer_separation",
            separated,
            if separated {
                "proposer and engineering reviewer use distinct handles".to_owned()
            } else {
                "proposer may not author its own engineering review".to_owned()
            },
        ))
    } else {
        let separated = forecasts
            .iter()
            .all(|forecast| actor_identity(&forecast.forecaster) != proposer);
        Ok(check(
            "forecaster_separation",
            separated,
            if separated {
                "proposer and forecasters use distinct handles".to_owned()
            } else {
                "proposer may not forecast its own experiment".to_owned()
            },
        ))
    }
}

fn validate_existing_settlement(
    existing: &ForecastSettlement,
    expected: &ForecastSettlement,
) -> Result<()> {
    if existing.schema != expected.schema
        || existing.forecast_id != expected.forecast_id
        || existing.experiment_id != expected.experiment_id
        || existing.resolved_outcome != expected.resolved_outcome
        || existing.stake != expected.stake
        || (existing.brier_score - expected.brier_score).abs() > f64::EPSILON
    {
        return Err(Error::Conflict(format!(
            "recorded settlement for {} does not match frozen forecast",
            existing.forecast_id
        )));
    }
    Ok(())
}

pub fn experiment_status(workspace: &Workspace, experiment_id: &str) -> Result<ExperimentStatus> {
    let compiled_event = workspace
        .latest_event(EXPERIMENT_COMPILED, experiment_id)?
        .ok_or_else(|| Error::NotFound(format!("compiled experiment {experiment_id}")))?;
    let compiled_ref = required_artifact(&compiled_event.event_type, compiled_event.artifact_ref)?;
    let forecasts = forecasts_for(workspace, experiment_id)?;
    let commitments = funding_for(workspace, experiment_id)?;
    Ok(ExperimentStatus {
        experiment_id: experiment_id.to_owned(),
        compiled_ref,
        forecasts: forecasts.len(),
        total_stake: checked_total(
            forecasts.iter().map(|forecast| forecast.stake),
            "forecast stake",
        )?,
        funding_commitments: commitments.len(),
        funded_compute_credits: checked_total(
            commitments
                .iter()
                .map(|commitment| commitment.compute_credits),
            "compute funding",
        )?,
        latest_admission: latest_typed(workspace, ADMISSION_DECIDED, experiment_id)?,
        execution_started: workspace
            .latest_event(EXECUTION_STARTED, experiment_id)?
            .is_some(),
        latest_run: latest_typed(workspace, EXPERIMENT_COMPLETED, experiment_id)?,
        latest_evidence: latest_typed(workspace, EVIDENCE_RECORDED, experiment_id)?,
    })
}

fn load_compiled(workspace: &Workspace, experiment_id: &str) -> Result<CompiledExperiment> {
    latest_typed(workspace, EXPERIMENT_COMPILED, experiment_id)?
        .ok_or_else(|| Error::NotFound(format!("compiled experiment {experiment_id}")))
}

fn forecasts_for(workspace: &Workspace, experiment_id: &str) -> Result<Vec<Forecast>> {
    Ok(artifacts_for(workspace, FORECAST_SUBMITTED)?
        .into_iter()
        .filter(|forecast: &Forecast| forecast.experiment_id == experiment_id)
        .collect::<Vec<_>>())
}

fn funding_for(workspace: &Workspace, experiment_id: &str) -> Result<Vec<FundingCommitment>> {
    Ok(artifacts_for(workspace, FUNDING_COMMITTED)?
        .into_iter()
        .filter(|commitment: &FundingCommitment| commitment.experiment_id == experiment_id)
        .collect::<Vec<_>>())
}

fn artifacts_for<T: DeserializeOwned>(workspace: &Workspace, event_type: &str) -> Result<Vec<T>> {
    workspace
        .events()?
        .into_iter()
        .filter(|event| event.event_type == event_type)
        .map(|event| {
            let artifact_ref = required_artifact(&event.event_type, event.artifact_ref)?;
            workspace.get(&artifact_ref)
        })
        .collect()
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

fn ensure_unique_id(workspace: &Workspace, event_type: &str, id: &str) -> Result<()> {
    if workspace.latest_event(event_type, id)?.is_some() {
        Err(Error::Conflict(format!("{id} already exists")))
    } else {
        Ok(())
    }
}

fn ensure_inputs_open(workspace: &Workspace, experiment_id: &str) -> Result<()> {
    if workspace
        .latest_event(EXECUTION_STARTED, experiment_id)?
        .is_some()
    {
        return Err(Error::Conflict(format!(
            "experiment {experiment_id} has started; forecasts and funding are closed"
        )));
    }
    if latest_typed::<AdmissionDecision>(workspace, ADMISSION_DECIDED, experiment_id)?
        .is_some_and(|decision| decision.accepted)
    {
        return Err(Error::Conflict(format!(
            "experiment {experiment_id} is admitted; forecasts and funding are closed"
        )));
    }
    Ok(())
}

fn actor_identity(actor: &ActorRef) -> &str {
    if actor.kind == ActorKind::Model {
        actor.model_ref.as_deref().unwrap_or(&actor.id)
    } else {
        &actor.id
    }
}

fn checked_total(values: impl IntoIterator<Item = u64>, label: &str) -> Result<u64> {
    values.into_iter().try_fold(0_u64, |total, value| {
        total
            .checked_add(value)
            .ok_or_else(|| Error::Conflict(format!("{label} total exceeds u64 capacity")))
    })
}

fn required_artifact(event_type: &str, artifact_ref: Option<String>) -> Result<String> {
    artifact_ref.ok_or_else(|| {
        Error::Conflict(format!(
            "{event_type} event is missing its artifact reference"
        ))
    })
}

fn check(gate: &str, passed: bool, detail: String) -> GateCheck {
    GateCheck {
        gate: gate.to_owned(),
        passed,
        detail,
    }
}

fn resolve_outcome(spec: &ExperimentSpec, run: &RunRecord) -> Result<String> {
    let matched = spec
        .outcome_contract
        .outcomes
        .iter()
        .filter(|outcome| predicate_matches(&outcome.predicate, run))
        .map(|outcome| outcome.id.clone())
        .collect::<Vec<_>>();
    match matched.as_slice() {
        [outcome] => Ok(outcome.clone()),
        [] => Err(Error::Execution(
            "run did not resolve to any frozen outcome".to_owned(),
        )),
        outcomes => Err(Error::Execution(format!(
            "run ambiguously resolved to outcomes {}",
            outcomes.join(", ")
        ))),
    }
}

fn predicate_matches(predicate: &OutcomePredicate, run: &RunRecord) -> bool {
    match predicate {
        OutcomePredicate::ExecutionFailure => run.exit_code != 0 || run.timed_out,
        OutcomePredicate::Metric {
            metric,
            operator,
            threshold,
        } => {
            if run.exit_code != 0 || run.timed_out {
                return false;
            }
            run.metrics.get(metric).is_some_and(|value| match operator {
                ComparisonOperator::Gt => value > threshold,
                ComparisonOperator::Gte => value >= threshold,
                ComparisonOperator::Lt => value < threshold,
                ComparisonOperator::Lte => value <= threshold,
                ComparisonOperator::Eq => (value - threshold).abs() < f64::EPSILON,
            })
        }
    }
}

fn settle_forecast(forecast: &Forecast, resolved_outcome: &str) -> ForecastSettlement {
    let brier_score = forecast
        .probabilities
        .iter()
        .map(|(outcome, probability)| {
            let observed = if outcome == resolved_outcome {
                1.0
            } else {
                0.0
            };
            (probability - observed).powi(2)
        })
        .sum();
    ForecastSettlement {
        schema: "ilxyr.forecast_settlement.v1".to_owned(),
        forecast_id: forecast.id.clone(),
        experiment_id: forecast.experiment_id.clone(),
        resolved_outcome: resolved_outcome.to_owned(),
        brier_score,
        stake: forecast.stake,
    }
}
