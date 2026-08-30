use std::collections::{BTreeMap, BTreeSet};

use serde::de::DeserializeOwned;

use crate::{
    ActorKind, ActorRef, CompiledExperiment, ContributionStage, Error, ExperimentProposal,
    ExperimentSpec, FrozenProposalCandidate, OutcomePredicate, ProposalCompilation,
    ProposalContributionPackage, ProposalReadinessCheck, ProposalReview, ProposalReviewSeverity,
    ProposalStatus, ResearchContribution, Result, Workspace, compile_experiment, store::now_ms,
    submit_contribution, validation,
};

const PROPOSAL_DRAFTED: &str = "ProposalDrafted";
const PROPOSAL_REVISED: &str = "ProposalRevised";
const PROPOSAL_REVIEWED: &str = "ProposalReviewed";
const PROPOSAL_FROZEN: &str = "ProposalFrozen";
const PROPOSAL_PACKAGED: &str = "ProposalPackaged";
const PROPOSAL_COMPILED: &str = "ProposalCompiled";
const CONTRIBUTION_SUBMITTED: &str = "ContributionSubmitted";
const EXPERIMENT_COMPILED: &str = "ExperimentCompiled";

pub fn submit_proposal(workspace: &Workspace, proposal: ExperimentProposal) -> Result<String> {
    validation::proposal(&proposal)?;
    let current = current_proposal(workspace, &proposal.id)?;
    if let Some((current_ref, current_proposal)) = &current {
        if Workspace::digest(current_proposal)? == Workspace::digest(&proposal)? {
            return Ok(current_ref.clone());
        }
    }
    if workspace
        .latest_event(PROPOSAL_FROZEN, &proposal.id)?
        .is_some()
    {
        return Err(Error::Conflict(format!(
            "proposal {} is frozen and cannot be revised",
            proposal.id
        )));
    }

    let event_type = if let Some((current_ref, current)) = current {
        if proposal.revision != current.revision + 1 {
            return Err(Error::Conflict(format!(
                "proposal {} must advance from revision {} to {}",
                proposal.id,
                current.revision,
                current.revision + 1
            )));
        }
        if proposal.predecessor_ref.as_deref() != Some(current_ref.as_str()) {
            return Err(Error::Conflict(format!(
                "proposal {} predecessor_ref must bind the current revision",
                proposal.id
            )));
        }
        if proposal.experiment_id != current.experiment_id {
            return Err(Error::Conflict(
                "a proposal revision cannot change experiment_id".to_owned(),
            ));
        }
        if proposal.proposer != current.proposer {
            return Err(Error::Conflict(
                "a proposal revision cannot change proposer".to_owned(),
            ));
        }
        PROPOSAL_REVISED
    } else {
        ensure_experiment_has_no_other_proposal(workspace, &proposal)?;
        PROPOSAL_DRAFTED
    };

    let artifact_ref = workspace.put(&proposal)?;
    workspace.append_event(
        event_type,
        &proposal.id,
        proposal.proposer.clone(),
        Some(artifact_ref.clone()),
    )?;
    Ok(artifact_ref)
}

pub fn review_proposal(workspace: &Workspace, review: ProposalReview) -> Result<String> {
    validation::proposal_review(&review)?;
    if let Some(event) = workspace.latest_event(PROPOSAL_REVIEWED, &review.id)? {
        let existing_ref = required_artifact(PROPOSAL_REVIEWED, event.artifact_ref)?;
        let existing: ProposalReview = workspace.get(&existing_ref)?;
        if Workspace::digest(&existing)? == Workspace::digest(&review)? {
            return Ok(existing_ref);
        }
        return Err(Error::Conflict(format!(
            "review {} already exists with different content",
            review.id
        )));
    }
    if workspace
        .latest_event(PROPOSAL_FROZEN, &review.proposal_id)?
        .is_some()
    {
        return Err(Error::Conflict(format!(
            "proposal {} is frozen and no longer accepts reviews",
            review.proposal_id
        )));
    }
    let (proposal_ref, proposal) = required_current_proposal(workspace, &review.proposal_id)?;
    if review.proposal_ref != proposal_ref {
        return Err(Error::Conflict(
            "review.proposal_ref must bind the current proposal revision".to_owned(),
        ));
    }
    if actor_identity(&review.reviewer) == actor_identity(&proposal.proposer) {
        return Err(Error::Validation(vec![
            "a proposal reviewer must be independent from the proposer".to_owned(),
        ]));
    }

    let artifact_ref = workspace.put(&review)?;
    workspace.append_event(
        PROPOSAL_REVIEWED,
        &review.id,
        review.reviewer.clone(),
        Some(artifact_ref.clone()),
    )?;
    Ok(artifact_ref)
}

