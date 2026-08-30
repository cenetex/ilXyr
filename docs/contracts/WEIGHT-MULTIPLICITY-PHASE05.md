# Phase 0.5 — dimension-indexed oracle correction

## Status

Client-approved scope revision to Revision 3. Phase 0.5 lasts one week. It
does not authorize corpus generation, model training, or blind evaluation.

The sealed Phase 0 Version 1 and Version 2 evidence remains unchanged. The
append-only memory-observability erratum is sealed beside that evidence. It
records that memory is unknown for the 35 timed-out cells; their substituted
RSS values are not measurements of the blocked queries. Version 2 remains a
valid measurement of the frozen height-indexed, uncached Zero time frontier
and its Stop remains valid under Revision 3. Phase 0.5 measures a new surface;
it does not relabel the old result.

The corrected binding plan is
`examples/weight-multiplicity/phase05-frontier-plan-v2.json`. Version 1 and its
representation manifest remain unchanged because the sealed LiE witness binds
their hashes.

## Jointly owned ambiguity defect

Revision 3 Section 3 assigns the exact symbolic-oracle role to Zero, and the
machine-readable contract identifies `zero_symbolic`. Section 7 cites SageMath
as a reference for the Weyl-invariance law; it does not designate SageMath as
the oracle.

The reusable defect is that the frontier clause did not state the algorithm
and executable identity prominently enough. Both parties missed that
ambiguity during review. Future frontier clauses must name the algorithm,
executable, interface version, revision, and executable digest directly.

Phase 0 used Zero's exact C11 Freudenthal oracle. There was no Sage-to-Zero
implementation substitution.

## Corrected scientific coordinate

Highest-weight height is retained as a secondary coordinate but is not the
primary cross-type frontier coordinate. Phase 0.5 computes the exact
representation dimension before oracle execution using the Weyl dimension
formula and groups results by dimension band.

The representation roster is selected deterministically from all dominant
Dynkin-label vectors of height 1 through 8. It includes:

- every fundamental representation;
- every highest weight from the first Version 2 timeout for B7, B8, C7, C8,
  D7, D8, E7, and E8; and
- the minimum, geometric-midpoint-nearest, and maximum dimension candidates
  in each populated dimension band for each type.

The roster is a tested surface, not proof about every representation below a
reported dimension. Reports must say `tested ceiling`, list holes, and retain
the exact highest weights behind every boundary.

## Zero algorithm and optimization order

The Phase 0 oracle reduced the requested target to its dominant Weyl
representative, then applied the exact Freudenthal recurrence. It did not fold
recursive dependency weights before memo lookup.

Phase 0.5 has two ordered optimization stages. They must not be reported as one
combined speedup:

1. Fold every recursive dependency weight to its dominant Weyl representative
   before memo lookup and recurrence evaluation. Measure and record a cold
   fresh-memo frontier first. Exact answers must match the frozen Phase 0
   evidence wherever both runs complete.
2. Only after the cold result is recorded, add one bounded session memo per
   worker for one exact `(type, lambda)` group and measure grouped reuse.

The session memo:

- is reused only while type and highest weight are unchanged;
- is evicted on type or highest-weight change;
- does not enumerate unrequested weights;
- uses the dominant representative of every recursive weight as the key;
- must remain below the total two-GiB per-worker RSS limit; and
- must produce exactly the same answer as a fresh-memo query.

Requested-target folding is historical. Recursive folding is new Phase 0.5
work and remains a separate measured stage. SageMath and LiE are not
production-oracle replacements in this phase.

## Target order and order sensitivity

The code audit predicts that target order affects grouped cost because the
recursion is per-target depth-first and the session memo is populated by each
request. This is a design result, not a measured Phase 0.5 result. The binding
production order for testing the prediction is:

1. increasing signed target depth;
2. dominant targets before non-dominant targets at equal depth; and
3. lexicographic target Dynkin labels as the final tie-break.

