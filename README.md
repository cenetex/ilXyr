# ilxyr

**Intelligent Lab eXperiment Yielding Research**

*Fund uncertainty. Settle in evidence.*

ilxyr is the research control plane for a certified-micromodel lab. It turns research
proposals into immutable experiment contracts, admits runs only after forecast, funding,
methodology, and security gates pass, and records the result in a locally integrity-checkable,
hash-linked event ledger. The research program it serves — the Zero and Solomon model families
and the certified-gate method — is defined in [docs/PROGRAM.md](docs/PROGRAM.md).

**Experiment guide:** [cenetex.github.io/ilXyr](https://cenetex.github.io/ilXyr/)

This repository is a local V1 vertical slice. It demonstrates the research lifecycle and its
provider-neutral autonomous policy boundary before any service or cloud binding. The supported
academic claim, evaluation boundary, and publication gaps are stated in
[docs/ACADEMIC-SCOPE.md](docs/ACADEMIC-SCOPE.md).

## What v1 does

- Accepts decision-complete experiment proposals, binds reviews to an exact proposal revision,
  and freezes only independently reviewed revisions with no blocking review.
- Converts a frozen proposal into the four role-separated research contributions and full
  experiment contract without allowing the package to change the chosen data, metric, threshold,
  seeds, evidence level, export policy, or compute ceiling.
- Records model or human contributions for hypothesis, mathematical foundation, engineering
  review, and experiment design.
- Compiles those contributions into a versioned experiment and frozen outcome contract.
- Optionally requires an OSF public or embargoed preregistration, emits a deterministic executable
  package, and gates admission on an immutable receipt bound to that exact compiled plan.
- Collects probabilistic forecasts and compute-credit commitments separately.
- Admits execution only when methodology, security, forecast participation, stake, and funding
  thresholds pass.
- Closes forecasts and funding at accepted admission, and permits only one forecast per actor
  identity and one completed run per experiment ID.
- Runs public-weight, unrestricted-export toy experiments through a shell-free local executor.
- Defines a provider-neutral `remote-v1` boundary over digest-bound packages, signed-budget
  authorization, reserve-before-launch idempotency, read-only observation/collection, and durable
  single-writer report intake. Its fake adapter starts no process and uses no cloud resource.
- Provides a separate report-intake service with hashed one-run credentials, strict request limits,
  bounded authenticated failures, durable replay handling, and no cloud-launch code. It is built
  for deployment behind a TLS reverse proxy but is not yet operated as a public endpoint.
- Resolves the declared outcome, scores forecasts with the Brier rule, and records evidence.
- Records grounding authority and additive certificates over declared decidable domains.
- Runs a budget-capped sandbox lane and deterministically evaluates promotion eligibility.
- Verifies human-signed Ed25519 epoch budgets against immutable trusted policy keys.
- Allocates compute by resolution-weighted forecast disagreement per credit and enforces model
  role separation.
- Runs allocated experiments unattended inside policy, while returning boundary crossings for
  human acknowledgement.
- Maintains per-handle Murphy reliability and resolution calibration records after settlement.
- Resumes evidence and settlement finalization after interruption without rerunning completed work.
- Stores objects by SHA-256 and verifies the hash-linked event ledger before append and on replay.
- Registers immutable cross-family shared tasks with SHA-256 data/eval bindings and designated
  Zero and Solomon proposers.
- Replays frozen prior claims into a separate retro evidence lane without pretending they carried
  historical forecast risk.
- Runs an idempotent propose → forecast → allocate → run → settle cycle inside signed policy.
- Imports public, ungated Hugging Face models into the ledger with immutable Hub revisions, Git
  blob identities, LFS SHA-256 digests, and separate actor/weight handles.
- Exports ledger-verified evidence bundles as native JSON, RO-Crate 1.3 with PROV-O mappings,
  in-toto Statement v1 predicates, and side-effect-free MLflow REST bridge manifests.
- Verifies Ed25519-signed DSSE envelopes over in-toto Statement v1 payloads, binds supported SLSA
  or ilXyr executor predicates to ledgered run digests and trusted service identities, and carries
  accepted attestations into evidence exports.
- Records immutable claim nodes and typed evidence edges, preregisters capability/equivalence
  replication tolerances against exact shared-task bindings, funds replication from the signed
  reserve, mechanically settles provenance independence, and derives spine eligibility without
  computing a truth score.
- Freezes rival-mechanism tournaments with metric-level predictions, ranks observations by
  disagreement per estimated credit, and settles an exhaustive predeclared decision table from
  ledgered evidence.
- Provides clean-commit metric adapters for Zero q22r seed and multi-seed decisions and the
  Solomon successor-v2 harness, plus ledgered Q2.3–Q2.6 prospective transaction experiments
  and the completed Q2.6 seed-1/3 family replication workflow.
- Publishes a machine-readable lab registry that separates Braid data inputs, the promoted ZERO.4
  line, the active ZERO.5 research line, upstream evidence debt, and C5.2's private terminal state.
- Runs an authenticated, single-writer Corpus as a Service boundary that registers immutable
  Braid-style releases, checks complete S3 or Azure Blob materialization receipts, and emits
  digest-bound SageMaker or Azure ML training-input handoffs without storing cloud credentials.
- Records resumable OCI training jobs with exact corpus bindings, digest-pinned images, versioned
  outputs, and signed settlement before cloud results become promoted evidence.
- Compiles supported upstream benchmark results into schema-validated review records without
  pretending that completed external runs were registered prospectively by ilXyr.

Protected weights are handles, never local paths. The local executor and the first `oci-job` and
`remote-v1` profiles accept public weights only; protected weights need a stronger, separately
reviewed attested profile.

## Quick start

Rust 1.85 or newer is required.

The proposal path is the experiment-draft mechanism. Start with any checked-in draft, capture the
returned proposal artifact reference, and put that exact reference in a review object:

```bash
cargo run -p ilxyr-cli -- init .
cargo run -p ilxyr-cli -- proposal-submit . examples/proposals/zero-orbit-quotient.proposal.json
# Set proposal_ref in a review JSON to the artifact_ref printed above.
cargo run -p ilxyr-cli -- proposal-review . path/to/review.json
cargo run -p ilxyr-cli -- proposal-freeze . zero.orbit_quotient.proposal.v1
cargo run -p ilxyr-cli -- proposal-status . zero.orbit_quotient.proposal.v1
# After the four formal contributions and runnable experiment are ready:
cargo run -p ilxyr-cli -- proposal-package . zero.orbit_quotient.proposal.v1 path/to/contributions.json path/to/experiment.json
cargo run -p ilxyr-cli -- proposal-compile . zero.orbit_quotient.proposal.v1
```

The draft may be revised before freeze. Each successor increments `revision` and names the exact
current object in `predecessor_ref`; reviews of an older revision do not carry forward. See
[`examples/proposals`](examples/proposals) for three symmetry-informed ML proposals and the limits
of the analogy.

The direct contribution path remains available for already-complete experiment packages:

```bash
cargo build
cargo run -p ilxyr-cli -- init .
cargo run -p ilxyr-cli -- contribute . examples/toy/hypothesis.json
cargo run -p ilxyr-cli -- contribute . examples/toy/foundation.json
cargo run -p ilxyr-cli -- contribute . examples/toy/engineering-review.json
cargo run -p ilxyr-cli -- contribute . examples/toy/experiment-design.json
cargo run -p ilxyr-cli -- compile . examples/toy/experiment.json
# For an experiment whose frozen spec declares preregistration:
cargo run -p ilxyr-cli -- preregister-package . EXPERIMENT_ID
# Freeze the emitted package externally, then record the matching receipt:
cargo run -p ilxyr-cli -- preregister-record . path/to/receipt.json
cargo run -p ilxyr-cli -- forecast . examples/toy/forecast-model.json
cargo run -p ilxyr-cli -- forecast . examples/toy/forecast-human.json
cargo run -p ilxyr-cli -- fund . examples/toy/funding-a.json
cargo run -p ilxyr-cli -- fund . examples/toy/funding-b.json
cargo run -p ilxyr-cli -- admit . toy.score.v1
cargo run -p ilxyr-cli -- run . toy.score.v1 --execute
cargo run -p ilxyr-cli -- status . toy.score.v1
cargo run -p ilxyr-cli -- export-evidence . EVIDENCE_REF ro-crate
cargo run -p ilxyr-cli -- verify .
```

The corpus service runs over a separate or existing initialized workspace:

```bash
export ILXYR_CORPUS_TOKEN='replace-with-a-random-secret-of-at-least-32-bytes'
cargo run -p ilxyr-corpus-service -- /path/to/initialized-workspace
```

See [docs/CORPUS-SERVICE.md](docs/CORPUS-SERVICE.md) for release registration, materialization
receipts, and SageMaker/Azure ML handoffs.

Multi-seed replications can use one family manifest while retaining separate ledger objects for
every contribution, experiment, forecast, funding commitment, run, and evidence record:

```bash
cargo run -p ilxyr-cli -- family freeze . path/to/family.json
cargo run -p ilxyr-cli -- family check . path/to/family.json
cargo run -p ilxyr-cli -- family run . path/to/family.json --execute
cargo run -p ilxyr-cli -- family settle . path/to/family.json
```

`family freeze` is safe to retry and rejects drift in an existing object. It also proves that the
prospective member contracts differ only in their declared seed-scoped fields. `family check`
admits every member and confirms that each local executable exists before execution begins.
`family run` attempts every member even when an earlier member has an executor error. `family
settle` waits for evidence from every declared run, applies the frozen all-member outcome rule,
and records one idempotent family settlement.

The checked-in Q2.6-R manifest is a frozen record of EXP-005, which has already completed
upstream. Do not use it to execute seeds 1 or 3 again. Its published evidence is verified, but its
import and settlement in this repository's local ilXyr ledger are still pending.

Executor/attestation adapters can bind signed provenance after a run:

```bash
cargo run -p ilxyr-cli -- trust-attestation-key . service://executor key://executor/v1 PUBLIC_KEY_BASE64
cargo run -p ilxyr-cli -- attest . RUN_REF path/to/dsse-envelope.json
```

`attest` verifies the DSSE signature over the exact decoded payload, then parses that same payload.
The current profile accepts SLSA provenance v1 or the ilXyr executor predicate and requires the
statement subjects and predicate to bind the ledgered run.

The remote control and intake steps are available without a cloud adapter:

```bash
cargo run -p ilxyr-cli -- remote-package-verify . environment.json job-package.json
cargo run -p ilxyr-cli -- remote-authorize . environment.json job-package.json BUDGET_ID AUTHORIZATION_ID EXPIRES_AT_MS
cargo run -p ilxyr-cli -- remote-report-accept . execution-report.json
```

These commands do not launch compute or publish an HTTP write endpoint. See
[docs/REMOTE_EXECUTION.md](docs/REMOTE_EXECUTION.md) for the execution-node and public-site
responsibility boundary.

Hugging Face models can be pinned before they are named by an actor or experiment:

```bash
# Resolve the current Hub commit:
cargo run -p ilxyr-cli -- huggingface-import . staccs/lecore-qwen35-9b-assimilated
# Or register the checked-in frozen manifest offline:
cargo run -p ilxyr-cli -- huggingface-register . examples/schema/huggingface-model.json
cargo run -p ilxyr-cli -- huggingface-show . MODEL_REF
```

The import records metadata and exact file identities; it does not download weights or perform
inference. See [docs/HUGGINGFACE.md](docs/HUGGINGFACE.md) for the linked Qwen3.5 checkpoint,
revision-pinned loading, and the executor boundary.

Native NSRL checkpoints use a separate registry that verifies local source and artifact bytes
before creating model and continuation handles:

```bash
cargo run -p ilxyr-cli -- nsrl-register . examples/nsrl/p10m-v10-registration.json /path/to/nsrl --execute
cargo run -p ilxyr-cli -- nsrl-gate-record . examples/nsrl/p10m-v10-generation-gate.json /path/to/ilxyr
cargo run -p ilxyr-cli -- nsrl-status . MODEL_REF
```

See [docs/NSRL.md](docs/NSRL.md) for the custody boundary and
[the executed p10m intake](docs/experiments/NSRL-P10M-PILOT.md) for its failing public baseline.

## Research discovery

The read-only research registry joins project aliases, pinned repositories and weights, corpora,
experiments, evaluations, dispatches, artifacts, costs, blockers, and missing work. It is a
rebuildable view over approved publication indexes and ledger heads. It never registers an object
or changes lifecycle state.

The built-in pilot reports Qwen-SEC as blocked before paid training: the code and 403-example
development export exist, but the full corpus, baselines, compiled experiment, adapter, and cloud
dispatch do not.

FERAL-7B is an ilXyr-owned training project. Braid produces its corpus, Runner Watch supplies the
training image, and ilXyr owns the frozen experiment, admission, budget, cloud receipts,
evaluation, and evidence settlement. Import the accepted Braid training, future-evaluation, and
unseen-issuer releases with `braid-corpus-register`; do not substitute the legacy Runner Watch
development export.
See [the FERAL-7B training-lab guide](docs/FERAL-7B.md) for the prepared identities and remaining
gates.

```bash
cargo run -p ilxyr-cli -- search qwen-sec --json
cargo run -p ilxyr-cli -- status project://ilxyr/feral-7b --json
cargo run -p ilxyr-cli -- lineage feral-7b.sec-analysis.v2 --json
cargo run -p ilxyr-cli -- artifact-metadata artifact://runner-watch/feral-7b-experiment-card --json
cargo run -p ilxyr-cli -- registry-verify
```

Use `--registry path/to/research-registry.json` or `ILXYR_REGISTRY` to query another validated
snapshot. Every response includes the indexed source heads, age, and stale flag.

`ilxyr mcp` starts a stdio MCP server with four read-only tools: `ilxyr.search`, `ilxyr.status`,
`ilxyr.lineage`, and `ilxyr.artifact_metadata`. The CLI and MCP server call the same core read
model, so aliases and visibility rules behave the same way.

Claim and replication operations are explicit:

```bash
cargo run -p ilxyr-cli -- claim-register . path/to/claim.json
cargo run -p ilxyr-cli -- edge-record . path/to/edge.json
cargo run -p ilxyr-cli -- replication-register . path/to/replication-contract.json
cargo run -p ilxyr-cli -- replication-allocate . SIGNED_BUDGET_ID CONTRACT_REF
cargo run -p ilxyr-cli -- replication-settle . CONTRACT_REF REPLICATION_EVIDENCE_REF
cargo run -p ilxyr-cli -- claim-status . CLAIM_ID
```

`claim-status` is passive. It returns competing edges and settlements plus five mechanical facts:
whether the claim and its evidence are bound to one shared task, whether any
attached/replication evidence was prospectively risked, whether any path is cold replayable, how
many independent replications succeeded, and whether all conditions make the claim eligible for
the promoted spine. Private claims may omit a task binding and remain queryable, but cannot become
spine-eligible.

Mechanism tournaments turn a broad outcome into a discriminating causal test:

```bash
cargo run -p ilxyr-cli -- tournament-register . examples/schema/mechanism-tournament.json
# Run and settle the referenced experiment through its normal lifecycle.
cargo run -p ilxyr-cli -- tournament-settle . toy.score-mechanisms.v1
```

Registration must happen before accepted admission or execution. Every rival predicts every
observation, and the decision table must cover all boolean observation patterns. Settlement fails
closed while any declared metric condition is unresolved. Rival Brier scores and the authored
next action are recorded without changing the experiment's scientific outcome. Identical
registration retries are safe; changing a frozen tournament under the same ID is rejected.

V1.1 adds:

```bash
cargo run -p ilxyr-cli -- shared-task-register . examples/schema/shared-task.json
cargo run -p ilxyr-cli -- retro . examples/schema/retro-registration.json --execute
cargo run -p ilxyr-cli -- loop-cycle . SIGNED_BUDGET_ID path/to/cycle.json
```

`loop-cycle` consumes a complete cycle supplied by proposer and forecaster actors; it does not
generate research claims itself. It retries exact frozen inputs idempotently and executes only when
the existing signed epoch policy authorizes the allocation.

`run` requires the explicit `--execute` acknowledgement. It invokes an absolute executable
directly and never passes the experiment through a shell. A completed run is terminal for that
experiment ID, including when its output does not resolve to evidence; `status` exposes the run
record in either case. Retrying a resolved completed run resumes any missing evidence or forecast
settlements and does not execute the program again.

## Signed-policy operation

The manual path above remains the explicit human override. Autonomous and sandbox runs use a
signed epoch budget:

```bash
cargo run -p ilxyr-cli -- trust-key . human://owner key://owner/v1 PUBLIC_KEY_BASE64
cargo run -p ilxyr-cli -- budget-payload examples/schema/epoch-budget.json
# Sign the emitted canonical JSON with the trusted Ed25519 key and set signature.value.
cargo run -p ilxyr-cli -- budget-register . path/to/signed-budget.json
cargo run -p ilxyr-cli -- allocate . toy.epoch-budget.v1 toy.score.v1
cargo run -p ilxyr-cli -- run-auto . toy.epoch-budget.v1 toy.score.v1
cargo run -p ilxyr-cli -- sandbox . toy.epoch-budget.v1 examples/schema/sandbox-spec.json
```

Private signing keys never enter ilxyr. `run-auto` proceeds only for an existing allocation whose
executable, exact argument vector, network request, per-run cost, epoch cost, and cumulative-spend
threshold satisfy the registered signed policy. It also refuses to repeat an execution that
started without producing a terminal run. `authorize` reports the same decision without executing.

## Repository map

- `permaweb`: the static Arweave/AO experiment registry, canonical index tooling, and signed
  proposal/review/funding process. See [`permaweb/README.md`](permaweb/README.md).
- `portal`: the hosted submission and review portal used for the conventional web deployment.
- `crates/ilxyr-core`: protocol objects, validation, ledger, gates, execution, settlement.
- `crates/ilxyr-cli`: a small reference control-plane CLI.
- `schemas`: portable JSON contracts for non-Rust producers and consumers (strict Draft 2020-12
  schemas, including evidence authority, certificates, epoch budgets, sandbox runs,
  calibration records, evidence/registration bundles, external registration receipts, trusted
  attestation keys, verified executor attestations, claims/edges/status, replication
  contracts/settlements, and mechanism tournaments/settlements).
- `examples/proposals`: decision-complete experiment drafts, including three symmetry-informed ML
  tests.
- `examples/toy`: one end-to-end funded experiment.
- `examples/schema`: positive fixtures for the published protocol schemas.
- `docs/PROGRAM.md`: the research program — the active Reasoner line, preserved Zero and Solomon
  model evidence, certified gates, autonomous operation, and the replication bridge.
- `docs/REASONER-LINE.md`: the Reasoner registration, evidence boundary, and proposed next
  representation-transfer question.
- `docs/RESEARCH-PATHWAYS.md`: the checked research-pathway map — successful,
  negative, blocked, withheld, and experimental branches plus exploration-method rules.
- `docs/research-pathways.json`: machine-readable pathway nodes, causal edges,
  independent status axes, evidence bindings, and method assessment.
- `docs/decisions/0005-nsrl-p10m-operational-stewardship.md`: the approved 30-day experimental
  stewardship pilot, ownership boundary, checkpoint bundle, and promotion gates for NSRL p10m.
- `docs/lab-registry.json`: the reviewed cross-project program inventory for Braid and ZERO,
  including active controls, artifact hashes, model-line boundaries, and evidence state.
- `docs/program-registry.html`: the public, readable view of that inventory.
- `docs/ARCHITECTURE.md`: two-lane structure, system boundaries, future cloud adapters.
- `docs/PROTOCOL.md`: object lifecycle, events, gate semantics, decided and deferred extensions.
- `docs/INTEROPERABILITY.md`: MLflow, OSF, RO-Crate/PROV, in-toto/SLSA, and research-agent
  boundaries plus the integration roadmap.
- `docs/HUGGINGFACE.md`: immutable Hub import, model/weight handles, and revision-pinned loading.
- `docs/NSRL.md`: native NSRL checkpoint, continuation, local-verification, and gate-evidence
  registration.
- `docs/REMOTE_EXECUTION.md`: sealed-package execution, adapter operations, one-run authorization,
  report intake, and the read-only public projection boundary.
- `docs/CORPUS-SERVICE.md`: authenticated immutable corpus registry, materialization receipts, and
  provider training-input handoffs.
- `docs/CLOUD-TRAINING.md`: provider-neutral OCI dispatch, reconciliation, attestation, and resume
  flow.
- `docs/CLOUD-EXECUTION.md`: local-versus-cloud venue policy and the package, preflight, launch,
  observation, collection, and evidence-import runbook for resource-heavy work.
- `docs/GOVERNANCE.md`: the frictionless solo-maintainer PR, checks, merge, and verification flow.
- `docs/SECURITY.md`: threat model, autonomous operation rules, weight protection.
- `docs/ROADMAP.md`: sequenced milestones from protocol proof through federation.
- `docs/V1_REVIEW.md`: V1 acceptance review, revisions, and residual limitations.
- `docs/V1_1_REVIEW.md`: family onboarding implementation review and empirical replay status.
- `docs/experiments/EXP-001.md`: the first numbered experiment record, including its frozen
  question, no-go result, replay contract, and next decision boundary.
- `docs/experiments/EXP-002.md`: the prospective Q2.4 cumulative-guard no-go and preserved retry
  settlement histories.
- `docs/experiments/EXP-003.md`: the prospectively frozen Q2.5 deterministic-backtracking
  no-go, settled forecasts, exact evidence, and sealed downstream gates.
- `docs/experiments/EXP-004.md`: the prospective Q2.6 global replay-tangent projection go,
  settled forecasts, exact evidence, and newly eligible replication boundary.
- `docs/experiments/EXP-005.md`: the completed Q2.6 seeds 1 and 3 replication, settled forecasts,
  exact source pins, and verified all-three-seeds family go.
- `docs/experiments/EXP-006.md`: the recovered public-corpus Holo HRR protocol verification and
  its bounded negative performance comparison.
- `docs/experiments/EXP-007.md`: the prospectively frozen three-seed Zero→Solomon Q22 bridge,
  exact public evidence, forecast settlement, and narrow claim boundary.
- `docs/experiments/EXP-008.md`: the shortcut-resistant Q22 successor, its prospective no-go,
  exact public evidence, forecast settlement, and closed sparse class-head boundary.
- `docs/experiments/NSRL-P10M-TARGET-MARGIN.md`: exact-check negative results for the
  output-matrix target-margin pilot, its fixed-schedule trust region, and the canonical-NLL
  direct-head guard, exact safe-set, and cross-document stability follow-ups.
- `docs/decisions/`: architectural decision records.

## Current non-goals and evidence gaps

This is not a multi-tenant service, a currency, a hostile-code sandbox, or a protected-weight
runtime. The ledger is single-writer. Actor handles are local self-declarations, trusted policy
keys are installed through an explicit local human action, and compute credits are reservations,
not money. The loop driver does not provide a scheduler or autonomous proposal generator; actors
may generate drafts, but every draft still passes the proposal review and freeze boundary.
The registration workflow does not authenticate to OSF or independently inspect remote contents;
an authorized actor or adapter freezes the package and supplies the receipt, whose exact local
package binding ilxyr enforces.
Graph-wide weakest-link authority composition, demotion windows, authenticated multi-writer
queries, and an OSF network adapter remain later milestones. Solomon's frozen successor-v2 commit
is published in the public NSRL repository and has replayed from an unauthenticated fresh checkout.
Zero q22r
seed 2 replays independently from a public hash-pinned model; seeds 1 and 3 completed as valid
no-go results. That earlier Q2.2-R family decision remains one go and two no-go. EXP-001 grounds
the Q2.3 seed-2 local-guard no-go. EXP-002
prospectively settled Q2.4 no-go after 66 commits and eight cumulative-guard rollbacks. EXP-003
prospectively settled Q2.5 no-go after 66 full-scale and five backtracked commits, followed by
eight exhausted outer attempts. It reached no public checkpoint. EXP-004 prospectively tested
Q2.6's global replay-tangent projection from merged Zero commit `412ab70a...`, with the direct
replay and quantity gates unchanged. Seed 2 resolved go after 700 full-scale commits; its selected
public checkpoint and exactly one promotion-split evaluation both passed. EXP-005 then executed
seeds 1 and 3 independently under the frozen Q2.6-R contract. Both resolved go after 600 commits,
so the all-three-seeds family rule passed and ZERO.4 is current upstream. The result commit is
published and verified; local ilXyr ledger import remains pending. EXP-007 then completed the
cross-family Q22 operation-routing bridge prospectively: all three Solomon seeds scored 500/500
and agreed on every promotion case. This closes the narrow routing claim, not arithmetic answer
generation or broad language quality. EXP-008 then removed the prefix shortcut, balanced
wrong-operation distractors, and held out whole template families. The unchanged sparse class
head scored 42.5%, 43.0%, and 53.3%, with 53.1% all-seed agreement, so that harder transfer claim
resolved no-go. The next branch must change representation or objective and use fresh evaluation
templates rather than tune against the opened set. See `docs/V1_1_REVIEW.md` for the earlier
Q2.2-R audit.

## Academic terminology and citation

An experiment is **prospectively frozen** when its ilxyr contract and outcome rules are immutable
before execution. It is described as **externally preregistered** only when a matching receipt from
the declared external registry is bound to that contract. A multi-seed run in one research program
tests within-program robustness; it is not called an external reproduction unless a separate team
obtains the result.

Citation metadata is provided in [`CITATION.cff`](CITATION.cff). No DOI is claimed until a tagged
release and its complete evidence package are deposited in a long-term archive.
