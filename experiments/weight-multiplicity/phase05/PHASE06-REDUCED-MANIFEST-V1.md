# Phase 0.6 re-scoped manifest

Date: 2026-08-31

Status: candidate pending client approval and LiE preflight

Corpus generation: not authorized

## Result

The candidate surface contains 825 of the original 828 representations. It
removes the one E7 and two E8 representations that failed the frozen 1.0
second LiE gate. There are no holes below the highest retained pass in either
type.

The full roster is necessary to preserve the Revision 3 training, held-out
classical, and held-out exceptional split. The 253 Phase 0.6 LiE passes are
only the recovered part of the earlier 256-representation non-pass surface;
they are not a complete corpus roster. Restricting the manifest to those 253
would remove required training families and would not support Revision 3.

The manifest therefore makes the evidence boundary explicit:

- 253 retained representations directly passed Phase 0.6 under LiE;
- 572 retained representations passed the earlier Zero frontier but were not
  timed under LiE in Phase 0.6; and
- 3 representations are excluded by measured LiE time failures.

The 572 are not treated as LiE passes. They carry a mandatory LiE preflight
flag. That preflight has not been run and is not authorized by this manifest.
Every one must pass the frozen 1.0 second query and 2 GiB worker gates before
corpus generation. It uses the frozen 32-target generator, the Phase 0.6
binding and replay orders, and two complete passes through the same pinned
persistent LiE harness. Any Zero/LiE disagreement is Hold.

## Canonical names

Both historical and canonical labels remain in every row. Legacy Zero
`B3`–`B8` becomes canonical `C3`–`C8`, and legacy Zero `C3`–`C8` becomes
canonical `B3`–`B8`, with coordinates unchanged. Legacy rank-two `B2` used
the canonical C2 orientation; its two coordinates are reversed when written
as canonical B2. This preserves the representation dimension while removing
the historical naming ambiguity.

## E7 and E8 distribution change

The change is material in the dimension tail even though it is small by
representation count.

| Type | Before | Retained | Removed mass under a representation-uniform reference | Expected removed queries out of 500 | Maximum-dimension drop |
| --- | ---: | ---: | ---: | ---: | ---: |
| E7 | 38 | 37 | 2.63% | 13.16 | 19.62× |
| E8 | 33 | 31 | 6.06% | 30.30 | 2.82×10^18 |

All three exclusions have highest-weight height 8. E7 retains six of its
seven height-8 representations. E8 retains one of its three height-8
representations. The highest retained tested passes are:

- E7: dimension `10060206579322144240195200`; and
- E8: dimension `1002266804532248686581718750000`.

This does not reduce E8 to token coverage. Phase 0.6 passed 30 of its 32
tested recovery representations, and the retained tested surface reaches
about 10^30 dimensions. The two exclusions are the extreme tail.

## Re-derived exceptional gates

The decision surface remains 500 stratified queries per exceptional type:
125 each for multiplicities `0`, `1`, `2–7`, and `8–31`. A deterministic
round-robin balances representations within and across the four strata. A
separate 500-query natural-distribution surface per type remains report-only.

For a changed type, the original threshold is multiplied by
`source representations / retained representations` and rounded up. This is
the conservative rule that gives the excluded tail zero accuracy under a
representation-uniform reference distribution. It prevents removal of the
hardest representations from making the gate easier.

| Type | Median gate | Every-seed gate | Change |
| --- | ---: | ---: | --- |
| G2 | 70.0% | 60.0% | unchanged |
| F4 | 70.0% | 60.0% | unchanged |
| E6 | 70.0% | 60.0% | unchanged |
| E7 | 71.9% | 61.7% | re-derived for 38 → 37 |
| E8 | 74.6% | 63.9% | re-derived for 33 → 31 |

The Revision 3 representation-clustered 95% bootstrap interval with 10,000
resamples remains in force. If a per-type interval straddles its new line,
the result is Hold. The natural-distribution figures are reported but do not
control promotion.

This derivation is frozen to the representation-uniform reference stated
above. A later change in representation weighting requires client approval
and a new threshold derivation.

## Governance

Client counsel accepts LiE 2.2.2 as an unmodified separate executable under
the stated LGPL 2.1-or-later position. Every delivery must include the exact
pinned source archive, reproducible build instructions, and intact LGPL
notice. Any patch ends that acceptance and returns the arrangement to
counsel.

The accountable custodian is **Codex, IlXYr Research Operations**. The
supported target is Ubuntu 24.04 LTS x86-64 with GCC 13.3.0. There is no
active upstream and no security patching service. The commitment is limited
to pinned-artifact custody and reproducible builds.

## Authority boundary

This document and its machine-readable manifest are planning artifacts. They
do not authorize the 572-representation preflight, corpus generation, model
training, or oracle promotion. Corpus generation remains a separate client
decision after the manifest and preflight evidence are reviewed.

## Artifacts

- `examples/weight-multiplicity/phase06-reduced-corpus-manifest-v1.json`
- `examples/weight-multiplicity/phase06-lie-governance-v1.json`
- `experiments/weight-multiplicity/phase05/LIE-2.2.2-PINNED-BUILD.md`
- `scripts/prepare-weight-multiplicity-phase06-reduced-manifest.mjs`
