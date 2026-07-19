# ADR 0004: Decidable core, scored believers

- Status: accepted
- Date: 2026-07-18

## Context

A review of the protocol's epistemics found that both halves of "Fund uncertainty. Settle in
evidence." lacked formal backing: the authority levels were framed as a total order that
reality will not respect; composition of authority across evidence edges was undefined;
certificates did not say what the checker checks; contradiction queries, retro-registered
claim status, replication incentives, and approximate (float-to-integer) replication were all
unresolved. Behind them sits an open research problem: no known formalization of scientific
knowledge is simultaneously rigorous enough to implement, expressive enough to capture
practice, and incentive-compatible. The protocol must not bet on solving it.

## Decision

One principle resolves the tractable subset: **the ledger never computes beliefs; it records
decidable checks and scores believers.** Objective machinery for what is decidable; subjective
judgment delegated to model advisors whose track records the same ledger keeps. The tagline
maps onto the split: "settle in evidence" is the decidable half, "fund uncertainty" the
subjective half. Specific rulings:

1. **Authority is a record, not a rank.** Evidence declares
   `(level, scope, provenance)` — which check ran, over exactly which seeds, eval sets, and
   coverage, from which artifacts. There is no global ordering; gate policies compare via
   predicates over the record ("promotion requires `deterministic_replay` over all declared
   seeds"). Incomparable evidence never needs comparing.
2. **Weakest-link composes over `depends_on` only.** A claim is no better grounded than a
   premise it needs. Support edges do not compose into authority at all: aggregating
   independent support into confidence is advisor work, expressed as forecasts and scored at
   settlement. No belief calculus (Dempster–Shafer or otherwise) enters the ledger.
3. **A certificate proves a decidable predicate over a declared domain**: exhaustive checks
   over enumerated finite state spaces, or facts in decidable algebraic fragments. The domain
   declaration is part of the certificate; the checker's claim is "holds on exactly this set,"
   never "holds." Causal attribution is out of certificate scope — it is established by
   matched-ablation experiments.
4. **Retro-registered claims are grounded, not risked.** Registration re-executes the replay
   command and records the result as fresh `deterministic_replay` evidence, so grounding is
   current, not grandfathered. The permanent marker denotes the one thing that cannot be
   recreated: prediction before observation. Grounding qualifies a claim as a replication
   target or baseline; risk is required to count as a confirmed novel claim.
5. **The promoted spine requires replication.** A claim enters the spine only with at least
   one independent replication settled through the forward gates; a retro-registered claim is
   promoted the same way. Forecasters predict the replication's outcome, which is genuinely
   uncertain. The allocator reserves a fixed epoch-budget share for replication experiments;
   replication is funded by policy, not altruism. Independence is approximated as provenance
   disjointness (no shared dataset hashes, model lineage, or checker identity) — crude,
   mechanical, and honestly labeled. Cross-family replication is the strongest independence
   the lab can produce.
6. **Replication tolerance is declared in the contract, before the run.** Replication
   contracts distinguish capability replication (metric within declared tolerance) from
   computational equivalence (per-input agreement rate over the declared eval set — exhaustively
   enumerable for micromodels). The Zero→Solomon bridge declares both.
7. **Calibration records the Murphy decomposition, and the allocator weights by resolution.**
   Settlement stores reliability and resolution per handle, not just scalar Brier. Each
   forecaster's contribution to the disagreement metric is weighted by its resolution track
   record, with probationary weight for new handles. This amends ADR 0003's allocator: an
   unweighted disagreement metric lets a hedging (always-uniform) forecaster inflate entropy
   everywhere and flatten the funding signal while never being very wrong.
8. **Passive ledger, active advisors.** The ledger's query interface returns evidence state:
   both chains of a contradiction plus the contradiction's own state (replications attempted,
   forecast movement). "Is X true" and "which architecture should I use" are advisor
   questions; advisor answers are forecasts with track records. A consensus function
   hard-coded into the protocol would itself be a contested scientific claim frozen beyond
   revision.

## Deferred, with sketches

- **Demotion**: a promoted claim demotes when a provenance-disjoint contradiction at
  equal-or-higher authority settles and no defending replication succeeds within a declared
  challenge window. Window mechanics deferred to the evidence-graph milestone.
- **Subsumption**: `subsumes` (old claim valid within declared scope) added alongside
  `supersedes` (old claim wrong); archive policy for dangling claims deferred.
- **Open research, to be published as such rather than engineered around**: authority
  composition beyond weakest-link, causal certificates, independence beyond provenance
  disjointness.

## Consequences

The evidence object gains an authority record. Certificates attach additively through ledger
events, avoiding a content-address cycle between evidence and certificate objects. The retro path
must execute replays at registration; the allocator and calibration ledger gain the
decomposition and weighting; replication contracts gain declared tolerances; the spine gains a
replication requirement. Nothing in the ledger computes a belief, so no future evidence-theory
result can invalidate recorded objects — only reinterpret them.
