use std::{fs, path::PathBuf, process, time::SystemTime};

use ilxyr_core::{
    ComparisonOperator, ContributionStage, ExperimentProposal, ExperimentSpec, ModelFamily,
    OutcomePredicate, ProposalReview, ProposalReviewSeverity, ResearchContribution, Workspace,
    compile_proposal, freeze_proposal, package_proposal, proposal_status, review_proposal,
    submit_proposal,
};

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn create(label: &str) -> Self {
        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("test clock must follow Unix epoch")
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("ilxyr-proposal-{label}-{}-{nonce}", process::id()));
        fs::create_dir_all(&path).expect("test directory must be created");
        Self(path)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn proposal_lifecycle_compiles_a_frozen_candidate() {
    let directory = TestDirectory::create("complete");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    let (proposal, experiment, contributions) = fixtures();

    let proposal_ref =
        submit_proposal(&workspace, proposal.clone()).expect("proposal must be accepted");
    assert_eq!(
        submit_proposal(&workspace, proposal.clone()).expect("exact draft retry must work"),
        proposal_ref
    );
    review_proposal(
        &workspace,
        review(
            "toy.proposal.review.v1",
            &proposal,
            &proposal_ref,
            ProposalReviewSeverity::Endorsement,
        ),
    )
    .expect("independent review must be accepted");
    let candidate_ref =
        freeze_proposal(&workspace, &proposal.id).expect("reviewed proposal must freeze");
    let package_ref = package_proposal(&workspace, &proposal.id, contributions, experiment.clone())
        .expect("matching contribution package must be accepted");
    let compilation = compile_proposal(&workspace, &proposal.id).expect("package must compile");

    assert_eq!(compilation.package_ref, package_ref);
    assert_eq!(compilation.contribution_refs.len(), 4);
    assert!(compilation.compiled_ref.starts_with("artifact://sha256/"));
    let status = proposal_status(&workspace, &proposal.id).expect("status must load");
    assert!(status.frozen);
    assert!(status.packaged);
    assert!(status.compiled);
    assert_eq!(
        status.candidate_ref.as_deref(),
        Some(candidate_ref.as_str())
    );
    assert!(status.readiness.iter().all(|check| check.passed));

    let events_before_retry = workspace.events().expect("events must load").len();
    let retry = compile_proposal(&workspace, &proposal.id).expect("compile must be idempotent");
    assert_eq!(retry.compiled_ref, compilation.compiled_ref);
    assert_eq!(
        workspace.events().expect("events must load").len(),
        events_before_retry
    );
    assert!(workspace.verify().expect("ledger must verify").valid);
}

#[test]
fn revision_invalidates_old_reviews_and_blocking_reviews_prevent_freeze() {
    let directory = TestDirectory::create("revision");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    let (proposal, _, _) = fixtures();
    let first_ref = submit_proposal(&workspace, proposal.clone()).expect("draft must be accepted");
    let mut self_review = review(
        "toy.proposal.self_review.v1",
        &proposal,
        &first_ref,
        ProposalReviewSeverity::Endorsement,
    );
    self_review.reviewer = proposal.proposer.clone();
    assert!(review_proposal(&workspace, self_review).is_err());
    review_proposal(
        &workspace,
        review(
            "toy.proposal.blocking.v1",
            &proposal,
            &first_ref,
            ProposalReviewSeverity::Blocking,
        ),
    )
    .expect("blocking review must be recorded");
    assert!(freeze_proposal(&workspace, &proposal.id).is_err());

    let mut revision = proposal.clone();
    revision.revision = 2;
    revision.predecessor_ref = Some(first_ref);
    revision.summary =
        "Revision addresses the review and keeps the frozen test unchanged.".to_owned();
    let second_ref =
        submit_proposal(&workspace, revision.clone()).expect("successor revision must be accepted");
    let status = proposal_status(&workspace, &proposal.id).expect("status must load");
    assert!(status.current_review_refs.is_empty());
    assert!(freeze_proposal(&workspace, &proposal.id).is_err());

    review_proposal(
        &workspace,
        review(
            "toy.proposal.review.v2",
            &revision,
            &second_ref,
            ProposalReviewSeverity::Endorsement,
        ),
    )
    .expect("new revision review must be accepted");
    freeze_proposal(&workspace, &proposal.id).expect("current review must permit freeze");
    let mut forbidden_revision = revision;
    forbidden_revision.revision = 3;
    forbidden_revision.predecessor_ref = Some(second_ref);
    assert!(submit_proposal(&workspace, forbidden_revision).is_err());
}

