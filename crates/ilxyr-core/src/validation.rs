use std::collections::BTreeSet;

use crate::{
    ActorKind, ActorRef, AuthorityLevel, Certificate, CertificateDomain, CertificatePredicate,
    CodePolicy, ComparisonOperator, EpochBudget, Error, ExperimentSpec, ExportPolicy, Forecast,
    FundingCommitment, GroundingAuthority, NetworkPolicy, OutcomePredicate, ResearchContribution,
    Result, RetroRegistrationSpec, SandboxSpec, SharedTaskContract, TrustedPolicyKey, WeightClass,
};

pub fn contribution(contribution: &ResearchContribution) -> Result<()> {
    let mut errors = Vec::new();
    schema(&contribution.schema, "ilxyr.contribution.v1", &mut errors);
    identifier(&contribution.id, "contribution.id", &mut errors);
    actor(&contribution.actor, &mut errors);
    nonempty(&contribution.title, "contribution.title", &mut errors);
    nonempty(&contribution.body, "contribution.body", &mut errors);
    for input_ref in &contribution.input_refs {
        identifier(input_ref, "contribution.input_refs[]", &mut errors);
    }
    for claim in &contribution.claims {
        nonempty(claim, "contribution.claims[]", &mut errors);
    }
    if !(0.0..=1.0).contains(&contribution.confidence) {
        errors.push("contribution.confidence must be between 0 and 1".to_owned());
    }
    finish(errors)
}