pub fn freeze_proposal(workspace: &Workspace, proposal_id: &str) -> Result<String> {
    if let Some((artifact_ref, _)) =
        latest_typed_with_ref::<FrozenProposalCandidate>(workspace, PROPOSAL_FROZEN, proposal_id)?
    {
        return Ok(artifact_ref);
    }
    let (proposal_ref, proposal) = required_current_proposal(workspace, proposal_id)?;
    let reviews = reviews_for_revision(workspace, proposal_id, &proposal_ref)?;
    let blocking = reviews
        .iter()
        .filter(|(_, review)| review.severity == ProposalReviewSeverity::Blocking)
        .map(|(_, review)| review.id.clone())
        .collect::<Vec<_>>();
    let mut errors = Vec::new();
    if reviews.is_empty() {
        errors.push("proposal needs at least one independent review before freeze".to_owned());
    }
    if !blocking.is_empty() {
        errors.push(format!(
            "proposal has unresolved blocking reviews: {}",
            blocking.join(", ")
        ));
    }
    if !errors.is_empty() {
        return Err(Error::Validation(errors));
    }

    let candidate = FrozenProposalCandidate {
        schema: "ilxyr.frozen_proposal_candidate.v1".to_owned(),
        id: format!("{proposal_id}/candidate/r{}", proposal.revision),
        proposal_id: proposal_id.to_owned(),
        proposal_ref,
        revision: proposal.revision,
        proposer: proposal.proposer,
        review_refs: reviews
            .into_iter()
            .map(|(reference, _)| reference)
            .collect(),
        frozen_at_ms: now_ms()?,
    };
    let artifact_ref = workspace.put(&candidate)?;
    workspace.append_event(
        PROPOSAL_FROZEN,
        proposal_id,
        ActorRef::service("service://ilxyr/proposal-gate-v1"),
        Some(artifact_ref.clone()),
    )?;
    Ok(artifact_ref)
}

pub fn package_proposal(
    workspace: &Workspace,
    proposal_id: &str,
    contributions: Vec<ResearchContribution>,
    experiment: ExperimentSpec,
) -> Result<String> {
    let (candidate_ref, candidate) =
        latest_typed_with_ref::<FrozenProposalCandidate>(workspace, PROPOSAL_FROZEN, proposal_id)?
            .ok_or_else(|| {
                Error::Conflict(format!("proposal {proposal_id} must be frozen first"))
            })?;
    let proposal: ExperimentProposal = workspace.get(&candidate.proposal_ref)?;
    validate_package_binding(&proposal, &candidate, &contributions, &experiment)?;

    let package = ProposalContributionPackage {
        schema: "ilxyr.proposal_contribution_package.v1".to_owned(),
        id: format!("{proposal_id}/package/r{}", candidate.revision),
        proposal_id: proposal_id.to_owned(),
        proposal_ref: candidate.proposal_ref,
        candidate_ref,
        review_refs: candidate.review_refs,
        contributions,
        experiment,
    };
    if let Some((existing_ref, existing)) = latest_typed_with_ref::<ProposalContributionPackage>(
        workspace,
        PROPOSAL_PACKAGED,
        proposal_id,
    )? {
        if Workspace::digest(&existing)? == Workspace::digest(&package)? {
            return Ok(existing_ref);
        }
        return Err(Error::Conflict(format!(
            "proposal {proposal_id} already has a different contribution package"
        )));
    }

    let artifact_ref = workspace.put(&package)?;
    workspace.append_event(
        PROPOSAL_PACKAGED,
        proposal_id,
        package.experiment.proposer.clone(),
        Some(artifact_ref.clone()),
    )?;
    Ok(artifact_ref)
}

