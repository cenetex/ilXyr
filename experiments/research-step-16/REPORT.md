# Research step 16: who chooses Solomon's answer

Suffix memory chooses every byte in the frozen combined candidate's standard
evaluation mode. The transformer supplies the confidence distribution. This
source finding explains the equal accuracy in the earlier component ablation
and changes the next experiment.

The independent reader matched **30 of 30 native predictions**. Sixteen windows
came from the opened evaluation file. Fourteen synthetic windows covered every
suffix lookup length and the frequency fallback. Each synthetic context appeared
with two different target bytes; all seven pairs kept identical output logits.

## The source mechanism

The candidate contains 9,388 training bytes in its stored suffix memory. For
each context, the lookup tries suffix lengths 16, 8, 4, 3, 2, and 1. It chooses
the most frequent continuation of the longest matching suffix, breaking ties
by byte value. A lookup with zero matches uses the most frequent stored byte.

The transformer head produces logits in the i16 range, from -32,768 to 32,767.
The reranker assigns `max(logits) + 1` to the memory's selected byte. That value
fits in i32 and is strictly larger than every other logit. The evaluator takes
the largest logit as its answer.

The claim covers successful forwards with the `mini-calibrated` feature, NOPE
positions, and the candidate's valid nonempty memory. The pinned source is
[NSRL commit 9632194](https://github.com/atimics/nsrl/blob/96321943e1da7b67bf6c9b4954ff14e6057ac433/crates/nsrl-train/src/lib.rs):
the standard forward path is at line 14974, memory lookup at 17379, reranking
at 17443, output-head conversion at 17476, and answer selection at 17751.
The mathematical claim comes from that source path. The small native smoke
checks its connection to the actual artifact and executable.

## Failure and the next design

The failed interpretation is that the frozen transformer's learned weights
improve the combined model's chosen answers. Suffix memory owns that decision
in this architecture. The existing promotion scores and the earlier
constant-context successor audit keep their own lineage and scope.

This narrows the useful fresh comparison:

- For the current artifact, compare native confidence with fixed smoothing and
  train-only suffix count probabilities. Keep answer counts, normalized Brier
  scores, zero-probability events, and complete work separate.
- For a learned accuracy claim, first introduce an architecture that can change
  the selected answer. Freeze that rule and the fresh corpus before evaluation.

This is a direct reason to change experiment selection: the source settles
answer ownership, while fresh documents can still test confidence quality.
The shared failure ledger now preserves this distinction.

The first audit attempt also failed. My independent model reader omitted the
candidate's 1,024-byte RMS normalization tail. The corrected reader counts the
tail from the layer shape and tests both accepted formats plus a malformed
length. [RESULT.json](RESULT.json) retains the original failed attempt and its
digest. It separates that reader mistake from the model mechanism.

## Reproduce and inspect

```bash
python3 scripts/test_solomon_answer_ownership.py
python3 scripts/research_solomon_answer_ownership.py \
  --nsrl-repo /path/to/nsrl \
  --out /tmp/solomon-answer-ownership-v1
```

The audit materializes committed bytes from NSRL revision
`96321943e1da7b67bf6c9b4954ff14e6057ac433`, then builds with locked offline
dependencies. [NATIVE.json](NATIVE.json) binds 75 source files, the executable,
compiler, inputs, raw logits, and native results. The model SHA-256 remains
`37acae6a4f763182730c76f762c351eda5bb37d6d197358c252733b1f08dca10`.

Ten checker tests, the 30-window native smoke, and the combined schema suite
passed. The existing evaluator performs one pass for its summary and another
for detailed output. Raw process receipts therefore cover 60 forward calls.
These local measurements serve engineering diagnosis. Cloud comparisons will
bind the shared machine and full cost separately.

## Where the five projects stand

The local review branch now contains the prepared steps 11 through 16 together.
The original branches and source-bound artifacts remain available. Publication
and live cloud work are pending.

| Line | Tangible result | Next decision |
| --- | --- | --- |
| Reasoner | Six matched arms, a fixed guide, fresh-family generator, independent replay, and a source archive. | Complete the machine and budget binding for the semantic-versus-lexical comparison. |
| Solomon | Exact confidence controls and a native check of answer ownership. | Test confidence against suffix counts; give a new accuracy candidate control over its answer. |
| ZERO.4 | Five retention arms with complete checkpoints and answer scoring. Its toy smoke keeps 5/5 oracle subscores beside 0/5 final artifacts. | Freeze fresh tasks and retention cohorts, with final-answer gates and equal work. |
| FERAL-7B | Full revised targets, fixed model and arithmetic controls, a controller, and a tested host package. | Refresh AWS access, complete live preflight, and review the proposed one-hour, $3 run. |
| Weight multiplicity | The real runner binds its resource policy and preserves completed work after a Hold. | Restore access to the original trace and replay its final-p99 decision before the next corpus package. |

The common question remains when learned state reduces the work needed for a
correct answer on unfamiliar inputs. Each comparison must give the learned
component a real opportunity to change the quantity being measured. Failures
then tell us whether to change the model, the measurement, or the execution.
