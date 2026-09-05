# Research step 1: shared baseline audit

Date: 2026-09-05

Question: what useful work does each learned component add when the input,
simple baseline, exact checker, and full cost are held clear?

This is a read-only diagnostic of published evidence. Each source revision
and input digest is recorded in the result. The original experiment decisions
keep their original meaning. A new scientific run gets its own contract.

## Measurements fixed before calculation

1. **Reasoner:** import the complete 5.0–5.4 series, including every no-go;
   check the 5.5 analysis bindings and independently recompute its paired
   family ratios. Carry the 5.6 development failures into the next-step record.
2. **Solomon:** fit one byte-frequency baseline with additive smoothing
   alpha = 1 on the historical training bytes after the 64-byte context.
   Score every historical evaluation target. Use floating-point log loss in
   bits and exact top-one accuracy. Keep the historical integer likelihood
   metric under its own name. Report the context-free behavior established
   by the pinned trainer as a source inspection finding.
3. **ZERO.4:** verify every bound replication result and extract the three
   seeds' retained capability, replay regression, and update counts. Prepare
   a comparison of plain replay, replay projection, direct checks, and joint
   rollback on fresh tasks. The next run must use matched input and compute.
4. **FERAL:** verify and join the published 1,147 inputs and predictions by
   unique ID. Reproduce the original score. Count empty gold answers, wrong
   numeric answers, boolean errors, and output-shape errors. Keep the original
   denominator. Report valid-gold accuracy separately as a diagnostic.
5. **Weight multiplicity:** verify the tail-calibration closeout and its plan
   bindings. Recompute the proposed p99 limit and corpus-scale ratios. Report
   the measured result and the wrapper failure separately. Prepare the
   existing resource-clause decision with its exact measured limit.

## Shared record

Each line records its present evidence, the constraint learned from failure,
the next mechanism to test, and the remaining execution boundary. The result
is a navigation and diagnostic record. Historical forecast and promotion
records remain attached to their original experiments.

The runner reads exact Git objects and local checked-in evidence. It uses
the Python standard library. It performs arithmetic and small diagnostics on
existing records. Scientific training and cloud execution use later steps.

## Reproduce

```sh
python3 scripts/research_baselines.py \
  --zero-repo /path/to/zero-grounded-literary-lm \
  --nsrl-repo /path/to/nsrl \
  --feral-repo /path/to/runner-watch \
  --output experiments/research-step-1/RESULT.json
python3 scripts/test_research_baselines.py
```
