# LiE cross-check Version 1 — Hold and root cause

## Decision

Version 1 halted at its first disagreement, as required. The resource frontier
did not run.

Zero and LiE agreed on all 128 A-type cases. The first B2 case then returned
`1` from Zero and `0` from LiE. The raw partial evidence remains immutable in
`lie-cross-check-v1.json`.

## Root cause

The Version 1 witness treated every non-E coordinate system as identical. That
is false for the non-simply-laced types because Zero/Reasoner0 and LiE expose
opposite Cartan-matrix orientation conventions.

Fundamental-representation dimensions make the mapping unambiguous:

- Zero B3 reports `6, 14, 14`, matching LiE C3 rather than LiE B3.
- Zero C3 reports `7, 21, 8`, matching LiE B3 rather than LiE C3.
- Zero F4 reports `26, 273, 1274, 52`; LiE reports the same values when the
  four Dynkin coordinates are reversed.
- Zero G2 and LiE G2 use the same effective weight-coordinate order.

The failed B2 case agrees exactly when Zero B2 is compared with LiE C2 using
the same weight coordinates.

This is a witness-mapping defect, not evidence that either returned integer is
arithmetically wrong in its own convention. It must still be visible in the
record because the Phase 0.5 frontier uses explicit Zero root data while the
independent witness uses LiE family names.

## Required correction

Version 2 must freeze both a LiE type mapping and a coordinate mapping:

- Zero `B<n>` to LiE `C<n>`, coordinates unchanged;
- Zero `C<n>` to LiE `B<n>`, coordinates unchanged;
- Zero F4 to LiE F4, coordinates reversed;
- Zero G2 to LiE G2, coordinates unchanged;
- A and D types unchanged; and
- the already-recorded E6/E7/E8 node permutations unchanged.

Version 1 remains Hold. Only a complete Version 2 pass can clear the witness
and authorize the resource-frontier run.
