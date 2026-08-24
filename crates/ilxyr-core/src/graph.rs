use std::collections::BTreeSet;

use serde::de::DeserializeOwned;

use crate::{
    ActorRef, ClaimNode, ClaimStatus, CompiledExperiment, Error, Evidence, EvidenceGraphEdge,
    EvidenceRelation, IndependenceAssessment, ReplicationContract, ReplicationKind,
    ReplicationSettlement, Result, SharedTaskContract, Workspace, evidence_bundle, store::now_ms,
};

pub(crate) const CLAIM_REGISTERED: &str = "ClaimRegistered";
pub(crate) const EVIDENCE_EDGE_RECORDED: &str = "EvidenceEdgeRecorded";
const REPLICATION_CONTRACT_REGISTERED: &str = "ReplicationContractRegistered";
pub(crate) const REPLICATION_SETTLED: &str = "ReplicationSettled";
pub(crate) const EXPERIMENT_COMPILED: &str = "ExperimentCompiled";
const EXECUTION_STARTED: &str = "ExecutionStarted";
pub(crate) const EVIDENCE_RECORDED: &str = "EvidenceRecorded";

pub fn register_claim(workspace: &Workspace, claim: ClaimNode) -> Result<String> {
    validate_claim(&claim)?;
    ensure_unique_id(workspace, CLAIM_REGISTERED, &claim.id)?;
    let shared_task = claim
        .shared_task_ref
        .as_deref()
        .map(|task_ref| ledgered_shared_task(workspace, task_ref))
        .transpose()?;
    for evidence_ref in &claim.evidence_refs {
        ensure_evidence_ref(workspace, evidence_ref)?;
        if let Some((task_ref, task)) = &shared_task {
            ensure_evidence_bound_to_shared_task(workspace, evidence_ref, task_ref, task)?;
        }
    }
    let artifact_ref = workspace.put(&claim)?;
    workspace.append_event(
        CLAIM_REGISTERED,
        &claim.id,
        claim.created_by.clone(),
        Some(artifact_ref.clone()),
    )?;
    Ok(artifact_ref)
}

pub fn record_evidence_edge(workspace: &Workspace, edge: EvidenceGraphEdge) -> Result<String> {
    validate_edge(&edge)?;
    ensure_unique_id(workspace, EVIDENCE_EDGE_RECORDED, &edge.id)?;
    ensure_graph_node(workspace, &edge.source)?;
    ensure_graph_node(workspace, &edge.target)?;
    if edge.source == edge.target {
        return Err(Error::Validation(vec![
            "evidence graph edge cannot point a node to itself".to_owned(),
        ]));
    }
    let artifact_ref = workspace.put(&edge)?;
    workspace.append_event(
        EVIDENCE_EDGE_RECORDED,
        &edge.id,
        edge.asserted_by.clone(),
        Some(artifact_ref.clone()),
    )?;
    Ok(artifact_ref)
}