#[test]
fn package_cannot_change_the_frozen_metric_or_role_separation() {
    let directory = TestDirectory::create("binding");
    let workspace = Workspace::init(&directory.0).expect("workspace must initialize");
    let (proposal, experiment, contributions) = fixtures();
    let proposal_ref = submit_proposal(&workspace, proposal.clone()).expect("draft must work");
    review_proposal(
        &workspace,
        review(
            "toy.proposal.review.binding",
            &proposal,
            &proposal_ref,
            ProposalReviewSeverity::Advisory,
        ),
    )
    .expect("review must work");
    freeze_proposal(&workspace, &proposal.id).expect("proposal must freeze");

    let mut changed_experiment = experiment.clone();
    for outcome in &mut changed_experiment.outcome_contract.outcomes {
        if let OutcomePredicate::Metric { threshold, .. } = &mut outcome.predicate {
            *threshold = 0.81;
        }
    }
    assert!(
        package_proposal(
            &workspace,
            &proposal.id,
            contributions.clone(),
            changed_experiment
        )
        .is_err()
    );

    let mut collapsed_roles = contributions;
    collapsed_roles
        .iter_mut()
        .find(|contribution| contribution.stage == ContributionStage::MathematicalFoundation)
        .expect("foundation must exist")
        .actor = proposal.proposer.clone();
    assert!(package_proposal(&workspace, &proposal.id, collapsed_roles, experiment).is_err());
}

fn fixtures() -> (
    ExperimentProposal,
    ExperimentSpec,
    Vec<ResearchContribution>,
) {
    let mut experiment: ExperimentSpec =
        serde_json::from_str(include_str!("../../../examples/toy/experiment.json"))
            .expect("experiment example must parse");
    let mut contributions = [
        include_str!("../../../examples/toy/hypothesis.json"),
        include_str!("../../../examples/toy/foundation.json"),
        include_str!("../../../examples/toy/engineering-review.json"),
        include_str!("../../../examples/toy/experiment-design.json"),
    ]
    .into_iter()
    .map(|json| serde_json::from_str::<ResearchContribution>(json).expect("fixture must parse"))
    .collect::<Vec<_>>();
    let hypothesis = contributions
        .iter()
        .find(|contribution| contribution.stage == ContributionStage::Hypothesis)
        .expect("hypothesis must exist")
        .body
        .clone();
    experiment.hypothesis.clone_from(&hypothesis);
    experiment.family = Some(ModelFamily::Zero);
    contributions
        .iter_mut()
        .find(|contribution| contribution.stage == ContributionStage::ExperimentDesign)
        .expect("experiment design must exist")
        .actor = experiment.proposer.clone();

    let proposal = ExperimentProposal {
        schema: "ilxyr.experiment_proposal.v1".to_owned(),
        id: "toy.score.proposal.v1".to_owned(),
        revision: 1,
        predecessor_ref: None,
        experiment_id: experiment.id.clone(),
        proposer: experiment.proposer.clone(),
        title: experiment.title.clone(),
        summary: "Test whether a frozen procedure clears a declared quality threshold.".to_owned(),
        hypothesis,
        novelty: "Exercises a decision-complete draft before execution details are compiled."
            .to_owned(),
        family: ModelFamily::Zero,
        baseline: experiment.baseline.clone(),
        datasets: experiment.datasets.clone(),
        primary_metric: experiment.outcome_contract.primary_metric.clone(),
        success_operator: ComparisonOperator::Gte,
        success_threshold: 0.8,
        seeds: experiment.seeds.clone(),
        compute_credits: experiment.execution.max_cost_credits,
        evidence_level: experiment.evidence_authority.level.clone(),
        export_policy: experiment.security.export_policy.clone(),
    };
    (proposal, experiment, contributions)
}

fn review(
    id: &str,
    proposal: &ExperimentProposal,
    proposal_ref: &str,
    severity: ProposalReviewSeverity,
) -> ProposalReview {
    ProposalReview {
        schema: "ilxyr.proposal_review.v1".to_owned(),
        id: id.to_owned(),
        proposal_id: proposal.id.clone(),
        proposal_ref: proposal_ref.to_owned(),
        reviewer: ilxyr_core::ActorRef {
            id: "human://toy/proposal-reviewer".to_owned(),
            kind: ilxyr_core::ActorKind::Human,
            model_ref: None,
        },
        category: "methodology".to_owned(),
        severity,
        comment: "The frozen comparison is decision-complete and testable.".to_owned(),
        confidence: 0.93,
    }
}
