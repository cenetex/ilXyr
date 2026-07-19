use std::{
    cmp::Ordering,
    collections::{BTreeMap, BTreeSet},
};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::{
    ActorKind, ActorRef, AllocationDecision, AllocationKind, AllocationRecord, AllocationReport,
    AuthorityLevel, BaselineRule, CalibrationRecord, Certificate, CertificatePredicate, CodePolicy,
    ComparisonOperator, CompiledExperiment, CompletedExperiment, CompletedSandbox, EpochBudget,
    Error, Evidence, EvidenceLane, ExecutionSpec, ExperimentSpec, ExportPolicy, Forecast,
    ForecastSettlement, FundingCommitment, FundingPolicy, GroundingAuthority, NetworkPolicy,
    OutcomeContract, PromotionEligibility, ResearchLineage, Result, RunAuthorization, RunRecord,
    SandboxRun, SandboxSpec, SecurityPolicy, TrustedPolicyKey, WeightClass, Workspace,
    commit_funding, decide_admission, executor, run_experiment, store::canonical_bytes,
    store::now_ms, validation,
};

const POLICY_KEY_TRUSTED: &str = "PolicyKeyTrusted";
const EPOCH_BUDGET_REGISTERED: &str = "EpochBudgetRegistered";
const EXPERIMENT_COMPILED: &str = "ExperimentCompiled";
const FORECAST_SUBMITTED: &str = "ForecastSubmitted";
const FUNDING_COMMITTED: &str = "FundingCommitted";
const EXECUTION_STARTED: &str = "ExecutionStarted";
const EXPERIMENT_COMPLETED: &str = "ExperimentCompleted";
const ALLOCATION_COMMITTED: &str = "AllocationCommitted";
const SANDBOX_PLANNED: &str = "SandboxPlanned";
const SANDBOX_RUN_COMPLETED: &str = "SandboxRunCompleted";
const EVIDENCE_RECORDED: &str = "EvidenceRecorded";
const PROMOTION_EVALUATED: &str = "PromotionEvaluated";
const FORECAST_SETTLED: &str = "ForecastSettled";
const CALIBRATION_UPDATED: &str = "CalibrationUpdated";
const CERTIFICATE_RECORDED: &str = "CertificateRecorded";
const PROBATIONARY_WEIGHT: f64 = 0.25;
const CALIBRATION_MINIMUM: usize = 5;
const DISAGREEMENT_EPSILON: f64 = 1e-12;
const BASIS_POINTS_PER_WHOLE: u128 = 10_000;

pub fn trust_policy_key(
    workspace: &Workspace,
    key_id: &str,
    owner: ActorRef,
    public_key: String,
) -> Result<TrustedPolicyKey> {
    if let Some(existing) = latest_typed::<TrustedPolicyKey>(workspace, POLICY_KEY_TRUSTED, key_id)?
    {
        if existing.owner == owner && existing.public_key == public_key {
            return Ok(existing);
        }
        return Err(Error::Conflict(format!(
            "trusted policy key {key_id} is immutable"
        )));
    }
    let key = TrustedPolicyKey {
        schema: "ilxyr.trusted_policy_key.v1".to_owned(),
        key_id: key_id.to_owned(),
        owner: owner.clone(),
        public_key,
        trusted_at_ms: now_ms()?,
    };
    validation::trusted_policy_key(&key)?;
    decode_verifying_key(&key.public_key)?;
    let artifact_ref = workspace.put(&key)?;
    workspace.append_event(POLICY_KEY_TRUSTED, key_id, owner, Some(artifact_ref))?;
    Ok(key)
}

pub fn epoch_budget_signing_payload(budget: &EpochBudget) -> Result<Vec<u8>> {
    let mut unsigned = serde_json::to_value(budget)?;
    unsigned
        .as_object_mut()
        .ok_or_else(|| Error::Validation(vec!["epoch budget must be an object".to_owned()]))?
        .remove("signature");
    canonical_bytes(&unsigned)
}

pub fn register_epoch_budget(workspace: &Workspace, budget: EpochBudget) -> Result<String> {
    validation::epoch_budget(&budget)?;
    if workspace
        .latest_event(EPOCH_BUDGET_REGISTERED, &budget.id)?
        .is_some()
    {
        return Err(Error::Conflict(format!(
            "epoch budget {} already exists",
            budget.id
        )));
    }
    let key =
        latest_typed::<TrustedPolicyKey>(workspace, POLICY_KEY_TRUSTED, &budget.signature.key_id)?
            .ok_or_else(|| Error::Security(format!("untrusted key {}", budget.signature.key_id)))?;
    if key.owner.id != budget.signed_by {
        return Err(Error::Security(format!(
            "budget signer {} does not own key {}",
            budget.signed_by, budget.signature.key_id
        )));
    }
    verify_budget_signature(&budget, &key)?;
    let artifact_ref = workspace.put(&budget)?;
    workspace.append_event(
        EPOCH_BUDGET_REGISTERED,
        &budget.id,
        key.owner,
        Some(artifact_ref.clone()),
    )?;
    Ok(artifact_ref)
}

pub fn epoch_budget(workspace: &Workspace, budget_id: &str) -> Result<EpochBudget> {
    registered_budget_with_ref(workspace, budget_id).map(|(_, budget)| budget)
}