pub fn register_replication_contract(
    workspace: &Workspace,
    contract: ReplicationContract,
) -> Result<String> {
    validate_replication_contract(&contract)?;
    ensure_unique_id(workspace, REPLICATION_CONTRACT_REGISTERED, &contract.id)?;
    if workspace
        .latest_event(EXECUTION_STARTED, &contract.replication_experiment_id)?
        .is_some()
    {
        return Err(Error::Conflict(format!(
            "replication experiment {} has already started",
            contract.replication_experiment_id
        )));
    }
    let claim = registered_claim(workspace, &contract.target_claim)?;
    let shared_task_ref = claim.shared_task_ref.as_deref().ok_or_else(|| {
        Error::Validation(vec![format!(
            "replication target claim {} is not bound to a shared task",
            contract.target_claim
        )])
    })?;
    let (_, shared_task) = ledgered_shared_task(workspace, shared_task_ref)?;
    if !claim
        .evidence_refs
        .contains(&contract.reference_evidence_ref)
    {
        return Err(Error::Validation(vec![format!(
            "reference evidence is not attached to claim {}",
            contract.target_claim
        )]));
    }
    let reference: Evidence = workspace.get(&contract.reference_evidence_ref)?;
    ensure_evidence_ref(workspace, &contract.reference_evidence_ref)?;
    let compiled = compiled_experiment(workspace, &contract.replication_experiment_id)?;
    if compiled.shared_task_ref.as_deref() != Some(shared_task_ref) {
        return Err(Error::Validation(vec![format!(
            "replication experiment is not compiled against claim shared task {shared_task_ref}"
        )]));
    }
    if contract.eval_set != shared_task.eval_set.handle {
        return Err(Error::Validation(vec![format!(
            "replication contract eval set must match shared task {}",
            shared_task.eval_set.handle
        )]));
    }
    if !compiled.spec.datasets.contains(&contract.eval_set) {
        return Err(Error::Validation(vec![format!(
            "replication experiment does not declare eval set {}",
            contract.eval_set
        )]));
    }
    if let Some(tolerances) = &contract.tolerances {
        for metric in tolerances.keys() {
            if !reference.metrics.contains_key(metric)
                || !compiled
                    .spec
                    .metrics
                    .iter()
                    .any(|declared| declared.name == *metric)
            {
                return Err(Error::Validation(vec![format!(
                    "capability tolerance metric {metric} is not present in both reference and replication contracts"
                )]));
            }
        }
    }
    if let Some(metric) = &contract.agreement_metric {
        if !compiled
            .spec
            .metrics
            .iter()
            .any(|declared| declared.name == *metric)
        {
            return Err(Error::Validation(vec![format!(
                "agreement metric {metric} is not declared by the replication experiment"
            )]));
        }
    }
    if compiled.spec.evidence_authority.scope.eval_set.as_deref()
        != Some(contract.eval_set.as_str())
    {
        return Err(Error::Validation(vec![format!(
            "replication experiment evidence authority must be scoped to eval set {}",
            contract.eval_set
        )]));
    }

    let artifact_ref = workspace.put(&contract)?;
    workspace.append_event(
        REPLICATION_CONTRACT_REGISTERED,
        &contract.id,
        contract.declared_by.clone(),
        Some(artifact_ref.clone()),
    )?;
    Ok(artifact_ref)
}

pub fn settle_replication(
    workspace: &Workspace,
    contract_ref: &str,
    replication_evidence_ref: &str,
) -> Result<ReplicationSettlement> {
    let events = workspace.events()?;
    let contract_event_index = events
        .iter()
        .position(|event| {
            event.event_type == REPLICATION_CONTRACT_REGISTERED
                && event.artifact_ref.as_deref() == Some(contract_ref)
        })
        .ok_or_else(|| {
            Error::Conflict(format!(
                "{contract_ref} is not a ledgered replication contract"
            ))
        })?;
    let evidence_event_index = events
        .iter()
        .position(|event| {
            event.event_type == EVIDENCE_RECORDED
                && event.artifact_ref.as_deref() == Some(replication_evidence_ref)
        })
        .ok_or_else(|| {
            Error::Conflict(format!(
                "{replication_evidence_ref} is not ledgered evidence"
            ))
        })?;
    if evidence_event_index <= contract_event_index {
        return Err(Error::Conflict(
            "replication evidence predates its frozen contract".to_owned(),
        ));
    }
    let contract: ReplicationContract = workspace.get(contract_ref)?;
    let replication: Evidence = workspace.get(replication_evidence_ref)?;
    if replication.experiment_id != contract.replication_experiment_id {
        return Err(Error::Validation(vec![format!(
            "replication evidence belongs to {}, expected {}",
            replication.experiment_id, contract.replication_experiment_id
        )]));
    }
    let settlement_id = format!(
        "replication:{}:{}",
        artifact_digest(contract_ref)?,
        artifact_digest(replication_evidence_ref)?
    );
    if let Some(existing) =
        latest_typed::<ReplicationSettlement>(workspace, REPLICATION_SETTLED, &settlement_id)?
    {
        ensure_replication_edge(workspace, &existing)?;
        return Ok(existing);
    }

    let claim = registered_claim(workspace, &contract.target_claim)?;
    if !claim
        .evidence_refs
        .contains(&contract.reference_evidence_ref)
    {
        return Err(Error::Conflict(
            "replication target no longer contains its frozen reference evidence".to_owned(),
        ));
    }
    let reference: Evidence = workspace.get(&contract.reference_evidence_ref)?;
    let replication_bundle = evidence_bundle(workspace, replication_evidence_ref)?;
    let capability_passed = capability_passed(&contract, &reference, &replication)?;
    let equivalence_passed = equivalence_passed(&contract, &replication)?;
    let independence = independence(&reference, &replication, claim.shared_task_ref.as_deref());
    let forward_risked = replication_bundle.forecast_risked;
    let succeeded =
        capability_passed && equivalence_passed && independence.independent && forward_risked;
    let settlement = ReplicationSettlement {
        schema: "ilxyr.replication_settlement.v1".to_owned(),
        id: settlement_id.clone(),
        contract_ref: contract_ref.to_owned(),
        target_claim: contract.target_claim,
        reference_evidence_ref: contract.reference_evidence_ref,
        replication_evidence_ref: replication_evidence_ref.to_owned(),
        capability_passed,
        equivalence_passed,
        forward_risked,
        independence,
        succeeded,
        settled_at_ms: now_ms()?,
    };
    let artifact_ref = workspace.put(&settlement)?;
    workspace.append_event(
        REPLICATION_SETTLED,
        &settlement_id,
        ActorRef::service("service://ilxyr/replication-settler-v1"),
        Some(artifact_ref),
    )?;
    ensure_replication_edge(workspace, &settlement)?;
    Ok(settlement)
}