pub fn experiment(spec: &ExperimentSpec) -> Result<()> {
    let mut errors = Vec::new();
    schema(&spec.schema, "ilxyr.experiment.v1", &mut errors);
    identifier(&spec.id, "experiment.id", &mut errors);
    actor(&spec.proposer, &mut errors);
    if spec.shared_task_id.is_some() && spec.family.is_none() {
        errors.push("experiment.family is required when shared_task_id is declared".to_owned());
    }
    if let Some(shared_task_id) = &spec.shared_task_id {
        identifier(shared_task_id, "experiment.shared_task_id", &mut errors);
    }
    nonempty(&spec.title, "experiment.title", &mut errors);
    nonempty(&spec.hypothesis, "experiment.hypothesis", &mut errors);
    nonempty(&spec.rationale, "experiment.rationale", &mut errors);
    handle(&spec.baseline, "experiment.baseline", None, &mut errors);

    unique_strings(&spec.datasets, "experiment.datasets", &mut errors);
    for dataset in &spec.datasets {
        handle(
            dataset,
            "experiment.datasets[]",
            Some("dataset://"),
            &mut errors,
        );
    }
    unique_strings(&spec.models, "experiment.models", &mut errors);
    for model in &spec.models {
        handle(model, "experiment.models[]", Some("weight://"), &mut errors);
    }

    if spec.metrics.is_empty() {
        errors.push("experiment.metrics must not be empty".to_owned());
    }
    for metric in &spec.metrics {
        nonempty(&metric.name, "experiment.metrics[].name", &mut errors);
        nonempty(
            &metric.description,
            "experiment.metrics[].description",
            &mut errors,
        );
    }
    let metric_names = spec
        .metrics
        .iter()
        .map(|metric| metric.name.as_str())
        .collect::<BTreeSet<_>>();
    if metric_names.len() != spec.metrics.len() {
        errors.push("experiment.metrics contains duplicate names".to_owned());
    }
    nonempty(
        &spec.outcome_contract.primary_metric,
        "outcome_contract.primary_metric",
        &mut errors,
    );
    if !metric_names.contains(spec.outcome_contract.primary_metric.as_str()) {
        errors.push("outcome_contract.primary_metric is not declared in metrics".to_owned());
    }
    if spec.seeds.is_empty() {
        errors.push("experiment.seeds must not be empty".to_owned());
    }
    if spec.seeds.iter().collect::<BTreeSet<_>>().len() != spec.seeds.len() {
        errors.push("experiment.seeds contains duplicates".to_owned());
    }
    authority(&spec.evidence_authority, &mut errors);
    if spec.evidence_authority.scope.seeds != spec.seeds {
        errors.push("evidence_authority.scope.seeds must equal experiment.seeds".to_owned());
    }
    if let Some(eval_set) = &spec.evidence_authority.scope.eval_set {
        if !spec.datasets.contains(eval_set) {
            errors
                .push("evidence_authority.scope.eval_set must be declared in datasets".to_owned());
        }
    }

    let outcomes = &spec.outcome_contract.outcomes;
    if outcomes.len() < 2 {
        errors.push("outcome_contract must declare at least two outcomes".to_owned());
    }
    let outcome_ids = outcomes
        .iter()
        .map(|outcome| outcome.id.as_str())
        .collect::<BTreeSet<_>>();
    if outcome_ids.len() != outcomes.len() {
        errors.push("outcome_contract contains duplicate outcome ids".to_owned());
    }
    if !outcome_ids.contains(spec.outcome_contract.success_outcome.as_str()) {
        errors.push("outcome_contract.success_outcome is not declared".to_owned());
    }
    for outcome in outcomes {
        identifier(&outcome.id, "outcome.id", &mut errors);
        nonempty(&outcome.description, "outcome.description", &mut errors);
        if let OutcomePredicate::Metric {
            metric,
            operator,
            threshold,
        } = &outcome.predicate
        {
            if !metric_names.contains(metric.as_str()) {
                errors.push(format!(
                    "outcome {} refers to undeclared metric {metric}",
                    outcome.id
                ));
            }
            if !threshold.is_finite() {
                errors.push(format!("outcome {} has a non-finite threshold", outcome.id));
            }
            if matches!(operator, ComparisonOperator::Eq) {
                errors.push(format!(
                    "outcome {} uses exact floating-point equality; use a bounded outcome",
                    outcome.id
                ));
            }
        }
    }

    nonempty(&spec.execution.executor, "execution.executor", &mut errors);
    nonempty(&spec.execution.program, "execution.program", &mut errors);
    if spec.execution.program.contains('\0') {
        errors.push("execution.program must not contain a NUL byte".to_owned());
    }
    if spec.execution.args.iter().any(|arg| arg.contains('\0')) {
        errors.push("execution.args must not contain NUL bytes".to_owned());
    }
    if spec.execution.timeout_seconds == 0 {
        errors.push("execution.timeout_seconds must be positive".to_owned());
    }
    if spec.execution.max_cost_credits == 0 {
        errors.push("execution.max_cost_credits must be positive".to_owned());
    }
    if spec.funding.required_compute_credits < spec.execution.max_cost_credits {
        errors.push(
            "funding.required_compute_credits must cover execution.max_cost_credits".to_owned(),
        );
    }
    if spec.funding.minimum_forecasters == 0 {
        errors.push("funding.minimum_forecasters must be positive".to_owned());
    }
    if spec.funding.minimum_total_stake == 0 {
        errors.push("funding.minimum_total_stake must be positive".to_owned());
    }
    if spec.expected_outputs.is_empty() {
        errors.push("experiment.expected_outputs must not be empty".to_owned());
    }
    unique_strings(
        &spec.expected_outputs,
        "experiment.expected_outputs",
        &mut errors,
    );
    for expected_output in &spec.expected_outputs {
        nonempty(
            expected_output,
            "experiment.expected_outputs[]",
            &mut errors,
        );
        if let Some(metric) = expected_output.strip_prefix("metrics.") {
            if !metric_names.contains(metric) {
                errors.push(format!(
                    "expected output {expected_output} refers to undeclared metric {metric}"
                ));
            }
        }
    }
    let primary_output = format!("metrics.{}", spec.outcome_contract.primary_metric);
    if !spec.expected_outputs.contains(&primary_output) {
        errors.push(format!(
            "experiment.expected_outputs must include primary metric {primary_output}"
        ));
    }

    if spec.security.weight_class != WeightClass::Public {
        if spec.security.code_policy != CodePolicy::ApprovedImageOnly {
            errors.push("non-public weights require code_policy=approved_image_only".to_owned());
        }
        if spec.execution.network != NetworkPolicy::Denied {
            errors.push("non-public weights require network=denied".to_owned());
        }
    }
    if spec.security.weight_class == WeightClass::Restricted
        && !matches!(
            spec.security.export_policy,
            ExportPolicy::MetricsOnly | ExportPolicy::None
        )
    {
        errors.push("restricted weights permit only metrics_only or no export".to_owned());
    }

    finish(errors)
}

