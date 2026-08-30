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

## Exact safe-set follow-up

The next prospectively frozen run tested the full ranked safe set instead of
accepting or rejecting only the first proposal winner. For all eight ranked
output-weight coordinates, it measured both unit directions exactly on the
complete 64-window proposal and different-document 32-window guard surfaces.
A move was safe only if it strictly improved proposal NLL without worsening
guard NLL. The source remained an explicit candidate.

All eight coordinates had one proposal-descent direction. The improvements
ranged from 48,929 to 61,290 Q20 units, but all eight directions worsened guard
NLL, by 578 to 963 Q20 units. Six reverse directions improved the guard while
worsening the proposal; the other two worsened both. The safe set was empty,
so the source was retained in round zero with zero moves and zero saturation.
Independent runs reproduced model and trace bytes exactly.

The private training gate failed its movement and strict-improvement rules.
Public development, public test, open generation, hidden evidence, and paid
scaling remained closed. This establishes local proposal/guard anti-alignment
for both unit directions of the eight tested coordinates. It does not rule out
a wider coordinate set, a joint move, or a different training surface. The
exact-check registration is
`examples/families/nsrl-direct-head-nll-safe-set-v1.retro.json`, binding NSRL
merge commit `241424758a4d84f7cb1fa89aab3f622283aa2623`.

## Cross-document stability audit

The prospectively frozen next step tested whether any of the eight earlier
proposal-descent directions was stable beyond the proposal and guard pair. It
made no model update. Instead, it measured each fixed direction on the first 32
complete 64-token windows of training documents 2 through 9. Those eight
documents were new to this direct-head lineage. A direction counted as stable
only if it strictly improved at least six documents and had positive aggregate
NLL improvement.

Both complete runs produced the same 64-cell trace bytes. Seven directions
were mixed, improving three or four documents and regressing on the rest.
Coordinate 8,310 with delta -1 improved two documents and regressed on six.
Every direction had negative aggregate improvement, from -1,925 to -3,607 Q20
units. The stable set was empty. The source model and frozen-trunk hashes stayed
unchanged.

The frozen gate therefore does not support a joint move or another follow-up in
this coordinate family. Public development, public test, open generation,
hidden evidence, larger-model execution, and paid scaling remained closed. The
result shows that all eight earlier proposal descents were document-specific;
it does not rule out the wider head or a different training method. The
exact-check registration is
`examples/families/nsrl-direct-head-cross-document-stability-v1.retro.json`,
binding NSRL merge commit `bc7701b94b8c6a0bb27c426df77cb7c5289c8adb`.