pub fn allocate_epoch(
    workspace: &Workspace,
    budget_id: &str,
    experiment_ids: &[String],
) -> Result<AllocationReport> {
    let budget = epoch_budget(workspace, budget_id)?;
    let mut candidates = Vec::new();
    let mut decisions = Vec::new();
    let mut seen = BTreeSet::new();

    for experiment_id in experiment_ids {
        if !seen.insert(experiment_id.clone()) {
            continue;
        }
        match allocation_candidate(workspace, &budget, experiment_id) {
            Ok(candidate) => candidates.push(candidate),
            Err(error) => decisions.push(AllocationDecision {
                experiment_id: experiment_id.clone(),
                disagreement: 0.0,
                priority: 0.0,
                compute_credits: 0,
                allocated: false,
                detail: error.to_string(),
            }),
        }
    }
    candidates.sort_by(|left, right| {
        right
            .priority
            .partial_cmp(&left.priority)
            .unwrap_or(Ordering::Equal)
            .then_with(|| left.experiment_id.cmp(&right.experiment_id))
    });

    for candidate in candidates {
        if candidate.disagreement <= DISAGREEMENT_EPSILON {
            decisions.push(candidate.decision(false, "forecasts are effectively unanimous"));
            continue;
        }
        let allocation_id = allocation_id(
            budget_id,
            AllocationKind::Promoted,
            &candidate.experiment_id,
        );
        if latest_typed::<AllocationRecord>(workspace, ALLOCATION_COMMITTED, &allocation_id)?
            .is_some()
        {
            decisions.push(candidate.decision(true, "allocation already recorded"));
            continue;
        }
        if let Err(error) = check_capacity(
            workspace,
            &budget,
            &candidate.executable,
            candidate.compute_credits,
        ) {
            decisions.push(candidate.decision(false, &error.to_string()));
            continue;
        }

        let funding_id = format!("funding:{budget_id}:{}", candidate.experiment_id);
        if workspace
            .latest_event(FUNDING_COMMITTED, &funding_id)?
            .is_none()
        {
            commit_funding(
                workspace,
                FundingCommitment {
                    schema: "ilxyr.funding.v1".to_owned(),
                    id: funding_id,
                    experiment_id: candidate.experiment_id.clone(),
                    funder: ActorRef::service("service://ilxyr/allocator-v1"),
                    compute_credits: candidate.compute_credits,
                    rationale: format!(
                        "resolution-weighted disagreement priority {:.12}",
                        candidate.priority
                    ),
                },
            )?;
        }
        reserve_allocation(
            workspace,
            &budget,
            &candidate.experiment_id,
            &candidate.executable,
            candidate.compute_credits,
            AllocationKind::Promoted,
        )?;
        let admission = decide_admission(workspace, &candidate.experiment_id)?;
        if !admission.accepted {
            return Err(Error::Conflict(format!(
                "allocator funded {}, but admission rejected it",
                candidate.experiment_id
            )));
        }
        decisions.push(candidate.decision(true, "allocated and admitted"));
    }

    decisions.sort_by(|left, right| left.experiment_id.cmp(&right.experiment_id));
    let allocated_compute_credits = decisions
        .iter()
        .filter(|decision| decision.allocated)
        .try_fold(0_u64, |total, decision| {
            total.checked_add(decision.compute_credits).ok_or_else(|| {
                Error::Conflict("allocation report credit total exceeds u64 capacity".to_owned())
            })
        })?;
    Ok(AllocationReport {
        budget_id: budget_id.to_owned(),
        allocated_compute_credits,
        decisions,
    })
}

pub fn authorize_unattended_run(
    workspace: &Workspace,
    budget_id: &str,
    experiment_id: &str,
) -> Result<RunAuthorization> {
    let budget = epoch_budget(workspace, budget_id)?;
    let compiled = load_compiled(workspace, experiment_id)?;
    let allocation_id = allocation_id(budget_id, AllocationKind::Promoted, experiment_id);
    let allocation =
        latest_typed::<AllocationRecord>(workspace, ALLOCATION_COMMITTED, &allocation_id)?;
    let mut reasons = Vec::new();
    let allocated_compute_credits = allocation
        .as_ref()
        .map_or(0, |allocation| allocation.compute_credits);
    if allocation.is_none() {
        reasons.push("experiment has no allocation from this epoch budget".to_owned());
    }
    if workspace
        .latest_event(EXECUTION_STARTED, experiment_id)?
        .is_some()
        && workspace
            .latest_event(EXPERIMENT_COMPLETED, experiment_id)?
            .is_none()
    {
        reasons.push(
            "a prior execution started without a terminal run; recovery requires human acknowledgement"
                .to_owned(),
        );
    }
    authorization_reasons(
        workspace,
        &budget,
        &compiled.spec.execution.program,
        &compiled.spec.execution.args,
        &compiled.spec.execution.network,
        &mut reasons,
    )?;
    Ok(RunAuthorization {
        budget_id: budget_id.to_owned(),
        experiment_id: experiment_id.to_owned(),
        unattended: reasons.is_empty(),
        acknowledgement_reasons: reasons,
        allocated_compute_credits,
    })
}

pub fn run_experiment_unattended(
    workspace: &Workspace,
    budget_id: &str,
    experiment_id: &str,
) -> Result<CompletedExperiment> {
    if workspace
        .latest_event(EXPERIMENT_COMPLETED, experiment_id)?
        .is_some()
    {
        return run_experiment(workspace, experiment_id);
    }
    let authorization = authorize_unattended_run(workspace, budget_id, experiment_id)?;
    if !authorization.unattended {
        return Err(Error::Security(format!(
            "human acknowledgement required: {}",
            authorization.acknowledgement_reasons.join("; ")
        )));
    }
    run_experiment(workspace, experiment_id)
}

