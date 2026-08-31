# Phase 0.6 proposal — persistent LiE oracle bake-off

## Recommendation up front

This is worth doing only as a short, fixed-scope oracle decision. It is not a
case for extending the optimization program on hope.

The existing correctness witness shows a 34–39× LiE advantage on its three
deepest cases, but it does not include the actual Zero time-fail surface.
Phase 0.6 asks one question: **does persistent LiE clear the frozen failed
surface under the existing one-second and two-GiB limits?**

If the client requires Zero itself to be the production oracle, do not fund
this phase. Accept the Revision 3 Stop or commission Zero optimization as a
different engineering engagement.

## Status

This document is a proposal, not execution authority. It requires client
signature. It authorizes neither corpus generation nor model training.

- **Proposed duration:** five business days.
- **Proposed cloud ceiling:** one c6i.4xlarge, 30 minutes, no more than $1.00
  EC2.
- **Primary output:** `use_lie`, `use_lie_reduced`, `lie_resource_fail`,
  `hold`, or `stop`.

## Frozen source surface

The source is the exact cloud frontier from run `33329981839`:

- gzip SHA-256:
  `7d74654ebb16fe62b3e20a5f49c5a32312de14a3a2b3feaf8d79ae0ffb291c9c`;
- plan SHA-256:
  `350ed67272f534a0d8bc7df1ae35a5da55485c04d1184e4e5ce92de8a8e57314`;
- exact Zero executable SHA-256:
  `274d00071b33b9e4d4f495e629b0af96867cea382a8e7c4dc3174d13ca56a621`;
- corrected classifications: 572 Pass, 17 order-sensitive, 239 time-fail,
  zero exactness-fail.

The bake-off includes all 256 corrected non-pass representations: every
time-fail and every order-sensitive representation. It does not take a
favorable sample.

The controller reconstructs all 32 frozen target requests for each
representation from the sealed plan and manifest. The pre-run deliverable is
an exact canonicalized request manifest, its unique-request count, and its
SHA-256. The theoretical maximum before deduplication is 8,192 requests.

## Workstream 1 — canonical family names

Before timing, repair the B/C public-name defect:

1. Zero's public `B_n` must refer to the standard B family and public `C_n` to
   the standard C family.
2. Regression tests for ranks 3 through 8 must require
   `dim V_Bn(omega_1) = 2n + 1` and `dim V_Cn(omega_1) = 2n`.
3. Historical evidence remains immutable and gains both `legacy_zero_type`
   and `canonical_type` in any derived record.
4. The compatibility mapping is historical Zero B to canonical C and
   historical Zero C to canonical B. B2/C2 is recorded as the rank-two
   isomorphism edge case rather than used to validate naming.
5. The Revision 3 training and held-out family lists are restated in canonical
   names before any later corpus manifest is accepted.

Any ambiguous type label is Hold. No silent type mapping is allowed.

## Workstream 2 — persistent LiE harness

Use LiE 2.2.2 from the already pinned source archive:

- source SHA-256:
  `c4d6f67fa17d2bc77c875a5b2ad2b42ffc5cadf30e7d1c64c097648ccb918b1e`;
- source URL:
  `https://mirror.metanet.ch/sage/spkg/upstream/lie/lie-2.2.2.tar.gz`.

Run one long-lived LiE interpreter per worker. Send one request at a time and
record wall time until the complete parseable response arrives. Do not spawn a
new process per query. Record process startup separately; do not hide warm-up
inside query timing.

The binding order is the same ascending-depth, dominant-first, lexicographic
order used by the corrective audit. A second seeded order tests sequencing.
Every request and response is recorded. The harness performs two complete
deterministic passes.

The existing F4 and E-type coordinate permutations remain explicit. B/C uses
canonical public names in LiE and the append-only compatibility mapping only
when comparing historical Zero records.

## Workstream 3 — differential correctness

The correctness rules are:

- LiE must complete every frozen request twice with byte-identical parsed
  integer multiplicities.
- LiE must agree with every completed historical Zero answer available on the
  same request.
- A disagreement, parse error, crash, or non-deterministic replay is Hold and
  stops the resource decision.
- A historical Zero timeout is not called agreement. It remains an unavailable
  differential comparison and is reported separately.

The existing 496-of-496 witness remains supporting evidence. It is not counted
again as coverage of the failed surface.

The final report states differential coverage as both a count and a fraction:
completed historical Zero comparisons divided by the unique frozen LiE
requests. Agreement is never presented without that denominator. Zero
timeouts remain unavailable comparisons and do not validate either oracle.

## Workstream 4 — resource gate

The Revision 3 limits remain unchanged:

- every query completes in no more than 1,000 ms;
- p95 is no more than 1,000 ms globally and within every representation;
- peak incremental worker RSS is no more than 2,147,483,648 bytes;
- no crash, timeout, parse failure, or non-integer answer; and
- deterministic replay is exact.