pub fn compile_proposal(workspace: &Workspace, proposal_id: &str) -> Result<ProposalCompilation> {
    if let Some(compilation) =
        latest_typed::<ProposalCompilation>(workspace, PROPOSAL_COMPILED, proposal_id)?
    {
        return Ok(compilation);
    }
    let (package_ref, package) = latest_typed_with_ref::<ProposalContributionPackage>(
        workspace,
        PROPOSAL_PACKAGED,
        proposal_id,
    )?
    .ok_or_else(|| Error::Conflict(format!("proposal {proposal_id} must be packaged first")))?;

    let mut contribution_refs = BTreeMap::new();
    for contribution in &package.contributions {
        let artifact_ref = if let Some(event) =
            workspace.latest_event(CONTRIBUTION_SUBMITTED, &contribution.id)?
        {
            let existing_ref = required_artifact(CONTRIBUTION_SUBMITTED, event.artifact_ref)?;
            let existing: ResearchContribution = workspace.get(&existing_ref)?;
            if Workspace::digest(&existing)? != Workspace::digest(contribution)? {
                return Err(Error::Conflict(format!(
                    "contribution {} already exists with different content",
                    contribution.id
                )));
            }
            existing_ref
        } else {
            submit_contribution(workspace, contribution.clone())?
        };
        contribution_refs.insert(stage_name(&contribution.stage).to_owned(), artifact_ref);
    }

    let compiled_ref =
        if let Some(event) = workspace.latest_event(EXPERIMENT_COMPILED, &package.experiment.id)? {
            let existing_ref = required_artifact(EXPERIMENT_COMPILED, event.artifact_ref)?;
            let existing: CompiledExperiment = workspace.get(&existing_ref)?;
            if existing.source_digest != Workspace::digest(&package.experiment)? {
                return Err(Error::Conflict(format!(
                    "experiment {} already exists with a different specification",
                    package.experiment.id
                )));
            }
            existing_ref
        } else {
            compile_experiment(workspace, package.experiment.clone())?
        };

    let compilation = ProposalCompilation {
        schema: "ilxyr.proposal_compilation.v1".to_owned(),
        id: format!("{}/compilation", package.id),
        proposal_id: proposal_id.to_owned(),
        package_ref,
        contribution_refs,
        compiled_ref,
    };
    let artifact_ref = workspace.put(&compilation)?;
    workspace.append_event(
        PROPOSAL_COMPILED,
        proposal_id,
        ActorRef::service("service://ilxyr/proposal-compiler-v1"),
        Some(artifact_ref),
    )?;
    Ok(compilation)
}

pub fn proposal_status(workspace: &Workspace, proposal_id: &str) -> Result<ProposalStatus> {
    let (current_ref, proposal) = required_current_proposal(workspace, proposal_id)?;
    let reviews = reviews_for_revision(workspace, proposal_id, &current_ref)?;
    let current_review_refs = reviews
        .iter()
        .map(|(reference, _)| reference.clone())
        .collect::<Vec<_>>();
    let blocking_count = reviews
        .iter()
        .filter(|(_, review)| review.severity == ProposalReviewSeverity::Blocking)
        .count();
    let candidate =
        latest_typed_with_ref::<FrozenProposalCandidate>(workspace, PROPOSAL_FROZEN, proposal_id)?;
    let package = latest_typed_with_ref::<ProposalContributionPackage>(
        workspace,
        PROPOSAL_PACKAGED,
        proposal_id,
    )?;
    let compilation =
        latest_typed::<ProposalCompilation>(workspace, PROPOSAL_COMPILED, proposal_id)?;

    let frozen = candidate.is_some();
    let packaged = package.is_some();
    let compiled = compilation.is_some();
    Ok(ProposalStatus {
        proposal_id: proposal_id.to_owned(),
        current_ref,
        revision: proposal.revision,
        frozen,
        candidate_ref: candidate.map(|(reference, _)| reference),
        current_review_refs,
        packaged,
        package_ref: package.map(|(reference, _)| reference),
        compiled,
        compiled_ref: compilation.map(|receipt| receipt.compiled_ref),
        readiness: vec![
            readiness(
                "independent_review",
                !reviews.is_empty(),
                format!("{} current-revision review(s)", reviews.len()),
            ),
            readiness(
                "no_blocking_review",
                blocking_count == 0,
                format!("{blocking_count} blocking review(s)"),
            ),
            readiness(
                "frozen_candidate",
                frozen,
                if frozen { "frozen" } else { "not frozen" }.to_owned(),
            ),
            readiness(
                "contribution_package",
                packaged,
                if packaged { "packaged" } else { "not packaged" }.to_owned(),
            ),
            readiness(
                "compiled_experiment",
                compiled,
                if compiled { "compiled" } else { "not compiled" }.to_owned(),
            ),
        ],
    })
}

