# Research step 9: matched Reasoner controls

The next Reasoner comparison now has an executable runner in
[Zero PR #236](https://github.com/atimics/zero-grounded-literary-lm/pull/236).
It puts all six arms on the same optimized executable and generates a new
family cohort. The local smoke and the new Linux/macOS CI jobs passed.

The source reviewed here is Zero commit
`24fae8ea8aa42212c7058b084b66dfa725672dfd`. Its
[plan](https://github.com/atimics/zero-grounded-literary-lm/blob/24fae8ea8aa42212c7058b084b66dfa725672dfd/benchmarks/reasoner55-matched-controls-v1/PLAN.md)
has SHA-256 `56fa7548cc1851a8811c19649813ed7dc277c5b38f8ca16777157341f49e185c`.
The
[smoke record](https://github.com/atimics/zero-grounded-literary-lm/blob/24fae8ea8aa42212c7058b084b66dfa725672dfd/benchmarks/reasoner55-matched-controls-v1/SMOKE.json)
has SHA-256 `e89e21d4004834827dcfa4edbb17d1602be75309214be6d6b5d5859e3e673c57`.
It binds the runner, model file, checks, replay code, and earlier source records.

The source archive has SHA-256
`b0746af0eff764e7548cd7543ebd6dff99285b1f424e897a0d68cb725192c8d0`
and contains 7,761,920 bytes. A fresh extraction built both implementations and
passed the complete four-family smoke. Reproduce it from the pinned commit:

```bash
python3 scripts/package_reasoner55_matched_source.py \
  --zero-repo /path/to/zero-grounded-literary-lm \
  --revision 24fae8ea8aa42212c7058b084b66dfa725672dfd \
  --output /tmp/reasoner55-matched-source-v1.tar
```

The builder reads committed bytes, checks every smoke source binding, and
writes a stable archive. Its tests cover a changed local checkout, changed
bindings, output preservation, and paths that leave the archive.

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