pub fn run_sandbox(
    workspace: &Workspace,
    budget_id: &str,
    spec: SandboxSpec,
) -> Result<CompletedSandbox> {
    validation::sandbox(&spec)?;
    let (budget_ref, budget) = registered_budget_with_ref(workspace, budget_id)?;
    ensure_authority_artifacts_exist(workspace, &spec.authority)?;
    let spec_ref = freeze_sandbox_spec(workspace, &spec)?;
    if let Some((run_ref, run)) =
        latest_typed_with_ref::<SandboxRun>(workspace, SANDBOX_RUN_COMPLETED, &spec.id)?
    {
        return finalize_sandbox(workspace, budget_id, &spec, run_ref, run);
    }
    let sandbox_allocation_id = allocation_id(&budget.id, AllocationKind::Sandbox, &spec.id);
    if latest_typed::<AllocationRecord>(workspace, ALLOCATION_COMMITTED, &sandbox_allocation_id)?
        .is_none()
    {
        check_sandbox_authorization(workspace, &budget, &spec)?;
    }
    reserve_allocation(
        workspace,
        &budget,
        &spec.id,
        &spec.executable,
        spec.cost_credits,
        AllocationKind::Sandbox,
    )?;

    let execution_spec = sandbox_execution_spec(&spec);
    let run = executor::execute_local(&execution_spec, workspace.root())?;
    let previous_event = workspace
        .events()?
        .last()
        .map(|event| event.event_hash.clone())
        .ok_or_else(|| Error::Conflict("sandbox run requires a budget ledger event".to_owned()))?;
    let mut run_authority = spec.authority.clone();
    add_authority_artifact(&mut run_authority, &budget_ref);
    add_authority_artifact(&mut run_authority, &spec_ref);
    let sandbox_run = SandboxRun {
        schema: "ilxyr.sandbox_run.v1".to_owned(),
        id: run.id,
        sandbox_id: spec.id.clone(),
        experiment_id: spec.experiment_id.clone(),
        budget_id: budget_id.to_owned(),
        executable: spec.executable.clone(),
        args: spec.args.clone(),
        cost_credits: spec.cost_credits,
        started_at_ms: run.started_at_ms,
        completed_at_ms: run.completed_at_ms,
        exit_code: run.exit_code,
        timed_out: run.timed_out,
        stdout: run.stdout,
        stderr: run.stderr,
        output_truncated: run.output_truncated,
        output_error: run.output_error,
        metrics: run.metrics,
        authority: run_authority,
        previous_event,
    };
    let run_ref = workspace.put(&sandbox_run)?;
    workspace.append_event(
        SANDBOX_RUN_COMPLETED,
        &spec.id,
        ActorRef::service("service://ilxyr/sandbox-executor-v1"),
        Some(run_ref.clone()),
    )?;
    finalize_sandbox(workspace, budget_id, &spec, run_ref, sandbox_run)
}

fn freeze_sandbox_spec(workspace: &Workspace, spec: &SandboxSpec) -> Result<String> {
    if let Some((artifact_ref, existing)) =
        latest_typed_with_ref::<SandboxSpec>(workspace, SANDBOX_PLANNED, &spec.id)?
    {
        if existing == *spec {
            return Ok(artifact_ref);
        }
        return Err(Error::Conflict(format!(
            "sandbox plan {} is immutable",
            spec.id
        )));
    }
    let artifact_ref = workspace.put(spec)?;
    workspace.append_event(
        SANDBOX_PLANNED,
        &spec.id,
        ActorRef::service("service://ilxyr/sandbox-planner-v1"),
        Some(artifact_ref.clone()),
    )?;
    Ok(artifact_ref)
}

pub fn record_certificate(workspace: &Workspace, certificate: Certificate) -> Result<String> {
    validation::certificate(&certificate)?;
    if workspace
        .latest_event(CERTIFICATE_RECORDED, &certificate.id)?
        .is_some()
    {
        return Err(Error::Conflict(format!(
            "certificate {} already exists",
            certificate.id
        )));
    }
    let evidence: Evidence = workspace.get(&certificate.evidence_ref)?;
    if !certificate.checked_artifacts.contains(&evidence.run_ref) {
        return Err(Error::Validation(vec![
            "certificate.checked_artifacts must include the evidence run_ref".to_owned(),
        ]));
    }
    for checked_artifact in &certificate.checked_artifacts {
        let _: Value = workspace.get(checked_artifact)?;
    }
    if !certificate_matches(workspace, &certificate, &evidence)? {
        return Err(Error::Validation(vec![
            "certificate predicate does not match the recorded evidence".to_owned(),
        ]));
    }
    let artifact_ref = workspace.put(&certificate)?;
    workspace.append_event(
        CERTIFICATE_RECORDED,
        &certificate.id,
        ActorRef::service("service://ilxyr/certificate-recorder-v1"),
        Some(artifact_ref.clone()),
    )?;
    Ok(artifact_ref)
}

pub fn certificates_for_evidence(
    workspace: &Workspace,
    evidence_ref: &str,
) -> Result<Vec<Certificate>> {
    Ok(
        artifacts_for::<Certificate>(workspace, CERTIFICATE_RECORDED)?
            .into_iter()
            .filter(|certificate| certificate.evidence_ref == evidence_ref)
            .collect(),
    )
}

pub fn calibration_for(workspace: &Workspace, handle: &str) -> Result<Option<CalibrationRecord>> {
    latest_typed(workspace, CALIBRATION_UPDATED, handle)
}

pub(crate) fn evidence_authority_for_run(
    declared: &GroundingAuthority,
    run_ref: &str,
) -> GroundingAuthority {
    let mut authority = declared.clone();
    add_authority_artifact(&mut authority, run_ref);
    authority
}

pub(crate) fn ensure_authority_artifacts_exist(
    workspace: &Workspace,
    authority: &GroundingAuthority,
) -> Result<()> {
    for artifact_ref in &authority.provenance.artifact_hashes {
        let _: Value = workspace.get(artifact_ref)?;
    }
    Ok(())
}

pub(crate) fn refresh_calibrations(
    workspace: &Workspace,
    forecasts: &[Forecast],
) -> Result<Vec<CalibrationRecord>> {
    let handles = forecasts
        .iter()
        .filter(|forecast| forecast.forecaster.kind != ActorKind::Service)
        .map(|forecast| actor_identity(&forecast.forecaster).to_owned())
        .collect::<BTreeSet<_>>();
    handles
        .into_iter()
        .map(|handle| refresh_calibration(workspace, &handle))
        .collect()
}

