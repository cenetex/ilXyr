# Solomon answer ownership audit

This is a source audit and a small engineering smoke on opened data. The source
is NSRL commit `96321943e1da7b67bf6c9b4954ff14e6057ac433`, with the unchanged
`calibrated-v2-suffix-memory` candidate. Its memory stores training bytes.

The source puts suffix memory's selected byte one logit above the output head's
maximum. The head produces i16 logits and the reranker uses i32, so adding one
stays within range. A valid nonempty memory returns a byte even when every
suffix lookup misses: the fallback uses the most frequent stored byte.

The audit checks this mechanism against an independent memory reader and native
output. It covers sixteen known evaluation windows and fourteen synthetic
windows. The synthetic windows cover suffix lengths 16, 8, 4, 3, 2, 1, and the
frequency fallback. Each context appears with two different target bytes.
Native predictions and logits must agree across each target pair.

Build committed source with the locked offline dependencies and the same
`mini-heads-8,mini-calibrated` features. Use linear attention and NOPE positions.
Retain input, source, executable, logit, and result hashes. A failed build or
probe keeps its phase, outputs, and process record. Local process measurements
serve failure diagnosis; the smoke supplies engineering evidence.

This audit decides how to frame the fresh comparison. If suffix memory owns the
chosen answer, fixed-answer probability quality is the current transformer
question. An accuracy study then needs a candidate that can change the answer.
Existing promotion records keep their scope and scores.
