# Q2.7 flagship proposal — sparse-hash expansion with readout-only learning

Status: proposal, not registered. Nothing here claims ledger authority. This
document freezes the intended design so the hypothesis, foundation,
engineering-review, and experiment-design contributions can be written against
it.

## 1. Position

Q2.7 is **not** another repair to ZERO.4. ZERO.4 is promoted and its Q2.6
replay-tangent projection passed all three seeds. Q2.7 tests a different
layer: the architecture that produces the representations, not the rule that
moves the weights.

The Q2.3–Q2.6 sequence isolated one root cause: a dense trainable surface
makes every update interfere with every protected slice, so the guard must
police the whole network on every step. The mushroom body of the fly brain
(Drosophila) solves the same problem structurally:

- a fixed, unlearned sparse expansion (projection neurons → ~2,500 Kenyon cells),
- winner-take-all normalization keeping ~5% of units active,
- plasticity confined to a small readout layer (mushroom body output neurons),
- learning gated by a teaching signal (dopamine) only when it matters.

Q2.7 imports the first three properties. Q2.7.2 and Q2.7.3 (below) import the
fourth.

The design has a second, program-level purpose: hash projection and
winner-take-all are **integer-native operations**. If Q2.7 resolves go, its
entire forward path can be replicated in Solomon's integer-only stack without
float-tolerance engineering. That makes Q2.7 the cheapest known candidate to
unblock the Zero→Solomon q22 bridge, whose recorded next authorized action is
exactly one preregistered Solomon training experiment against
`zero-solomon.q22-operation.v1`.

Lifecycle framing: Q2.7 opens a new candidate successor line. It does not
demote ZERO.4 and does not start from the C2 ZERO.5 checkpoint, so it should
register under its own lineage label with `experimental` lifecycle status.
Promotion eligibility only through the frozen three-seed family rule.

## 2. Frozen question

Can confining the trainable surface to a small readout behind a fixed
sparse-hash expansion with winner-take-all normalization hold the unchanged
cumulative replay ceiling and public replay ceiling while matching the
quantity performance of the selected Q2.6 ZERO.4 checkpoint on the frozen q22
shared task, at or below the declared total parameter budget?

## 3. Frozen intervention

All of the following is declared before compile and never edited after:

1. **Channel encoding.** The frozen q22 Zero channel encoding, unchanged,
   at the exact public source commit bound into the shared-task contract.
2. **Stage 1 — fixed sparse expansion.** A declared deterministic projection
   from the channel encoding to N expanded units, implemented with a declared
   PRNG and a declared ternary distribution (entries in {-1, 0, +1}, Achlioptas
   style). Stage 1 weights are generated once, hashed, and pinned by SHA-256.
   They receive no gradient, ever.
3. **Stage 2 — winner-take-all.** Keep the top-k activated units, k ≈ 5% of N
   (the fly ratio). Selection is a pure integer comparison network; the output
   is a sparse code. No softmax, no division.
4. **Stage 3 — trainable readout.** A small head from the N expanded units to
   the q22 output surface. This is the only trainable tensor in the system.
   The optimizer is the unchanged AdamW with the Q2.6 replay-tangent
   projection, run against the immutable ZERO.3 baseline, under the unchanged
   six frozen replay validation windows.
5. **Frozen-surface guarantee.** The executable proves readout-only training
   mechanically: the optimizer's parameter list is exactly the stage-3 tensor.
   This is checked in the engineering review before admission, not asserted.
6. **Determinism.** Every stage-1 and stage-2 operation is integer or exact
   fixed-point. PRNG draws are enumerated and hashed. The run must replay
   byte-identically, and the replay proof is part of evidence.
