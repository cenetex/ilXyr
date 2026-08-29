# NSRL p10m target-margin pilot: negative result

- Run date: 2026-08-29
- Family: Solomon / NSRL p10m
- Source checkpoint: healthy p10m representation v9
- Candidate: output-matrix-only hard-negative margin training
- Result: development no-go
- Public test opened: no
- Hidden panel opened: no

## Question

The v10 continuation improved canonical likelihood but did not fix token rank,
context use, or free-running collapse. This pilot asked whether directly
separating each target token from the current highest-scoring wrong token could
repair rank while keeping the healthy v9 trunk fixed.

The contract, rate selection, development gate, and exact evidence hashes were
committed before the full candidate was evaluated.

## Result

All three 64-window feature-shift preflights passed. The frozen rule selected
shift 14 after mean target rank improved from 2,190.919 to 895.808 on that
small surface. The full 2,048-window run stayed numerically safe and changed
only the output matrix. Midpoint restart reproduced the final model and
optimizer state byte-for-byte.

The effect did not generalize. On the full run's 512-target audit, mean target
rank moved from 2,133.306 to 4,072.675, a 910-per-mille regression. Top-10 hits
fell from 21 to 6. Canonical public-development NLL increased by 2,004,452
millibits, or 308 per mille, with no increase in residual saturation.

The prospective gate failed and denied public test evaluation and
open-generation confirmation. The hidden panel remained untouched.

## Lineage decision

Do not repeat this unregularized hard-negative perceptron schedule at the same
horizon. The result does not rule out ranking objectives. A future bounded
attempt would need a fixed disjoint selection surface plus a development trust
region or early stop. It would be a new experiment with new authority, not a
continuation implied by this record.

The exact-check registration is
`examples/families/nsrl-target-margin-v1.retro.json`. It binds NSRL merge commit
`df6e7b0c2dd07520094216662903f61921f11f54` and the three frozen evidence
artifacts.
