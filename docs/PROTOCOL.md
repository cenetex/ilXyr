# Research protocol v1

## State machine

```text
contributions
    -> compiled experiment
    -> forecasts + compute commitments
    -> admission decision
    -> execution
    -> evidence
    -> forecast settlement
    -> calibration update

trusted policy key -> signed epoch budget -> allocation -> unattended execution

signed epoch budget + sandbox spec -> sandbox run -> evidence -> promotion eligibility

shared task -> family-bound compiled experiment

frozen prior claim -> retro plan -> replay -> retro evidence -> grounded registration

loop cycle -> contributions + forecasts -> allocation -> unattended run -> settlement
```

The steps are monotonic. Objects are immutable; revisions create new objects and experiment
revisions use new experiment IDs. Events may add information but never mutate prior evidence.
Contribution, forecast, funding, and experiment IDs are unique within their object type.

## Contributions

The compiler requires one contribution from each stage:

1. `hypothesis`
2. `mathematical_foundation`
3. `engineering_review`
4. `experiment_design`

An actor may be a human, model, or service. Model actors must declare a versioned `model://` handle
so provenance does not collapse into an anonymous “AI generated” label.

## Frozen experiment contract

An experiment declares data and model handles, metrics, seeds, execution budget, security policy,
and a finite outcome space. Compilation resolves lineage IDs to immutable hashes and allocates the
unique experiment ID. Forecasting begins only after compilation.

V1 performs static checks but cannot prove that numeric outcome predicates are disjoint or
exhaustive in the general case. Resolution fails closed when zero or multiple outcomes match.

## Forecast and funding semantics

Prediction and funding solve different problems:

- **Forecast stake** measures calibrated belief. Forecasters submit a probability for every frozen
  outcome and stake closed-loop forecast credits.
- **Compute commitment** reserves execution capacity. Funders commit compute credits against a
  quoted experiment requirement.

An experiment is admitted only after both thresholds pass. This avoids treating confidence as a
budget and avoids letting a rich funder manufacture scientific consensus.

V1 permits one forecast per actor identity for an experiment. Human and service identity is the
actor ID; model identity is the versioned `model_ref`, so aliases cannot multiply forecast stake.
A rejected admission leaves forecasting and funding open for missing inputs. Accepted admission
closes both collections and is idempotent: reevaluation returns the accepted decision without
appending another event. Credit totals use checked arithmetic and fail closed on overflow.

V1 scores each forecast with the multiclass Brier score:

```text
sum((predicted_probability[outcome] - observed[outcome])^2)
```

Lower is better. V1 records the score and stake and recomputes each human/model handle's Murphy
reliability and resolution record. Settlement never mints, burns, or transfers credits.

## Events

The reference implementation emits:

- `ContributionSubmitted`
- `ExperimentCompiled`
- `ForecastSubmitted`
- `FundingCommitted`
- `AdmissionDecided`
- `ExecutionStarted`
- `ExperimentCompleted`
- `EvidenceRecorded`
- `ForecastSettled`
- `CalibrationUpdated`
- `PolicyKeyTrusted`
- `EpochBudgetRegistered`
- `AllocationCommitted`
- `SandboxPlanned`
- `SandboxRunCompleted`
- `PromotionEvaluated`
- `CertificateRecorded`
- `SharedTaskRegistered`
- `RetroPlanned`
- `RetroExecutionStarted`
- `RetroRunCompleted`
- `RetroRegistered`

Each event contains the preceding event hash. Events that materialize an object contain its
content-addressed artifact reference.

## Failure behavior

- Invalid protocol objects are rejected before storage.
- Missing lineage or changed experiment IDs fail compilation.
- Insufficient forecast participation, stake, or compute funding records a rejected admission.
- Unsupported or protected-weight executors are rejected by admission.
- Manual execution requires explicit CLI acknowledgement. Unattended execution requires an
  existing allocation and a passing decision under a verified signed epoch budget.
- An unattended retry never reruns an experiment with `ExecutionStarted` but no terminal run; the
  ambiguous recovery state requires the explicit manual path.
- A completed run is terminal for its experiment ID and cannot execute twice. Retrying a resolved
  run idempotently reuses existing evidence and settlements and appends only missing finalization
  records.
- Successful executor output must contain exactly the frozen metric keys. Invalid, missing, or
  undeclared metric output records a terminal run but cannot become evidence.
- Zero or multiple matching outcomes record a terminal run but produce no evidence or settlement;
  the run remains visible through `status`.
- Ledger or object digest mismatches fail verification immediately, and a corrupt ledger cannot be
  extended through the workflow APIs.
- Invalid policy signatures, signer/key-owner mismatch, cap overruns, self-review, self-forecast,
  and acknowledgement-threshold crossings fail closed before unattended process creation.
- A sandbox ID freezes its complete plan. Retrying may reuse its allocation but may not alter the
  executable, arguments, metric contract, authority, or cost.

## Evidence and autonomous policy

