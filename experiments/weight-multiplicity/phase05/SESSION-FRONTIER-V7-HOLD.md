# Parallel root-ray DAG frontier Version 7 — Hold

Version 7 is the controlling Phase 0.5 resource frontier for Zero merge
`443d8e99a7b6e9045a8a9ee6735c3c75f2b29b66`. It repeats the exact frozen
828-representation Version 6 roster and the same one-second query and p95,
ten-second hard-timeout, 2 GiB incremental-RSS, target-order, and two-replay
limits. It uses eight internal Zero workers. Versions 1 through 6 remain
sealed and are not rewritten.

Across the frozen roster, Version 7 records:

- 826 passes;
- one E8 time failure;
- one order-sensitive E8 representation;
- zero grouped hard timeouts;
- exact memory observations for all 2,484 grouped runs; and
- passing exactness and deterministic replay projections for all 828
  representations, with zero disagreements.

The gate remains a Hold because every frozen representation must pass every
query and the p95 limit in every frozen order.

## Boundary movement

The root-ray representation produces a large memory improvement on the
hardest completed cells. Compared with Version 6:

- maximum grouped incremental RSS falls from 2,054,946,816 to 1,445,609,472
  bytes, a 29.7 percent reduction;
- maximum completed working set falls from 1,809,596,416 to 1,324,881,920
  bytes, a 26.8 percent reduction; and
- maximum graph capacity falls from 1,564,491,776 to 111,149,056 bytes, a
  92.9 percent reduction.

The largest ray memo capacity is 1,087,903,744 bytes. The graph, ray memo,
working-set, and RSS figures overlap and must not be added. There are no
unknown-memory cells and no hard-timeout placeholder values.

The pass surface does not advance. Version 6 had 827 passes and one
order-sensitive result. Version 7 has 826 passes, one time failure, and one
order-sensitive result. This is a timing boundary, not a correctness or
memory regression.

## Remaining time boundaries

E8 `[0,0,8,0,0,0,0,0]` remains order-sensitive:

- descending depth: p95 0.115625 ms, maximum 4,263.395208 ms, one query above
  one second;
- ascending depth: p95 3,235.453375 ms, maximum 3,454.100708 ms, two queries
  above one second; and
- seeded order: p95 2,722.602750 ms, maximum 9,497.799291 ms, two queries
  above one second.

Compared with Version 6, its descending maximum improves by 2.25x, ascending
p95 improves by 5.3 percent, and seeded p95 improves by 20.9 percent. The
seeded maximum is worse in this capture. The two exact descending replays
also vary in wall time, but their answers and structural replay projections
are identical. Timing variance therefore does not weaken the correctness
result.

E8 `[0,0,2,1,2,0,0,3]` is the separate time failure. Descending order has
p95 0.073292 ms but one 1,172.780292 ms query. Ascending and seeded orders
pass both limits. It is not called order-sensitive because every order passes
the p95 rule; the descending first-query miss fails the separate per-query
rule.

The parallel calibration still finds eight processes safe on its frozen
stress set. That is a capacity result, not a statement that all frontier
queries pass.

## What changed in Zero

Zero factors the dependency graph into orbit-canonical root-ray states and
evaluates it in parallel level order. The session keeps one highest-weight
memo and one root-ray DAG per process, clearing both when the type or highest
weight changes. This reduces repeated orbit-member storage while preserving
the recurrence and exact arbitrary-width answers.

The replay projection includes answers, recurrence and fold counters, ray
states, ray hits, transitions, node counts, worker counts, and parallel level
structure. It excludes allocation capacities and timings, which are resource
observations. All 828 representations pass that projection in both replays.

## Capture provenance

The measurement controller at
`dcb15c0c7b33c52dd739cb1fd403f58ca53a0310` completed and checkpointed the
first 641 representations, then Node reached its maximum string size while
rewriting the growing checkpoint. No measurement failed and the saved prefix
remained valid.

The checkpoint writer at
`ecdc1f0ae16e7b52f5fbd56e1de380ab3da95ba7` changed storage only: after a
response had been parsed and its exact replay projection recorded, it kept
the response SHA-256 and removed the duplicate raw response and duplicate
projection copy. It migrated the saved prefix and resumed at representation
642. It did not change measurements, classification, replay comparison, the
plan, the manifest, or the Zero executable. The finalizer revision is
`56655d36618eb2372519643f7f980e032acd9547`.

## Correctness evidence categories

The current Zero and ilXyr checks are internal evidence, not an independent
witness. They include exact answers, identical recurrence and fold counters,
and deterministic root-ray replay projections across the complete roster.

LiE Version 4 remains a separate independent predecessor witness: 496
agreements and zero disagreements. It exercised an earlier Zero executable,
not the Version 7 binary. It is therefore recorded as a predecessor link, not
as a direct independent witness for the current oracle. These two categories
remain separate in the record.

## Next performance target

Root-ray factorization should remain because it materially lowers memory and
improves the hardest descending query. It is not the final time solution. The
next work should reduce or partition discovery before evaluation, especially
the large set of ray transitions generated before the compact node graph is
known. A sharded discovery merge, stronger pre-discovery deduplication, or a
lazy recurrence that avoids materializing the full reachable ray set should
be tested separately against this Version 7 frontier. More session memo
tuning alone cannot make the first cold target meet one second.

## Evidence identities

- plan SHA-256:
  `74a16761d1fef3c3dea04624fe9e5b2d491bb285bd810cb41514493e160f5a6f`;
- representation manifest SHA-256:
  `7b4d83e01b3af05195bfe92d2c08d8d76da8a33b4ce83953df909e98dedf37ff`;
- measurement capture SHA-256:
  `ea024d1234c2afc37ab578b7ab3c134ed3d1a7c6f86a56feaf7f298a55d696e6`;
- finalized uncompressed result SHA-256:
  `5b935cb61846c570f3ba573be92a9d3a9143257701225e4a478b6ac2bf716530`;
- finalized compressed result SHA-256:
  `997efbe48f6d1025e49f8befa7cb06899a33e70ca94d5e254d47f64438f481e7`;
- compact summary SHA-256:
  `c08bba3348deeaa3ab8a55e910b9695d4918bc2ada0ccdf95644a7b633768fb0`;
- Zero executable SHA-256:
  `245ee35504604014f562e4c1916a8cf987569aef72533a1c06218b90e270fcdf`;
- measurement controller revision:
  `dcb15c0c7b33c52dd739cb1fd403f58ca53a0310`;
- checkpoint writer revision:
  `ecdc1f0ae16e7b52f5fbd56e1de380ab3da95ba7`; and
- evidence finalizer revision:
  `56655d36618eb2372519643f7f980e032acd9547`.

The binding capture ran for 22 minutes 14.759 seconds on the recorded Apple M4
Max reference host.

No corpus generation or training is authorized.
