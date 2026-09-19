# Prepared-DAG frontier Version 5 — Hold

Version 5 is the controlling Phase 0.5 resource frontier for Zero merge
`0714eb0b4f6d1e31497d819c6e8bd4b996c2f702`, whose prepared-DAG implementation
is commit `0eba7457e5edb63ce418adc3e07c0a7cc804d639`. It repeats the exact frozen
828-representation Version 4 roster and the same one-second query and p95,
ten-second hard-timeout, 2 GiB incremental-RSS, target-order, and two-replay
limits. Version 4 remains sealed and is not rewritten.

The prepared engine folds internal dependency states to dominant orbit
representatives, combines duplicate dependency edges, reuses one graph across
targets for a representation, and discovers and evaluates that graph with
eight workers. The controller sends the deepest dominant target first, then
tests ascending-depth and seeded orders separately. `target_depth` is the sum
of the integer simple-root coefficients in `lambda - mu`; it is not a recursion
call count.

Across the frozen roster, Version 5 records:

- 827 passes, up from 825;
- zero measured time failures, down from one;
- zero order-sensitive classifications, down from one; and
- one `time_fail_memory_unknown`, unchanged.

The gate remains a Hold because every frozen representation must pass.

## Boundary movement

E7 `[0,0,7,1,0,0,0]`, the Version 4 time failure, now passes in all three
orders. Descending, ascending, and seeded p95 values are 0.229833 ms,
105.525292 ms, and 137.819958 ms. Their maximum single-query times are
322.443167 ms, 151.420125 ms, and 184.197416 ms. All are below one second.

E8 `[0,0,2,1,2,0,0,3]`, the Version 4 order-sensitive case, also passes in
all three orders. Descending, ascending, and seeded p95 values are 0.076625 ms,
301.068417 ms, and 339.083084 ms. Their maximum single-query times are
921.295458 ms, 411.746542 ms, and 448.042958 ms. This removes the measured
order-sensitive boundary without hiding the graph-build query: the 921 ms
maximum is included in the descending run.

The selected parallel calibration now finds 1, 2, 4, and 8 workers safe under
both parts of the full time contract. The eight-worker candidate has a maximum
query time of 654.978166 ms and p95 of 3.208875 ms. The Version 4
zero-safe-workers result is therefore retired for this prepared engine and
this calibration set.

## Remaining failure

E8 `[0,0,8,0,0,0,0,0]` remains `time_fail_memory_unknown`.

The descending run starts with zero weight at target depth 1080 and completes
no request before its ten-second hard timeout. The ascending run starts at
depth 267 and also completes no request. In seeded order, the first depth-268
query completes in 9,928.496750 ms, three small graph extensions complete in
42.603958 to 49.574500 ms, and the next depth-537 query reaches the hard
timeout. The first completed query alone exceeds the one-second contract.

The seeded partial run reports a 1,197,834,240-byte incremental RSS lower bound,
a 1,139,810,304-byte peak prepared working-set allocation, and a
1,024,466,944-byte prepared-graph capacity. These counters describe overlapping
storage and must not be added together. The observed prefix is below 2 GiB,
but the blocked process cannot provide a final high-water measurement.
Incremental memory is therefore unknown, not passed, for this representation.
Version 5 still cannot distinguish time-only failure from time-and-memory
failure after a hard timeout, and it does not invent that distinction.

Maximum measured incremental RSS among completed grouped runs is 164,528,128
bytes. That value says nothing conclusive about the timed-out E8 cell.

## Correctness evidence

All 827 completed representations have zero observed answer disagreements and
identical deterministic projections across both required prepared replays.
Raw response byte identity is deliberately not claimed because prepared
responses contain measured timing fields; the projection covers answers and
the structural graph, recurrence, memo, and folding counters.

Zero PR #169 also compared the prepared and recursive engines internally,
including identical answers and structural counters on representative and
hard E8 queries, canonicalizer differential tests, sanitizer runs, and the
portable, OpenBLAS, Accelerate, and WASM CI jobs. This is strong internal
implementation evidence. It is not independent evidence.

LiE Version 4 remains a separate independent predecessor witness: 496
agreements and zero disagreements. It exercised an earlier Zero executable,
not the Version 5 prepared binary. It is recorded as a predecessor link, not
as a direct independent witness for the current oracle. A direct LiE run for
the current binary remains pending.

## Performance interpretation

The full capture took 13 minutes 13.144 seconds, compared with about 13 minutes
55 seconds for Version 4. This wall-clock change understates the useful boundary
movement because the capture still includes fresh recursive references,
multiple orders, two replays, calibration, and repeated ten-second timeouts.
The frontier result itself is the stronger signal: the two previously measured
non-pass cells moved to pass, and the safe-worker count moved from zero to
eight.

The remaining problem is now narrow. Prepared graph construction for the
largest E8 representation still scales past both the one-second query contract
and the ten-second observation window. More memo persistence or target
reordering will not clear a cold depth-1080 graph build. The next performance
work should reduce the graph itself or avoid materializing all dependency
edges, while preserving the current orbit canonicalization and structural
counter checks.

## Evidence identities

- plan SHA-256:
  `f728ae0f21a757d3e0fc7dad60d18b90ab9c76e9f781bceb9ad66bdd02f038dd`;
- representation manifest SHA-256:
  `66567ba15cf3743d0fa38bc96b5ff2709e1abcf46e946fe62f2166255a02d1d8`;
- measurement capture SHA-256:
  `11ad1982ee025505eb38a9ba05597a6307b9e965fc447bf2317da076224aa559`;
- finalized uncompressed result SHA-256:
  `dad2926e23b9b711ce0d0ff5d8f2c14ba043c6058a8b5445e8390b9e0752e9e6`;
- finalized compressed result SHA-256:
  `996232dace6728e1b669d3ae83b2750c92e4a61fd685033d9517ab32f3d413d4`;
- compact summary SHA-256:
  `84e477eda7790440b0e88258ec357eb4ecb17af64bc1f4277f2c56cb85e98b6c`;
- Zero executable SHA-256:
  `4b4c9d24a7df7d07c9f84210d952a0fcd0a9b20e833e98d4432bb6c6c9150e87`;
- measurement controller revision:
  `518ed561dfe2abb15482a5976a653a9fed12ca09`; and
- evidence finalizer revision:
  `f0966230568c454c49b635f31fa25e68bb6373a6`.

No corpus generation or training is authorized.
