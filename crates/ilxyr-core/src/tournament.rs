//! Rival-mechanism tournaments over prospectively frozen observations.
//!
//! A tournament turns a broad go/no-go question into a causal discrimination
//! problem. Rival mechanisms predict whether each declared metric condition
//! will be satisfied. The protocol ranks observations by disagreement per
//! credit, freezes an exhaustive decision table before execution, and settles
//! the table from ledgered evidence without changing the experiment outcome.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::conditions::{
    CONDITION_SCHEMA, ConditionFacts, ConditionResult, ConditionSet, evaluate,
};
use crate::{
    ActorRef, Error, Result, Workspace, experiment_status, require_registered_huggingface_actor,
    require_registered_nsrl_actor, store::now_ms, validation,
};

pub const TOURNAMENT_SCHEMA: &str = "ilxyr.mechanism_tournament.v1";
pub const TOURNAMENT_SETTLEMENT_SCHEMA: &str = "ilxyr.mechanism_tournament_settlement.v1";
pub const TOURNAMENT_REGISTERED: &str = "MechanismTournamentRegistered";
pub const TOURNAMENT_SETTLED: &str = "MechanismTournamentSettled";
pub const MAX_TOURNAMENT_OBSERVATIONS: usize = 10;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MechanismTournament {
    pub schema: String,
    pub id: String,
    pub title: String,
    pub experiment_id: String,
    pub author: ActorRef,
    pub question: String,
    pub rivals: Vec<RivalMechanism>,
    pub observations: Vec<DiscriminatingObservation>,
    pub decision_table: Vec<DecisionRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RivalMechanism {
    pub id: String,
    pub statement: String,
    pub predictions: Vec<MechanismPrediction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MechanismPrediction {
    pub observation_id: String,
    pub probability_satisfied: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DiscriminatingObservation {
    pub id: String,
    pub description: String,
    pub estimated_cost_credits: u64,
    pub condition: ConditionSet,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DecisionRow {
    pub id: String,
    pub expectations: Vec<ObservationExpectation>,
    pub supported_rival_ids: Vec<String>,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ObservationExpectation {
    pub observation_id: String,
    pub satisfied: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ObservationPriority {
    pub observation_id: String,
    pub estimated_cost_credits: u64,
    pub disagreement: f64,
    pub priority_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TournamentRegistration {
    pub tournament_ref: String,
    pub observation_priorities: Vec<ObservationPriority>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ObservedConditionOutcome {
    Satisfied,
    Unsatisfied,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ObservationResolution {
    pub observation_id: String,
    pub outcome: ObservedConditionOutcome,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RivalScore {
    pub rival_id: String,
    pub brier_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MechanismTournamentSettlement {
    pub schema: String,
    pub tournament_id: String,
    pub experiment_id: String,
    pub decision_row_id: String,
    pub observations: Vec<ObservationResolution>,
    pub rival_scores: Vec<RivalScore>,
    pub lowest_scoring_rival_ids: Vec<String>,
    pub supported_rival_ids: Vec<String>,
    pub next_action: String,
    pub settled_at_ms: u128,
}

impl MechanismTournament {
    pub fn validate(&self) -> Result<()> {
        let mut errors = Vec::new();
        if self.schema != TOURNAMENT_SCHEMA {
            errors.push(format!(
                "tournament schema must be {TOURNAMENT_SCHEMA}, got {}",
                self.schema
            ));
        }
        for (label, value) in [
            ("id", self.id.as_str()),
            ("title", self.title.as_str()),
            ("experiment_id", self.experiment_id.as_str()),
            ("question", self.question.as_str()),
        ] {
            if value.trim().is_empty() {
                errors.push(format!("tournament {label} must not be empty"));
            }
        }
        if let Err(Error::Validation(actor_errors)) = validation::actor_ref(&self.author) {
            errors.extend(
                actor_errors
                    .into_iter()
                    .map(|error| format!("tournament.author: {error}")),
            );
        }
        if self.rivals.len() < 2 {
            errors.push("tournament needs at least two rival mechanisms".to_owned());
        }
        if self.observations.is_empty() {
            errors.push("tournament needs at least one observation".to_owned());
        }
        if self.observations.len() > MAX_TOURNAMENT_OBSERVATIONS {
            errors.push(format!(
                "tournament has {} observations; maximum is {MAX_TOURNAMENT_OBSERVATIONS}",
                self.observations.len()
            ));
        }

        let rival_ids = unique_ids(
            self.rivals.iter().map(|rival| rival.id.as_str()),
            "rival",
            &mut errors,
        );
        let observation_ids = unique_ids(
            self.observations
                .iter()
                .map(|observation| observation.id.as_str()),
            "observation",
            &mut errors,
        );
        let observation_order = self
            .observations
            .iter()
            .map(|observation| observation.id.clone())
            .collect::<Vec<_>>();

        let mut condition_ids = BTreeSet::new();
        for observation in &self.observations {
            if observation.description.trim().is_empty() {
                errors.push(format!(
                    "observation {} description must not be empty",
                    observation.id
                ));
            }
            if observation.estimated_cost_credits == 0 {
                errors.push(format!(
                    "observation {} estimated cost must be positive",
                    observation.id
                ));
            }
            if observation.condition.schema != CONDITION_SCHEMA {
                errors.push(format!(
                    "observation {} condition schema must be {CONDITION_SCHEMA}",
                    observation.id
                ));
            }
            if observation.condition.id.trim().is_empty()
                || !condition_ids.insert(observation.condition.id.as_str())
            {
                errors.push(format!(
                    "observation {} condition id must be non-empty and unique",
                    observation.id
                ));
            }
            if let Err(error) = observation.condition.validate() {
                errors.push(format!(
                    "observation {} condition is invalid: {error}",
                    observation.id
                ));
            }
        }

        let mut prediction_vectors: Vec<Vec<f64>> = Vec::new();
        for rival in &self.rivals {
            if rival.statement.trim().is_empty() {
                errors.push(format!("rival {} statement must not be empty", rival.id));
            }
            let mut predictions = BTreeMap::new();
            for prediction in &rival.predictions {
                if !observation_ids.contains(prediction.observation_id.as_str()) {
                    errors.push(format!(
                        "rival {} predicts unknown observation {}",
                        rival.id, prediction.observation_id
                    ));
                }
                if predictions
                    .insert(
                        prediction.observation_id.as_str(),
                        prediction.probability_satisfied,
                    )
                    .is_some()
                {
                    errors.push(format!(
                        "rival {} predicts observation {} more than once",
                        rival.id, prediction.observation_id
                    ));
                }
                if !prediction.probability_satisfied.is_finite()
                    || !(0.0..=1.0).contains(&prediction.probability_satisfied)
                {
                    errors.push(format!(
                        "rival {} probability for {} must be finite and within [0, 1]",
                        rival.id, prediction.observation_id
                    ));
                }
            }
            if predictions.len() != observation_ids.len() {
                errors.push(format!(
                    "rival {} must predict every observation exactly once",
                    rival.id
                ));
            }
            let vector = observation_order
                .iter()
                .filter_map(|id| predictions.get(id.as_str()).copied())
                .collect::<Vec<_>>();
            if vector.len() == observation_order.len() {
                if prediction_vectors
                    .iter()
                    .any(|existing| existing == &vector)
                {
                    errors.push(format!(
                        "rival {} is not distinguishable from another rival",
                        rival.id
                    ));
                } else {
                    prediction_vectors.push(vector);
                }
            }
        }

        let expected_rows = 1_usize
            .checked_shl(u32::try_from(self.observations.len()).unwrap_or(u32::MAX))
            .unwrap_or(usize::MAX);
        if self.decision_table.len() != expected_rows {
            errors.push(format!(
                "decision table must cover all {expected_rows} observation patterns"
            ));
        }
        let mut row_ids = BTreeSet::new();
        let mut patterns = BTreeSet::new();
        for row in &self.decision_table {
            if row.id.trim().is_empty() || !row_ids.insert(row.id.as_str()) {
                errors.push("decision row ids must be non-empty and unique".to_owned());
            }
            if row.next_action.trim().is_empty() {
                errors.push(format!("decision row {} needs a next action", row.id));
            }
            let mut supported = BTreeSet::new();
            for rival_id in &row.supported_rival_ids {
                if !rival_ids.contains(rival_id.as_str()) {
                    errors.push(format!(
                        "decision row {} supports unknown rival {rival_id}",
                        row.id
                    ));
                }
                if !supported.insert(rival_id.as_str()) {
                    errors.push(format!(
                        "decision row {} repeats supported rival {rival_id}",
                        row.id
                    ));
                }
            }
            let mut expectations = BTreeMap::new();
            for expectation in &row.expectations {
                if !observation_ids.contains(expectation.observation_id.as_str()) {
                    errors.push(format!(
                        "decision row {} names unknown observation {}",
                        row.id, expectation.observation_id
                    ));
                }
                if expectations
                    .insert(expectation.observation_id.as_str(), expectation.satisfied)
                    .is_some()
                {
                    errors.push(format!(
                        "decision row {} repeats observation {}",
                        row.id, expectation.observation_id
                    ));
                }
            }
            if expectations.len() != observation_ids.len() {
                errors.push(format!(
                    "decision row {} must classify every observation exactly once",
                    row.id
                ));
            }
            let pattern = observation_order
                .iter()
                .filter_map(|id| expectations.get(id.as_str()).copied())
                .collect::<Vec<_>>();
            if pattern.len() == observation_order.len() && !patterns.insert(pattern) {
                errors.push(format!(
                    "decision row {} duplicates another observation pattern",
                    row.id
                ));
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(Error::Validation(errors))
        }
    }
}

fn unique_ids<'a>(
    ids: impl IntoIterator<Item = &'a str>,
    label: &str,
    errors: &mut Vec<String>,
) -> BTreeSet<&'a str> {
    let mut unique = BTreeSet::new();
    for id in ids {
        if id.trim().is_empty() || !unique.insert(id) {
            errors.push(format!("{label} ids must be non-empty and unique"));
        }
    }
    unique
}

pub fn rank_observations(tournament: &MechanismTournament) -> Result<Vec<ObservationPriority>> {
    tournament.validate()?;
    let mut priorities = tournament
        .observations
        .iter()
        .map(|observation| {
            let probabilities = tournament
                .rivals
                .iter()
                .filter_map(|rival| {
                    rival
                        .predictions
                        .iter()
                        .find(|prediction| prediction.observation_id == observation.id)
                        .map(|prediction| prediction.probability_satisfied)
                })
                .collect::<Vec<_>>();
            let mean = probabilities.iter().sum::<f64>() / probabilities.len() as f64;
            let disagreement = probabilities
                .iter()
                .map(|probability| (probability - mean).powi(2))
                .sum::<f64>()
                / probabilities.len() as f64;
            ObservationPriority {
                observation_id: observation.id.clone(),
                estimated_cost_credits: observation.estimated_cost_credits,
                disagreement,
                priority_score: disagreement / observation.estimated_cost_credits as f64,
            }
        })
        .collect::<Vec<_>>();
    priorities.sort_by(|left, right| {
        right
            .priority_score
            .total_cmp(&left.priority_score)
            .then_with(|| {
                left.estimated_cost_credits
                    .cmp(&right.estimated_cost_credits)
            })
            .then_with(|| left.observation_id.cmp(&right.observation_id))
    });
    Ok(priorities)
}

pub fn register_mechanism_tournament(
    workspace: &Workspace,
    tournament: MechanismTournament,
) -> Result<TournamentRegistration> {
    tournament.validate()?;
    let priorities = rank_observations(&tournament)?;
    if let Some(event) = workspace.latest_event(TOURNAMENT_REGISTERED, &tournament.id)? {
        let tournament_ref = event.artifact_ref.ok_or_else(|| {
            Error::Conflict(format!(
                "{TOURNAMENT_REGISTERED} event is missing its artifact reference"
            ))
        })?;
        let existing: MechanismTournament = workspace.get(&tournament_ref)?;
        if Workspace::digest(&existing)? != Workspace::digest(&tournament)? {
            return Err(Error::Conflict(format!(
                "mechanism tournament {} is already registered with different content",
                tournament.id
            )));
        }
        return Ok(TournamentRegistration {
            tournament_ref,
            observation_priorities: priorities,
        });
    }
    require_registered_huggingface_actor(workspace, &tournament.author)?;
    require_registered_nsrl_actor(workspace, &tournament.author)?;
    let status = experiment_status(workspace, &tournament.experiment_id)?;
    if status.execution_started
        || status
            .latest_admission
            .as_ref()
            .is_some_and(|decision| decision.accepted)
    {
        return Err(Error::Conflict(format!(
            "experiment {} is already admitted or started; mechanism tournament must be frozen first",
            tournament.experiment_id
        )));
    }
    let tournament_id = tournament.id.clone();
    let tournament_ref = workspace.put(&tournament)?;
    workspace.append_event(
        TOURNAMENT_REGISTERED,
        &tournament_id,
        tournament.author.clone(),
        Some(tournament_ref.clone()),
    )?;
    Ok(TournamentRegistration {
        tournament_ref,
        observation_priorities: priorities,
    })
}

pub fn settle_mechanism_tournament(
    workspace: &Workspace,
    tournament_id: &str,
) -> Result<MechanismTournamentSettlement> {
    if let Some(event) = workspace.latest_event(TOURNAMENT_SETTLED, tournament_id)? {
        let reference = event.artifact_ref.ok_or_else(|| {
            Error::Conflict(format!(
                "{TOURNAMENT_SETTLED} event is missing its artifact reference"
            ))
        })?;
        return workspace.get(&reference);
    }
    let event = workspace
        .latest_event(TOURNAMENT_REGISTERED, tournament_id)?
        .ok_or_else(|| Error::NotFound(format!("mechanism tournament {tournament_id}")))?;
    let reference = event.artifact_ref.ok_or_else(|| {
        Error::Conflict(format!(
            "{TOURNAMENT_REGISTERED} event is missing its artifact reference"
        ))
    })?;
    let tournament: MechanismTournament = workspace.get(&reference)?;
    tournament.validate()?;

    let facts = ConditionFacts::from_workspace(workspace)?;
    let mut observations = Vec::new();
    let mut observed = BTreeMap::new();
    let mut unresolved = Vec::new();
    for observation in &tournament.observations {
        match evaluate(&observation.condition.root, &facts) {
            ConditionResult::Satisfied => {
                observed.insert(observation.id.as_str(), true);
                observations.push(ObservationResolution {
                    observation_id: observation.id.clone(),
                    outcome: ObservedConditionOutcome::Satisfied,
                    detail: "condition satisfied".to_owned(),
                });
            }
            ConditionResult::Unsatisfied { reason, .. } => {
                observed.insert(observation.id.as_str(), false);
                observations.push(ObservationResolution {
                    observation_id: observation.id.clone(),
                    outcome: ObservedConditionOutcome::Unsatisfied,
                    detail: reason,
                });
            }
            ConditionResult::Unresolvable { key, .. } => unresolved.push(key),
        }
    }
    if !unresolved.is_empty() {
        return Err(Error::Conflict(format!(
            "mechanism tournament {tournament_id} cannot settle; unresolved observations: {}",
            unresolved.join(", ")
        )));
    }

    let decision = tournament
        .decision_table
        .iter()
        .find(|row| {
            row.expectations.iter().all(|expectation| {
                observed.get(expectation.observation_id.as_str()) == Some(&expectation.satisfied)
            })
        })
        .ok_or_else(|| {
            Error::Conflict(format!(
                "mechanism tournament {tournament_id} has no matching decision row"
            ))
        })?;

    let mut rival_scores = tournament
        .rivals
        .iter()
        .map(|rival| {
            let sum = rival
                .predictions
                .iter()
                .map(|prediction| {
                    let actual = if observed[prediction.observation_id.as_str()] {
                        1.0
                    } else {
                        0.0
                    };
                    (prediction.probability_satisfied - actual).powi(2)
                })
                .sum::<f64>();
            RivalScore {
                rival_id: rival.id.clone(),
                brier_score: sum / rival.predictions.len() as f64,
            }
        })
        .collect::<Vec<_>>();
    rival_scores.sort_by(|left, right| {
        left.brier_score
            .total_cmp(&right.brier_score)
            .then_with(|| left.rival_id.cmp(&right.rival_id))
    });
    let best_score = rival_scores
        .first()
        .map_or(f64::INFINITY, |score| score.brier_score);
    let lowest_scoring_rival_ids = rival_scores
        .iter()
        .filter(|score| (score.brier_score - best_score).abs() <= f64::EPSILON)
        .map(|score| score.rival_id.clone())
        .collect::<Vec<_>>();

    let settlement = MechanismTournamentSettlement {
        schema: TOURNAMENT_SETTLEMENT_SCHEMA.to_owned(),
        tournament_id: tournament.id,
        experiment_id: tournament.experiment_id,
        decision_row_id: decision.id.clone(),
        observations,
        rival_scores,
        lowest_scoring_rival_ids,
        supported_rival_ids: decision.supported_rival_ids.clone(),
        next_action: decision.next_action.clone(),
        settled_at_ms: now_ms()?,
    };
    let settlement_ref = workspace.put(&settlement)?;
    workspace.append_event(
        TOURNAMENT_SETTLED,
        tournament_id,
        ActorRef::service("service://ilxyr/mechanism-tournament-v1"),
        Some(settlement_ref),
    )?;
    Ok(settlement)
}
