# ADR 0003: Autonomous operation with human policy oversight

- Status: accepted
- Date: 2026-07-18

## Context

The research program (`docs/PROGRAM.md`) targets a cadence that a human-in-the-loop cannot
sustain: Zero-family falsification runs complete in minutes, and the protocol's value
proposition depends on volume — many cheap experiments, few promoted claims. If a human must
acknowledge every contribution, every forecast, every run, and every settlement, the loop's
cycle time becomes human response time, and the protocol is a bottleneck rather than an
accelerator.

At the same time the program is finite: two model families, known executables, a fixed set of
promoted metrics, and public-weight micromodels. The attack surface is bounded. Full autonomy
in an unbounded research program would be reckless; full human gating in a bounded one is
wasteful. This ADR draws the boundary.

## Decision

### Human responsibilities

The human authors policy and audits the ledger. Specifically the human:

1. signs epoch budget objects (credit supply and per-executable caps);
2. maintains the executable allowlist and its associated security policy
   (network, weight class, export);
3. sets promoted metrics and directional baseline rules that define the ratchet;
4. acknowledges boundary-crossing events: a new executable, an open-network
   request beyond policy, or a crossed cumulative spend line; and
5. reviews the promoted spine asynchronously in batch — the human never
   approves individual experiments.

The human does not propose hypotheses, contribute reviews, design experiments, forecast,
allocate credits, run experiments, or settle evidence. Those are operational roles.

### Model actor responsibilities

Every operational role may be filled by a model actor:

- **Proposer** — authors the hypothesis and experiment design contributions,
  compiles the experiment contract.
- **Reviewer** — authors the mathematical-foundation and engineering-review
  contributions.
- **Forecaster** — submits probability distributions over frozen outcomes with
  a stake.
- **Funder-allocator** — commits compute credits against experiments; the
  allocator ranks and selects.

Role separation is enforced at the handle level. A `model://` handle is a versioned,
immutable identity. The protocol rejects any experiment where:

- the proposer authored its own engineering review;
- the proposer forecast its own experiment; or
- any forecast or funding input arrives after accepted admission or execution start.

The identity-separation constraints are checked at admission time against the event ledger; input
closure is enforced on every forecast and funding append. V1 cannot prove what information an
actor saw before submitting a forecast.

### Two-lane structure with deterministic ratchet

```
sandbox lane (fast)                    promoted lane (slow)
───────────────────                    ─────────────────────
single-call recording                  full ceremony
allowlisted executable + arguments     contributions → compile
per-run + per-epoch caps               → forecast → fund
declared grounding authority           → admit → run → settle
                                       → calibration update
         │                                      │
         └───── ratchet (beats baseline) ───────┘
```

**Sandbox lane.** One call records spec, run, and evidence. No contribution ceremony, no
forecast or funding gates. Its constraints are structural: the executable must be on the
allowlist, arguments are policy-checked, and per-run and per-epoch compute caps apply.
Results carry a declared grounding-authority level. The sandbox lane absorbs the
falsification cadence — Zero-family runs complete in minutes, so the lane latency is bounded
by training time, not ceremony.

**Promoted lane.** Full protocol ceremony with every role filled. Forecasts close before
execution. Settlement builds a rolling calibration track per `model://` handle. The
promoted lane carries the lab's claims; only promoted evidence appears on the public
evidence spine.

**The ratchet.** A sandbox result that beats a ledger-registered baseline on a promoted
metric, at `exact_check` or `deterministic_replay` authority, becomes eligible for
compilation into a promoted contract. Eligibility is computed from evidence — it is never
granted by an actor. The promoted lane's gates (contributions, forecasts, funding) must
still pass; the ratchet opens the door but does not walk through it.

### Disagreement-ranked allocation

A human-signed epoch budget object mints the credits available for the epoch. A
deterministic allocator spends them by ranking admissible experiments:

```
priority = forecaster_disagreement(experiment) / cost(experiment)
```

where disagreement is the entropy or variance across forecasters' probability
distributions for that experiment's outcomes. Near-unanimous experiments are not funded
regardless of budget: there is no information gain in confirming what everyone already
expects. "Fund uncertainty. Settle in evidence." is the allocator, not a slogan.

### Allocation-only credits

Credits are closed-loop accounting units. They allocate scarce compute, nothing else.
Settlement does not mint, burn, or transfer credits. The Brier score and credit stake are
recorded and update the forecaster's calibration record — their predictive track record
— which the allocator may weight when ranking future work. Poor calibration reduces a
forecaster's influence on allocation; it never reduces a balance because there is no
balance.

This avoids securities regulation, gambling law, and the incentive distortion that
accompanies monetary stakes on scientific claims. The stake is epistemic skin in the
game, not financial.

### Acknowledgement-becomes-threshold

