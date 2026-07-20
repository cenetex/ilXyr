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
- Provides clean-commit metric adapters for Zero q22r seed and multi-seed decisions and the
  Solomon successor-v2 harness, plus ledgered Q2.3, Q2.4, Q2.5, and Q2.6 prospective
  transaction experiments.

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
cargo run -p ilxyr-cli -- forecast . examples/toy/forecast-model.json
cargo run -p ilxyr-cli -- forecast . examples/toy/forecast-human.json
cargo run -p ilxyr-cli -- fund . examples/toy/funding-a.json
cargo run -p ilxyr-cli -- fund . examples/toy/funding-b.json
cargo run -p ilxyr-cli -- admit . toy.score.v1
cargo run -p ilxyr-cli -- run . toy.score.v1 --execute
cargo run -p ilxyr-cli -- status . toy.score.v1
cargo run -p ilxyr-cli -- verify .
```

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

- `crates/ilxyr-core`: protocol objects, validation, ledger, gates, execution, settlement.
- `crates/ilxyr-cli`: a small reference control-plane CLI.
- `schemas`: portable JSON contracts for non-Rust producers and consumers (13 strict Draft
  2020-12 schemas, including evidence authority, certificates, epoch budgets, sandbox runs,
  calibration records, and the decided replication contract).
- `examples/toy`: one end-to-end funded experiment.
- `examples/schema`: positive fixtures for the published protocol schemas.
- `docs/PROGRAM.md`: the research program — Zero and Solomon micromodel families,
  certified-gate method, autonomous operating model, flagship replication bridge.
- `docs/ARCHITECTURE.md`: two-lane structure, system boundaries, future cloud adapters.
- `docs/PROTOCOL.md`: object lifecycle, events, gate semantics, decided and deferred extensions.
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
- `docs/decisions/`: architectural decision records (ADR 0001–0004).

## Current non-goals and evidence gaps

This is not a multi-tenant service, a currency, a hostile-code sandbox, or a protected-weight
runtime. The ledger is single-writer. Actor handles are local self-declarations, trusted policy
keys are installed through an explicit local human action, and compute credits are reservations,
not money. The loop driver does not provide a scheduler or autonomous proposal generator.
Replication settlement and the evidence graph remain later milestones. Solomon's frozen
successor-v2 commit is advertised on a remote branch and replays from a fresh checkout, but the
NSRL repository is private, so unauthenticated public checkout is still unavailable. Zero q22r
seed 2 replays independently from a public hash-pinned model; seeds 1 and 3 have now completed as
valid no-go results. The grounded family decision is one go and two no-go, so ZERO.4 is not
promoted and ZERO.3 remains current. EXP-001 grounds the Q2.3 seed-2 local-guard no-go. EXP-002
prospectively settled Q2.4 no-go after 66 commits and eight cumulative-guard rollbacks. EXP-003
prospectively settled Q2.5 no-go after 66 full-scale and five backtracked commits, followed by
eight exhausted outer attempts. It reached no public checkpoint. EXP-004 prospectively tested
Q2.6's global replay-tangent projection from merged Zero commit `412ab70a...`, with the direct
replay and quantity gates unchanged. Seed 2 resolved go after 700 full-scale commits; its selected
public checkpoint and exactly one promotion-split evaluation both passed. Seeds 1 and 3 are now
eligible but remain unregistered and unexecuted, so ZERO.3 remains current.
The real cross-family q22r contract also remains
blocked on shared data bindings and a Solomon encoding/verifier. See `docs/V1_1_REVIEW.md` for the
exact audit.