pub fn claim_status(workspace: &Workspace, claim_id: &str) -> Result<ClaimStatus> {
    let claim = registered_claim(workspace, claim_id)?;
    let mut edges = artifacts_for::<EvidenceGraphEdge>(workspace, EVIDENCE_EDGE_RECORDED)?
        .into_iter()
        .filter(|edge| edge.source == claim_id || edge.target == claim_id)
        .collect::<Vec<_>>();
    edges.sort_by(|left, right| left.id.cmp(&right.id));
    let mut replications = artifacts_for::<ReplicationSettlement>(workspace, REPLICATION_SETTLED)?
        .into_iter()
        .filter(|settlement| settlement.target_claim == claim_id)
        .collect::<Vec<_>>();
    replications.sort_by(|left, right| left.id.cmp(&right.id));

    let mut evidence_refs = claim.evidence_refs.clone();
    evidence_refs.extend(
        replications
            .iter()
            .map(|settlement| settlement.replication_evidence_ref.clone()),
    );
    evidence_refs.sort();
    evidence_refs.dedup();
    let mut prospectively_risked = false;
    let mut cold_replayable = false;
    for evidence_ref in evidence_refs {
        let bundle = evidence_bundle(workspace, &evidence_ref)?;
        prospectively_risked |= bundle.forecast_risked;
        cold_replayable |= bundle.cold_replayable;
    }
    let independent_replications = replications
        .iter()
        .filter(|settlement| settlement.succeeded && settlement.independence.independent)
        .count();
    let shared_task_bound = claim.shared_task_ref.is_some();
    let spine_eligible = shared_task_bound
        && prospectively_risked
        && cold_replayable
        && independent_replications > 0;

    Ok(ClaimStatus {
        schema: "ilxyr.claim_status.v1".to_owned(),
        claim,
        edges,
        replications,
        shared_task_bound,
        prospectively_risked,
        cold_replayable,
        independent_replications,
        spine_eligible,
    })
}

fn capability_passed(
    contract: &ReplicationContract,
    reference: &Evidence,
    replication: &Evidence,
) -> Result<bool> {
    if !matches!(
        contract.kind,
        ReplicationKind::Capability | ReplicationKind::Both
    ) {
        return Ok(true);
    }
    let tolerances = contract.tolerances.as_ref().ok_or_else(|| {
        Error::Conflict("capability replication contract has no tolerances".to_owned())
    })?;
    for (metric, tolerance) in tolerances {
        let reference_value = reference.metrics.get(metric).ok_or_else(|| {
            Error::Conflict(format!("reference evidence is missing metric {metric}"))
        })?;
        let replication_value = replication.metrics.get(metric).ok_or_else(|| {
            Error::Conflict(format!("replication evidence is missing metric {metric}"))
        })?;
        if (reference_value - replication_value).abs() > *tolerance {
            return Ok(false);
        }
    }
    Ok(true)
}