fn verify_budget_signature(budget: &EpochBudget, key: &TrustedPolicyKey) -> Result<()> {
    let verifying_key = decode_verifying_key(&key.public_key)?;
    let signature_bytes = STANDARD
        .decode(&budget.signature.value)
        .map_err(|error| Error::Security(format!("invalid budget signature encoding: {error}")))?;
    let signature_bytes: [u8; 64] = signature_bytes.try_into().map_err(|_| {
        Error::Security("Ed25519 budget signature must contain 64 bytes".to_owned())
    })?;
    let signature = Signature::from_bytes(&signature_bytes);
    verifying_key
        .verify_strict(&epoch_budget_signing_payload(budget)?, &signature)
        .map_err(|error| Error::Security(format!("invalid epoch budget signature: {error}")))
}

fn decode_verifying_key(encoded: &str) -> Result<VerifyingKey> {
    let bytes = STANDARD.decode(encoded).map_err(|error| {
        Error::Validation(vec![format!("invalid public key encoding: {error}")])
    })?;
    let bytes: [u8; 32] = bytes.try_into().map_err(|_| {
        Error::Validation(vec![
            "Ed25519 public key must contain exactly 32 bytes".to_owned(),
        ])
    })?;
    VerifyingKey::from_bytes(&bytes)
        .map_err(|error| Error::Validation(vec![format!("invalid Ed25519 public key: {error}")]))
}

#[derive(Debug)]
struct Candidate {
    experiment_id: String,
    executable: String,
    disagreement: f64,
    priority: f64,
    compute_credits: u64,
}

impl Candidate {
    fn decision(&self, allocated: bool, detail: &str) -> AllocationDecision {
        AllocationDecision {
            experiment_id: self.experiment_id.clone(),
            disagreement: self.disagreement,
            priority: self.priority,
            compute_credits: self.compute_credits,
            allocated,
            detail: detail.to_owned(),
        }
    }
}

fn allocation_candidate(
    workspace: &Workspace,
    budget: &EpochBudget,
    experiment_id: &str,
) -> Result<Candidate> {
    if workspace
        .latest_event(EXECUTION_STARTED, experiment_id)?
        .is_some()
    {
        return Err(Error::Conflict("experiment has already started".to_owned()));
    }
    let compiled = load_compiled(workspace, experiment_id)?;
    let spec = &compiled.spec;
    if spec.execution.executor != "local-command"
        || spec.security.weight_class != WeightClass::Public
        || spec.security.code_policy != CodePolicy::Arbitrary
        || spec.security.export_policy != ExportPolicy::Artifacts
        || spec.execution.network != NetworkPolicy::Open
    {
        return Err(Error::Security(
            "candidate does not fit the local executor capability set".to_owned(),
        ));
    }
    let cap = budget
        .per_executable_caps
        .get(&spec.execution.program)
        .ok_or_else(|| Error::Security("executable is not budget-allowlisted".to_owned()))?;
    if spec.funding.required_compute_credits > cap.per_run_credits {
        return Err(Error::Security(format!(
            "experiment cost {} exceeds per-run cap {}",
            spec.funding.required_compute_credits, cap.per_run_credits
        )));
    }
    if !cap.allowed_argument_sets.contains(&spec.execution.args) {
        return Err(Error::Security(
            "experiment arguments are not allowlisted by the signed executable policy".to_owned(),
        ));
    }
    let forecasts = forecasts_for(workspace, experiment_id)?;
    if forecasts.len() < spec.funding.minimum_forecasters {
        return Err(Error::Conflict(
            "insufficient forecast participation".to_owned(),
        ));
    }
    let stake = forecasts.iter().try_fold(0_u64, |total, forecast| {
        total
            .checked_add(forecast.stake)
            .ok_or_else(|| Error::Conflict("forecast stake exceeds u64 capacity".to_owned()))
    })?;
    if stake < spec.funding.minimum_total_stake {
        return Err(Error::Conflict("insufficient forecast stake".to_owned()));
    }
    ensure_role_separation(workspace, &compiled, &forecasts)?;
    let disagreement = weighted_disagreement(workspace, &forecasts)?;
    let compute_credits = spec.funding.required_compute_credits;
    Ok(Candidate {
        experiment_id: experiment_id.to_owned(),
        executable: spec.execution.program.clone(),
        disagreement,
        priority: disagreement / compute_credits as f64,
        compute_credits,
    })
}

fn weighted_disagreement(workspace: &Workspace, forecasts: &[Forecast]) -> Result<f64> {
    let outcome_ids = forecasts
        .iter()
        .flat_map(|forecast| forecast.probabilities.keys().cloned())
        .collect::<BTreeSet<_>>();
    let weighted = forecasts
        .iter()
        .map(|forecast| -> Result<_> {
            let handle = actor_identity(&forecast.forecaster);
            let weight =
                calibration_for(workspace, handle)?.map_or(PROBATIONARY_WEIGHT, |calibration| {
                    if calibration.probationary {
                        PROBATIONARY_WEIGHT
                    } else {
                        calibration.resolution.max(0.05)
                    }
                });
            Ok((forecast, weight))
        })
        .collect::<Result<Vec<_>>>()?;
    let weight_total = weighted.iter().map(|(_, weight)| weight).sum::<f64>();
    if weight_total <= f64::EPSILON {
        return Ok(0.0);
    }
    Ok(outcome_ids
        .iter()
        .map(|outcome| {
            let mean = weighted
                .iter()
                .map(|(forecast, weight)| {
                    forecast.probabilities.get(outcome).copied().unwrap_or(0.0) * weight
                })
                .sum::<f64>()
                / weight_total;
            weighted
                .iter()
                .map(|(forecast, weight)| {
                    let probability = forecast.probabilities.get(outcome).copied().unwrap_or(0.0);
                    weight * (probability - mean).powi(2)
                })
                .sum::<f64>()
                / weight_total
        })
        .sum())
}