7. **Budget accounting.** Total parameter count includes the frozen expansion
   weights. Frozen weights count fully; they carry zero replay risk but not
   zero accounting. Recommended declaration: total ≤ 5,000,000 parameters,
   with the expansion factor chosen to fit (for example 4× or 8×, not the
   fly's 50×). Final budget and expansion factor are open decisions for the
   human (section 10).

## 4. Arms

One registered run settles the primary claim; ablation deltas are recorded
metrics, not separate settlements.

- **Arm A (intervention).** Sparse-hash expansion + WTA + readout-only.
- **Arm B (dense control).** Same trainable-parameter count as Arm A's
  readout, but applied to a dense trained baseline of the same total budget.
  Separates "small trainable surface" from "frozen sparse expansion."
- **Arm C (no-WTA ablation).** Arm A without winner-take-all: dense fixed
  expansion, readout-only. Isolates the sparsity contribution.

Primary metric: q22 exact-operation parts-per-million on the disjoint
promotion split, under joint feasibility (quantity gates and replay gates
must both pass). Arms B and C run under identical seeds, budget, and gates so
their deltas are directly interpretable.

## 5. Unchanged gates and decision rule

No standard is weakened relative to EXP-004/EXP-005:

- Cumulative replay commit ceiling: 1.5% per committed update against
  immutable ZERO.3, six frozen replay validation windows.
- Public replay ceiling: 2% at the selected checkpoint.
- Quantity gates: identical thresholds to the Q2.6 frontier.
- Promotion split opened exactly once, on the disjoint 500-row set.
- Seeds 1, 2, 3; seed 2 runs first as diagnostic; family freeze for seeds
  1 and 3 only if the diagnostic resolves go.

Outcome contract sketch: `go` / `quantity_no_go` / `replay_no_go` /
`execution_failure`, with `go` requiring joint feasibility on the promotion
split in the single declared evaluation.

## 6. Falsification map

| Outcome | What it closes | Recorded next boundary |
| --- | --- | --- |
| `go` | Nothing closed; sparse architecture is a viable successor candidate | Register the Solomon integer replication (Q2.7.6) against the same shared task |
| Replay held, quantity fails | Fixed sparse expansion at this budget is not expressive enough for q22 | Raise expansion factor, or accept that q22 needs learned representation (closes the architecture hypothesis at this budget) |
| Replay not held | Interference lives in the readout learning rule, not representation density | The sparse-coding hypothesis is closed; pivot to rule-level gating (Q2.7.2) |
| Arm B ≈ Arm A | The win is trainable-surface size, not sparsity | The cheaper dense-small-readout alternative is identified and recorded |

Every branch produces completed knowledge, per the pathway-map convention.

## 7. Sequencing

1. Contributions: hypothesis, mathematical foundation (the interference
   argument, section 8 of the chat record), engineering review, experiment
   design.
2. Compile, forecast (mechanistic + empirical), fund, admit.
3. Diagnostic seed 2.
4. If go: family freeze seeds 1 and 3.
5. If family go: Q2.7 becomes the first Solomon bridge candidate, registered
   as a separate prospective replication, not as part of this contract.

## 8. Mechanistic foundation (to be written up as the foundation contribution)

Sparse codes with overlap o between consecutively-updated representations
bound per-update interference on any protected slice by a function of o, the
trainable-surface fraction s, and the step size. Frozen weights contribute
zero interference by construction. WTA reduces o by spreading representations;
random expansion concentrates it. The interference law is stated as a
declared function, and the flagship records the **active-set overlap
statistics** as a mediator metric, so the ledger can check the claimed
mechanism, not just the outcome. Prior art to cite: Dasgupta et al. 2017
(neural similarity search from the fly olfactory circuit); extreme learning
machines (Huang et al. 2006); random kitchen sinks; A-GEM precedent note from
EXP-004.

## 9. Forecast framing

Both forecasters in EXP-004 put their largest probability on `no_go` and were
wrong. For Q2.7 the honest priors are asymmetric:

- Replay control is close to guaranteed by construction (frozen stages
  cannot drift; only the small readout is policed).
- Quantity is the genuine risk: random features + small linear readout are
  known to be surprisingly strong, but the Q2.6 bar is 99.6% on four
  operation gates.

A mechanistic forecaster should therefore put most mass on "replay holds,
quantity uncertain" and the settlement should be scored on the joint claim,
not the replay claim alone.

## 10. Open decisions for the human

1. Total parameter budget and expansion factor (recommended: ≤ 5,000,000
   total, 4× or 8× expansion).
2. Lineage label for registration (recommend a new candidate-successor label,
   not zero4-quantity, not the C2-based ZERO.5 line).
3. Whether Arm C (no-WTA) runs inside this contract as a recorded arm or is
   deferred to keep the flagship minimal (recommended: keep it; it is cheap
   and closes the strongest alternative explanation).
4. Whether the readout is a single linear tensor or one small nonlinearity
   (recommended: linear for the flagship; nonlinear variants belong to
   follow-ups if quantity fails).

---

# Q2.7.x slate — ranked follow-up experiments

All are proposals. Each states its frozen question, its fly-brain analog, and
its conditioning on the flagship outcome.

## Q2.7.6 — Solomon integer replication of Q2.7 (bridge unblock) — rank 1

- **Frozen question:** Q2.7's architecture, with every stage already
  integer-native, replicates in Solomon's integer-only stack within the
  declared capability tolerance and per-input agreement over the full eval
  set of `zero-solomon.q22-operation.v1`.
- **Why rank 1:** the program's recorded next boundary for ZERO.4 is exactly
  one preregistered Solomon training experiment on this task. Q2.7 was
  designed so this replication needs no float-tolerance engineering: hash and
  WTA are integer ops; only the readout training needs Solomon's
  native-integer updates. This is the flagship's payoff move.
- **Condition:** runs only if the Q2.7 family resolves go.
- **Cost:** moderate; the Solomon harness exists (successor-v2 is promoted),
  and the shared-task contract is frozen and executable.

## Q2.7.2 — Eligibility-gated readout updates (dopamine-gated plasticity) — rank 2

- **Frozen question:** rejecting candidate updates before the replay
  authority is consulted, whenever the declared per-slice prediction error is
  below a declared threshold, reduces the rate and magnitude of committed
  replay increase versus the un-gated Q2.6 trace (max 0.050892% per commit).
- **Fly analog:** dopaminergic teaching neurons gate plasticity; synapses
  change only when a teaching signal coincides with output activity. Learning
  happens on error, not on every sample.
- **Value:** applies to **any** trainable surface, dense or sparse, so it
  survives every Q2.7 flagship branch. It also shrinks the surface the guard
  must inspect, which is the direct answer to the Q2.3 "accumulation"
  failure mode.
- **Condition:** independent of the flagship outcome; can register in
  parallel.
- **Falsification:** if gating does not reduce committed replay increase or
  it stalls quantity learning (Q2.4's failure mode returns), eligibility
  gating closes and the record sharpens toward consolidation (Q2.7.3).

## Q2.7.3 — Dual-rate consolidation (compartmentalized stores) — rank 3

- **Frozen question:** splitting the system into a fast plastic store
  (guarded only by a small local budget) and a slow consolidated store
  (receiving only commit-authority-gated transfers at declared intervals)
  recovers unguarded quantity-learning speed while holding the long-horizon
  public replay ceiling.
- **Fly analog:** fly memories transfer from fast γ-lobe compartments to slow
  α/β compartments with distinct half-lives; acquisition and stable storage
  are physically different weights.
- **Value:** it is the architecture-level answer to Q2.4's recorded failure
  ("cumulative authority preserved safety but blocked the learning path").
  The guard polices the transfer, not every fast update.
- **Condition:** highest value if the flagship resolves replay-held /
  quantity-failed, or if Q2.7.2 stalls.
- **Cost:** the highest of the slate; a second store changes the family
  manifest shape. Register only after the flagship settles.

## Q2.7.4 — Hash-routed faculties (deterministic router control) — rank 4

- **Frozen question:** routing tokens to certified faculties by a fixed
  sparse hash over the certified-gate signature matches the trained router's
  q22 operation accuracy within a declared tolerance, with zero trained
  routing parameters.
- **Fly analog:** the fly routes odor identity to valence through a fixed,
  untrained projection plus winner-take-all, with plasticity only at the
  endpoint. No learned router exists in the fly, yet routing is robust.
- **Value:** the program's mission scales by "certified faculties and the
  deterministic router that composes them." A trained router is a replay-risk
  surface; a hash router is risk-free by construction and integer-native.
  This experiment tests whether the mission's own scaling axis needs trained
  routing at all.
- **Condition:** runs after Q2.7 settles; reuses its stage-1/2 machinery, so
  it is cheap once the flagship harness exists.

## Q2.7.5 — Interference-law calibration (mechanistic mediator) — rank 5

- **Frozen question:** the declared interference law, fitted on active-set
  overlap statistics and replay drift recorded by Q2.7 and the retro Q2.3–Q2.6
  traces, predicts the replay drift of Q2.7.2 and Q2.7.3 runs within a
  preregistered tolerance, stated before those runs execute.
- **Fly analog:** none directly; this is the lab's own foundation muscle —
  turning the fly-brain argument into a quantitative, falsifiable law.
- **Value:** converts the architecture story from an analogy into a
  predictive model; a hit is a promoted-spine-eligible mathematical claim; a
  miss closes the overlap mechanism and redirects to rule-level explanations.
- **Condition:** runs alongside the flagship and settles only against later
  registrations, which keeps it cheap but slow.

## Explicitly deferred

- **Tokens-per-watt benchmark arms.** Fold into the flagship as recorded
  metrics (integer op count per token, active-set size distribution); a
  separate energy experiment adds no decision value until Solomon replication
  exists.
- **One-shot / continual task streams beyond q22.** The shared-task spine
  rule says claims enter the promoted spine only on shared task contracts.
  New task streams wait for a registered contract, not an ad-hoc eval.