fn equivalence_passed(contract: &ReplicationContract, replication: &Evidence) -> Result<bool> {
    if !matches!(
        contract.kind,
        ReplicationKind::ComputationalEquivalence | ReplicationKind::Both
    ) {
        return Ok(true);
    }
    let metric = contract.agreement_metric.as_ref().ok_or_else(|| {
        Error::Conflict("equivalence replication contract has no agreement metric".to_owned())
    })?;
    let threshold = contract.agreement_threshold.ok_or_else(|| {
        Error::Conflict("equivalence replication contract has no agreement threshold".to_owned())
    })?;
    let Some(value) = replication.metrics.get(metric) else {
        return Ok(false);
    };
    if !(0.0..=1.0).contains(value) {
        return Err(Error::Validation(vec![format!(
            "agreement metric {metric} must be between 0 and 1"
        )]));
    }
    Ok(*value >= threshold)
}

fn independence(
    reference: &Evidence,
    replication: &Evidence,
    permitted_shared_task_ref: Option<&str>,
) -> IndependenceAssessment {
    let reference_artifacts = reference
        .authority
        .provenance
        .artifact_hashes
        .iter()
        .collect::<BTreeSet<_>>();
    let mut shared_artifacts = replication
        .authority
        .provenance
        .artifact_hashes
        .iter()
        .filter(|artifact| reference_artifacts.contains(artifact))
        .filter(|artifact| Some(artifact.as_str()) != permitted_shared_task_ref)
        .cloned()
        .collect::<Vec<_>>();
    shared_artifacts.sort();
    let distinct_checker =
        reference.authority.provenance.checker != replication.authority.provenance.checker;
    let distinct_model_lineage = match (
        reference.authority.provenance.model_lineage.as_deref(),
        replication.authority.provenance.model_lineage.as_deref(),
    ) {
        (Some(reference), Some(replication)) => reference != replication,
        _ => false,
    };
    let independent = shared_artifacts.is_empty() && distinct_checker && distinct_model_lineage;
    IndependenceAssessment {
        shared_artifacts,
        distinct_checker,
        distinct_model_lineage,
        independent,
    }
}

fn ensure_replication_edge(
    workspace: &Workspace,
    settlement: &ReplicationSettlement,
) -> Result<()> {
    let edge_id = format!("edge:{}", settlement.id);
    if workspace
        .latest_event(EVIDENCE_EDGE_RECORDED, &edge_id)?
        .is_some()
    {
        return Ok(());
    }
    record_evidence_edge(
        workspace,
        EvidenceGraphEdge {
            schema: "ilxyr.evidence_graph_edge.v1".to_owned(),
            id: edge_id,
            source: settlement.replication_evidence_ref.clone(),
            target: settlement.target_claim.clone(),
            relation: EvidenceRelation::Replicates,
            asserted_by: ActorRef::service("service://ilxyr/replication-settler-v1"),
            asserted_at_ms: settlement.settled_at_ms,
        },
    )?;
    Ok(())
}

fn validate_claim(claim: &ClaimNode) -> Result<()> {
    let mut errors = Vec::new();
    if claim.schema != "ilxyr.claim.v1" {
        errors.push("claim.schema must be ilxyr.claim.v1".to_owned());
    }
    validate_identifier(&claim.id, "claim.id", &mut errors);
    if claim.statement.trim().is_empty() {
        errors.push("claim.statement must not be empty".to_owned());
    }
    if claim.evidence_refs.is_empty() {
        errors.push("claim.evidence_refs must not be empty".to_owned());
    }
    if claim.evidence_refs.iter().collect::<BTreeSet<_>>().len() != claim.evidence_refs.len() {
        errors.push("claim.evidence_refs contains duplicates".to_owned());
    }
    for evidence_ref in &claim.evidence_refs {
        validate_artifact_ref(evidence_ref, "claim.evidence_refs[]", &mut errors);
    }
    if let Some(shared_task_ref) = &claim.shared_task_ref {
        validate_artifact_ref(shared_task_ref, "claim.shared_task_ref", &mut errors);
    }
    if let Some(freshness_prerequisite) = &claim.freshness_prerequisite {
        validate_artifact_ref(
            freshness_prerequisite,
            "claim.freshness_prerequisite",
            &mut errors,
        );
    }
    if let Some(refresh_command) = &claim.refresh_command {
        if refresh_command.trim().is_empty() {
            errors.push("claim.refresh_command must not be empty".to_owned());
        }
    }
    if claim.created_at_ms == 0 {
        errors.push("claim.created_at_ms must be positive".to_owned());
    }
    validate_actor(&claim.created_by, &mut errors);
    finish(errors)
}

