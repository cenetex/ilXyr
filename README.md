# ilxyr

**Intelligent Lab eXperiment Yielding Research**

*Fund uncertainty. Settle in evidence.*

ilxyr is the research control plane for a certified-micromodel lab. It turns research
proposals into immutable experiment contracts, admits runs only after forecast, funding,
methodology, and security gates pass, and records the result in a tamper-evident event
ledger. The research program it serves — the Zero and Solomon model families and the
certified-gate method — is defined in [docs/PROGRAM.md](docs/PROGRAM.md).

**Experiment guide:** [cenetex.github.io/ilXyr](https://cenetex.github.io/ilXyr/)

This repository is a local V1 vertical slice. It proves the research lifecycle and its autonomous
policy boundary provider-neutral, before any service or cloud binding.

## What v1 does

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
- Provides clean-commit metric adapters for Zero q22r seed and multi-seed decisions and the
  Solomon successor-v2 harness, plus ledgered Q2.3–Q2.6 prospective transaction experiments
  and the completed Q2.6 seed-1/3 family replication workflow.
- Publishes a machine-readable lab registry that separates Braid data inputs, the promoted ZERO.4
  line, the active ZERO.5 research line, upstream evidence debt, and the current C5.2 contract.
- Compiles supported upstream benchmark results into schema-validated review records without
  pretending that completed external runs were registered prospectively by ilXyr.

Protected weights are handles, never local paths. The v1 local executor cannot run protected
weight experiments; those require a future attested executor adapter.

## Quick start

Rust 1.85 or newer is required.

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
- `schemas`: portable JSON contracts for non-Rust producers and consumers (27 strict Draft
  2020-12 schemas, including evidence authority, certificates, epoch budgets, sandbox runs,
  calibration records, evidence/registration bundles, external registration receipts, trusted
  attestation keys, verified executor attestations, claims/edges/status, and replication
  contracts/settlements).
- `examples/toy`: one end-to-end funded experiment.
- `examples/schema`: positive fixtures for the published protocol schemas.
- `docs/PROGRAM.md`: the research program — Zero and Solomon micromodel families,
  certified-gate method, autonomous operating model, flagship replication bridge.
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
- `docs/SECURITY.md`: threat model, autonomous operation rules, weight protection.
- `docs/ROADMAP.md`: sequenced milestones from protocol proof through federation.
- `docs/V1_REVIEW.md`: V1 acceptance review, revisions, and residual limitations.
- `docs/V1_1_REVIEW.md`: family onboarding implementation review and empirical replay status.
- `docs/experiments/EXP-001.md`: the first numbered experiment record, including its frozen
  question, no-go result, replay contract, and next decision boundary.
- `docs/experiments/EXP-002.md`: the prospective Q2.4 cumulative-guard no-go and preserved retry
  settlement histories.
- `docs/experiments/EXP-003.md`: the prospectively registered Q2.5 deterministic-backtracking
  no-go, settled forecasts, exact evidence, and sealed downstream gates.
- `docs/experiments/EXP-004.md`: the prospective Q2.6 global replay-tangent projection go,
  settled forecasts, exact evidence, and newly eligible replication boundary.
- `docs/experiments/EXP-005.md`: the completed Q2.6 seeds 1 and 3 replication, settled forecasts,
  exact source pins, and verified all-three-seeds family go.
- `docs/decisions/`: architectural decision records (ADR 0001–0004).

## Current non-goals and evidence gaps

This is not a multi-tenant service, a currency, a hostile-code sandbox, or a protected-weight
runtime. The ledger is single-writer. Actor handles are local self-declarations, trusted policy
keys are installed through an explicit local human action, and compute credits are reservations,
not money. The loop driver does not provide a scheduler or autonomous proposal generator.
The registration workflow does not authenticate to OSF or independently inspect remote contents;
an authorized actor or adapter freezes the package and supplies the receipt, whose exact local
package binding ilxyr enforces.
Graph-wide weakest-link authority composition, demotion windows, authenticated multi-writer
queries, and an OSF network adapter remain later milestones. Solomon's frozen
successor-v2 commit is advertised on a remote branch and replays from a fresh checkout, but the
NSRL repository is private, so unauthenticated public checkout is still unavailable. Zero q22r
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
published and verified; local ilXyr ledger import remains pending. The cross-family bridge is no
longer blocked by the Zero family gate, but it still needs shared data bindings and a Solomon
encoding/verifier. See `docs/V1_1_REVIEW.md` for the earlier Q2.2-R audit.
