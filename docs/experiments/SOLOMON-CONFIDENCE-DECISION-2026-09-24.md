# Solomon confidence: decision after the fresh-document panel

Date: 2026-09-24. Scope: interpretation of the completed fixed panel, without
changing its registered rule or authorizing another run.

## Evidence

[Research step 51](../../experiments/research-step-51/REPORT.md) and its
[independent check](../../experiments/research-step-51/SOLOMON-CHECK.json) bind
the 384 windows from twelve documents, five confidence arms, 300 processes,
9,600 probability rows, 1,920 native forward calls, collection costs and
linked document groups. All methods selected the same bytes and made 261
mistakes. Equal-document normalized Brier errors are 1.071032 (native),
1.017686 (empirical suffix counts) and 0.883474 (smoothed suffix counts).

Inspection of the preserved per-document score fractions shows lower Brier
error for smoothed suffix counts than for both native and empirical counts on
each of the twelve documents. The panel's ten linked document groups, not its
overlapping windows or repeated processes, constrain inference. The earlier
opened sixteen-window diagnostic favored unsmoothed counts. Its reversal is
consistent with document shift and finite-count smoothing; this panel alone
cannot isolate which corpus property caused it.

The [NSRL substrate ablation](https://github.com/atimics/nsrl/blob/main/benchmarks/integer-transformer-proof-v1/component-ablation.json)
answers a different question with Q15 probability error on an already-opened
fixture. Its combined profile includes fitted suffix memory. That metric and
this panel's Brier scores are not pooled or substituted for each other.

## Decision

**Change the reference for the next confidence design to smoothed suffix
counts.** Keep the frozen native checkpoint and complete receipts as controls.
Do not fund another identical five-arm panel to reconfirm the opened ordering.
The observed confidence difference did not change a selected byte, so it does
not support an answer-accuracy claim or model promotion.

The next proposed mechanism must state whether it can change (a) the chosen
byte, (b) probability quality at a fixed byte, or (c) whole-process inference
cost. Compare the corresponding outcome to the appropriate simple control.
Use the saved document differences to identify a specific uncertainty first;
if none changes a decision, stop here. Any new experiment freezes its roster,
grouping, scoring, costs and decision rule before observing fresh outcomes.

Owning backlog: [#171](https://github.com/cenetex/ilXyr/issues/171).