fn ensure_role_separation(
    workspace: &Workspace,
    compiled: &CompiledExperiment,
    forecasts: &[Forecast],
) -> Result<()> {
    let proposer = actor_identity(&compiled.spec.proposer);
    let engineering_ref = compiled
        .resolved_lineage
        .get("engineering_review")
        .ok_or_else(|| {
            Error::Conflict("compiled experiment has no engineering review".to_owned())
        })?;
    let review: crate::ResearchContribution = workspace.get(engineering_ref)?;
    if actor_identity(&review.actor) == proposer {
        return Err(Error::Conflict(
            "proposer may not author its own engineering review".to_owned(),
        ));
    }
    if forecasts
        .iter()
        .any(|forecast| actor_identity(&forecast.forecaster) == proposer)
    {
        return Err(Error::Conflict(
            "proposer may not forecast its own experiment".to_owned(),
        ));
    }
    Ok(())
}

fn reserve_allocation(
    workspace: &Workspace,
    budget: &EpochBudget,
    experiment_id: &str,
    executable: &str,
    compute_credits: u64,
    kind: AllocationKind,
) -> Result<AllocationRecord> {
    let id = allocation_id(&budget.id, kind.clone(), experiment_id);
    if let Some(existing) = latest_typed::<AllocationRecord>(workspace, ALLOCATION_COMMITTED, &id)?
    {
        if existing.executable == executable && existing.compute_credits == compute_credits {
            return Ok(existing);
        }
        return Err(Error::Conflict(format!("allocation {id} is immutable")));
    }
    check_capacity(workspace, budget, executable, compute_credits)?;
    let allocation = AllocationRecord {
        schema: "ilxyr.allocation.v1".to_owned(),
        id: id.clone(),
        budget_id: budget.id.clone(),
        experiment_id: experiment_id.to_owned(),
        executable: executable.to_owned(),
        compute_credits,
        kind,
        allocated_at_ms: now_ms()?,
    };
    let artifact_ref = workspace.put(&allocation)?;
    workspace.append_event(
        ALLOCATION_COMMITTED,
        &id,
        ActorRef::service("service://ilxyr/allocator-v1"),
        Some(artifact_ref),
    )?;
    Ok(allocation)
}

fn check_capacity(
    workspace: &Workspace,
    budget: &EpochBudget,
    executable: &str,
    compute_credits: u64,
) -> Result<()> {
    let cap = budget
        .per_executable_caps
        .get(executable)
        .ok_or_else(|| Error::Security(format!("{executable} has no executable cap")))?;
    if !budget
        .allowlisted_executables
        .iter()
        .any(|allowed| allowed == executable)
    {
        return Err(Error::Security(format!(
            "{executable} is not on the epoch allowlist"
        )));
    }
    if compute_credits > cap.per_run_credits {
        return Err(Error::Security(format!(
            "requested {compute_credits} credits exceeds per-run cap {}",
            cap.per_run_credits
        )));
    }
    let allocations = allocations_for(workspace, &budget.id)?;
    let total = checked_allocation_total(&allocations, |_| true)?;
    let reserve_basis_points = percentage_basis_points(budget.replication_reserve_pct)?;
    let reserve_product = u128::from(budget.total_compute_credits) * reserve_basis_points;
    let reserved = reserve_product
        .checked_add(BASIS_POINTS_PER_WHOLE - 1)
        .ok_or_else(|| Error::Conflict("replication reserve exceeds u128 capacity".to_owned()))?
        / BASIS_POINTS_PER_WHOLE;
    let reserved = u64::try_from(reserved)
        .map_err(|_| Error::Conflict("replication reserve exceeds u64 capacity".to_owned()))?;
    let general_limit = budget
        .total_compute_credits
        .saturating_sub(reserved.min(budget.total_compute_credits));
    if total
        .checked_add(compute_credits)
        .is_none_or(|next| next > general_limit)
    {
        return Err(Error::Security(format!(
            "general epoch allocation limit {general_limit} would be exceeded; {reserved} credits are reserved for replication"
        )));
    }
    let executable_total = checked_allocation_total(&allocations, |allocation| {
        allocation.executable == executable
    })?;
    if executable_total
        .checked_add(compute_credits)
        .is_none_or(|next| next > cap.per_epoch_credits)
    {
        return Err(Error::Security(format!(
            "per-epoch cap for {executable} would be exceeded"
        )));
    }
    Ok(())
}

fn authorization_reasons(
    workspace: &Workspace,
    budget: &EpochBudget,
    executable: &str,
    args: &[String],
    network: &NetworkPolicy,
    reasons: &mut Vec<String>,
) -> Result<()> {
    if !budget
        .allowlisted_executables
        .iter()
        .any(|allowed| allowed == executable)
        && budget.acknowledgement_thresholds.new_executable
    {
        reasons.push(format!("{executable} is a new executable"));
    }
    match budget.per_executable_caps.get(executable) {
        Some(cap) => {
            if !cap
                .allowed_argument_sets
                .iter()
                .any(|allowed| allowed == args)
            {
                reasons.push("argument vector is not allowed by signed policy".to_owned());
            }
            if *network == NetworkPolicy::Open && cap.network == NetworkPolicy::Denied {
                let disposition = if budget.acknowledgement_thresholds.network_beyond_policy {
                    "requires human acknowledgement"
                } else {
                    "is denied by signed policy"
                };
                reasons.push(format!(
                    "run requests network access beyond executable policy and {disposition}"
                ));
            }
        }
        None => reasons.push("executable has no signed policy cap".to_owned()),
    }
    let spent = checked_allocation_total(&allocations_for(workspace, &budget.id)?, |_| true)?;
    let spend_pct = spent as f64 * 100.0 / budget.total_compute_credits as f64;
    if percentage_threshold_crossed(
        spent,
        budget.total_compute_credits,
        budget.acknowledgement_thresholds.cumulative_spend_pct,
    )? {
        reasons.push(format!(
            "epoch allocation is {spend_pct:.2}%, crossing the {:.2}% acknowledgement threshold",
            budget.acknowledgement_thresholds.cumulative_spend_pct
        ));
    }
    Ok(())
}

