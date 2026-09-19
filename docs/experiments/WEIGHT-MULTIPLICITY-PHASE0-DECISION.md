# Weight-multiplicity Phase 0 decision

## Outcome: Stop

Phase 1 is not authorized under Revision 3. This is a clean negative result at
the oracle/resource gate, before corpus generation, model training, or blind
evaluation.

The corrected binding run measured all 248 type-and-height cells: 31 simple
types and heights 1 through 8. It made 1,594,852 uncached oracle attempts and
accepted 19,104 quota records. Of the 248 cells, 135 filled every label and
target-status quota, 78 ended with incomplete label yield, and 35 contained a
query that exceeded the frozen one-second limit.

No oracle query returned an inexact integer. Every completed replay was
byte-identical. The failure is cost, not symbolic disagreement.

## Measured boundary

The one conservative common rectangle is:

```text
rank <= 6 and highest-weight height <= 8
```

All measured cells in that rectangle met the one-second and 2 GiB limits.
It does not cover the signed Phase 1 plan, which requires unseen classical
ranks 7 and 8 plus E7 and E8.

| Type | Maximum contiguous safe height |
|---|---:|
| A1–A8 | 8 |
| B2–B6 | 8 |
| B7 | 5 |
| B8 | 3 |
| C3–C6 | 8 |
| C7 | 5 |
| C8 | 3 |
| D4–D6 | 8 |
| D7 | 7 |
| D8 | 4 |
| G2, F4, E6 | 8 |
| E7 | 2 |
| E8 | none |

E8 exceeded the budget at height 1, target depth 44. Therefore no positive
common height exists if rank 8 and every included type must be covered.

The first observed timeout depths were 39 for B7, 42 for B8, 38 for C7, 38
for C8, 39 for D7, 35 for D8, 46 for E7, and 44 for E8. Query cost is not
monotone in depth alone, so these are observed exceedances rather than a claim
that every shallower request is safe. The type-and-height exclusion above is
the conservative boundary.

## Resource result

Reference hardware was an Apple M4 Max with 14 logical CPUs and 36 GiB of
memory.

Inside the common safe rectangle:

- weighted mean query latency was 0.0389 ms;
- the worst cell p50 was 0.9572 ms at E6, height 8;
- the worst cell p95 was 156.5561 ms at B6, height 8;
- maximum measured incremental memory was 88,735,744 bytes at C6, height 8;
  and
- every completed fresh-process replay was byte-identical.

Stress calibration selected one safe parallel worker. Its p95 was 906.6017 ms
and peak incremental memory was 174,538,752 bytes. Two, four, and eight workers
each produced a query timeout. The machine has many cores, but the frozen
per-query limit makes more than one worker unsafe for the measured hard-query
mix.

## Label yield and cost

Within the common safe rectangle, the targeted proposal stream produced:

| Multiplicity | Observed attempt share |
|---|---:|
| 0 | 0.3031% |
| 1 | 84.2831% |
| 2–7 | 14.9268% |
| 8–31 | 0.2041% |
| Above 31 | 0.2829% |

These are targeted-generator yields, not natural representation-theory
frequencies.

A counterfactual projection using only the 100 complete cells inside the safe
rectangle estimates 1,064,898 oracle calls and 0.427 CPU-core-hours for
458,750 accepted records. The cell-cluster bootstrap 95% intervals are
886,683–1,284,508 calls and 0.167–0.764 CPU-core-hours. The upper 95% values
plus the contractual 15% margin are 1,477,184 calls and 0.878 CPU-core-hours.

That projection is not a Phase 1 budget. It omits the failed rank-7/rank-8 and
E7/E8 surfaces, so freezing it would silently change the signed task. No
binding oracle budget is issued.

## Version history

Version 1 is retained as sealed superseded evidence. It used unconstrained
root-lattice proposals for positive strata, which made E7 and E8 yield almost
only zero-multiplicity targets. Version 2 replaced only that proposal step with
valid lowering walks and retained the contract, coordinates, seed, quotas,
oracle, and resource limits. Version 2 then exposed the actual cost boundary.

## Decision consequences

Under Section 10 of Revision 3, failure of the oracle/resource frontier is a
Stop. Therefore:

- the 458,750-record corpus is not generated;
- the three full models and shortcut baseline are not trained;
- ACR-1, ACR-2, cross-rank, and exceptional model evaluations are not opened;
- no statement is made about learned structural transfer; and
- the delivered result is the negative Phase 0 package.

Continuing with lower heights, excluding E7/E8, raising the time limit, or
changing the oracle would require a signed scope revision. None is assumed.
