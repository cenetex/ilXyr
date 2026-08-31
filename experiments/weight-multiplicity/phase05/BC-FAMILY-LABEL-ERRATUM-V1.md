# B/C family-label erratum Version 1

## Finding

Historical Zero weight-multiplicity outputs transpose the public B and C
family names relative to standard literature and LiE naming for ranks greater
than two.

This is a naming defect, not an observed arithmetic defect. Zero's internal
calculations are consistent with their matrices, and the corrected LiE witness
agreed on 496 of 496 mapped cases.

## Evidence

The frozen witness manifest maps:

- Zero `B2`–`B8` to LiE `C2`–`C8`; and
- Zero `C3`–`C8` to LiE `B3`–`B8`.

The dimensions give an independent public-name check:

| Historical Zero request | First fundamental dimension | Canonical family |
|---|---:|---|
| `B8 [1,0,0,0,0,0,0,0]` | 16 | C8 |
| `C8 [1,0,0,0,0,0,0,0]` | 17 | B8 |

For standard names at rank `n >= 3`, the first fundamental representation has
dimension `2n + 1` for B and `2n` for C. B2 and C2 are isomorphic and are not
used as the naming regression.

The Zero constructor also places the double bond in its public `B` matrix with
the orientation used by canonical C, and conversely for public `C`.

## Impact

- Historical arithmetic values remain valid under their exact matrices and
  legacy labels.
- Historical signatures and hashes remain unchanged.
- Client-facing B/C rows in tested-ceiling and frontier tables must be swapped
  when expressed in canonical names.
- The Revision 3 family split is ambiguous until it is restated against the
  repaired public API.
- A corpus generated before repair would attach standard family names to the
  wrong B/C matrices.

## Required migration before any corpus

1. Repair the Zero public API so `B_n` and `C_n` use canonical matrices.
2. Add rank-3-through-rank-8 first-fundamental dimension regressions.
3. Preserve a versioned legacy adapter:
   `legacy B_n -> canonical C_n` and
   `legacy C_n -> canonical B_n`.
4. Derived historical records must carry both `legacy_zero_type` and
   `canonical_type`.
5. Restate every SOW training, held-out, and exceptional family list in
   canonical names.
6. Regenerate, do not relabel in place, any future frontier manifest.

Until these steps pass review, the program is Hold for corpus generation even
if an oracle later clears the resource gate.
