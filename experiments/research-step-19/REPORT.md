# Research step 19: Solomon suffix-count probabilities

Solomon now has two executable probability controls built from its stored
training bytes. They keep the frozen candidate's chosen answer and expose a
useful tradeoff: empirical counts give lower Brier error on the small known
fixture, while smoothing supplies probability to targets absent from the
matched suffix counts.

The native smoke evaluates the same sixteen previously opened windows as the
earlier confidence check. Every arm makes four mistakes.

| Probability rule | Mean Brier error | Zero-probability targets |
| --- | ---: | ---: |
| Native combined model | 0.702257 | 2 |
| Full confidence | 0.500000 | 4 |
| Fixed smoothing | 0.459847 | 0 |
| Empirical suffix counts | 0.436361 | 4 |
| Suffix counts with one total prior observation | 0.494994 | 0 |

These are engineering observations on opened data. A fresh document
comparison will test whether the learned confidence earns its cost against
the count controls. The current smoke shares native forward calls and checks
probability arithmetic; each arm's complete inference cost belongs in the
next frozen package.

## The two controls

Both rules use the candidate's 9,388 stored training bytes. They try suffix
lengths 16, 8, 4, 3, 2, and 1, count overlapping continuations, and select the
longest suffix with a continuation. The fallback counts all stored bytes.
Ties select the lowest byte. The model reader checks that the stored memory
matches the training-file prefix.

For continuation count `c` and total matches `N`, the empirical probability
is `c / N`. The smoothed probability is `(256*c + 1) / (256*N + 256)`. This adds
one observation of total prior mass, spread evenly across the 256 byte values.
Integer masses and fraction arithmetic preserve exact probabilities. Targets
enter the scorer after each distribution has been computed from training
bytes and context.

The independent reader and native predictions agree on every chosen byte.
All forty-eight native probability vectors pass the frozen upstream checker.
The two added controls supply another thirty-two vectors. Brier error uses
probabilities normalized by their actual mass, including the native Q15
rounding. The score sums squared distances across all 256 byte values.

## Failure retained

The empirical rule assigns zero probability to four observed targets.
The uniform prior removes those zeros, while its mean Brier error rises from
0.436361 to 0.494994. Both outcomes remain in the report. This is a reason to
keep probability quality and zero-probability events separate in the next
study. The rules stay fixed while the fresh corpus and complete cost package
are prepared.

Seven focused tests passed. They cover overlapping matches, terminal suffixes,
ties, fallback, prior mass, independently expanded Brier arithmetic, altered
native rows, and retained source failures. A failed source fixture keeps its
terminal record; a repeated output path preserves the first attempt.

## Evidence and reproduction

[RESULT.json](RESULT.json) binds the implementation at
`ae5b8639c051d3f10c98d1cfc017104c62ab3f00` and four source files.
[NATIVE.json](NATIVE.json) preserves the native result, exact fraction scores,
compiler identity, executable digest, and 76 upstream source bindings at NSRL
commit `96321943e1da7b67bf6c9b4954ff14e6057ac433`.
[WINDOWS.json](WINDOWS.json) keeps every window's nonzero training counts,
chosen byte, target, suffix order, and exact score. Expanding each sparse count
record to 256 entries reconstructs the full saved count vectors.

```bash
python3 scripts/test_solomon_suffix_probabilities.py
python3 scripts/research_solomon_suffix_probabilities.py \
  --nsrl-repo /path/to/nsrl \
  --out /tmp/solomon-suffix-probability-smoke
```

Use a fresh output directory. The runner reads committed upstream bytes,
builds with locked offline dependencies, and saves build and native-process
receipts. The native evaluator performs two passes over the sixteen windows,
for 32 forward calls. The integrated schema and research test suite passed.

The [program decision map](../research-step-18/REPORT.md) still applies. For
Solomon, the next deliverable is now the fresh-document roster and the package
for all five confidence arms. The earlier answer-selection and measurement
failures retain their original scope in the shared ledger.
