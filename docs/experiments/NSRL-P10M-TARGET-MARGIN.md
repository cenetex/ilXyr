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

## Trust-region follow-up

The authorized follow-up was run under a new prospective contract. It fixed
the selection mismatch by binding shifts 13, 14, and 15 to one 2,048-window
update schedule. It also added 32 fixed training-corpus guard windows that were
disjoint from the entire update schedule. A proposed batch was accepted only
when canonical guard NLL did not worsen.

The result stopped the lineage earlier and more cleanly. Every one of the 16
batches proposed at each feature shift worsened guard NLL. All 48 proposals
were restored atomically. No shift had an accepted batch, update, or
output-matrix movement. The common guard stayed at 407,206 millibits, mean
target rank 2,289.312, and one top-10 hit. Saturation stayed at zero and all
frozen hashes held.

Because no preflight candidate passed, the full run never started. Public
development, public test, open-generation checks, and the hidden panel all
stayed closed. This identifies an immediate objective conflict: at the tested
rates, the hard-negative direction itself opposed canonical NLL on disjoint
data.

Do not continue this hard-negative hinge lineage by weakening the guard. The
next useful work should change the objective or candidate family before adding
more scale. The exact-check registration is
`examples/families/nsrl-target-margin-trust-region-v1.retro.json`, binding NSRL
merge commit `e2a9e9558ce5811e904a9d8e68e66ba6dac8306f`.

## Canonical-NLL head follow-up

The next prospectively frozen run changed the objective rather than weakening
the guard. It searched unit updates to the output matrix and bias using
canonical integer NLL. The trunk stayed frozen. The proposal used 64 windows
from document 0; the guard used 32 windows from document 1. The complete run
was repeated independently from the healthy v9 source.

The selected output-weight coordinate 8,445 improved exact proposal NLL by
57,212 Q20 units but worsened exact guard NLL by 586 Q20 units. The guard
restored the move in round zero. Both runs produced identical model and trace
hashes, the frozen trunk hash held, and weight saturation stayed zero. Because
no move was applied, public development exactly matched the source. The
required movement and strict training-NLL gates failed.

Public test, open generation, hidden evidence, and paid scaling remained
closed. This result rejects the single proposal-selected move. It does not show
that all eight ranked coordinates were guard-unsafe; a new experiment would
need exact two-surface selection across the whole candidate set. The
exact-check registration is
`examples/families/nsrl-direct-head-nll-guard-v1.retro.json`, binding NSRL merge
commit `316663b9ff1a0ec805f2f0218be683d75ad90e2d`.