pub fn shared_task(contract: &SharedTaskContract) -> Result<()> {
    let mut errors = Vec::new();
    schema(&contract.schema, "ilxyr.shared_task.v1", &mut errors);
    identifier(&contract.id, "shared_task.id", &mut errors);
    nonempty(&contract.title, "shared_task.title", &mut errors);
    artifact_binding(
        &contract.dataset,
        "shared_task.dataset",
        "dataset://",
        &mut errors,
    );
    artifact_binding(
        &contract.eval_set,
        "shared_task.eval_set",
        "dataset://",
        &mut errors,
    );
    if contract.dataset.handle == contract.eval_set.handle {
        errors.push("shared_task dataset and eval_set handles must be distinct".to_owned());
    }
    if contract.metrics.is_empty() {
        errors.push("shared_task.metrics must not be empty".to_owned());
    }
    let metric_names = contract
        .metrics
        .iter()
        .map(|metric| metric.name.as_str())
        .collect::<BTreeSet<_>>();
    if metric_names.len() != contract.metrics.len() {
        errors.push("shared_task.metrics contains duplicate names".to_owned());
    }
    for metric in &contract.metrics {
        nonempty(&metric.name, "shared_task.metrics[].name", &mut errors);
        nonempty(&metric.unit, "shared_task.metrics[].unit", &mut errors);
        nonempty(
            &metric.description,
            "shared_task.metrics[].description",
            &mut errors,
        );
    }
    if contract.seeds.is_empty() {
        errors.push("shared_task.seeds must not be empty".to_owned());
    }
    if contract.seeds.iter().collect::<BTreeSet<_>>().len() != contract.seeds.len() {
        errors.push("shared_task.seeds contains duplicates".to_owned());
    }
    if contract.family_bindings.len() != 2 {
        errors.push("shared_task must bind exactly the zero and solomon families".to_owned());
    }
    let families = contract
        .family_bindings
        .iter()
        .map(|binding| &binding.family)
        .collect::<BTreeSet<_>>();
    if families.len() != 2 {
        errors.push("shared_task family bindings must be unique".to_owned());
    }
    for binding in &contract.family_bindings {
        nonempty(
            &binding.encoding,
            "shared_task.family_bindings[].encoding",
            &mut errors,
        );
        nonempty(
            &binding.verifier,
            "shared_task.family_bindings[].verifier",
            &mut errors,
        );
        actor(&binding.designated_proposer, &mut errors);
    }
    finish(errors)
}

