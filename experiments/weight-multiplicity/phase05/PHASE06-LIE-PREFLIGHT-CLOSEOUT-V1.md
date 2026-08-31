# Phase 0.6 retained-surface LiE preflight — Pass

Date: 2026-08-31

## Decision

The authorized 572-representation LiE preflight is **`preflight_pass`**.
Every retained representation passed the frozen resource gate, all 4,218
available Zero comparisons agreed exactly, and the second LiE pass reproduced
all 4,218 results.

Together with the 253 retained representations measured in the earlier Phase
0.6 bake-off, LiE now has measured coverage for **825 of 825** representations
in the reduced manifest. The three measured E7/E8 time failures remain
excluded. This closes the technical preflight gate; it does not authorize
corpus generation, model training, or oracle promotion.

## What ran

- Frozen surface: 572 retained representations, 18,304 generated targets, and
  4,218 unique queries.
- Oracle: unmodified LiE 2.2.2 as a separate persistent executable.
- Passes: the complete frozen binding order followed by the complete frozen
  replay order, for 8,436 primary calls.
- Differential source: a completed historical Zero answer for every unique
  query.
- Machine: one AWS `c6i.4xlarge` in `us-east-1`.
- Successful run: `20260831212800`, automatically terminated after 83 seconds.

No corpus was generated and no model was trained.

## Correctness result

- Zero/LiE comparison coverage: **4,218/4,218**.
- Exact agreements: **4,218**.
- Arithmetic disagreements: **0**.
- Unavailable LiE results: **0**.
- Replay comparisons: **4,218**.
- Exact replay agreements: **4,218**.
- Incomplete or non-deterministic results: **0**.

This is the direct differential evidence that was missing for the 572 earlier
Zero-pass representations. It is separate from, and additive to, the earlier
Phase 0.6 evidence for the other 253 retained representations.

## Resource result

The two complete primary passes produced these measurements:

- median query latency: 0.217 ms;
- global p95: 1.341 ms;
- maximum query latency: 12.643 ms;
- peak incremental worker RSS: 274,432 bytes; and
- all per-query, global-p95, per-representation-p95, and memory gates: pass.

The frozen limits were 1,000 ms per query, 1,000 ms global and
per-representation p95, and 2 GiB incremental RSS per worker.

The one-request-per-representation calibration also passed at every requested
worker count:

| Workers | Requests | p95 | Maximum | Peak incremental worker RSS |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 8,436 complete-pass calls | 1.341 ms | 12.643 ms | 274,432 bytes |
| 2 | 572 | 1.614 ms | 3.700 ms | 212,992 bytes |
| 4 | 572 | 1.143 ms | 4.404 ms | 196,608 bytes |
| 8 | 572 | 2.539 ms | 6.861 ms | 204,800 bytes |

Eight persistent workers are therefore safe on this frozen surface. This is
not a general claim beyond the measured manifest.

## Reproducible build identity

The successful run built the unchanged source twice in independent
directories with the fixed source epoch. Both executables had SHA-256:

`bc1099ccfa0f890868e2261c106ede4fd0e52dcd86a4d03b16318ba39674e974`

The pinned source SHA-256 remains:

`c4d6f67fa17d2bc77c875a5b2ad2b42ffc5cadf30e7d1c64c097648ccb918b1e`

The source was not modified. The fixed epoch was `1112054400`, based on the
source archive date. This satisfies the corrected two-build identity gate in
`PHASE06-LIE-BUILD-IDENTITY-ERRATUM-V1.md`.

## Cost and shutdown

The successful run cost an estimated **$0.015677777778**. The earlier
build-only attempt stopped before queries, cost **$0.013788888889**, and is
preserved separately. Total estimated EC2 cost for both preflight attempts was
**$0.029466666667**, below the signed $1.00 ceiling.

Both instances terminated automatically. The successful instance is confirmed
terminated, and its result status has exit code zero.

## Append-only record

The reduced manifest is not rewritten because its hash is a frozen input to
this preflight. This closeout and its machine-readable evidence are the
append-only proof that the manifest's 572-representation preflight condition
has been satisfied.

The private bootstrap trace is not checked into Git because it may contain
short-lived instance-metadata authorization material. It is not
decision-bearing. The runner's standard-error log is empty and is preserved.

## Next decision

The reduced 825-representation surface is ready for the client's separate
corpus-generation decision. Until that approval is recorded, corpus
generation, model training, and oracle promotion remain locked.

## Evidence

- `phase06-preflight-cloud-v1/`
- `phase06-lie-preflight-closeout-v1.json`
- `examples/weight-multiplicity/phase06-lie-preflight-plan-v1.json`
- `examples/weight-multiplicity/phase06-lie-preflight-manifest-v1.json.gz`
- `examples/weight-multiplicity/phase06-reduced-corpus-manifest-v1.json`