fn check_sandbox_authorization(
    workspace: &Workspace,
    budget: &EpochBudget,
    spec: &SandboxSpec,
) -> Result<()> {
    check_capacity(workspace, budget, &spec.executable, spec.cost_credits)?;
    let cap = budget
        .per_executable_caps
        .get(&spec.executable)
        .ok_or_else(|| Error::Security("sandbox executable has no cap".to_owned()))?;
    if spec.network != cap.network {
        return Err(Error::Security(
            "sandbox network request does not match the signed executable policy".to_owned(),
        ));
    }
    if !cap.allowed_argument_sets.contains(&spec.args) {
        return Err(Error::Security(
            "sandbox argument vector is not allowed by signed policy".to_owned(),
        ));
    }
    let spent = checked_allocation_total(&allocations_for(workspace, &budget.id)?, |_| true)?;
    let next = spent.checked_add(spec.cost_credits).ok_or_else(|| {
        Error::Conflict("sandbox allocation total exceeds u64 capacity".to_owned())
    })?;
    if percentage_threshold_crossed(
        next,
        budget.total_compute_credits,
        budget.acknowledgement_thresholds.cumulative_spend_pct,
    )? {
        return Err(Error::Security(format!(
            "sandbox run would cross the {:.2}% cumulative spend acknowledgement threshold",
            budget.acknowledgement_thresholds.cumulative_spend_pct
        )));
    }
    Ok(())
}