pub fn retro_registration(spec: &RetroRegistrationSpec) -> Result<()> {
    let mut errors = Vec::new();
    schema(
        &spec.schema,
        "ilxyr.retro_registration_spec.v1",
        &mut errors,
    );
    identifier(&spec.id, "retro_registration.id", &mut errors);
    nonempty(&spec.claim, "retro_registration.claim", &mut errors);
    if let Some(shared_task_id) = &spec.shared_task_id {
        identifier(
            shared_task_id,
            "retro_registration.shared_task_id",
            &mut errors,
        );
    }
    nonempty(
        &spec.source.repository,
        "retro_registration.source.repository",
        &mut errors,
    );
    if spec.source.commit.len() != 40
        || !spec
            .source
            .commit
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        errors.push("retro_registration.source.commit must be a 40-character Git hash".to_owned());
    }
    if spec.source.artifacts.is_empty() {
        errors.push("retro_registration.source.artifacts must not be empty".to_owned());
    }
    let artifact_paths = spec
        .source
        .artifacts
        .iter()
        .map(|artifact| artifact.path.as_str())
        .collect::<BTreeSet<_>>();
    if artifact_paths.len() != spec.source.artifacts.len() {
        errors.push("retro_registration.source.artifacts contains duplicate paths".to_owned());
    }
    for artifact in &spec.source.artifacts {
        nonempty(
            &artifact.path,
            "retro_registration.source.artifacts[].path",
            &mut errors,
        );
        sha256(
            &artifact.sha256,
            "retro_registration.source.artifacts[].sha256",
            &mut errors,
        );
    }
    if spec.metrics.is_empty() {
        errors.push("retro_registration.metrics must not be empty".to_owned());
    }
    let metric_names = spec
        .metrics
        .iter()
        .map(|metric| metric.name.as_str())
        .collect::<BTreeSet<_>>();
    if metric_names.len() != spec.metrics.len() {
        errors.push("retro_registration.metrics contains duplicate names".to_owned());
    }
    for metric in &spec.metrics {
        nonempty(
            &metric.name,
            "retro_registration.metrics[].name",
            &mut errors,
        );
        nonempty(
            &metric.description,
            "retro_registration.metrics[].description",
            &mut errors,
        );
    }
    if spec.seeds.is_empty() {
        errors.push("retro_registration.seeds must not be empty".to_owned());
    }
    if spec.seeds.iter().collect::<BTreeSet<_>>().len() != spec.seeds.len() {
        errors.push("retro_registration.seeds contains duplicates".to_owned());
    }
    if spec.authority.scope.seeds != spec.seeds {
        errors.push("retro_registration authority seeds must equal registration seeds".to_owned());
    }
    authority(&spec.authority, &mut errors);
    if !matches!(
        spec.authority.level,
        AuthorityLevel::ExactCheck | AuthorityLevel::DeterministicReplay
    ) {
        errors.push(
            "retro-registration requires exact_check or deterministic_replay authority".to_owned(),
        );
    }
    absolute_program(
        &spec.replay.program,
        "retro_registration.replay.program",
        &mut errors,
    );
    if spec.replay.args.iter().any(|arg| arg.contains('\0')) {
        errors.push("retro_registration.replay.args must not contain NUL bytes".to_owned());
    }
    if spec.replay.timeout_seconds == 0 {
        errors.push("retro_registration.replay.timeout_seconds must be positive".to_owned());
    }
    if spec.replay.network != NetworkPolicy::Open {
        errors.push("the local retro replay executor requires network=open".to_owned());
    }
    finish(errors)
}

pub fn forecast(forecast: &Forecast, spec: &ExperimentSpec) -> Result<()> {
    let mut errors = Vec::new();
    schema(&forecast.schema, "ilxyr.forecast.v1", &mut errors);
    identifier(&forecast.id, "forecast.id", &mut errors);
    actor(&forecast.forecaster, &mut errors);
    if forecast.experiment_id != spec.id {
        errors.push("forecast.experiment_id does not match the experiment".to_owned());
    }
    if forecast.stake == 0 {
        errors.push("forecast.stake must be positive".to_owned());
    }
    nonempty(&forecast.rationale, "forecast.rationale", &mut errors);

    let expected = spec
        .outcome_contract
        .outcomes
        .iter()
        .map(|outcome| outcome.id.as_str())
        .collect::<BTreeSet<_>>();
    let actual = forecast
        .probabilities
        .keys()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    if actual != expected {
        errors.push(
            "forecast.probabilities must contain every declared outcome exactly once".to_owned(),
        );
    }
    if forecast
        .probabilities
        .values()
        .any(|probability| !probability.is_finite() || !(0.0..=1.0).contains(probability))
    {
        errors.push("forecast probabilities must be finite and between 0 and 1".to_owned());
    }
    let sum: f64 = forecast.probabilities.values().sum();
    if (sum - 1.0).abs() > 1e-9 {
        errors.push(format!("forecast probabilities must sum to 1, got {sum}"));
    }
    finish(errors)
}