fn validate_package_binding(
    proposal: &ExperimentProposal,
    candidate: &FrozenProposalCandidate,
    contributions: &[ResearchContribution],
    experiment: &ExperimentSpec,
) -> Result<()> {
    validation::experiment(experiment)?;
    let mut errors = Vec::new();
    if candidate.proposal_id != proposal.id || candidate.proposal_ref != artifact_ref_for(proposal)?
    {
        errors.push("frozen candidate does not bind the supplied proposal".to_owned());
    }
    if experiment.id != proposal.experiment_id {
        errors.push("experiment.id does not match proposal.experiment_id".to_owned());
    }
    if experiment.title != proposal.title {
        errors.push("experiment.title does not match proposal.title".to_owned());
    }
    if experiment.hypothesis != proposal.hypothesis {
        errors.push("experiment.hypothesis does not match proposal.hypothesis".to_owned());
    }
    if experiment.proposer != proposal.proposer {
        errors.push("experiment.proposer does not match proposal.proposer".to_owned());
    }
    if experiment.family.as_ref() != Some(&proposal.family) {
        errors.push("experiment.family does not match proposal.family".to_owned());
    }
    if experiment.baseline != proposal.baseline {
        errors.push("experiment.baseline does not match proposal.baseline".to_owned());
    }
    if experiment.datasets != proposal.datasets {
        errors.push("experiment.datasets do not match proposal.datasets".to_owned());
    }
    if experiment.seeds != proposal.seeds {
        errors.push("experiment.seeds do not match proposal.seeds".to_owned());
    }
    if experiment.evidence_authority.level != proposal.evidence_level {
        errors.push("experiment evidence level does not match proposal.evidence_level".to_owned());
    }
    if experiment.security.export_policy != proposal.export_policy {
        errors.push("experiment export policy does not match proposal.export_policy".to_owned());
    }
    if experiment.execution.max_cost_credits != proposal.compute_credits
        || experiment.funding.required_compute_credits != proposal.compute_credits
    {
        errors
            .push("experiment compute ceiling does not match proposal.compute_credits".to_owned());
    }
    if experiment.outcome_contract.primary_metric != proposal.primary_metric {
        errors.push("experiment primary metric does not match proposal.primary_metric".to_owned());
    }
    let success = experiment
        .outcome_contract
        .outcomes
        .iter()
        .find(|outcome| outcome.id == experiment.outcome_contract.success_outcome);
    match success.map(|outcome| &outcome.predicate) {
        Some(OutcomePredicate::Metric {
            metric,
            operator,
            threshold,
        }) if metric == &proposal.primary_metric
            && operator == &proposal.success_operator
            && threshold.to_bits() == proposal.success_threshold.to_bits() => {}
        _ => errors.push("experiment success predicate does not match the proposal".to_owned()),
    }

    if contributions.len() != 4 {
        errors.push("proposal package must contain exactly four contributions".to_owned());
    }
    let mut stages = BTreeSet::new();
    let mut ids = BTreeSet::new();
    for contribution in contributions {
        if let Err(Error::Validation(mut contribution_errors)) =
            validation::contribution(contribution)
        {
            errors.append(&mut contribution_errors);
        }
        let stage = stage_name(&contribution.stage);
        if !stages.insert(stage) {
            errors.push(format!(
                "proposal package contains duplicate {stage} contributions"
            ));
        }
        if !ids.insert(contribution.id.as_str()) {
            errors.push("proposal package contains duplicate contribution ids".to_owned());
        }
        let expected_id = lineage_id(experiment, &contribution.stage);
        if contribution.id != expected_id {
            errors.push(format!(
                "{stage} contribution id does not match experiment.lineage"
            ));
        }
        match contribution.stage {
            ContributionStage::Hypothesis => {
                if contribution.actor != proposal.proposer {
                    errors.push(
                        "hypothesis contribution must be authored by the proposer".to_owned(),
                    );
                }
                if contribution.body != proposal.hypothesis {
                    errors.push(
                        "hypothesis contribution body must equal the frozen hypothesis".to_owned(),
                    );
                }
            }
            ContributionStage::ExperimentDesign => {
                if contribution.actor != proposal.proposer {
                    errors.push(
                        "experiment design contribution must be authored by the proposer"
                            .to_owned(),
                    );
                }
            }
            ContributionStage::MathematicalFoundation | ContributionStage::EngineeringReview => {
                if actor_identity(&contribution.actor) == actor_identity(&proposal.proposer) {
                    errors.push(format!(
                        "{stage} contribution must be independent from the proposer"
                    ));
                }
            }
        }
    }
    if stages.len() != 4 {
        errors.push("proposal package must cover all four contribution stages".to_owned());
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(Error::Validation(errors))
    }
}

