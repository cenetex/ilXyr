# Phase 0.5 corrective cloud audit — final closeout

## Status and decision

- **Status:** final vendor closeout; client acceptance requested
- **Execution date:** 2026-08-30 America/Vancouver / 2026-08-31 UTC
- **Contractual outcome:** **Stop under Revision 3**
- **Recommended next decision:** approve or reject the separate Phase 0.6
  oracle bake-off
- **Corpus and model status:** not authorized; none generated or trained

The corrective audit is complete. It repaired two false exactness labels,
tested the allocator hypothesis on the exact prior cloud executable, and
repeated the independent LiE witness. It did not clear the one-second resource
gate. Phase 1 therefore remains stopped.

There is still a narrow, useful next test. The LiE witness exposed a strong
performance signal on deeper targets, while the Zero frontier remains entirely
time-bound. That signal should be measured on the actual failed surface before
any more Zero optimization or corpus design is funded.

If the client requires Zero itself to be the production oracle, the proposed
LiE bake-off has little value and the engagement should close here as an
accepted negative result.

## Binding execution

- Corrective audit: `weight-multiplicity-phase05-cloud-corrective-audit-2026-08-30-v1`.
- Workflow run: [33353839104](https://github.com/atimics/zero-grounded-literary-lm/actions/runs/33353839104).
- Zero source commit: `cb09bcd5121cdc799749173963bda4cc54a32e9b`.
- ilXyr controller commit: `ad39f923c5b1c489afec24b461ef922cdd2db561`.
- Exact prior cloud Zero executable SHA-256:
  `274d00071b33b9e4d4f495e629b0af96867cea382a8e7c4dc3174d13ca56a621`.
- LiE executable SHA-256:
  `6df4a14b3af4eb0768357c5f5f7a27495602e3ae9f20a11bbea87dcc5a7d86fb`.
- Instance: `i-07ed6044d7463a155`, c6i.4xlarge, us-east-1; confirmed terminated.
- Instance time: 247 seconds.
- Estimated EC2 cost: $0.046655555556 against a $0.50 cap.

The checked-in evidence is under `cloud-corrective-v1/`. Its own checksums
pass.

## Exactness correction

An incomplete replay cannot prove an arithmetic failure. The binding rule is:

> Only an observed multiplicity mismatch or a complete replay with different
> response bytes is an exactness failure. An incomplete replay is exactness
> unknown and a resource failure.

Two historical labels change append-only:

| Representation | Prior label | Corrected label | Observed mismatches |
|---|---|---|---:|
| `B6:0,0,1,2,1,0` | `exactness_fail` | `time_fail` | 0 |
| `F4:0,2,5,0` | `exactness_fail` | `time_fail` | 0 |

The corrected 828-representation cloud summary is:

| Classification | Count |
|---|---:|
| Pass | 572 |
| Order-sensitive | 17 |
| Time failure | 239 |
| Exactness failure | 0 |

Observed exactness is Pass for 595 representations, Fail for zero, and unknown
after timeout or oracle error for 233. This is not evidence that the 233 are
wrong; it is evidence that the frozen resource gate did not return a complete
comparison.

## Independent correctness witness

LiE completed all 496 frozen cases and agreed with Zero on all 496. Every one
of the 31 supported types contributed 16 cases. There were no disagreements,
timeouts, process errors, or parse errors.

This supports Zero's arithmetic on the tested cases. It does not prove every
unobserved label and does not by itself authorize LiE as a corpus oracle.

## Allocator result

The audit ran five frozen representations under the default table policy and
an 8,388,608-slot presized policy. The exact executable, machine type, target
order, and ten-second hard timeout were held fixed.

| Representation | Default incremental RSS | Presized incremental RSS | Timeout depth, both policies |
|---|---:|---:|---:|
| `A8:2,0,0,3,0,1,1,1` | 1.024 GB | 1.366 GB | 54 |
| `B6:2,0,5,0,0,0` | 1.021 GB | 1.366 GB | 73 |
| `B7:0,2,0,1,0,1,0` | 2.053 GB | 1.365 GB | 68 |
| `B8:0,0,0,0,2,0,0,0` | 1.020 GB | 1.364 GB | 55 |
| `C6:0,6,1,0,0,0` | 2.052 GB | 1.365 GB | 81 |

The binding memory limit is 2,147,483,648 bytes. Neither policy crossed it
before termination, no memory classification changed, and no answer differed.
Every run still hit the same deep-target timeout.

The high default RSS for B7 and C6 is a resize transient. At timeout each had
2,936,012 live entries, or 481,505,968 bytes at 164 bytes per entry. The table
reported 687,865,856 old bytes plus 1,375,731,712 new bytes during rehash:
2,063,597,568 simultaneous bytes. Observed peak RSS was 2,065,317,888 bytes for
B7 and 2,065,342,464 bytes for C6. Presizing avoided that transient but
overallocated badly on smaller working sets; its capacity-to-live ratio reached
11.20 for B8.

The allocator policy strongly affects raw RSS, but it did not affect the
binary gate in this audit. Incremental rehash is a sensible contingency if
memory later becomes binding. It is not the next funded task.

The statement “under the limit” is bounded by termination. It does not prove
that an unbounded query would stay under two GiB.

## New performance signal from LiE

The 496-case witness was designed for correctness, not benchmarking. It
spawns a process for each query, so the LiE timing mostly measures startup and
I/O. Even with that limitation, the depth pattern is material:

| Surface | Cases | LiE p50 | LiE p95/max | Zero p50 | Zero p95/max |
|---|---:|---:|---:|---:|---:|
| All witness cases | 496 | 2.141 ms | 2.404 / 4.032 ms | 2.284 ms | 3.767 / 85.047 ms |
| Depth 0–5 | 283 | 2.072 ms | 2.374 / 4.032 ms | 2.237 ms | 2.839 / 8.248 ms |
| Depth 21–23 | 3 | 2.206 ms | 2.206 / 2.380 ms | 82.718 ms | 82.718 / 85.047 ms |

At the deep end, C8 depth 21 was 39.25 times faster in LiE, and the two E8
depth-22/23 cases were 37.50 and 34.59 times faster. The sample is too small
and too shallow to claim that LiE clears the failed frontier. It is strong
enough to make another round of Zero-only optimization premature.

## B/C public-name defect

The witness maps every historical Zero `B_n` request to LiE `C_n` and every
Zero `C_n` request to LiE `B_n`. The dimensions independently show that this
is not only a display convention: historical Zero `B8` at first fundamental
weight has dimension 16, while historical Zero `C8` has dimension 17.
Standard public names are the reverse.

Zero's internal calculations and the 496 comparisons remain consistent. The
public family names are transposed relative to the literature. Historical
hashes must not be rewritten; client-facing B/C frontier rows must be read
through the append-only naming erratum.

No corpus may be generated until Zero's public API is repaired, a legacy-name
adapter is frozen, and the SOW's family splits are confirmed in canonical
names.

## What the completed work proves

- No arithmetic disagreement was observed in the corrective audit.
- LiE independently agreed on 496 of 496 frozen cases.
- The two historical `exactness_fail` labels were false classifications.
- Raw memory is heavily affected by hash-table capacity and resize policy.
- The prior local memory boundary did not reproduce as a cloud memory failure.
- Presizing did not rescue any resource classification.
- The one-second time frontier remains the binding failure.
- The historical B/C public labels are transposed.

## What it does not prove

- It does not show learned structural transfer; no model was trained.
- It does not authorize a corpus.
- It does not show that LiE clears the 239 time failures.
- It does not establish an unconditional memory ceiling past the hard timeout.
- It does not make the original height-matched exceptional surface valid.
- It does not approve LiE licensing, packaging, or maintenance for production.

## Closeout decision

Revision 3 names oracle or resource frontier failure as Stop. That outcome
stands. The accepted Phase 0 negative result is cost, not observed arithmetic
failure.

The only recommended continuation is the separately signed Phase 0.6 oracle
bake-off. It tests persistent LiE on every corrected non-pass representation,
fixes the B/C public naming defect, and returns an oracle choice. It still does
not authorize corpus generation.

## Acceptance

- [ ] Client accepts this closeout and the Revision 3 Stop.
- [ ] Client requests factual corrections listed below.
- [ ] Client separately approves the Phase 0.6 proposal.

Client representative: ____________________

Date: ____________________

IlXYr research operations: ____________________

Date: ____________________