pub fn funding(commitment: &FundingCommitment, spec: &ExperimentSpec) -> Result<()> {
    let mut errors = Vec::new();
    schema(&commitment.schema, "ilxyr.funding.v1", &mut errors);
    identifier(&commitment.id, "funding.id", &mut errors);
    actor(&commitment.funder, &mut errors);
    if commitment.experiment_id != spec.id {
        errors.push("funding.experiment_id does not match the experiment".to_owned());
    }
    if commitment.compute_credits == 0 {
        errors.push("funding.compute_credits must be positive".to_owned());
    }
    nonempty(&commitment.rationale, "funding.rationale", &mut errors);
    finish(errors)
}

pub fn trusted_policy_key(key: &TrustedPolicyKey) -> Result<()> {
    let mut errors = Vec::new();
    schema(&key.schema, "ilxyr.trusted_policy_key.v1", &mut errors);
    handle(
        &key.key_id,
        "policy_key.key_id",
        Some("key://"),
        &mut errors,
    );
    actor(&key.owner, &mut errors);
    if key.owner.kind != ActorKind::Human {
        errors.push("policy key owner must be a human actor".to_owned());
    }
    nonempty(&key.public_key, "policy_key.public_key", &mut errors);
    finish(errors)
}

pub fn epoch_budget(budget: &EpochBudget) -> Result<()> {
    let mut errors = Vec::new();
    schema(&budget.schema, "ilxyr.epoch_budget.v1", &mut errors);
    identifier(&budget.id, "epoch_budget.id", &mut errors);
    if budget.epoch == 0 {
        errors.push("epoch_budget.epoch must be positive".to_owned());
    }
    if budget.total_compute_credits == 0 {
        errors.push("epoch_budget.total_compute_credits must be positive".to_owned());
    }
    finite_percentage(
        budget.replication_reserve_pct,
        "epoch_budget.replication_reserve_pct",
        &mut errors,
    );
    if budget.per_executable_caps.is_empty() {
        errors.push("epoch_budget.per_executable_caps must not be empty".to_owned());
    }
    for (executable, cap) in &budget.per_executable_caps {
        absolute_program(
            executable,
            "epoch_budget.per_executable_caps key",
            &mut errors,
        );
        if cap.per_run_credits == 0 || cap.per_epoch_credits == 0 {
            errors.push(format!("credit caps for {executable} must be positive"));
        }
        if cap.per_epoch_credits < cap.per_run_credits {
            errors.push(format!(
                "per-epoch credit cap for {executable} must cover its per-run cap"
            ));
        }
        if cap.allowed_argument_sets.is_empty() {
            errors.push(format!(
                "argument allowlist for {executable} must not be empty"
            ));
        }
        if cap
            .allowed_argument_sets
            .iter()
            .collect::<BTreeSet<_>>()
            .len()
            != cap.allowed_argument_sets.len()
        {
            errors.push(format!(
                "argument allowlist for {executable} contains duplicates"
            ));
        }
        if cap
            .allowed_argument_sets
            .iter()
            .flatten()
            .any(|arg| arg.contains('\0'))
        {
            errors.push(format!(
                "argument allowlist for {executable} must not contain NUL bytes"
            ));
        }
    }
    unique_strings(
        &budget.allowlisted_executables,
        "epoch_budget.allowlisted_executables",
        &mut errors,
    );
    if budget.allowlisted_executables.is_empty() {
        errors.push("epoch_budget.allowlisted_executables must not be empty".to_owned());
    }
    for executable in &budget.allowlisted_executables {
        absolute_program(
            executable,
            "epoch_budget.allowlisted_executables[]",
            &mut errors,
        );
        if !budget.per_executable_caps.contains_key(executable) {
            errors.push(format!(
                "allowlisted executable {executable} has no credit cap"
            ));
        }
    }
    if budget
        .per_executable_caps
        .keys()
        .any(|executable| !budget.allowlisted_executables.contains(executable))
    {
        errors.push("every executable cap must name an allowlisted executable".to_owned());
    }
    unique_strings(
        &budget.promoted_metrics,
        "epoch_budget.promoted_metrics",
        &mut errors,
    );
    if budget.promoted_metrics.is_empty() {
        errors.push("epoch_budget.promoted_metrics must not be empty".to_owned());
    }
    let promoted = budget
        .promoted_metrics
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let baselines = budget
        .baselines
        .keys()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    if promoted != baselines {
        errors.push("epoch_budget.baselines must exactly cover promoted_metrics".to_owned());
    }
    for (metric, baseline) in &budget.baselines {
        if !baseline.threshold.is_finite() {
            errors.push(format!("baseline threshold for {metric} must be finite"));
        }
        if matches!(baseline.operator, ComparisonOperator::Eq) {
            errors.push(format!(
                "baseline rule for {metric} must not use exact equality"
            ));
        }
    }
    finite_percentage(
        budget.acknowledgement_thresholds.cumulative_spend_pct,
        "epoch_budget.acknowledgement_thresholds.cumulative_spend_pct",
        &mut errors,
    );
    handle(
        &budget.signed_by,
        "epoch_budget.signed_by",
        Some("human://"),
        &mut errors,
    );
    if budget.signature.algorithm != "ed25519" {
        errors.push("epoch_budget.signature.algorithm must be ed25519".to_owned());
    }
    handle(
        &budget.signature.key_id,
        "epoch_budget.signature.key_id",
        Some("key://"),
        &mut errors,
    );
    nonempty(
        &budget.signature.value,
        "epoch_budget.signature.value",
        &mut errors,
    );
    finish(errors)
}