fn validate_edge(edge: &EvidenceGraphEdge) -> Result<()> {
    let mut errors = Vec::new();
    if edge.schema != "ilxyr.evidence_graph_edge.v1" {
        errors.push("edge.schema must be ilxyr.evidence_graph_edge.v1".to_owned());
    }
    validate_identifier(&edge.id, "edge.id", &mut errors);
    if edge.source.trim().is_empty() || edge.target.trim().is_empty() {
        errors.push("edge source and target must not be empty".to_owned());
    }
    if edge.asserted_at_ms == 0 {
        errors.push("edge.asserted_at_ms must be positive".to_owned());
    }
    validate_actor(&edge.asserted_by, &mut errors);
    finish(errors)
}

fn validate_replication_contract(contract: &ReplicationContract) -> Result<()> {
    let mut errors = Vec::new();
    if contract.schema != "ilxyr.replication_contract.v1" {
        errors.push("replication schema must be ilxyr.replication_contract.v1".to_owned());
    }
    validate_identifier(&contract.id, "replication.id", &mut errors);
    validate_identifier(
        &contract.target_claim,
        "replication.target_claim",
        &mut errors,
    );
    validate_identifier(
        &contract.replication_experiment_id,
        "replication.replication_experiment_id",
        &mut errors,
    );
    validate_artifact_ref(
        &contract.reference_evidence_ref,
        "replication.reference_evidence_ref",
        &mut errors,
    );
    if !contract.eval_set.starts_with("dataset://") && !contract.eval_set.starts_with("artifact://")
    {
        errors.push("replication.eval_set must use dataset:// or artifact://".to_owned());
    }
    let needs_capability = matches!(
        contract.kind,
        ReplicationKind::Capability | ReplicationKind::Both
    );
    let needs_equivalence = matches!(
        contract.kind,
        ReplicationKind::ComputationalEquivalence | ReplicationKind::Both
    );
    if needs_capability {
        match &contract.tolerances {
            Some(tolerances) if !tolerances.is_empty() => {
                for (metric, tolerance) in tolerances {
                    if metric.trim().is_empty() || !tolerance.is_finite() || *tolerance < 0.0 {
                        errors.push(
                            "replication tolerances require named, finite non-negative values"
                                .to_owned(),
                        );
                    }
                }
            }
            _ => errors.push("capability replication requires tolerances".to_owned()),
        }
    } else if contract.tolerances.is_some() {
        errors.push("non-capability replication must not declare tolerances".to_owned());
    }
    if needs_equivalence {
        if contract
            .agreement_metric
            .as_deref()
            .is_none_or(str::is_empty)
        {
            errors.push("equivalence replication requires agreement_metric".to_owned());
        }
        if contract
            .agreement_threshold
            .is_none_or(|value| !value.is_finite() || !(0.0..=1.0).contains(&value))
        {
            errors.push(
                "equivalence replication requires agreement_threshold between 0 and 1".to_owned(),
            );
        }
    } else if contract.agreement_metric.is_some() || contract.agreement_threshold.is_some() {
        errors.push("non-equivalence replication must not declare agreement fields".to_owned());
    }
    if contract.declared_at_ms == 0 {
        errors.push("replication.declared_at_ms must be positive".to_owned());
    }
    validate_actor(&contract.declared_by, &mut errors);
    finish(errors)
}

pub(crate) fn registered_claim(workspace: &Workspace, claim_id: &str) -> Result<ClaimNode> {
    latest_typed(workspace, CLAIM_REGISTERED, claim_id)?
        .ok_or_else(|| Error::NotFound(format!("claim {claim_id}")))
}

fn compiled_experiment(workspace: &Workspace, experiment_id: &str) -> Result<CompiledExperiment> {
    latest_typed(workspace, EXPERIMENT_COMPILED, experiment_id)?
        .ok_or_else(|| Error::NotFound(format!("compiled experiment {experiment_id}")))
}

fn ensure_graph_node(workspace: &Workspace, node: &str) -> Result<()> {
    if node.starts_with("artifact://sha256/") {
        ensure_evidence_ref(workspace, node)
    } else {
        registered_claim(workspace, node).map(|_| ())
    }
}

