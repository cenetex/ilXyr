# Phase 0.6 persistent LiE bake-off — Hold

## Decision

The full-surface result is **not `use_lie`**. LiE fails the frozen one-second
gate on three of 256 representations.

The technical result is a strong reduced-surface candidate: 253 of 256
representations pass, every classical type passes, E6 and F4 pass, and only
one E7 and two E8 representations fail. The formal contract result is
**`hold`**, not `use_lie_reduced`, because client counsel has not accepted the
dependency arrangement and no named person or team owns LiE maintenance. A
re-scoped corpus manifest has also not yet proved that every retained Revision
3 family and evaluation stratum fits inside the measured surface.

No corpus was generated. No model was trained.

## What ran

- Frozen source: all 256 corrected non-pass representations from the sealed
  Phase 0.5 cloud frontier.
- Frozen requests: 8,192 original records, deduplicated to 2,701 unique
  queries.
- Orders: the frozen binding order and the frozen seeded replay order.
- Oracle: unmodified LiE 2.2.2 as a separate executable, built from source
  SHA-256
  `c4d6f67fa17d2bc77c875a5b2ad2b42ffc5cadf30e7d1c64c097648ccb918b1e`.
- Executable SHA-256:
  `d2478e3cf9abed5cc0105da52fb6580a8c85b66ec74b7cfd3192d3eb6953f391`.
- Machine: one c6i.4xlarge in us-east-1, auto-terminated after 543 seconds.
- Final run cost: $0.102566666667. All three sequential launch attempts cost
  an estimated $0.131844444445, below the signed $1.00 ceiling.

Zero's B/C public-name repair was merged before timing. Derived evidence keeps
both historical and canonical names. B2/C2 remains excluded from naming
validation as the rank-two isomorphism edge case.

## Correctness result

- Historical Zero comparisons completed: **1,572/2,701** unique requests.
- Exact agreements: **1,572**.
- Arithmetic disagreements: **0**.
- Completed LiE integers reproduced exactly across the two orders:
  **2,689/2,701**.
- Completed-integer replay disagreements: **0**.
- Incomplete replay: **12** queries, all from the same final E8
  representation and all hard timeouts in both orders.

The earlier 496-case witness remains supporting evidence and is not counted in
the 1,572 comparisons above.

## Resource result

Across 5,402 timed calls:

- median latency: 1.192 ms;
- global p95: 100.808 ms;
- maximum: 10,000.909 ms;
- calls over one second: 74, confined to three representations;
- peak incremental worker RSS: 24,768,512 bytes;
- memory failures: zero;
- parse failures and crashes: zero; and
- persistent-process restarts: 24, one after each hard timeout.

The full one-worker gate fails, so the signed rule correctly skipped the
2/4/8-worker calibration. No safe full-surface worker count is claimed.

The three failures are:

| Type | Highest weight | Dimension | Per-representation p95 | Maximum | Result |
|---|---|---:|---:|---:|---|
| E7 | `[0,0,7,1,0,0,0]` | 197384447553975041491131000 | 2,616.023 ms | 2,618.826 ms | time fail |
| E8 | `[0,0,2,1,2,0,0,3]` | 10016456650651626970590027632517801547500 | 5,161.806 ms | 5,162.536 ms | time fail |
| E8 | `[0,0,8,0,0,0,0,0]` | 2828672569442851162646738736520484513149992187500 | 10,000.827 ms | 10,000.909 ms | time and incomplete replay |

## LiE-only tested ceilings

These are ceilings only within the frozen 256-representation non-pass roster.
They are not monotonicity claims and do not interpolate untested dimensions.
No type has a failed hole below its listed passing ceiling.

| Type | Pass/tested | Highest tested passing dimension |
|---|---:|---:|
| A7 | 4/4 | 7802262468 |
| A8 | 9/9 | 458057600000 |
| B5 | 3/3 | 275056636140 |
| B6 | 12/12 | 661908513946680 |
| B7 | 21/21 | 2431298746901524500 |
| B8 | 25/25 | 10276141146895896930000 |
| C5 | 4/4 | 86315693750 |
| C6 | 12/12 | 128730960072000 |
| C7 | 19/19 | 307887007485657600 |
| C8 | 24/24 | 924257419952455680000 |
| D6 | 10/10 | 3801688415525 |
| D7 | 17/17 | 12020316675422055 |
| D8 | 20/20 | 57861572008640400000 |
| F4 | 4/4 | 9412226506683 |
| E6 | 15/15 | 5334503627095500 |
| E7 | 24/25 | 10060206579322144240195200 |
| E8 | 30/32 | 1002266804532248686581718750000 |

All failed E7/E8 representations sit above their type's highest tested pass.
The machine-readable evidence preserves every tested case and classification.

## License and maintenance gate

The run used LiE as an unmodified separate executable. The exact source
archive, hash, compiler identity, and build command are reproducible. That is
enough for this internal bake-off, not for operational adoption.

Still missing:

1. client-counsel acceptance of the source, notice, relinking, and distribution
   duties; and
2. a named accountable maintenance owner, escalation contact, and supported
   build target.

The report does not invent either answer. The decision therefore remains
`hold`.

## Next authorized decision

If the client supplies both missing governance answers, IlXYr may prepare a
re-scoped, canonical, dimension-indexed corpus manifest limited to the 253
passing representations. That manifest must prove the retained family split
and evaluation strata, list the three exclusions, and return for approval.
It still does not authorize corpus generation or training.

If the client does not accept LiE governance, close this route. More Zero
optimization is a different engagement.

## Evidence

The raw two-pass record, compact summary, build record, launch record, terminal
cost receipt, and hashes are sealed under `phase06-cloud-v1/`. The raw record
is compressed without timestamps; its uncompressed SHA-256 is
`835fd2e492e284af514db111b55070ff36b6f5c85c2c63ef5fb0bfab7988cc1d`.
