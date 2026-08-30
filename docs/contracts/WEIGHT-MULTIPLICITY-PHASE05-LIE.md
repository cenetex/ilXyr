# Phase 0.5 LiE correctness witness

## Role

LiE 2.2.2 is a separate, independent correctness witness for Zero's exact
weight-multiplicity answers. It is not a speed candidate, a production oracle,
or a project dependency. The source and executable are not committed to this
repository.

The frozen case manifest contains 16 nontrivial cases for every supported type,
which is more than the contractual minimum of 12. It includes one case for
every E7 and E8 fundamental representation. A1 uses additional representations
from the already-frozen height-one-through-eight candidate envelope because its
frontier roster alone has fewer than 12 unique nontrivial queries.

Any disagreement, timeout, process failure, or unparsable answer produces Hold.
The resource frontier must not run until the witness passes or the discrepancy
is resolved.

## Source and license record

- Version: LiE 2.2.2.
- Source archive: `https://mirror.metanet.ch/sage/spkg/upstream/lie/lie-2.2.2.tar.gz`.
- Source SHA-256: `c4d6f67fa17d2bc77c875a5b2ad2b42ffc5cadf30e7d1c64c097648ccb918b1e`.
- Sage's package record describes LiE as LGPL-licensed:
  `https://doc.sagemath.org/html/en/reference/spkg/lie.html`.
- Debian's LiE 2.2.2 copyright record states LGPL 2.1 or later and records the
  upstream author's license confirmation:
  `https://sources.debian.org/copyright/license/lie/2.2.2%2Bdfsg-2/`.

For this phase, the executable is built in temporary storage and used only for
the approved internal comparison. This avoids adding any distribution or
runtime dependency. A future proposal to ship or depend on LiE would need a
fresh license and maintenance review; Phase 0.5 does not approve that step.

## Build record

The unmodified source archive builds on the reference Mac with its documented
`noreadline` target and the portability definition
`CPPFLAGS=-D_POSIX_C_SOURCE=200809L`. The definition prevents the operating
system's deprecated `index()` declaration from colliding with LiE's historical
`index` type name. No LiE source file is patched.

## Coordinate identity

Zero/Reasoner0 and LiE expose opposite Cartan orientation conventions for the
non-simply-laced families. The independent comparison therefore maps Zero Bn
to LiE Cn and Zero Cn to LiE Bn without changing the coordinate order. This is
required by their fundamental-representation dimensions, not inferred from a
single multiplicity query. Zero F4 maps to LiE F4 with the four coordinates
reversed. Zero and LiE G2 use the same effective coordinate order.

LiE also numbers the E-type diagrams differently. The frozen manifest maps
Zero coordinates into LiE coordinates as follows:

- F4: `[z3, z2, z1, z0]`;
- E6: `[z0, z5, z1, z2, z3, z4]`;
- E7: `[z0, z6, z1, z2, z3, z4, z5]`;
- E8: `[z0, z7, z1, z2, z3, z4, z5, z6]`.

Each permutation is applied to both the highest and target weights before the
LiE query. The type and coordinate mappings are part of the frozen Version 2
case manifest and evidence output. Version 1's identity-mapping Hold remains
preserved as evidence of the witness defect and its correction.