Measure one worker first. If it passes, test 2, 4, and 8 persistent workers on
the frozen stress subset and name the safe worker count. Report process
startup, per-query latency, per-representation total cost, accepted-record
cost, and peak RSS separately.

Regardless of the aggregate outcome, publish a LiE-only cost frontier in the
same tested-ceilings form as the corrected Zero frontier. For every canonical
type, report the highest tested passing dimension, every tested hole below
that ceiling, every passing representation above a hole, and the separate
time, memory, parse, and replay classifications. A ceiling is a summary of
tested cases, not a monotonicity claim. Preserve failed and untested cells;
do not interpolate across them.

## License and maintenance gate

[Sage records LiE](https://doc.sagemath.org/html/en/reference/spkg/lie.html)
as LGPL with an unspecified version. [Debian's LiE 2.2.2 copyright
record](https://sources.debian.org/copyright/license/lie/2.2.2%2Bdfsg-2/)
states LGPL 2.1 or later and records upstream confirmation. That supports the
internal bake-off; it is not legal approval to ship a new dependency.

Before a `use_lie` recommendation becomes operational, the deliverable must
state:

- whether LiE is invoked as an unmodified separate executable;
- what source, notice, relinking, and distribution duties apply;
- how the client receives reproducible source and build instructions;
- the named person or team that owns maintenance of the older codebase, with
  an escalation contact and supported build target; and
- whether client counsel accepts the arrangement.

`IlXYr`, `the vendor`, or `we` is not a sufficient maintenance owner. A
`use_lie` or `use_lie_reduced` decision requires a specific accountable name
in the final report.

An unresolved license or maintenance position is Hold. This proposal is not
legal advice.

## Decision rules

### `use_lie`

All naming, correctness, time, memory, replay, license, and maintenance gates
pass. Recommend LiE as the primary corpus oracle and Zero as a differential
check. This outcome authorizes preparation of a new canonical, dimension-
indexed frontier; it does not authorize a corpus automatically.

### `use_lie_reduced`

LiE fails the resource gate on one or more of the 256 representations, but a
strict subset passes every naming, correctness, replay, license, maintenance,
time, and memory gate. That measured subset must be large enough to support
the Revision 3 family split and every retained evaluation stratum; otherwise
the outcome is `lie_resource_fail`.

Recommend LiE as the primary oracle only inside the measured passing frontier,
with Zero as a differential check where a completed Zero answer exists. This
outcome authorizes preparation of a re-scoped corpus manifest containing only
measured passing representations and requests inside their tested envelopes.
It does not authorize corpus generation or model training. The manifest must
return for client approval with all excluded types, representations, and
strata stated explicitly.

### `lie_resource_fail`

LiE fails the frozen time or memory gate and no reduced passing surface meets
the predeclared corpus-viability rule above. This outcome says nothing about
whether Zero is correct or production-ready. Report differential agreement
separately as a count and coverage fraction, including when the available
coverage is zero.

Close the LiE route. Any further Zero optimization requires a separately
priced and signed engineering scope. Incremental rehash is included only if
memory becomes a measured failure.

### `hold`

Any arithmetic disagreement, B/C migration ambiguity, incomplete LiE replay,
or unresolved license/maintenance issue. Root cause must be resolved before
another frontier or corpus decision.

### `stop`

The measured outcome is `lie_resource_fail`, the client declines a separate
Zero engineering scope, and no approved reduced corpus surface exists. Accept
the existing negative result and close the program without a corpus. The final
report records the underlying resource result and must not describe Zero as
validated.

## Deliverables

- append-only B/C family-label erratum;
- Zero public-name repair and compatibility tests in a separate Zero PR;
- persistent LiE harness and self-tests in an ilXyr PR;
- frozen canonical request manifest and hashes;
- two complete raw LiE passes and checksums;
- differential agreement report against all available Zero answers;
- differential coverage count and fraction over unique frozen requests;
- per-representation and aggregate time/memory report;
- LiE-only measured ceilings per canonical type, with holes preserved;
- safe persistent-worker count;
- license and maintenance note naming the accountable maintenance owner;
- canonical dimension-indexed frontier recommendation; and
- final `use_lie`, `use_lie_reduced`, `lie_resource_fail`, `hold`, or `stop`
  decision.

## Schedule

| Day | Deliverable |
|---|---|
| 1 | B/C repair, compatibility record, and frozen request manifest |
| 2 | Persistent LiE harness, self-tests, and dry run |
| 3 | Binding run, deterministic replay, and worker calibration |
| 4 | Differential analysis and license/maintenance review |
| 5 | Final decision package |

No corpus-generation code runs during this schedule.

## Acceptance

- [ ] Approved as written.
- [ ] Approved subject to the written changes below.
- [ ] Declined; Revision 3 Stop is accepted as final.

Client representative: ____________________

Date: ____________________

IlXYr research operations: ____________________

Date: ____________________
