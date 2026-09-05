# Research step 9: matched Reasoner controls

The next Reasoner comparison now has an executable runner in
[Zero PR #236](https://github.com/atimics/zero-grounded-literary-lm/pull/236).
It puts all six arms on the same optimized executable and generates a new
family cohort. The local smoke and the new Linux/macOS CI jobs passed.

The source reviewed here is Zero commit
`9b00d88c1530e777d561c4f13f76087d3aa40740`. Its
[plan](https://github.com/atimics/zero-grounded-literary-lm/blob/9b00d88c1530e777d561c4f13f76087d3aa40740/benchmarks/reasoner55-matched-controls-v1/PLAN.md)
has SHA-256 `56fa7548cc1851a8811c19649813ed7dc277c5b38f8ca16777157341f49e185c`.
The
[smoke record](https://github.com/atimics/zero-grounded-literary-lm/blob/9b00d88c1530e777d561c4f13f76087d3aa40740/benchmarks/reasoner55-matched-controls-v1/SMOKE.json)
has SHA-256 `c37190c937ecca9942f692e7b562a0f462aea0b6167853944d39499b5db33f69`.
It binds the runner, model file, checks, replay code, and earlier source records.

## What exists

The runner covers target-only search, source-free local guidance, semantic
frequency, task guidance, raw lexical task guidance, and task guidance with
the prior feature removed. It preserves the fixed 1,863-byte guide.

The four-family engineering smoke ran all four source/tie views for each
family. Plain and fast implementations produced matching receipts for all
six arms. All 384 native episodes, including warmup, passed the exact checks.
The independent JavaScript search replay checked 96 measured rows.

The generator excludes earlier target behaviors and primitive sets from the
136 source/development families and the 128-family public comparison. It also
checks source-solution syntax and duplicates within the new cohort. The four
composition strata retain their original design. A separate smoke seed keeps
development checks apart from the planned cloud comparison.

Failed searches, child exits, timeouts, and missing models leave raw output
and terminal records. Warmup, family preparation, model loading, search work,
and complete process costs remain available. Failure-path tests use injected
errors and are labeled as engineering checks.

## Failure that drives the comparison

The [step 4 audit](../research-step-4/REPORT.md) found a task-versus-lexical
CPU ratio of 1.0046 in the original pipeline. The later optimization study
measured three arms. This new runner makes the lexical comparison primary
while applying those optimizations to all six arms.

The full plan has 128 families and 12 paired passes. Its primary effect needs
both CPU and verifier-work upper confidence bounds below one against the
lexical control. It keeps the other arm comparisons and all four strata in
the report. The existing failure remains in the shared ledger until a new
experiment supplies evidence about that mechanism.

## Next moves across the program

| Line | Concrete next move | Question it resolves |
| --- | --- | --- |
| Reasoner | Build the immutable cloud package for this six-arm runner. | Does semantic task guidance beat the lexical control at equal implementation quality? |
| Solomon | Add matched probability controls beside the current transformer and suffix-memory components. | Which part changes the chosen answer, and which part changes probability quality? |
| ZERO.4 | Implement the frozen-reference, task-only, replay, and replay-plus-projection comparison. | How much retention comes from projection at equal compute? |
| FERAL | Package the model and evidence-only calculator comparison with the revised target version. | Where does learned evidence use improve on a fixed arithmetic method? |
| Weight multiplicity | Freeze the revised resource policy and replay the original query trace. | Which inputs account for the costly tail, including completed work after a Hold? |

Each line now moves toward the same comparison: correct answers and their full
cost on unfamiliar inputs, with a strong simple control and a retained failure
record. Cloud packages still need their machine, compiler, watchdog, storage,
and cost bindings before compute approval.