The v1 CLI requires `--execute` on every run. Autonomous operation replaces this
per-run acknowledgement with a policy threshold:

| Event | Threshold rule |
|-------|---------------|
| Run with allowlisted executable, within caps | unattended |
| Run with new executable | human acknowledgement required |
| Run requesting network access beyond policy | human acknowledgement required |
| Cumulative epoch spend crosses bound | human acknowledgement required |
| New `model://` handle registration | human acknowledgement required |

Policy objects, allowlists, thresholds, and the credit mint remain human-signed.
Changing them requires a decision record. V1 implements executable, network-policy, and
cumulative-spend thresholds over verified signed budgets. Model-handle registration remains
deferred until identities have a registry rather than being local self-declarations. Manual
`--execute` remains the explicit boundary override.

### Degeneration modes and structural answers

Every autonomous system has failure modes. Each is addressed structurally, not through
surveillance or trust.

| Degeneration mode | Structural answer |
|---|---|
| **Proposal flooding** — models generate infinite experiments | Sandbox lane absorbs volume with per-run caps and per-epoch compute budgets; promoted lane carries full ceremony cost (four contributions, multiple forecasters, funding). A flood stays in the sandbox. |
| **Forecast herding** — forecasters copy each other, eliminating the disagreement signal | Disagreement-ranked allocation: convergent forecasts starve the experiment. The allocator explicitly funds disagreement; herding is self-defeating. The calibration ledger also reveals correlated errors, visible to the human auditor. |
| **Self-dealing** — a model proposes, reviews, and forecasts its own experiment | Handle-level role separation enforced at admission. The proposer's handle is checked against the reviewer and forecaster handles on the event ledger. Violations reject admission. |
| **Reviewer capture** — reviewers become rubber-stamps or bottlenecks | Reviews are evidence objects with declared grounding authority, not capability grants. A review with `review` authority produces evidence too weak to promote a claim; the ratchet requires `exact_check` or `deterministic_replay`. A bottleneck reviewer is bypassed by the sandbox lane. |
| **Stagnation** — only safe experiments are proposed, no information gain | Disagreement-ranked allocation: safe experiments have low forecaster disagreement, so they are never allocated credits. The ratchet requires beating a baseline, which forces proposers to target improvements. |
| **Credit exhaustion** — allocator concentrates all credits on one path | The disagreement metric naturally diversifies: as one experiment gets funded and settled, its outcome is known, so remaining disputes have higher relative priority. Epoch budgets also cap total spend; exhaustion is a policy signal, not a bug. |
| **Collusion rings** — models coordinate across handles to game forecasts | The calibration ledger accumulates per-handle error; correlated forecast errors across supposedly independent handles are visible in batch audit. Handle registration requires distinct model versions, making sock-puppet creation a policy-boundary event. |
| **Baseline gaming** — a proposer sets a trivially beatable baseline | Baselines are ledger-registered claims on promoted metrics, human-audited. A new baseline is a claim; gaming it means publishing a weak claim on the promoted spine, which degrades the proposer's calibration record and the lab's evidence surface. The human can reject baseline registration at the policy layer. |

## Open question: single versus competing proposers

The allocator ranks *compiled experiments* by disagreement. If multiple proposers submit
experiments targeting the same claim, which one gets compiled?

**Decision (deferred, start with one):** v1.1 starts with a single designated proposer
per family. This keeps the loop simple and the disagreement signal clean — forecaster
disagreement is about the experiment's outcome, not about which variant to test.

Competing proposers introduce a second allocation problem: choosing among experiment
designs before you know which one is more informative. Possible structural answers,
deferred until the single-proposer loop is demonstrated:

- Proposers stake on their own design, and the allocator weights proposal quality by
  proposer calibration record.
- Experiments targeting the same baseline are ordinally ranked by forecaster
  disagreement *per credit*, and only the top-N within a spend bound can compile.
- The human enriches the epoch budget with a proposer set and an intra-baseline cap.

None of these are needed yet. The single-proposer loop proves the ratchet and the
allocator; competing proposers are an optimization once the loop works.

## Consequences

- The human role shifts from operator to auditor. Every human action is a signed policy
  object or a decision record; nothing is a chat message, a Slack approval, or a
  last-minute override.
- V1 implements the allocator, threshold broker, ratchet eligibility computation, and calibration
  ledger as deterministic `ilxyr-core` functions. The continuous family loop remains a library
  consumer of those functions, not a service.
- Role separation at the handle level requires the admission engine to query the event
  ledger for prior events by the same handles. The `ContributionSubmitted` event
  already records the actor; admission rejects self-reviewed experiments.
- `run-auto` is the policy-conforming execution interface. `run --execute` is retained only as the
  explicit human acknowledgement path.