pub fn sandbox(spec: &SandboxSpec) -> Result<()> {
    let mut errors = Vec::new();
    schema(&spec.schema, "ilxyr.sandbox_spec.v1", &mut errors);
    identifier(&spec.id, "sandbox.id", &mut errors);
    identifier(&spec.experiment_id, "sandbox.experiment_id", &mut errors);
    absolute_program(&spec.executable, "sandbox.executable", &mut errors);
    if spec.args.iter().any(|arg| arg.contains('\0')) {
        errors.push("sandbox.args must not contain NUL bytes".to_owned());
    }
    if spec.timeout_seconds == 0 {
        errors.push("sandbox.timeout_seconds must be positive".to_owned());
    }
    if spec.cost_credits == 0 {
        errors.push("sandbox.cost_credits must be positive".to_owned());
    }
    if spec.network != NetworkPolicy::Open {
        errors.push("the local sandbox executor requires network=open".to_owned());
    }
    if spec.metrics.is_empty() {
        errors.push("sandbox.metrics must not be empty".to_owned());
    }
    let metric_names = spec
        .metrics
        .iter()
        .map(|metric| metric.name.as_str())
        .collect::<BTreeSet<_>>();
    if metric_names.len() != spec.metrics.len() {
        errors.push("sandbox.metrics contains duplicate names".to_owned());
    }
    for metric in &spec.metrics {
        nonempty(&metric.name, "sandbox.metrics[].name", &mut errors);
        nonempty(
            &metric.description,
            "sandbox.metrics[].description",
            &mut errors,
        );
    }
    authority(&spec.authority, &mut errors);
    finish(errors)
}