fn sandbox_execution_spec(spec: &SandboxSpec) -> ExperimentSpec {
    ExperimentSpec {
        schema: "ilxyr.experiment.v1".to_owned(),
        id: spec.experiment_id.clone(),
        title: spec.id.clone(),
        hypothesis: "sandbox execution".to_owned(),
        rationale: "single-object sandbox lane".to_owned(),
        proposer: ActorRef::service("service://ilxyr/sandbox-v1"),
        family: None,
        shared_task_id: None,
        lineage: ResearchLineage {
            hypothesis: "sandbox".to_owned(),
            mathematical_foundation: "sandbox".to_owned(),
            engineering_review: "sandbox".to_owned(),
            experiment_design: "sandbox".to_owned(),
        },
        baseline: "baseline://sandbox/not-applicable".to_owned(),
        datasets: Vec::new(),
        models: Vec::new(),
        metrics: spec.metrics.clone(),
        seeds: spec.authority.scope.seeds.clone(),
        outcome_contract: OutcomeContract {
            primary_metric: spec.metrics[0].name.clone(),
            success_outcome: "sandbox_complete".to_owned(),
            outcomes: Vec::new(),
        },
        execution: ExecutionSpec {
            executor: "local-command".to_owned(),
            program: spec.executable.clone(),
            args: spec.args.clone(),
            timeout_seconds: spec.timeout_seconds,
            max_cost_credits: spec.cost_credits,
            network: spec.network.clone(),
        },
        funding: FundingPolicy {
            required_compute_credits: spec.cost_credits,
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

fn finalize_sandbox(
    workspace: &Workspace,
    budget_id: &str,
    spec: &SandboxSpec,
    run_ref: String,
    run: SandboxRun,
) -> Result<CompletedSandbox> {
    if run.budget_id != budget_id
        || run.sandbox_id != spec.id
        || run.experiment_id != spec.experiment_id
        || run.executable != spec.executable
        || run.args != spec.args
        || run.cost_credits != spec.cost_credits
    {
        return Err(Error::Conflict(
            "completed sandbox run does not match the requested budget and frozen spec".to_owned(),
        ));
    }
    if run.output_error.is_some() {
        return Ok(CompletedSandbox {
            run,
            evidence: None,
            promotion: None,
        });
    }
    let resolved_outcome = if run.exit_code == 0 && !run.timed_out {
        "sandbox_complete"
    } else {
        "execution_failure"
    };
    let expected = Evidence {
        schema: "ilxyr.evidence.v1".to_owned(),
        id: format!("evidence:{}", run.id),
        experiment_id: spec.experiment_id.clone(),
        run_ref: run_ref.clone(),
        resolved_outcome: resolved_outcome.to_owned(),
        metrics: run.metrics.clone(),
        recorded_at_ms: now_ms()?,
        authority: evidence_authority_for_run(&run.authority, &run_ref),
        lane: EvidenceLane::Sandbox,
    };
    let (evidence_ref, evidence) = if let Some((evidence_ref, existing)) =
        latest_typed_with_ref::<Evidence>(workspace, EVIDENCE_RECORDED, &spec.id)?
    {
        validate_sandbox_evidence(&existing, &expected)?;
        (evidence_ref, existing)
    } else {
        let evidence_ref = workspace.put(&expected)?;
        workspace.append_event(
            EVIDENCE_RECORDED,
            &spec.id,
            ActorRef::service("service://ilxyr/sandbox-resolver-v1"),
            Some(evidence_ref.clone()),
        )?;
        (evidence_ref, expected)
    };
    let promotion = promotion_for(workspace, budget_id, &spec.id, &evidence_ref, &evidence)?;
    Ok(CompletedSandbox {
        run,
        evidence: Some(evidence),
        promotion: Some(promotion),
    })
}

fn validate_sandbox_evidence(existing: &Evidence, expected: &Evidence) -> Result<()> {
    if existing.id != expected.id
        || existing.experiment_id != expected.experiment_id
        || existing.run_ref != expected.run_ref
        || existing.resolved_outcome != expected.resolved_outcome
        || existing.metrics != expected.metrics
        || existing.lane != EvidenceLane::Sandbox
    {
        return Err(Error::Conflict(
            "recorded sandbox evidence does not match completed run".to_owned(),
        ));
    }
    Ok(())
}

fn add_authority_artifact(authority: &mut GroundingAuthority, artifact_ref: &str) {
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

fn promotion_for(
    workspace: &Workspace,
    budget_id: &str,
    sandbox_id: &str,
    evidence_ref: &str,
    evidence: &Evidence,
) -> Result<PromotionEligibility> {
    if let Some(existing) =
        latest_typed::<PromotionEligibility>(workspace, PROMOTION_EVALUATED, sandbox_id)?
    {
        if existing.evidence_ref == evidence_ref && existing.budget_id == budget_id {
            return Ok(existing);
        }
        return Err(Error::Conflict(format!(
            "promotion evaluation for {sandbox_id} is immutable"
        )));
    }
    let budget = epoch_budget(workspace, budget_id)?;
    let authority_sufficient = matches!(
        evidence.authority.level,
        AuthorityLevel::ExactCheck | AuthorityLevel::DeterministicReplay
    );
    let passed_metrics = if authority_sufficient && evidence.lane == EvidenceLane::Sandbox {
        budget
            .promoted_metrics
            .iter()
            .filter(|metric| {
                evidence.metrics.get(*metric).is_some_and(|value| {
                    budget
                        .baselines
                        .get(*metric)
                        .is_some_and(|rule| baseline_matches(rule, *value))
                })
            })
            .cloned()
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    let promotion = PromotionEligibility {
        sandbox_id: sandbox_id.to_owned(),
        evidence_ref: evidence_ref.to_owned(),
        budget_id: budget_id.to_owned(),
        authority_sufficient,
        eligible: !passed_metrics.is_empty(),
        passed_metrics,
    };
    let artifact_ref = workspace.put(&promotion)?;
    workspace.append_event(
        PROMOTION_EVALUATED,
        sandbox_id,
        ActorRef::service("service://ilxyr/ratchet-v1"),
        Some(artifact_ref),
    )?;
    Ok(promotion)
}

fn baseline_matches(rule: &BaselineRule, value: f64) -> bool {
    match rule.operator {
        ComparisonOperator::Gt => value > rule.threshold,
        ComparisonOperator::Gte => value >= rule.threshold,
        ComparisonOperator::Lt => value < rule.threshold,
        ComparisonOperator::Lte => value <= rule.threshold,
        ComparisonOperator::Eq => false,
    }
}

fn certificate_matches(
    workspace: &Workspace,
    certificate: &Certificate,
    evidence: &Evidence,
) -> Result<bool> {
    match &certificate.predicate {
        CertificatePredicate::Metric {
            metric,
            operator,
            threshold,
        } => Ok(evidence
            .metrics
            .get(metric)
            .is_some_and(|value| comparison_matches(operator, *value, *threshold))),
        CertificatePredicate::ExecutionFailure => {
            let value: Value = workspace.get(&evidence.run_ref)?;
            if let Ok(run) = serde_json::from_value::<RunRecord>(value.clone()) {
                return Ok(run.exit_code != 0 || run.timed_out);
            }
            let run = serde_json::from_value::<SandboxRun>(value)?;
            Ok(run.exit_code != 0 || run.timed_out)
        }
    }
}

fn comparison_matches(operator: &ComparisonOperator, value: f64, threshold: f64) -> bool {
    match operator {
        ComparisonOperator::Gt => value > threshold,
        ComparisonOperator::Gte => value >= threshold,
        ComparisonOperator::Lt => value < threshold,
        ComparisonOperator::Lte => value <= threshold,
        ComparisonOperator::Eq => (value - threshold).abs() < f64::EPSILON,
    }
}

#[derive(Debug)]
struct CalibrationSample {
    forecast_id: String,
    probabilities: BTreeMap<String, f64>,
    resolved_outcome: String,
    brier_score: f64,
    settled_at_ms: u128,
}

fn refresh_calibration(workspace: &Workspace, handle: &str) -> Result<CalibrationRecord> {
    let mut samples = Vec::new();
    for event in workspace
        .events()?
        .into_iter()
        .filter(|event| event.event_type == FORECAST_SETTLED)
    {
        let artifact_ref = required_artifact(&event)?;
        let settlement: ForecastSettlement = workspace.get(&artifact_ref)?;
        let forecast =
            latest_typed::<Forecast>(workspace, FORECAST_SUBMITTED, &settlement.forecast_id)?
                .ok_or_else(|| Error::NotFound(format!("forecast {}", settlement.forecast_id)))?;
        if actor_identity(&forecast.forecaster) == handle {
            samples.push(CalibrationSample {
                forecast_id: forecast.id,
                probabilities: forecast.probabilities,
                resolved_outcome: settlement.resolved_outcome,
                brier_score: settlement.brier_score,
                settled_at_ms: event.occurred_at_ms,
            });
        }
    }
    if samples.is_empty() {
        return Err(Error::NotFound(format!("settled forecasts for {handle}")));
    }
    samples.sort_by(|left, right| left.forecast_id.cmp(&right.forecast_id));
    let forecast_ids = samples
        .iter()
        .map(|sample| sample.forecast_id.clone())
        .collect::<Vec<_>>();
    if let Some(existing) = calibration_for(workspace, handle)? {
        if existing.forecast_ids == forecast_ids {
            return Ok(existing);
        }
    }
    let record = calculate_calibration(handle, &samples)?;
    let artifact_ref = workspace.put(&record)?;
    workspace.append_event(
        CALIBRATION_UPDATED,
        handle,
        ActorRef::service("service://ilxyr/calibration-v1"),
        Some(artifact_ref),
    )?;
    Ok(record)
}

fn calculate_calibration(handle: &str, samples: &[CalibrationSample]) -> Result<CalibrationRecord> {
    let outcomes = samples
        .iter()
        .flat_map(|sample| sample.probabilities.keys().cloned())
        .chain(samples.iter().map(|sample| sample.resolved_outcome.clone()))
        .collect::<BTreeSet<_>>();
    let count = samples.len() as f64;
    let base_rates = outcomes
        .iter()
        .map(|outcome| {
            let observed = samples
                .iter()
                .filter(|sample| sample.resolved_outcome == *outcome)
                .count() as f64;
            (outcome.clone(), observed / count)
        })
        .collect::<BTreeMap<_, _>>();
    let uncertainty = (1.0 - base_rates.values().map(|rate| rate.powi(2)).sum::<f64>()).max(0.0);

    let mut groups: BTreeMap<String, Vec<&CalibrationSample>> = BTreeMap::new();
    for sample in samples {
        let key = serde_json::to_string(&sample.probabilities)?;
        groups.entry(key).or_default().push(sample);
    }
    let mut reliability = 0.0;
    let mut resolution = 0.0;
    for group in groups.values() {
        let group_weight = group.len() as f64 / count;
        for outcome in &outcomes {
            let predicted = group
                .iter()
                .map(|sample| sample.probabilities.get(outcome).copied().unwrap_or(0.0))
                .sum::<f64>()
                / group.len() as f64;
            let observed = group
                .iter()
                .filter(|sample| sample.resolved_outcome == *outcome)
                .count() as f64
                / group.len() as f64;
            reliability += group_weight * (predicted - observed).powi(2);
            resolution += group_weight * (observed - base_rates[outcome]).powi(2);
        }
    }
    let brier_score = samples.iter().map(|sample| sample.brier_score).sum::<f64>() / count;
    let last_settlement_at_ms = samples
        .iter()
        .map(|sample| sample.settled_at_ms)
        .max()
        .unwrap_or(0);
    Ok(CalibrationRecord {
        schema: "ilxyr.calibration_record.v1".to_owned(),
        handle: handle.to_owned(),
        forecasts_settled: samples.len(),
        reliability,
        resolution,
        brier_score,
        uncertainty,
        probationary: samples.len() < CALIBRATION_MINIMUM,
        last_settlement_at_ms,
        forecast_ids: samples
            .iter()
            .map(|sample| sample.forecast_id.clone())
            .collect(),
    })
}

fn allocations_for(workspace: &Workspace, budget_id: &str) -> Result<Vec<AllocationRecord>> {
    Ok(
        artifacts_for::<AllocationRecord>(workspace, ALLOCATION_COMMITTED)?
            .into_iter()
            .filter(|allocation| allocation.budget_id == budget_id)
            .collect(),
    )
}

fn checked_allocation_total(
    allocations: &[AllocationRecord],
    include: impl Fn(&AllocationRecord) -> bool,
) -> Result<u64> {
    allocations
        .iter()
        .filter(|allocation| include(allocation))
        .try_fold(0_u64, |total, allocation| {
            total
                .checked_add(allocation.compute_credits)
                .ok_or_else(|| Error::Conflict("allocation total exceeds u64 capacity".to_owned()))
        })
}

fn percentage_threshold_crossed(total: u64, capacity: u64, percentage: f64) -> Result<bool> {
    let threshold_basis_points = percentage_basis_points(percentage)?;
    Ok(u128::from(total) * BASIS_POINTS_PER_WHOLE >= u128::from(capacity) * threshold_basis_points)
}

fn percentage_basis_points(percentage: f64) -> Result<u128> {
    if !percentage.is_finite() || !(0.0..=100.0).contains(&percentage) {
        return Err(Error::Validation(vec![
            "percentage must be finite and between 0 and 100".to_owned(),
        ]));
    }
    let scaled = percentage * 100.0;
    let rounded = scaled.round();
    if (scaled - rounded).abs() > 1e-9 {
        return Err(Error::Validation(vec![
            "percentage must use no more than two decimal places".to_owned(),
        ]));
    }
    Ok(rounded as u128)
}

fn allocation_id(budget_id: &str, kind: AllocationKind, experiment_id: &str) -> String {
    let kind = match kind {
        AllocationKind::Promoted => "promoted",
        AllocationKind::Sandbox => "sandbox",
    };
    format!("allocation:{budget_id}:{kind}:{experiment_id}")
}

fn load_compiled(workspace: &Workspace, experiment_id: &str) -> Result<CompiledExperiment> {
    latest_typed(workspace, EXPERIMENT_COMPILED, experiment_id)?
        .ok_or_else(|| Error::NotFound(format!("compiled experiment {experiment_id}")))
}

fn registered_budget_with_ref(
    workspace: &Workspace,
    budget_id: &str,
) -> Result<(String, EpochBudget)> {
    latest_typed_with_ref(workspace, EPOCH_BUDGET_REGISTERED, budget_id)?
        .ok_or_else(|| Error::NotFound(format!("epoch budget {budget_id}")))
}

fn forecasts_for(workspace: &Workspace, experiment_id: &str) -> Result<Vec<Forecast>> {
    Ok(artifacts_for::<Forecast>(workspace, FORECAST_SUBMITTED)?
        .into_iter()
        .filter(|forecast| forecast.experiment_id == experiment_id)
        .collect())
}

fn artifacts_for<T: DeserializeOwned>(workspace: &Workspace, event_type: &str) -> Result<Vec<T>> {
    workspace
        .events()?
        .into_iter()
        .filter(|event| event.event_type == event_type)
        .map(|event| {
            let artifact_ref = required_artifact(&event)?;
            workspace.get(&artifact_ref)
        })
        .collect()
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
            let artifact_ref = required_artifact(&event)?;
            let object = workspace.get(&artifact_ref)?;
            Ok((artifact_ref, object))
        })
        .transpose()
}

fn required_artifact(event: &crate::ResearchEvent) -> Result<String> {
    event.artifact_ref.clone().ok_or_else(|| {
        Error::Conflict(format!(
            "{} event is missing its artifact reference",
            event.event_type
        ))
    })
}

fn actor_identity(actor: &ActorRef) -> &str {
    if actor.kind == ActorKind::Model {
        actor.model_ref.as_deref().unwrap_or(&actor.id)
    } else {
        &actor.id
    }
}
