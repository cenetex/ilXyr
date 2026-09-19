# Research step 2: context and label diagnostics

Date: 2026-09-05

This step follows the public baseline audit. It is a post-hoc diagnostic on
already opened records. It preserves every historical score and decision.

## Solomon

Read the historical candidate artifact and verify its constant embeddings,
zero position, attention, and feed-forward arrays, and output-head shape.
Reconstruct its constant logits and reproduce the recorded canonical integer
likelihood exactly.

Fit alpha-1 smoothed unigram and previous-byte bigram distributions on the
same 9,324 training targets. Quantize log-counts with the original integer
logarithm and score all 5,896 evaluation targets with the original Q15
exponent table and millibit objective. Break prediction ties by byte order.

For the context control, reverse the vector of previous-byte inputs while
preserving target order. This keeps the context histogram fixed. Report the
full loss, top-one accuracy, changed predictions, and the context-control
loss for both baselines and the historical constant candidate. This audit
measures context evidence in the old public partition; new scientific claims
use fresh documents.

## FERAL

Read the original FinQA test file at revision
`0f16e2867befa6840783e58be38c9efb9229d742` and require its recorded SHA-256
`831dbfb2e785dbc227f895ce3f24046433467aec67b09db2bd6ac7692a8a30dc`.
Join it with the frozen FERAL inputs by unique ID. For each empty textual gold
answer, inspect its executable answer and independently run its gold program
with rational arithmetic. Record exact rational results and agreement within
the source answer's five-decimal precision. Keep this gold-program replay
separate from a predictive calculator baseline.

Output the fourteen label-repair candidates with source identity and numeric
units marked for a new benchmark version. Preserve the original 1,147-row
score and prompt bytes. Later retrieval-plus-calculator work must infer its
own program from the supplied evidence.