fn ensure_evidence_ref(workspace: &Workspace, evidence_ref: &str) -> Result<()> {
    let ledgered = workspace.events()?.into_iter().any(|event| {
        event.event_type == EVIDENCE_RECORDED && event.artifact_ref.as_deref() == Some(evidence_ref)
    });
    if !ledgered {
        return Err(Error::NotFound(format!("ledgered evidence {evidence_ref}")));
    }
    let _: Evidence = workspace.get(evidence_ref)?;
    Ok(())
}

fn ledgered_shared_task(
    workspace: &Workspace,
    shared_task_ref: &str,
) -> Result<(String, SharedTaskContract)> {
    let shared_task: SharedTaskContract = workspace.get(shared_task_ref)?;
    let ledgered = workspace.events()?.into_iter().any(|event| {
        event.event_type == "SharedTaskRegistered"
            && event.aggregate_id == shared_task.id
            && event.artifact_ref.as_deref() == Some(shared_task_ref)
    });
    if !ledgered {
        return Err(Error::NotFound(format!(
            "ledgered shared task {shared_task_ref}"
        )));
    }
    Ok((shared_task_ref.to_owned(), shared_task))
}

fn ensure_evidence_bound_to_shared_task(
    workspace: &Workspace,
    evidence_ref: &str,
    shared_task_ref: &str,
    shared_task: &SharedTaskContract,
) -> Result<()> {
    let bundle = evidence_bundle(workspace, evidence_ref)?;
    let prospectively_bound = bundle
        .compiled
        .as_ref()
        .and_then(|compiled| compiled.shared_task_ref.as_deref())
        == Some(shared_task_ref);
    let retro_bound = bundle
        .retro_plan
        .as_ref()
        .and_then(|plan| plan.shared_task_id.as_deref())
        == Some(shared_task.id.as_str());
    let authority_bound = bundle
        .evidence
        .authority
        .provenance
        .artifact_hashes
        .iter()
        .any(|artifact| artifact == shared_task_ref);
    if (!prospectively_bound && !retro_bound) || !authority_bound {
        return Err(Error::Validation(vec![format!(
            "claim evidence {evidence_ref} is not bound to shared task {shared_task_ref}"
        )]));
    }
    Ok(())
}

fn ensure_unique_id(workspace: &Workspace, event_type: &str, id: &str) -> Result<()> {
    if workspace.latest_event(event_type, id)?.is_some() {
        return Err(Error::Conflict(format!(
            "{event_type} ID {id} already exists"
        )));
    }
    Ok(())
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

pub(crate) fn artifacts_for<T: DeserializeOwned>(
    workspace: &Workspace,
    event_type: &str,
) -> Result<Vec<T>> {
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

fn validate_actor(actor: &ActorRef, errors: &mut Vec<String>) {
    let prefix = match actor.kind {
        crate::ActorKind::Human => "human://",
        crate::ActorKind::Model => "model://",
        crate::ActorKind::Service => "service://",
    };
    if !actor.id.starts_with(prefix) {
        errors.push(format!("actor ID must start with {prefix}"));
    }
    if matches!(actor.kind, crate::ActorKind::Model) != actor.model_ref.is_some() {
        errors.push("model actors require model_ref and other actors forbid it".to_owned());
    }
}

fn validate_identifier(value: &str, field: &str, errors: &mut Vec<String>) {
    if value.is_empty()
        || !value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b'/' | b':')
        })
    {
        errors.push(format!("{field} is not a valid identifier"));
    }
}

fn validate_artifact_ref(value: &str, field: &str, errors: &mut Vec<String>) {
    if artifact_digest(value).is_err() {
        errors.push(format!(
            "{field} must be a lowercase SHA-256 artifact reference"
        ));
    }
}

fn artifact_digest(artifact_ref: &str) -> Result<&str> {
    let digest = artifact_ref
        .strip_prefix("artifact://sha256/")
        .ok_or_else(|| Error::Validation(vec!["invalid artifact reference".to_owned()]))?;
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(Error::Validation(vec![
            "invalid SHA-256 artifact reference".to_owned(),
        ]));
    }
    Ok(digest)
}

fn finish(errors: Vec<String>) -> Result<()> {
    if errors.is_empty() {
        Ok(())
    } else {
        Err(Error::Validation(errors))
    }
}

fn required_artifact(event_type: &str, artifact_ref: Option<String>) -> Result<String> {
    artifact_ref.ok_or_else(|| {
        Error::Conflict(format!(
            "{event_type} event is missing its artifact reference"
        ))
    })
}
