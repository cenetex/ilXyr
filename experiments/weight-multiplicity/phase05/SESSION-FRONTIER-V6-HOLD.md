# Lock-light prepared-DAG frontier Version 6 — Hold

Version 6 is the controlling Phase 0.5 resource frontier for Zero merge
`349e6c2ef5487d4709a8dd525b2dbaac7d590f08`, whose lock-light compact
prepared-edge implementation is commit
`da56686d84e9bee28636acd9fe723f11eb9a9160`. It repeats the exact frozen
828-representation Version 5 roster and the same one-second query and p95,
ten-second hard-timeout, 2 GiB incremental-RSS, target-order, and two-replay
limits. It also keeps eight internal Zero workers so this capture measures the
code change without mixing in worker-count tuning. Version 5 remains sealed
and is not rewritten.

Across the frozen roster, Version 6 records:

- 827 passes;
- one order-sensitive E8 representation;
- zero grouped hard timeouts;
- exact memory observations for all 2,484 grouped runs; and
- passing exactness and deterministic replay projections for all 828
  representations, with zero disagreements.

The gate remains a Hold because every frozen representation must pass every
part of the time contract in every frozen order.

## Boundary movement

E8 `[0,0,8,0,0,0,0,0]` no longer ends at a hard timeout. Every grouped run
and both prepared replays complete. This retires the Version 5
`time_fail_memory_unknown` classification and replaces the placeholder-free
lower-bound observation with exact process high-water measurements.

The largest grouped incremental RSS is 2,054,946,816 bytes in ascending order,
92,536,832 bytes below the 2 GiB limit. The largest completed prepared working
set is 1,809,596,416 bytes and the largest prepared-graph capacity is
1,564,491,776 bytes. These are overlapping counters and must not be added.
There are no remaining unknown-memory cells in this frontier.

## Remaining time and order boundary

The same E8 representation remains outside the full time contract:

- descending depth: p95 0.047459 ms, maximum 9,573.796667 ms, one query above
  one second;
- ascending depth: p95 3,414.887792 ms, maximum 4,934.035209 ms, three queries
  above one second; and
- seeded order: p95 3,442.495500 ms, maximum 4,925.115250 ms, three queries
  above one second.

The classification is order-sensitive because descending order passes the p95
limit while both alternate orders fail it. No order passes the stricter
per-query part of the contract. Target order therefore changes the measured
cost substantially but does not change the Hold decision.

The parallel calibration still finds 1, 2, 4, and 8 processes safe under the
full time contract for its frozen stress set. Eight remains the selected safe
process count. A separate local Zero benchmark found ten internal workers
faster on the depth-1080 query, but Version 6 deliberately does not fold that
tuning change into this code-isolation capture.

## What changed in Zero

The prepared graph now uses worker-private compact edge shards during
discovery. Each round reads a stable node table, merges only unique new nodes
at its barrier, patches temporary local references, and keeps the common edge
record at 12 bytes with a side table for rare wide scales. This removes the
shared discovery lock from the hot path and reduces graph storage without
changing the dependency traversal or recurrence counters.

On Zero's hard E8 benchmark, the eight-worker query moved from 5.54 seconds to
3.83 seconds while prepared-graph capacity fell from 1,003,495,424 to
769,925,120 bytes. The depth-1080 query now completes in 10.61 seconds in the
standalone benchmark and completes inside the frontier's ten-second limit in
the binding descending run. Small timing differences are expected because the
frontier and standalone benchmark use different process histories and
measurement boundaries.

The earlier 5.57x direct-folding gain exceeded the 4.35x fixed-work Amdahl
ceiling computed from the old 77 percent hotspot. That is not evidence of an
impossible speedup: removing determinant work also removed costs the old
profile assigned elsewhere, including register pressure, call overhead, and
inlining barriers. Version 6 preserves that explanation in the record rather
than treating the result as a measurement error.

## Replay projection correction

During a nonbinding diagnostic run, the controller reported replay failures
even though answers and all semantic and structural counters agreed. The only
difference was `prepared_graph_capacity_bytes`. Worker-private shards can
distribute edges differently between runs, and block rounding makes that
capacity a resource observation rather than a deterministic traversal value.

Before this binding capture, the controller was corrected to exclude only
that capacity field from the exact replay projection. The field remains in
every run and in the resource maxima above. Answers, recurrence counters,
folding counters, graph structure, and memo behavior remain in the replay
projection. A self-test proves that a capacity-only change is accepted while a
recurrence-counter change still fails. The binding capture was then restarted
from zero at the committed controller revision; the diagnostic result was not
sealed.

## Correctness evidence categories

The current internal evidence is strong but not independent. Zero compared the
new and old prepared implementations on hard E8 cases with identical exact
answers and structural counters, ran a differential canonicalizer on every
recursive state, and passed normal, exact-reference, AddressSanitizer,
UndefinedBehaviorSanitizer, and ThreadSanitizer tests. This Version 6 capture
adds 828 passing exactness classifications and 828 passing deterministic
prepared replay projections.

LiE Version 4 remains a separate independent predecessor witness: 496
agreements and zero disagreements. It exercised an earlier Zero executable,
not the Version 6 binary. It is therefore recorded as a predecessor link, not
as a direct independent witness for the current oracle. Internal Zero/ilXyr
checks and the LiE witness stay in separate evidentiary categories.

## Next performance target

The frontier is now fully observable and nearly complete, but the remaining
gap is structural. More session persistence can help repeated queries; it does
not make a cold depth-1080 dependency graph meet one second. Worker tuning also
cannot close a roughly five-to-ten-second first-query cost.

The next work should attack the number of graph states or edges that must be
materialized, or evaluate the recurrence with a different representation that
avoids the full prepared graph. Any such change should retain the current
orbit canonicalization, exact arbitrary-width arithmetic, target-order runs,
and answer plus structural-counter differential checks.

## Evidence identities

- plan SHA-256:
  `384f9bc440dd3cc6184a56e345d80db313dd850dc045927807dce88caebb7208`;
- representation manifest SHA-256:
  `ea9594ace7983c46d02fb803153d063f63177e67cd1e374a012cdf6f6e09480d`;
- measurement capture SHA-256:
  `4af7d6f6fe6545351d4274a17fb9a0ae266b7e2e4440db5f3b79e3bc9849fab6`;
- finalized uncompressed result SHA-256:
  `756fa0e70046d06bc2fb7997ba7661e3624b1dd958d9fffc51f1ed60e3c70f1c`;
- finalized compressed result SHA-256:
  `84d795a8d194f5344bb5b66065d6ed56acabada155d8ba0180b59cbe95e878a8`;
- compact summary SHA-256:
  `7a6157f9bc7f1c122d326cc6c4145afa0011f797a2b2934c4303c34f9c959478`;
- Zero executable SHA-256:
  `e6ad8c85bbcfff1a6148020f7b97b4dabdcea7a703ed1cf5675550ac7ca342e4`;
- measurement controller revision:
  `0608b1d00b0e684a77da9449d6d1166935998ce4`; and
- evidence finalizer revision:
  `0608b1d00b0e684a77da9449d6d1166935998ce4`.

The binding capture ran for 14 minutes 21.584 seconds on the recorded Apple M4
Max reference host.

No corpus generation or training is authorized.