pub fn certificate(certificate: &Certificate) -> Result<()> {
    let mut errors = Vec::new();
    schema(&certificate.schema, "ilxyr.certificate.v1", &mut errors);
    identifier(&certificate.id, "certificate.id", &mut errors);
    artifact_ref(
        &certificate.evidence_ref,
        "certificate.evidence_ref",
        &mut errors,
    );
    match &certificate.predicate {
        CertificatePredicate::Metric {
            metric, threshold, ..
        } => {
            nonempty(metric, "certificate.predicate.metric", &mut errors);
            if !threshold.is_finite() {
                errors.push("certificate predicate threshold must be finite".to_owned());
            }
        }
        CertificatePredicate::ExecutionFailure => {}
    }
    match &certificate.domain {
        CertificateDomain::Enumerated { values } => {
            if values.is_empty() {
                errors.push("certificate enumerated domain must not be empty".to_owned());
            }
            let unique = values
                .iter()
                .filter_map(|value| serde_json::to_string(value).ok())
                .collect::<BTreeSet<_>>();
            if unique.len() != values.len() {
                errors.push("certificate enumerated domain contains duplicates".to_owned());
            }
        }
        CertificateDomain::DecidableFragment {
            fragment,
            declaration,
        } => {
            nonempty(fragment, "certificate.domain.fragment", &mut errors);
            nonempty(declaration, "certificate.domain.declaration", &mut errors);
        }
    }
    nonempty(
        &certificate.checker.id,
        "certificate.checker.id",
        &mut errors,
    );
    nonempty(
        &certificate.checker.version,
        "certificate.checker.version",
        &mut errors,
    );
    if certificate.checked_artifacts.is_empty() {
        errors.push("certificate.checked_artifacts must not be empty".to_owned());
    }
    unique_strings(
        &certificate.checked_artifacts,
        "certificate.checked_artifacts",
        &mut errors,
    );
    for checked in &certificate.checked_artifacts {
        artifact_ref(checked, "certificate.checked_artifacts[]", &mut errors);
    }
    finish(errors)
}

fn authority(authority: &GroundingAuthority, errors: &mut Vec<String>) {
    if authority.scope.seeds.is_empty() {
        errors.push("authority.scope.seeds must not be empty".to_owned());
    }
    if authority.scope.seeds.iter().collect::<BTreeSet<_>>().len() != authority.scope.seeds.len() {
        errors.push("authority.scope.seeds contains duplicates".to_owned());
    }
    if let Some(eval_set) = &authority.scope.eval_set {
        handle(eval_set, "authority.scope.eval_set", None, errors);
        if !eval_set.starts_with("dataset://") && !eval_set.starts_with("artifact://") {
            errors.push("authority.scope.eval_set must use dataset:// or artifact://".to_owned());
        }
    }
    if let Some(coverage) = authority.scope.coverage {
        if !coverage.is_finite() || !(0.0..=1.0).contains(&coverage) {
            errors.push("authority.scope.coverage must be finite and between 0 and 1".to_owned());
        }
    }
    unique_strings(
        &authority.provenance.artifact_hashes,
        "authority.provenance.artifact_hashes",
        errors,
    );
    for artifact in &authority.provenance.artifact_hashes {
        artifact_ref(artifact, "authority.provenance.artifact_hashes[]", errors);
    }
    if let Some(model_lineage) = &authority.provenance.model_lineage {
        handle(
            model_lineage,
            "authority.provenance.model_lineage",
            Some("model://"),
            errors,
        );
    }
    nonempty(
        &authority.provenance.checker,
        "authority.provenance.checker",
        errors,
    );
    if matches!(authority.level, AuthorityLevel::ExactCheck)
        && authority.scope.coverage != Some(1.0)
    {
        errors.push("exact_check authority requires scope.coverage=1".to_owned());
    }
}

fn schema(actual: &str, expected: &str, errors: &mut Vec<String>) {
    if actual != expected {
        errors.push(format!("schema must be {expected}, got {actual}"));
    }
}