fn ensure_experiment_has_no_other_proposal(
    workspace: &Workspace,
    proposal: &ExperimentProposal,
) -> Result<()> {
    for event in workspace.events()?.into_iter().filter(|event| {
        matches!(
            event.event_type.as_str(),
            PROPOSAL_DRAFTED | PROPOSAL_REVISED
        )
    }) {
        let artifact_ref = required_artifact(&event.event_type, event.artifact_ref)?;
        let existing: ExperimentProposal = workspace.get(&artifact_ref)?;
        if existing.experiment_id == proposal.experiment_id && existing.id != proposal.id {
            return Err(Error::Conflict(format!(
                "experiment {} already has proposal {}",
                proposal.experiment_id, existing.id
            )));
        }
    }
    Ok(())
}

fn current_proposal(
    workspace: &Workspace,
    proposal_id: &str,
) -> Result<Option<(String, ExperimentProposal)>> {
    workspace
        .events()?
        .into_iter()
        .rev()
        .find(|event| {
            event.aggregate_id == proposal_id
                && matches!(
                    event.event_type.as_str(),
                    PROPOSAL_DRAFTED | PROPOSAL_REVISED
                )
        })
        .map(|event| {
            let artifact_ref = required_artifact(&event.event_type, event.artifact_ref)?;
            let proposal = workspace.get(&artifact_ref)?;
            Ok((artifact_ref, proposal))
        })
        .transpose()
}

fn required_current_proposal(
    workspace: &Workspace,
    proposal_id: &str,
) -> Result<(String, ExperimentProposal)> {
    current_proposal(workspace, proposal_id)?
        .ok_or_else(|| Error::NotFound(format!("proposal {proposal_id}")))
}

fn reviews_for_revision(
    workspace: &Workspace,
    proposal_id: &str,
    proposal_ref: &str,
) -> Result<Vec<(String, ProposalReview)>> {
    let mut reviews = Vec::new();
    for event in workspace
        .events()?
        .into_iter()
        .filter(|event| event.event_type == PROPOSAL_REVIEWED)
    {
        let artifact_ref = required_artifact(&event.event_type, event.artifact_ref)?;
        let review: ProposalReview = workspace.get(&artifact_ref)?;
        if review.proposal_id == proposal_id && review.proposal_ref == proposal_ref {
            reviews.push((artifact_ref, review));
        }
    }
    Ok(reviews)
}

fn latest_typed<T: DeserializeOwned>(
    workspace: &Workspace,
    event_type: &str,
    aggregate_id: &str,
) -> Result<Option<T>> {
    latest_typed_with_ref(workspace, event_type, aggregate_id)
        .map(|item| item.map(|(_, object)| object))
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

fn required_artifact(event_type: &str, artifact_ref: Option<String>) -> Result<String> {
    artifact_ref.ok_or_else(|| {
        Error::Conflict(format!(
            "{event_type} event is missing its artifact reference"
        ))
    })
}

fn artifact_ref_for<T: serde::Serialize>(object: &T) -> Result<String> {
    Ok(format!("artifact://sha256/{}", Workspace::digest(object)?))
}

fn actor_identity(actor: &ActorRef) -> &str {
    if actor.kind == ActorKind::Model {
        actor.model_ref.as_deref().unwrap_or(&actor.id)
    } else {
        &actor.id
    }
}

fn stage_name(stage: &ContributionStage) -> &'static str {
    match stage {
        ContributionStage::Hypothesis => "hypothesis",
        ContributionStage::MathematicalFoundation => "mathematical_foundation",
        ContributionStage::EngineeringReview => "engineering_review",
        ContributionStage::ExperimentDesign => "experiment_design",
    }
}

fn lineage_id<'a>(experiment: &'a ExperimentSpec, stage: &ContributionStage) -> &'a str {
    match stage {
        ContributionStage::Hypothesis => &experiment.lineage.hypothesis,
        ContributionStage::MathematicalFoundation => &experiment.lineage.mathematical_foundation,
        ContributionStage::EngineeringReview => &experiment.lineage.engineering_review,
        ContributionStage::ExperimentDesign => &experiment.lineage.experiment_design,
    }
}

fn readiness(check: &str, passed: bool, detail: String) -> ProposalReadinessCheck {
    ProposalReadinessCheck {
        check: check.to_owned(),
        passed,
        detail,
    }
}
