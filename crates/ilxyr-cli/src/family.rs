use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
};

use ilxyr_core::{
    CompiledExperiment, CompletedExperiment, Error, ExperimentFamilyContract,
    ExperimentFamilyMember, ExperimentFamilyStatus, ExperimentSpec, Forecast, FundingCommitment,
    PriorFamilyOutcome, ResearchContribution, Result, SettledFamilyReport, Workspace,
    commit_funding, compile_experiment, decide_admission, experiment_family_status,
    register_experiment_family, registered_experiment_family, run_experiment,
    settle_experiment_family, submit_contribution, submit_forecast,
};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;

const CONTRIBUTION_SUBMITTED: &str = "ContributionSubmitted";
const EXPERIMENT_COMPILED: &str = "ExperimentCompiled";
const FORECAST_SUBMITTED: &str = "ForecastSubmitted";
const FUNDING_COMMITTED: &str = "FundingCommitted";
const EXECUTION_STARTED: &str = "ExecutionStarted";

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct FamilyManifest {
    schema: String,
    id: String,
    title: String,
    contributions: Vec<PathBuf>,
    members: Vec<ManifestMember>,
    #[serde(default)]
    prior_outcomes: Vec<PriorFamilyOutcome>,
    run_all: bool,
    success_outcome: String,
    failure_outcome: String,
    #[serde(default)]
    promotion_candidate: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct ManifestMember {
    seed: u64,
    required_outcome: String,
    experiment: PathBuf,
    forecasts: Vec<PathBuf>,
    funding: Vec<PathBuf>,
}

#[derive(Debug, Clone)]
struct LoadedFamily {
    contract: ExperimentFamilyContract,
    contributions: Vec<ResearchContribution>,
    members: Vec<LoadedMember>,
}

#[derive(Debug, Clone)]
struct LoadedMember {
    seed: u64,
    required_outcome: String,
    experiment: ExperimentSpec,
    forecasts: Vec<Forecast>,
    funding: Vec<FundingCommitment>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FamilyFreezeReport {
    pub family_id: String,
    pub family_ref: String,
    pub contributions_frozen: usize,
    pub members_frozen: usize,
    pub total_compute_credits: u64,
    pub status: ExperimentFamilyStatus,
}

#[derive(Debug, Clone, Serialize)]
pub struct MemberAdmissionReport {
    pub experiment_id: String,
    pub seed: u64,
    pub protocol_admitted: bool,
    pub ready: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub failed_gates: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FamilyCheckReport {
    pub family_id: String,
    pub ready: bool,
    pub members: Vec<MemberAdmissionReport>,
    pub status: ExperimentFamilyStatus,
}

#[derive(Debug, Clone, Serialize)]
pub struct MemberRunReport {
    pub experiment_id: String,
    pub seed: u64,
    pub completed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_outcome: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FamilyRunReport {
    pub family_id: String,
    pub attempted_all_members: bool,
    pub completed_without_errors: bool,
    pub members: Vec<MemberRunReport>,
    pub status: ExperimentFamilyStatus,
}

impl FamilyRunReport {
    #[must_use]
    pub fn has_errors(&self) -> bool {
        self.members.iter().any(|member| member.error.is_some())
    }
}

pub fn freeze(workspace: &Workspace, manifest_path: &Path) -> Result<FamilyFreezeReport> {
    let loaded = load_family(manifest_path)?;
    let mut execution_started = false;
    for member in &loaded.members {
        execution_started |= workspace
            .latest_event(EXECUTION_STARTED, &member.experiment.id)?
            .is_some();
    }

    if execution_started {
        assert_registered_contract(workspace, &loaded.contract)?;
        verify_frozen(workspace, &loaded)?;
        return freeze_report(workspace, &loaded);
    }

    register_experiment_family(workspace, loaded.contract.clone())?;
    for contribution in &loaded.contributions {
        ensure_contribution(workspace, contribution)?;
    }

    for member in &loaded.members {
        ensure_experiment(workspace, &member.experiment)?;
        for forecast in &member.forecasts {
            ensure_forecast(workspace, forecast)?;
        }
        for funding in &member.funding {
            ensure_funding(workspace, funding)?;
        }
    }
    freeze_report(workspace, &loaded)
}

pub fn check(workspace: &Workspace, manifest_path: &Path) -> Result<FamilyCheckReport> {
    let loaded = load_and_verify_frozen(workspace, manifest_path)?;
    let mut members = Vec::with_capacity(loaded.members.len());
    for member in &loaded.members {
        match decide_admission(workspace, &member.experiment.id) {
            Ok(decision) => {
                let mut failed_gates = decision
                    .checks
                    .iter()
                    .filter(|check| !check.passed)
                    .map(|check| check.gate.clone())
                    .collect::<Vec<_>>();
                if !Path::new(&member.experiment.execution.program).is_file() {
                    failed_gates.push("local_program_exists".to_owned());
                }
                let ready = decision.accepted && failed_gates.is_empty();
                members.push(MemberAdmissionReport {
                    experiment_id: member.experiment.id.clone(),
                    seed: member.seed,
                    protocol_admitted: decision.accepted,
                    ready,
                    failed_gates,
                    error: None,
                });
            }
            Err(error) => members.push(MemberAdmissionReport {
                experiment_id: member.experiment.id.clone(),
                seed: member.seed,
                protocol_admitted: false,
                ready: false,
                failed_gates: Vec::new(),
                error: Some(error.to_string()),
            }),
        }
    }
    let ready = members.iter().all(|member| member.ready);
    Ok(FamilyCheckReport {
        family_id: loaded.contract.id.clone(),
        ready,
        members,
        status: experiment_family_status(workspace, &loaded.contract.id)?,
    })
}

pub fn run(workspace: &Workspace, manifest_path: &Path) -> Result<FamilyRunReport> {
    let loaded = load_and_verify_frozen(workspace, manifest_path)?;
    let before = experiment_family_status(workspace, &loaded.contract.id)?;
    if !before.all_members_admitted {
        return Err(Error::Conflict(
            "every family member must be admitted before any family run starts".to_owned(),
        ));
    }
    let missing_programs = loaded
        .members
        .iter()
        .filter(|member| !Path::new(&member.experiment.execution.program).is_file())
        .map(|member| member.experiment.execution.program.as_str())
        .collect::<BTreeSet<_>>();
    if !missing_programs.is_empty() {
        return Err(Error::Conflict(format!(
            "family executables are not materialized: {}",
            missing_programs.into_iter().collect::<Vec<_>>().join(", ")
        )));
    }

    let mut members = Vec::with_capacity(loaded.members.len());
    for member in &loaded.members {
        members.push(match run_experiment(workspace, &member.experiment.id) {
            Ok(completed) => completed_member(member, completed),
            Err(error) => MemberRunReport {
                experiment_id: member.experiment.id.clone(),
                seed: member.seed,
                completed: false,
                run_ref: None,
                resolved_outcome: None,
                error: Some(error.to_string()),
            },
        });
    }
    let completed_without_errors = members.iter().all(|member| member.error.is_none());
    Ok(FamilyRunReport {
        family_id: loaded.contract.id.clone(),
        attempted_all_members: members.len() == loaded.members.len(),
        completed_without_errors,
        members,
        status: experiment_family_status(workspace, &loaded.contract.id)?,
    })
}

pub fn settle(workspace: &Workspace, manifest_path: &Path) -> Result<SettledFamilyReport> {
    let loaded = load_and_verify_frozen(workspace, manifest_path)?;
    settle_experiment_family(workspace, &loaded.contract.id)
}

fn completed_member(member: &LoadedMember, completed: CompletedExperiment) -> MemberRunReport {
    MemberRunReport {
        experiment_id: member.experiment.id.clone(),
        seed: member.seed,
        completed: true,
        run_ref: Some(completed.evidence.run_ref),
        resolved_outcome: Some(completed.evidence.resolved_outcome),
        error: None,
    }
}

fn load_and_verify_frozen(workspace: &Workspace, manifest_path: &Path) -> Result<LoadedFamily> {
    let loaded = load_family(manifest_path)?;
    assert_registered_contract(workspace, &loaded.contract)?;
    verify_frozen(workspace, &loaded)?;
    Ok(loaded)
}

fn verify_frozen(workspace: &Workspace, loaded: &LoadedFamily) -> Result<()> {
    for contribution in &loaded.contributions {
        existing_contribution(workspace, contribution)?.ok_or_else(|| {
            Error::Conflict(format!(
                "family {} started before contribution {} was frozen",
                loaded.contract.id, contribution.id
            ))
        })?;
    }

    for member in &loaded.members {
        existing_experiment(workspace, &member.experiment)?.ok_or_else(|| {
            Error::Conflict(format!(
                "family {} is missing frozen experiment {}",
                loaded.contract.id, member.experiment.id
            ))
        })?;
        for forecast in &member.forecasts {
            existing_typed::<Forecast>(workspace, FORECAST_SUBMITTED, &forecast.id, forecast)?
                .ok_or_else(|| {
                    Error::Conflict(format!(
                        "family {} is missing frozen forecast {}",
                        loaded.contract.id, forecast.id
                    ))
                })?;
        }
        for funding in &member.funding {
            existing_typed::<FundingCommitment>(
                workspace,
                FUNDING_COMMITTED,
                &funding.id,
                funding,
            )?
            .ok_or_else(|| {
                Error::Conflict(format!(
                    "family {} is missing frozen funding {}",
                    loaded.contract.id, funding.id
                ))
            })?;
        }
    }
    Ok(())
}

fn freeze_report(workspace: &Workspace, loaded: &LoadedFamily) -> Result<FamilyFreezeReport> {
    let family_event = workspace
        .latest_event("ExperimentFamilyRegistered", &loaded.contract.id)?
        .ok_or_else(|| Error::NotFound(format!("experiment family {}", loaded.contract.id)))?;
    let family_ref = required_event_ref("ExperimentFamilyRegistered", family_event.artifact_ref)?;
    let total_compute_credits = loaded
        .members
        .iter()
        .flat_map(|member| &member.funding)
        .try_fold(0_u64, |total, funding| {
            total
                .checked_add(funding.compute_credits)
                .ok_or_else(|| Error::Validation(vec!["family funding overflow".to_owned()]))
        })?;
    Ok(FamilyFreezeReport {
        family_id: loaded.contract.id.clone(),
        family_ref,
        contributions_frozen: loaded.contributions.len(),
        members_frozen: loaded.members.len(),
        total_compute_credits,
        status: experiment_family_status(workspace, &loaded.contract.id)?,
    })
}

fn load_family(manifest_path: &Path) -> Result<LoadedFamily> {
    let manifest: FamilyManifest = read_json(manifest_path)?;
    let base = manifest_path.parent().unwrap_or_else(|| Path::new("."));
    let mut errors = Vec::new();
    if manifest.schema != "ilxyr.family_manifest.v1" {
        errors.push("manifest.schema must be ilxyr.family_manifest.v1".to_owned());
    }
    if !manifest.run_all {
        errors
            .push("family manifests must set run_all=true to prevent optional stopping".to_owned());
    }
    if manifest.contributions.len() != 4 {
        errors.push("family manifest must contain exactly four research contributions".to_owned());
    }
    if manifest.members.len() < 2 {
        errors.push("family manifest must contain at least two prospective members".to_owned());
    }
    if !errors.is_empty() {
        return Err(Error::Validation(errors));
    }

    let contributions = manifest
        .contributions
        .iter()
        .map(|path| read_json(resolve(base, path)))
        .collect::<Result<Vec<ResearchContribution>>>()?;
    let mut members = Vec::with_capacity(manifest.members.len());
    for member in manifest.members {
        members.push(LoadedMember {
            seed: member.seed,
            required_outcome: member.required_outcome,
            experiment: read_json(resolve(base, &member.experiment))?,
            forecasts: member
                .forecasts
                .iter()
                .map(|path| read_json(resolve(base, path)))
                .collect::<Result<Vec<Forecast>>>()?,
            funding: member
                .funding
                .iter()
                .map(|path| read_json(resolve(base, path)))
                .collect::<Result<Vec<FundingCommitment>>>()?,
        });
    }

    validate_loaded(&contributions, &members)?;
    let contract = ExperimentFamilyContract {
        schema: "ilxyr.experiment_family.v1".to_owned(),
        id: manifest.id,
        title: manifest.title,
        members: members
            .iter()
            .map(|member| ExperimentFamilyMember {
                experiment_id: member.experiment.id.clone(),
                seed: member.seed,
                required_outcome: member.required_outcome.clone(),
            })
            .collect(),
        prior_outcomes: manifest.prior_outcomes,
        run_all: manifest.run_all,
        success_outcome: manifest.success_outcome,
        failure_outcome: manifest.failure_outcome,
        promotion_candidate: manifest.promotion_candidate,
    };
    Ok(LoadedFamily {
        contract,
        contributions,
        members,
    })
}

fn validate_loaded(contributions: &[ResearchContribution], members: &[LoadedMember]) -> Result<()> {
    let mut errors = Vec::new();
    let contribution_ids = contributions
        .iter()
        .map(|contribution| contribution.id.as_str())
        .collect::<BTreeSet<_>>();
    if contribution_ids.len() != 4 {
        errors.push("family contribution identifiers must be unique".to_owned());
    }

    let mut experiment_ids = BTreeSet::new();
    let mut seeds = BTreeSet::new();
    for member in members {
        if !experiment_ids.insert(member.experiment.id.as_str()) {
            errors.push(format!(
                "duplicate family experiment id {}",
                member.experiment.id
            ));
        }
        if !seeds.insert(member.seed) {
            errors.push(format!("duplicate family seed {}", member.seed));
        }
        if member.experiment.seeds != [member.seed] {
            errors.push(format!(
                "experiment {} must declare only seed {}",
                member.experiment.id, member.seed
            ));
        }
        let lineage = &member.experiment.lineage;
        for id in [
            &lineage.hypothesis,
            &lineage.mathematical_foundation,
            &lineage.engineering_review,
            &lineage.experiment_design,
        ] {
            if !contribution_ids.contains(id.as_str()) {
                errors.push(format!(
                    "experiment {} lineage {} is not in the family contribution set",
                    member.experiment.id, id
                ));
            }
        }
        if member.required_outcome != member.experiment.outcome_contract.success_outcome {
            errors.push(format!(
                "experiment {} required outcome must match its frozen success outcome",
                member.experiment.id
            ));
        }
        if !member
            .experiment
            .outcome_contract
            .outcomes
            .iter()
            .any(|outcome| outcome.id == member.required_outcome)
        {
            errors.push(format!(
                "experiment {} does not declare required outcome {}",
                member.experiment.id, member.required_outcome
            ));
        }
        for forecast in &member.forecasts {
            if forecast.experiment_id != member.experiment.id {
                errors.push(format!(
                    "forecast {} targets {}, expected {}",
                    forecast.id, forecast.experiment_id, member.experiment.id
                ));
            }
        }
        for funding in &member.funding {
            if funding.experiment_id != member.experiment.id {
                errors.push(format!(
                    "funding {} targets {}, expected {}",
                    funding.id, funding.experiment_id, member.experiment.id
                ));
            }
        }
    }

    if let Some(first) = members.first() {
        let expected = scientific_fingerprint(&first.experiment, first.seed)?;
        for member in &members[1..] {
            if scientific_fingerprint(&member.experiment, member.seed)? != expected {
                errors.push(format!(
                    "experiment {} differs outside allowed seed-scoped fields",
                    member.experiment.id
                ));
            }
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(Error::Validation(errors))
    }
}

fn scientific_fingerprint(spec: &ExperimentSpec, seed: u64) -> Result<Value> {
    let mut value = serde_json::to_value(spec)?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| Error::Validation(vec!["experiment must be a JSON object".to_owned()]))?;
    for field in ["id", "title", "hypothesis", "rationale"] {
        object.remove(field);
    }
    object.insert("seeds".to_owned(), serde_json::json!([0]));
    if let Some(datasets) = object.get_mut("datasets").and_then(Value::as_array_mut) {
        for dataset in datasets {
            normalize_seed_value(dataset, seed);
        }
    }
    if let Some(execution) = object.get_mut("execution").and_then(Value::as_object_mut)
        && let Some(args) = execution.get_mut("args").and_then(Value::as_array_mut)
    {
        for argument in args.iter_mut() {
            normalize_seed_value(argument, seed);
        }
        if let Some(position) = args.iter().position(|arg| arg.as_str() == Some("--seed")) {
            let value = args.get_mut(position + 1).ok_or_else(|| {
                Error::Validation(vec![format!(
                    "experiment {} has --seed without a value",
                    spec.id
                )])
            })?;
            if value.as_str() != Some(seed.to_string().as_str()) {
                return Err(Error::Validation(vec![format!(
                    "experiment {} --seed argument does not match declared seed {seed}",
                    spec.id
                )]));
            }
            *value = Value::String("{seed}".to_owned());
        }
    }
    if let Some(scope) = object
        .get_mut("evidence_authority")
        .and_then(Value::as_object_mut)
        .and_then(|authority| authority.get_mut("scope"))
        .and_then(Value::as_object_mut)
    {
        scope.insert("seeds".to_owned(), serde_json::json!([0]));
        if let Some(eval_set) = scope.get_mut("eval_set") {
            normalize_seed_value(eval_set, seed);
        }
    }
    Ok(value)
}

fn normalize_seed_value(value: &mut Value, seed: u64) {
    let Some(text) = value.as_str() else {
        return;
    };
    let mut normalized = text.to_owned();
    for token in [
        format!("seed-{seed}"),
        format!("seed_{seed}"),
        format!("seed {seed}"),
        format!("seed{seed}"),
    ] {
        normalized = normalized.replace(&token, "seed{seed}");
    }
    *value = Value::String(normalized);
}

fn assert_registered_contract(
    workspace: &Workspace,
    expected: &ExperimentFamilyContract,
) -> Result<()> {
    let registered = registered_experiment_family(workspace, &expected.id)?;
    if Workspace::digest(&registered)? != Workspace::digest(expected)? {
        return Err(Error::Conflict(format!(
            "family manifest {} does not match its frozen contract",
            expected.id
        )));
    }
    Ok(())
}

fn ensure_contribution(
    workspace: &Workspace,
    contribution: &ResearchContribution,
) -> Result<String> {
    if let Some(reference) = existing_contribution(workspace, contribution)? {
        return Ok(reference);
    }
    submit_contribution(workspace, contribution.clone())
}

fn existing_contribution(
    workspace: &Workspace,
    contribution: &ResearchContribution,
) -> Result<Option<String>> {
    existing_typed(
        workspace,
        CONTRIBUTION_SUBMITTED,
        &contribution.id,
        contribution,
    )
}

fn ensure_experiment(workspace: &Workspace, experiment: &ExperimentSpec) -> Result<String> {
    if let Some(reference) = existing_experiment(workspace, experiment)? {
        return Ok(reference);
    }
    compile_experiment(workspace, experiment.clone())
}

fn existing_experiment(
    workspace: &Workspace,
    experiment: &ExperimentSpec,
) -> Result<Option<String>> {
    let Some(event) = workspace.latest_event(EXPERIMENT_COMPILED, &experiment.id)? else {
        return Ok(None);
    };
    let artifact_ref = required_event_ref(EXPERIMENT_COMPILED, event.artifact_ref)?;
    let compiled: CompiledExperiment = workspace.get(&artifact_ref)?;
    if compiled.source_digest != Workspace::digest(experiment)? {
        return Err(Error::Conflict(format!(
            "experiment {} is already compiled with different content",
            experiment.id
        )));
    }
    Ok(Some(artifact_ref))
}

fn ensure_forecast(workspace: &Workspace, forecast: &Forecast) -> Result<String> {
    if let Some(reference) = existing_typed(workspace, FORECAST_SUBMITTED, &forecast.id, forecast)?
    {
        return Ok(reference);
    }
    submit_forecast(workspace, forecast.clone())
}

fn ensure_funding(workspace: &Workspace, funding: &FundingCommitment) -> Result<String> {
    if let Some(reference) = existing_typed(workspace, FUNDING_COMMITTED, &funding.id, funding)? {
        return Ok(reference);
    }
    commit_funding(workspace, funding.clone())
}

fn existing_typed<T: DeserializeOwned + Serialize>(
    workspace: &Workspace,
    event_type: &str,
    aggregate_id: &str,
    expected: &T,
) -> Result<Option<String>> {
    let Some(event) = workspace.latest_event(event_type, aggregate_id)? else {
        return Ok(None);
    };
    let artifact_ref = required_event_ref(event_type, event.artifact_ref)?;
    let existing: T = workspace.get(&artifact_ref)?;
    if Workspace::digest(&existing)? != Workspace::digest(expected)? {
        return Err(Error::Conflict(format!(
            "{aggregate_id} is already frozen with different content"
        )));
    }
    Ok(Some(artifact_ref))
}

fn required_event_ref(event_type: &str, artifact_ref: Option<String>) -> Result<String> {
    artifact_ref.ok_or_else(|| Error::Conflict(format!("{event_type} event has no artifact")))
}

fn resolve(base: &Path, path: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        base.join(path)
    }
}

fn read_json<T: DeserializeOwned>(path: impl AsRef<Path>) -> Result<T> {
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}

#[cfg(test)]
mod tests {
    use std::{process, time::SystemTime};

    use super::*;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn create(label: &str) -> Self {
            let nonce = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .expect("test clock must follow Unix epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "ilxyr-cli-family-{label}-{}-{nonce}",
                process::id()
            ));
            fs::create_dir_all(&path).expect("test directory must be created");
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn exp005_manifest() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../examples/experiments/zero-q26r/family.json")
    }

    #[test]
    fn exp005_manifest_collapses_the_full_frozen_package() {
        let loaded = load_family(&exp005_manifest()).expect("EXP-005 manifest must load");
        assert_eq!(loaded.contributions.len(), 4);
        assert_eq!(loaded.members.len(), 2);
        assert_eq!(loaded.contract.prior_outcomes.len(), 1);
        assert!(loaded.contract.run_all);
        assert_eq!(
            loaded
                .members
                .iter()
                .flat_map(|member| &member.funding)
                .map(|funding| funding.compute_credits)
                .sum::<u64>(),
            600
        );
    }

    #[test]
    fn member_drift_outside_the_seed_scope_is_rejected() {
        let mut loaded = load_family(&exp005_manifest()).expect("EXP-005 manifest must load");
        loaded.members[1].experiment.execution.timeout_seconds += 1;
        let error = validate_loaded(&loaded.contributions, &loaded.members)
            .expect_err("a changed run budget must break the family lock");
        assert!(
            error
                .to_string()
                .contains("outside allowed seed-scoped fields")
        );
    }

    #[test]
    fn separate_seed_scoped_checkout_paths_keep_the_family_lock() {
        let mut loaded = load_family(&exp005_manifest()).expect("EXP-005 manifest must load");
        for member in &mut loaded.members {
            let published_repo = member
                .experiment
                .execution
                .args
                .iter_mut()
                .find(|argument| argument.as_str() == "/workspace/zero-grounded-literary-lm")
                .expect("published repository argument must exist");
            *published_repo = format!("/tmp/zero-seed{}", member.seed);
        }
        validate_loaded(&loaded.contributions, &loaded.members)
            .expect("seed-scoped checkout paths must be allowed");
    }

    #[test]
    fn one_manifest_drives_the_complete_family_lifecycle() {
        let directory = TestDirectory::create("lifecycle");
        let package = directory.0.join("package");
        fs::create_dir_all(&package).expect("package directory must exist");
        let workspace =
            Workspace::init(directory.0.join("ledger")).expect("workspace must initialize");

        let mut first: ExperimentSpec = read_example("experiment.json");
        first.id = "toy.manifest.seed1.v1".to_owned();
        first.seeds = vec![1];
        first.evidence_authority.scope.seeds = vec![1];
        let mut second = first.clone();
        second.id = "toy.manifest.seed3.v1".to_owned();
        second.seeds = vec![3];
        second.evidence_authority.scope.seeds = vec![3];
        write_json(package.join("seed1-experiment.json"), &first);
        write_json(package.join("seed3-experiment.json"), &second);

        let mut member_files = Vec::new();
        for (label, experiment) in [("seed1", &first), ("seed3", &second)] {
            let mut model: Forecast = read_example("forecast-model.json");
            model.id = format!("toy.manifest.{label}.forecast.model.v1");
            model.experiment_id.clone_from(&experiment.id);
            let mut human: Forecast = read_example("forecast-human.json");
            human.id = format!("toy.manifest.{label}.forecast.human.v1");
            human.experiment_id.clone_from(&experiment.id);
            let mut funding_a: FundingCommitment = read_example("funding-a.json");
            funding_a.id = format!("toy.manifest.{label}.funding.a.v1");
            funding_a.experiment_id.clone_from(&experiment.id);
            let mut funding_b: FundingCommitment = read_example("funding-b.json");
            funding_b.id = format!("toy.manifest.{label}.funding.b.v1");
            funding_b.experiment_id.clone_from(&experiment.id);

            let model_path = format!("{label}-forecast-model.json");
            let human_path = format!("{label}-forecast-human.json");
            let funding_a_path = format!("{label}-funding-a.json");
            let funding_b_path = format!("{label}-funding-b.json");
            write_json(package.join(&model_path), &model);
            write_json(package.join(&human_path), &human);
            write_json(package.join(&funding_a_path), &funding_a);
            write_json(package.join(&funding_b_path), &funding_b);
            member_files.push((
                experiment.seeds[0],
                format!("{label}-experiment.json"),
                model_path,
                human_path,
                funding_a_path,
                funding_b_path,
            ));
        }

        let toy_root = toy_root();
        let members = member_files
            .iter()
            .map(|(seed, experiment, model, human, funding_a, funding_b)| {
                serde_json::json!({
                    "seed": seed,
                    "required_outcome": "success",
                    "experiment": experiment,
                    "forecasts": [model, human],
                    "funding": [funding_a, funding_b]
                })
            })
            .collect::<Vec<_>>();
        let manifest = serde_json::json!({
            "schema": "ilxyr.family_manifest.v1",
            "id": "toy.manifest.family.v1",
            "title": "Toy manifest family",
            "contributions": [
                toy_root.join("hypothesis.json"),
                toy_root.join("foundation.json"),
                toy_root.join("engineering-review.json"),
                toy_root.join("experiment-design.json")
            ],
            "members": members,
            "prior_outcomes": [{
                "experiment_id": "toy.manifest.seed2.v1",
                "seed": 2,
                "resolved_outcome": "success",
                "required_outcome": "success",
                "result_ref": format!("artifact://sha256/{}", "b".repeat(64))
            }],
            "run_all": true,
            "success_outcome": "go",
            "failure_outcome": "no_go",
            "promotion_candidate": "weight://toy/candidate-v1"
        });
        let manifest_path = package.join("family.json");
        write_json(&manifest_path, &manifest);

        let frozen = freeze(&workspace, &manifest_path).expect("family must freeze");
        assert_eq!(frozen.members_frozen, 2);
        assert_eq!(frozen.total_compute_credits, 20);
        assert!(
            freeze(&workspace, &manifest_path).is_ok(),
            "freeze must be idempotent"
        );
        let checked = check(&workspace, &manifest_path).expect("family must check");
        assert!(checked.ready);
        let ran = run(&workspace, &manifest_path).expect("family must run");
        assert!(ran.attempted_all_members);
        assert!(ran.completed_without_errors);
        let settled = settle(&workspace, &manifest_path).expect("family must settle");
        assert_eq!(settled.settlement.resolved_outcome, "go");
        assert!(settled.settlement.promotion_eligible);
        assert!(settled.ledger.valid);
    }

    fn toy_root() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/toy")
    }

    fn read_example<T: DeserializeOwned>(name: &str) -> T {
        read_json(toy_root().join(name)).expect("toy example must load")
    }

    fn write_json(path: impl AsRef<Path>, value: &impl Serialize) {
        fs::write(
            path,
            serde_json::to_vec_pretty(value).expect("test value must serialize"),
        )
        .expect("test JSON must be written");
    }
}