fn actor(actor: &ActorRef, errors: &mut Vec<String>) {
    nonempty(&actor.id, "actor.id", errors);
    let expected_prefix = match actor.kind {
        ActorKind::Human => "human://",
        ActorKind::Model => "model://",
        ActorKind::Service => "service://",
    };
    handle(&actor.id, "actor.id", Some(expected_prefix), errors);
    match (&actor.kind, &actor.model_ref) {
        (ActorKind::Model, Some(model_ref)) => {
            handle(model_ref, "actor.model_ref", Some("model://"), errors);
        }
        (ActorKind::Model, None) => {
            errors.push("model actors require actor.model_ref".to_owned());
        }
        (_, Some(_)) => {
            errors.push("only model actors may declare actor.model_ref".to_owned());
        }
        (_, None) => {}
    }
}

fn identifier(value: &str, field: &str, errors: &mut Vec<String>) {
    nonempty(value, field, errors);
    if !value.bytes().all(|byte| {
        byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b'/' | b':')
    }) {
        errors.push(format!(
            "{field} may contain only ASCII letters, numbers, '.', '_', '-', '/', and ':'"
        ));
    }
}

fn absolute_program(value: &str, field: &str, errors: &mut Vec<String>) {
    nonempty(value, field, errors);
    if !std::path::Path::new(value).is_absolute() {
        errors.push(format!("{field} must be an absolute path"));
    }
    if value.contains('\0') {
        errors.push(format!("{field} must not contain a NUL byte"));
    }
}

fn finite_percentage(value: f64, field: &str, errors: &mut Vec<String>) {
    if !value.is_finite() || !(0.0..=100.0).contains(&value) {
        errors.push(format!("{field} must be finite and between 0 and 100"));
    } else if (value * 100.0 - (value * 100.0).round()).abs() > 1e-9 {
        errors.push(format!("{field} must use no more than two decimal places"));
    }
}

fn artifact_ref(value: &str, field: &str, errors: &mut Vec<String>) {
    let digest = value.strip_prefix("artifact://sha256/");
    if digest.is_none_or(|digest| {
        digest.len() != 64
            || !digest
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    }) {
        errors.push(format!(
            "{field} must be an artifact://sha256/ reference with a lowercase digest"
        ));
    }
}

fn artifact_binding(
    binding: &crate::ArtifactBinding,
    field: &str,
    prefix: &str,
    errors: &mut Vec<String>,
) {
    handle(
        &binding.handle,
        &format!("{field}.handle"),
        Some(prefix),
        errors,
    );
    sha256(&binding.sha256, &format!("{field}.sha256"), errors);
}

fn sha256(value: &str, field: &str, errors: &mut Vec<String>) {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        errors.push(format!(
            "{field} must be a 64-character lowercase SHA-256 digest"
        ));
    }
}

fn handle(value: &str, field: &str, prefix: Option<&str>, errors: &mut Vec<String>) {
    let valid = value.split_once("://").is_some_and(|(scheme, rest)| {
        let mut characters = scheme.chars();
        characters
            .next()
            .is_some_and(|first| first.is_ascii_alphabetic())
            && characters.all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '+' | '.' | '-')
            })
            && !rest.is_empty()
            && !rest.chars().any(char::is_whitespace)
    });
    if !valid {
        errors.push(format!("{field} must be an opaque URI handle"));
    }
    if let Some(prefix) = prefix {
        if !value.starts_with(prefix) {
            errors.push(format!("{field} must start with {prefix}"));
        }
    }
    if value.starts_with('/') || value.starts_with("file://") {
        errors.push(format!("{field} must not expose a filesystem path"));
    }
}

fn nonempty(value: &str, field: &str, errors: &mut Vec<String>) {
    if value.trim().is_empty() {
        errors.push(format!("{field} must not be empty"));
    }
}

fn unique_strings(values: &[String], field: &str, errors: &mut Vec<String>) {
    if values.iter().collect::<BTreeSet<_>>().len() != values.len() {
        errors.push(format!("{field} contains duplicates"));
    }
}

fn finish(errors: Vec<String>) -> Result<()> {
    if errors.is_empty() {
        Ok(())
    } else {
        Err(Error::Validation(errors))
    }
}
