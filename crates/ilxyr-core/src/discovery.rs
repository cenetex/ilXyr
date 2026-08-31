use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
};

use serde::{Deserialize, Serialize};

use crate::{Error, Result, store::now_ms};

const REGISTRY_SCHEMA: &str = "ilxyr.research_registry.v1";
const PROJECT_SCHEMA: &str = "ilxyr.project_record.v1";
const BUILTIN_REGISTRY: &str = include_str!("../../../registry/research-registry.json");

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleState {
    Planned,
    Implemented,
    Registered,
    Admitted,
    Running,
    Completed,
    Blocked,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceClassification {
    Missing,
    Recorded,
    Verified,
    Sealed,
    ExternallyReferenced,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RegistryVisibility {
    Public,
    PrivateMetadata,
    SealedHashOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RegistryHeadKind {
    Ledger,
    PublicationIndex,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EvaluationRole {
    Baseline,
    Candidate,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RegistryHead {
    pub source: String,
    pub kind: RegistryHeadKind,
    pub head: String,
    pub indexed_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ResearchRegistry {
    pub schema: String,
    pub indexed_at_ms: u64,
    pub stale_after_ms: u64,
    pub heads: Vec<RegistryHead>,
    pub projects: Vec<ProjectRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProjectRepository {
    pub repository: String,
    pub revision: String,
    pub role: String,
    pub evidence: EvidenceClassification,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProjectModel {
    pub model_id: String,
    pub weight_revision: String,
    pub registration_ref: Option<String>,
    pub evidence: EvidenceClassification,
    pub visibility: RegistryVisibility,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProjectCorpus {
    pub corpus_id: String,
    pub title: String,
    pub example_count: Option<u64>,
    pub release_ref: Option<String>,
    pub materialization_ref: Option<String>,
    pub state: LifecycleState,
    pub evidence: EvidenceClassification,
    pub visibility: RegistryVisibility,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProjectExperiment {
    pub experiment_id: String,
    pub title: String,
    pub compiled_ref: Option<String>,
    pub source_ref: Option<String>,
    pub state: LifecycleState,
    pub evidence: EvidenceClassification,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ProjectDispatch {
    pub dispatch_id: String,
    pub experiment_id: String,
    pub dispatch_ref: Option<String>,
    pub executor: String,
    pub image: String,
    pub budget: Option<f64>,
    pub cost: Option<f64>,
    pub cost_unit: String,
    pub state: LifecycleState,
    pub evidence: EvidenceClassification,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ProjectEvaluation {
    pub evaluation_id: String,
    pub experiment_id: String,
    pub role: EvaluationRole,
    pub state: LifecycleState,
    pub model_revision: Option<String>,
    pub dataset_ref: Option<String>,
    pub evaluator_revision: Option<String>,
    pub predictions_ref: Option<String>,
    #[serde(default)]
    pub metrics: BTreeMap<String, f64>,
    pub evidence: EvidenceClassification,
    pub visibility: RegistryVisibility,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RegistryArtifact {
    pub artifact_id: String,
    pub experiment_id: Option<String>,
    pub kind: String,
    pub digest: Option<String>,
    pub uri: Option<String>,
    pub source_revision: Option<String>,
    pub evidence: EvidenceClassification,
    pub visibility: RegistryVisibility,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProjectStage {
    pub stage_id: String,
    pub title: String,
    pub state: LifecycleState,
    pub evidence: EvidenceClassification,
    #[serde(default)]
    pub refs: Vec<String>,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct MissingRequirement {
    pub requirement_id: String,
    pub title: String,
    pub blocks_stage: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct CostSummary {
    pub unit: String,
    pub spent: f64,
    pub approved_limit: Option<f64>,
    pub evidence: EvidenceClassification,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ProjectRecord {
    pub schema: String,
    pub project_id: String,
    pub canonical_name: String,
    pub aliases: Vec<String>,
    pub repositories: Vec<ProjectRepository>,
    pub model: ProjectModel,
    pub corpora: Vec<ProjectCorpus>,
    pub experiments: Vec<ProjectExperiment>,
    pub dispatches: Vec<ProjectDispatch>,
    pub evaluations: Vec<ProjectEvaluation>,
    pub artifacts: Vec<RegistryArtifact>,
    pub lifecycle_state: LifecycleState,
    pub stages: Vec<ProjectStage>,
    pub missing_requirements: Vec<MissingRequirement>,
    pub costs: CostSummary,
    pub visibility: RegistryVisibility,
    pub evidence: EvidenceClassification,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct IndexStatus {
    pub indexed_at_ms: u64,
    pub age_ms: u64,
    pub stale_after_ms: u64,
    pub stale: bool,
    pub heads: Vec<RegistryHead>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProjectSummary {
    pub project_id: String,
    pub canonical_name: String,
    pub aliases: Vec<String>,
    pub lifecycle_state: LifecycleState,
    pub evidence: EvidenceClassification,
    pub missing_requirements: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SearchResponse {
    pub schema: String,
    pub query: String,
    pub matches: Vec<ProjectSummary>,
    pub index: IndexStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ProjectStatusResponse {
    pub schema: String,
    pub project: ProjectRecord,
    pub completed: Vec<ProjectStage>,
    pub running: Vec<ProjectStage>,
    pub blocked: Vec<ProjectStage>,
    pub missing: Vec<MissingRequirement>,
    pub index: IndexStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct LineageResponse {
    pub schema: String,
    pub project: ProjectSummary,
    pub experiment: ProjectExperiment,
    pub model: ProjectModel,
    pub corpora: Vec<ProjectCorpus>,
    pub dispatches: Vec<ProjectDispatch>,
    pub evaluations: Vec<ProjectEvaluation>,
    pub artifacts: Vec<RegistryArtifact>,
    pub index: IndexStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ArtifactMetadataResponse {
    pub schema: String,
    pub project_id: String,
    pub artifact: RegistryArtifact,
    pub index: IndexStatus,
}

impl ResearchRegistry {
    pub fn builtin() -> Result<Self> {
        Self::from_json(BUILTIN_REGISTRY)
    }

    pub fn load(path: impl AsRef<Path>) -> Result<Self> {
        Self::from_json(&fs::read_to_string(path)?)
    }

    pub fn from_json(contents: &str) -> Result<Self> {
        let registry: Self = serde_json::from_str(contents)?;
        registry.validate()?;
        Ok(registry)
    }

    pub fn validate(&self) -> Result<()> {
        let mut errors = Vec::new();
        if self.schema != REGISTRY_SCHEMA {
            errors.push(format!(
                "unsupported registry schema {}; expected {REGISTRY_SCHEMA}",
                self.schema
            ));
        }
        if self.stale_after_ms == 0 {
            errors.push("stale_after_ms must be greater than zero".to_owned());
        }
        if self.heads.is_empty() {
            errors.push("registry must name at least one authoritative head".to_owned());
        }
        if self.projects.is_empty() {
            errors.push("registry must contain at least one project".to_owned());
        }
        for head in &self.heads {
            if !is_sha256_or_git_revision(&head.head) {
                errors.push(format!(
                    "registry head for {} is not a full hex digest: {}",
                    head.source, head.head
                ));
            }
        }

        let mut project_ids = BTreeSet::new();
        let mut searchable = BTreeMap::<String, String>::new();
        for project in &self.projects {
            if !project_ids.insert(project.project_id.as_str()) {
                errors.push(format!(
                    "registry repeats project id {}",
                    project.project_id
                ));
            }
            validate_project(project, &mut errors);
            for key in project_search_keys(project) {
                let normalized = normalize(&key);
                if let Some(other) =
                    searchable.insert(normalized.clone(), project.project_id.clone())
                {
                    if other != project.project_id {
                        errors.push(format!(
                            "search key {key} is shared by {other} and {}",
                            project.project_id
                        ));
                    }
                }
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(Error::Validation(errors))
        }
    }

    #[must_use]
    pub fn index_status_at(&self, now_ms: u64) -> IndexStatus {
        let age_ms = now_ms.saturating_sub(self.indexed_at_ms);
        IndexStatus {
            indexed_at_ms: self.indexed_at_ms,
            age_ms,
            stale_after_ms: self.stale_after_ms,
            stale: age_ms >= self.stale_after_ms,
            heads: self.heads.clone(),
        }
    }

    pub fn search(&self, query: &str) -> Result<SearchResponse> {
        let query = query.trim();
        if query.is_empty() {
            return Err(Error::Validation(vec![
                "search query must not be empty".to_owned(),
            ]));
        }
        let normalized = normalize(query);
        let mut ranked = self
            .projects
            .iter()
            .filter_map(|project| {
                let keys = project_search_keys(project);
                let exact = keys.iter().any(|key| normalize(key) == normalized);
                let partial = keys.iter().any(|key| normalize(key).contains(&normalized));
                (exact || partial).then_some((!exact, &project.project_id, project))
            })
            .collect::<Vec<_>>();
        ranked.sort_by(|left, right| (left.0, left.1).cmp(&(right.0, right.1)));
        Ok(SearchResponse {
            schema: "ilxyr.registry_search.v1".to_owned(),
            query: query.to_owned(),
            matches: ranked
                .into_iter()
                .map(|(_, _, project)| project_summary(project))
                .collect(),
            index: self.current_index_status()?,
        })
    }

    pub fn status(&self, identifier: &str) -> Result<ProjectStatusResponse> {
        let project = self.resolve_project(identifier)?.clone();
        Ok(ProjectStatusResponse {
            schema: "ilxyr.project_status.v1".to_owned(),
            completed: stages_with_state(&project, LifecycleState::Completed),
            running: stages_with_state(&project, LifecycleState::Running),
            blocked: stages_with_state(&project, LifecycleState::Blocked),
            missing: project.missing_requirements.clone(),
            project,
            index: self.current_index_status()?,
        })
    }

    pub fn lineage(&self, experiment_id: &str) -> Result<LineageResponse> {
        let (project, experiment) = self
            .projects
            .iter()
            .find_map(|project| {
                project
                    .experiments
                    .iter()
                    .find(|experiment| {
                        normalize(&experiment.experiment_id) == normalize(experiment_id)
                    })
                    .map(|experiment| (project, experiment))
            })
            .ok_or_else(|| Error::NotFound(format!("experiment {experiment_id}")))?;
        Ok(LineageResponse {
            schema: "ilxyr.experiment_lineage.v1".to_owned(),
            project: project_summary(project),
            experiment: experiment.clone(),
            model: project.model.clone(),
            corpora: project.corpora.clone(),
            dispatches: project
                .dispatches
                .iter()
                .filter(|dispatch| dispatch.experiment_id == experiment.experiment_id)
                .cloned()
                .collect(),
            evaluations: project
                .evaluations
                .iter()
                .filter(|evaluation| evaluation.experiment_id == experiment.experiment_id)
                .cloned()
                .collect(),
            artifacts: project
                .artifacts
                .iter()
                .filter(|artifact| {
                    artifact
                        .experiment_id
                        .as_deref()
                        .is_none_or(|id| id == experiment.experiment_id)
                })
                .cloned()
                .collect(),
            index: self.current_index_status()?,
        })
    }

    pub fn artifact_metadata(&self, identifier: &str) -> Result<ArtifactMetadataResponse> {
        let normalized = normalize(identifier);
        let (project, artifact) = self
            .projects
            .iter()
            .find_map(|project| {
                project
                    .artifacts
                    .iter()
                    .find(|artifact| {
                        normalize(&artifact.artifact_id) == normalized
                            || artifact.digest.as_deref() == Some(identifier)
                    })
                    .map(|artifact| (project, artifact))
            })
            .ok_or_else(|| Error::NotFound(format!("artifact {identifier}")))?;
        Ok(ArtifactMetadataResponse {
            schema: "ilxyr.artifact_metadata.v1".to_owned(),
            project_id: project.project_id.clone(),
            artifact: artifact.clone(),
            index: self.current_index_status()?,
        })
    }

    fn resolve_project(&self, identifier: &str) -> Result<&ProjectRecord> {
        let normalized = normalize(identifier);
        self.projects
            .iter()
            .find(|project| {
                project_search_keys(project)
                    .iter()
                    .any(|key| normalize(key) == normalized)
            })
            .ok_or_else(|| Error::NotFound(format!("project {identifier}")))
    }

    fn current_index_status(&self) -> Result<IndexStatus> {
        let current = now_ms()?.min(u128::from(u64::MAX)) as u64;
        Ok(self.index_status_at(current))
    }
}

fn validate_project(project: &ProjectRecord, errors: &mut Vec<String>) {
    if project.schema != PROJECT_SCHEMA {
        errors.push(format!(
            "project {} has unsupported schema {}",
            project.project_id, project.schema
        ));
    }
    if !project.project_id.starts_with("project://") {
        errors.push(format!(
            "project id must start with project://: {}",
            project.project_id
        ));
    }
    if project.aliases.is_empty() {
        errors.push(format!("project {} has no aliases", project.project_id));
    }
    validate_unique_normalized(
        project.aliases.iter().map(String::as_str),
        &project.project_id,
        "alias",
        errors,
    );
    for repository in &project.repositories {
        if !is_sha256_or_git_revision(&repository.revision) {
            errors.push(format!(
                "project {} repository revision is not a full hex digest: {}",
                project.project_id, repository.revision
            ));
        }
    }
    if !is_sha256_or_git_revision(&project.model.weight_revision) {
        errors.push(format!(
            "project {} model revision is not a full hex digest: {}",
            project.project_id, project.model.weight_revision
        ));
    }

    validate_unique(
        project.corpora.iter().map(|item| item.corpus_id.as_str()),
        &project.project_id,
        "corpus id",
        errors,
    );
    validate_unique(
        project
            .experiments
            .iter()
            .map(|item| item.experiment_id.as_str()),
        &project.project_id,
        "experiment id",
        errors,
    );
    validate_unique(
        project
            .dispatches
            .iter()
            .map(|item| item.dispatch_id.as_str()),
        &project.project_id,
        "dispatch id",
        errors,
    );
    validate_unique(
        project
            .evaluations
            .iter()
            .map(|item| item.evaluation_id.as_str()),
        &project.project_id,
        "evaluation id",
        errors,
    );
    validate_unique(
        project
            .artifacts
            .iter()
            .map(|item| item.artifact_id.as_str()),
        &project.project_id,
        "artifact id",
        errors,
    );
    validate_unique(
        project.stages.iter().map(|item| item.stage_id.as_str()),
        &project.project_id,
        "stage id",
        errors,
    );
    validate_unique(
        project
            .missing_requirements
            .iter()
            .map(|item| item.requirement_id.as_str()),
        &project.project_id,
        "missing requirement id",
        errors,
    );

    let experiment_ids = project
        .experiments
        .iter()
        .map(|experiment| experiment.experiment_id.as_str())
        .collect::<BTreeSet<_>>();
    let stage_ids = project
        .stages
        .iter()
        .map(|stage| stage.stage_id.as_str())
        .collect::<BTreeSet<_>>();
    for missing in &project.missing_requirements {
        if !stage_ids.contains(missing.blocks_stage.as_str()) {
            errors.push(format!(
                "project {} requirement {} blocks unknown stage {}",
                project.project_id, missing.requirement_id, missing.blocks_stage
            ));
        }
    }
    for dispatch in &project.dispatches {
        if !experiment_ids.contains(dispatch.experiment_id.as_str()) {
            errors.push(format!(
                "project {} dispatch {} names unknown experiment {}",
                project.project_id, dispatch.dispatch_id, dispatch.experiment_id
            ));
        }
        if dispatch.budget.is_some_and(|value| value < 0.0)
            || dispatch.cost.is_some_and(|value| value < 0.0)
        {
            errors.push(format!(
                "project {} dispatch {} has a negative budget or cost",
                project.project_id, dispatch.dispatch_id
            ));
        }
    }
    for evaluation in &project.evaluations {
        if !experiment_ids.contains(evaluation.experiment_id.as_str()) {
            errors.push(format!(
                "project {} evaluation {} names unknown experiment {}",
                project.project_id, evaluation.evaluation_id, evaluation.experiment_id
            ));
        }
        if !evaluation.metrics.is_empty()
            && (evaluation.model_revision.is_none()
                || evaluation.dataset_ref.is_none()
                || evaluation.evaluator_revision.is_none()
                || evaluation.predictions_ref.is_none())
        {
            errors.push(format!(
                "project {} evaluation {} reports metrics without predictions, dataset, evaluator, and model revisions",
                project.project_id, evaluation.evaluation_id
            ));
        }
        if let Some(revision) = evaluation.model_revision.as_deref() {
            if !is_sha256_or_git_revision(revision) {
                errors.push(format!(
                    "project {} evaluation {} has invalid model revision {}",
                    project.project_id, evaluation.evaluation_id, revision
                ));
            }
        }
    }
    for artifact in &project.artifacts {
        if artifact.visibility != RegistryVisibility::Public && artifact.uri.is_some() {
            errors.push(format!(
                "project {} non-public artifact {} exposes a URI",
                project.project_id, artifact.artifact_id
            ));
        }
        if let Some(digest) = artifact.digest.as_deref() {
            if !is_lower_sha256(digest) {
                errors.push(format!(
                    "project {} artifact {} has invalid SHA-256 {}",
                    project.project_id, artifact.artifact_id, digest
                ));
            }
        }
        if let Some(revision) = artifact.source_revision.as_deref() {
            if !is_sha256_or_git_revision(revision) {
                errors.push(format!(
                    "project {} artifact {} has invalid source revision {}",
                    project.project_id, artifact.artifact_id, revision
                ));
            }
        }
    }
    if project.costs.spent < 0.0
        || project
            .costs
            .approved_limit
            .is_some_and(|value| value < 0.0)
    {
        errors.push(format!(
            "project {} has a negative cost",
            project.project_id
        ));
    }
}

fn validate_unique<'a>(
    values: impl Iterator<Item = &'a str>,
    project_id: &str,
    label: &str,
    errors: &mut Vec<String>,
) {
    let mut seen = BTreeSet::new();
    for value in values {
        if !seen.insert(value) {
            errors.push(format!("project {project_id} repeats {label} {value}"));
        }
    }
}

fn validate_unique_normalized<'a>(
    values: impl Iterator<Item = &'a str>,
    project_id: &str,
    label: &str,
    errors: &mut Vec<String>,
) {
    let mut seen = BTreeSet::new();
    for value in values {
        if !seen.insert(normalize(value)) {
            errors.push(format!("project {project_id} repeats {label} {value}"));
        }
    }
}

fn project_search_keys(project: &ProjectRecord) -> Vec<String> {
    let mut keys = vec![project.project_id.clone(), project.canonical_name.clone()];
    keys.extend(project.aliases.iter().cloned());
    keys.extend(
        project
            .experiments
            .iter()
            .map(|experiment| experiment.experiment_id.clone()),
    );
    keys
}

fn project_summary(project: &ProjectRecord) -> ProjectSummary {
    ProjectSummary {
        project_id: project.project_id.clone(),
        canonical_name: project.canonical_name.clone(),
        aliases: project.aliases.clone(),
        lifecycle_state: project.lifecycle_state.clone(),
        evidence: project.evidence.clone(),
        missing_requirements: project.missing_requirements.len(),
    }
}

fn stages_with_state(project: &ProjectRecord, state: LifecycleState) -> Vec<ProjectStage> {
    project
        .stages
        .iter()
        .filter(|stage| stage.state == state)
        .cloned()
        .collect()
}

fn normalize(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn is_sha256_or_git_revision(value: &str) -> bool {
    matches!(value.len(), 40 | 64)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn is_lower_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aliases_and_experiment_id_resolve_to_one_project() {
        let registry = ResearchRegistry::builtin().expect("built-in registry");
        for query in ["qwen-sec", "FERAL-7B", "feral-7b.sec-analysis.v2"] {
            let response = registry.search(query).expect("search");
            assert_eq!(response.matches.len(), 1);
            assert_eq!(response.matches[0].project_id, "project://ilxyr/feral-7b");
        }
    }

    #[test]
    fn qwen_status_is_truthful_before_paid_training() {
        let registry = ResearchRegistry::builtin().expect("built-in registry");
        let status = registry.status("project://ilxyr/feral-7b").expect("status");
        assert_eq!(status.project.lifecycle_state, LifecycleState::Blocked);
        assert!(status.running.is_empty());
        assert_eq!(status.completed.len(), 1);
        assert!(
            status
                .completed
                .iter()
                .any(|stage| stage.stage_id == "development_corpus_export")
        );
        assert!(
            status
                .blocked
                .iter()
                .any(|stage| stage.stage_id == "full_corpus_freeze")
        );
        assert_eq!(status.project.costs.spent, 0.0);
        assert!(status.project.dispatches.is_empty());
        let measured = status
            .project
            .evaluations
            .iter()
            .filter(|item| !item.metrics.is_empty())
            .collect::<Vec<_>>();
        assert_eq!(measured.len(), 1);
        assert_eq!(
            measured[0].evaluation_id,
            "evaluation://feral-7b/finqa/base"
        );
        assert_eq!(measured[0].state, LifecycleState::Completed);
        let accuracy = measured[0]
            .metrics
            .get("finqa_accuracy")
            .copied()
            .expect("FinQA accuracy");
        assert!((accuracy - 0.14646904969485613).abs() < 1e-15);
        assert!(
            status
                .project
                .evaluations
                .iter()
                .filter(|item| item.role == EvaluationRole::Candidate)
                .all(|item| item.metrics.is_empty())
        );
        assert!(status.missing.len() >= 8);
    }

    #[test]
    fn lineage_has_model_corpus_and_planned_evaluations() {
        let registry = ResearchRegistry::builtin().expect("built-in registry");
        let lineage = registry
            .lineage("feral-7b.sec-analysis.v2")
            .expect("lineage");
        assert_eq!(
            lineage.model.weight_revision,
            "a09a35458c702b33eeacc393d103063234e8bc28"
        );
        assert_eq!(lineage.corpora[0].example_count, Some(403));
        assert!(lineage.dispatches.is_empty());
        assert_eq!(lineage.evaluations.len(), 7);
    }

    #[test]
    fn artifact_metadata_resolves_by_id_and_digest() {
        let registry = ResearchRegistry::builtin().expect("built-in registry");
        let by_id = registry
            .artifact_metadata("artifact://runner-watch/feral-7b-experiment-card")
            .expect("artifact by id");
        let digest = by_id.artifact.digest.clone().expect("digest");
        let by_digest = registry
            .artifact_metadata(&digest)
            .expect("artifact by digest");
        assert_eq!(by_id.artifact, by_digest.artifact);
    }

    #[test]
    fn index_status_reports_age_and_staleness() {
        let registry = ResearchRegistry::builtin().expect("built-in registry");
        let fresh = registry.index_status_at(registry.indexed_at_ms + 1);
        assert!(!fresh.stale);
        assert_eq!(fresh.age_ms, 1);
        let stale = registry.index_status_at(registry.indexed_at_ms + registry.stale_after_ms + 1);
        assert!(stale.stale);
        assert_eq!(stale.heads, registry.heads);
    }

    #[test]
    fn reported_metrics_require_full_lineage() {
        let registry = ResearchRegistry::builtin().expect("built-in registry");
        let mut value = serde_json::to_value(registry).expect("serialize");
        value["projects"][0]["evaluations"][0]["metrics"]["accuracy"] = serde_json::json!(0.5);
        let error = ResearchRegistry::from_json(
            &serde_json::to_string(&value).expect("serialize modified registry"),
        )
        .expect_err("unbound metric must fail");
        assert!(error.to_string().contains("reports metrics without"));
    }

    #[test]
    fn sealed_artifacts_cannot_expose_locations() {
        let registry = ResearchRegistry::builtin().expect("built-in registry");
        let mut value = serde_json::to_value(registry).expect("serialize");
        value["projects"][0]["artifacts"][0]["visibility"] = serde_json::json!("sealed_hash_only");
        let error = ResearchRegistry::from_json(
            &serde_json::to_string(&value).expect("serialize modified registry"),
        )
        .expect_err("sealed URI must fail");
        assert!(error.to_string().contains("exposes a URI"));
    }
}