Implemented in V1 from ADRs 0003–0004. Evidence has three runtime lanes: **sandbox evidence**
(fast-lane recordings), **promoted evidence** (settled through the full ceremony), and **retro
evidence** (a deterministic replay of a frozen prior claim, explicitly not forecast-risked). Spine status
is deferred until replication settlement exists; it is not a mutable flag on evidence.

### Grounding authority

Every evidence object declares an authority record `(level, scope, provenance)`:

- **level** — `exact_check`, `deterministic_replay`, `corpus_proxy`, or `review`;
- **scope** — what was checked: seed set, eval set, coverage fraction;
- **provenance** — artifact hashes, model lineage, checker identity.

Declared provenance artifact hashes must already resolve in the workspace; compilation and
sandbox planning add their own immutable lineage, policy, plan, and run artifacts.

Levels are not a global order. Gate policies compare records with predicates (the V1 ratchet
accepts only `exact_check` or `deterministic_replay`). A future evidence graph will compose
authority by weakest link over `depends_on` edges only; aggregating support into confidence remains
forecaster work, scored at settlement. Proxy-grounded evidence cannot pass the V1 ratchet.

### Certificates

A certificate attaches additively to evidence: a decidable predicate, the declared finite domain it
was checked over, the checker identity and version, and checked artifact hashes that exist and
include the evidence run. It claims "holds on exactly this set," never "holds in general." The V1
recorder checks the predicate against recorded evidence and validates artifact existence; checker
execution and remote attestation are not implemented. Causal claims require matched-ablation
experiments, not certificates.

### Runtime lanes and the ratchet

Evidence carries a `promoted` or `sandbox` designation.

- **Sandbox lane** — one call records spec, run, and evidence. No ceremony; constraints:
  allowlisted executables, policy-checked arguments, per-run and per-epoch compute caps.
- **Promoted lane** — full ceremony: contributions → compile → forecast → fund → admit →
  run → settle. Forecasts close before execution.
- **Retro lane** — deterministic replay of an already published claim. It is grounded on success
  but never receives a synthetic forecast or settlement.
- **Ratchet** — a sandbox result beating a directional baseline in the registered signed budget
  on a promoted metric
  at `exact_check` or `deterministic_replay` authority becomes eligible for promoted
  compilation. Computed from evidence, never granted by an actor.

### Shared tasks and retro-registration

A shared task freezes SHA-256 bindings for its dataset and eval set, an ordered metric and seed
contract, and a family-specific encoding, verifier, and designated proposer for both Zero and
Solomon. Compilation resolves the contract to an immutable artifact and rejects binding drift.

A retro-registration plan freezes a source repository/commit, external artifact SHA-256 values,
replay command, exact metric keys, seeds, and authority before execution. Only exact checks and
deterministic replays can register. The replay adapter checks the declared external files and emits
their repository, commit, paths, and SHA-256 values; ilxyr requires that attestation to equal the
frozen source snapshot in addition to checking terminal status and exact metric output. Success
produces `retro` evidence and the immutable pair `grounded=true`,
`forecast_risked=false`. It never manufactures a historical forecast or settlement.

### Loop cycles

`loop-cycle` is one idempotent orchestration transaction over immutable inputs supplied by external
actors. It ensures contributions, compilation, and forecasts, invokes the existing signed-budget
allocator, runs only when unattended authorization passes, and returns the settled result. It is
safe to call repeatedly with the same cycle. Daemon scheduling and proposal generation are outside
the core so they cannot bypass the same policy boundary.

### Roles and separation

Every operational role — proposer, reviewer, forecaster, funder-allocator — may be a model
actor. Handle-level separation is checked at admission against the event ledger: the
proposer may not author its own engineering review or forecast its own experiment.

### Budgets, allocation, calibration

A human-signed, Ed25519-verified epoch budget object mints allocation-only credits. A deterministic
allocator ranks admissible experiments by forecaster disagreement per credit cost, with
each forecaster's contribution weighted by its resolution record (probationary weight for
new handles). Settlement updates per-handle calibration records — the Murphy
decomposition, reliability and resolution separately — and never mints, burns, or
transfers credits. General and sandbox allocation cannot consume the signed replication-reserve
share; it remains unavailable until replication settlement is implemented.

### Acknowledgement thresholds

Runs with allowlisted executables inside the signed epoch budget proceed unattended. A new
executable, an open-network request beyond policy, or a crossed cumulative spend line
requires human acknowledgement. Policy objects, directional baselines, allowlists, and thresholds
remain human-signed. The manual `--execute` path is the explicit override; it is not called by
`run-auto`.

## Deferred protocol work

- replication settlement, provenance-disjoint independence checks, reserved replication spending,
  and promoted-spine status; the published replication-contract schema freezes the decided input
  vocabulary but no V1 workflow consumes it;
- evidence graph edges and weakest-link authority composition over `depends_on`;
- authenticated multi-writer event sequencing;
- compute reservation expiry and refund rules;
- signed evidence bundles and remote executor attestation;
- knowledge-graph merge policy and research pull-request review;
- competing proposers within a baseline (single-proposer per family in v1.1, see ADR 0003).