No unreported warm-up is permitted. Every cache-populating request is part of
the recorded group.

Each representation is also run in:

- decreasing depth with the same tie-breaks; and
- deterministic seeded generation order.

The report gives the recursive-folding cold fresh-memo latency, binding grouped
latency, both sensitivity-order latencies, and p95 pass/fail for each. If the
one-second p95 decision changes with order, the cell is marked
`order_sensitive`; this fact cannot be absorbed into an unconditional Pass.

## Time and memory decisions

The existing limits remain binding:

- one second per query and p95 no greater than one second;
- peak incremental RSS no greater than 2,147,483,648 bytes per worker;
- exact integer answers; and
- byte-identical deterministic replay.

The one-second value is the decision threshold. A query may continue for up to
ten seconds in the measurement harness solely so that a time failure can still
return its exact memo and process-memory high-water marks. Passing one second
remains a failure, regardless of whether the measurement later completes. A
query still running at ten seconds is killed and recorded as a hard timeout.

Time and memory are separate boundary facts:

- `time_fail`: time limit exceeded while memory remains within limit;
- `memory_fail`: memory limit exceeded while time remains within limit;
- `time_and_memory_fail`: both limits exceeded;
- `time_fail_memory_unknown`: a hard timeout prevented a reliable memory
  conclusion;
- `order_sensitive`: the p95 result changes across frozen orders; and
- `pass`: exactness, replay, time, and memory all pass in every required run.

The report records memo entries before and after every query, insertions, hits,
capacity bytes, group high-water entries, process RSS, and incremental RSS.
For a completed query, memory uses the worker's process high-water mark. For a
query killed at the ten-second measurement limit, exact peak and incremental
RSS are `null`. The controller may sample worker RSS every 25 ms, but that
sampling starts only after the one-second decision threshold and does not block
the query. The sample is only a lower bound. A sample above the limit can prove
a memory failure; a sample below the limit cannot prove a memory pass. Such a
timeout is reported as `time_fail_memory_unknown`, never as `time_fail`, unless
the sample itself proves that both limits failed.
Cold fresh-memo timing is a counterfactual comparison, not the production
resource gate. The binding and sensitivity grouped orders determine fit; cold
and grouped answers must still agree wherever both complete.

## Parallelism

Safe worker count is recalibrated with grouped persistent workloads. The
controller tests 1, 2, 4, and 8 workers on the same frozen stress groups.
Version 2's one-worker result is historical context, not a carried-forward
decision.

## Independent LiE witness

LiE is an independent correctness witness, not a speed dependency. A frozen
cross-check includes every supported type, nontrivial depths and multiplicity
strata, all E7 and E8 fundamental representations, and the named small E7/E8
cases in the Phase 0.5 roster.

Any unresolved Zero/LiE disagreement produces `Hold`. It outranks the resource
frontier and stops further execution until root cause is established. LiE is
not added as a distributed or production dependency in Phase 0.5.

The sealed LiE Version 3 result is a separate evidentiary category from the
internal Zero/ilXyr audit. It remains bound to the unchanged Version 1 plan and
representation manifest. Version 2 keeps the same 828-representation roster,
but it does not rewrite, reseal, or absorb the LiE record. Any later claim that
the witness covers Version 2 must be made by exact case identity.

## Deliverables and closure

Phase 0.5 delivers:

- the frozen dimension-indexed plan and representation manifest;
- exact dimension-formula tests;
- fresh-versus-persistent exactness tests;
- cold, grouped, order-sensitivity, memo-memory, and parallelism evidence;
- the LiE license note and frozen cross-check result;
- named tested dimension ceilings and holes by type;
- an explicit E7/E8 reachability table; and
- a corrected decision report.

The final decision is Proceed, Rescope, Hold, or Stop. No outcome authorizes a
corpus automatically. Corpus generation requires explicit client approval of
the Phase 0.5 report.
