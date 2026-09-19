# Research step 2: context and label diagnostics

Date: 2026-09-05

This is a diagnostic on opened public data. The plan was committed before
the calculation. The [result](RESULT.json) binds the plan, runner, dependency,
and ten source objects. Historical scores and decisions keep their original
meaning.

## Solomon: a simple context model beats the constant candidate

The candidate artifact has identical embeddings for every token. Its position,
attention, and feed-forward weights are zero. Its output head therefore gives
the same distribution for every input. Reconstructing that distribution
reproduces the historical loss of **25,347,655 millibits** exactly.

Two alpha-1 count models were fitted on the same 9,324 training targets. Both
use the original integer logarithm, exponent table, rounding, and loss rule.
Evaluation covers the original 5,896 targets.

| Method | Loss, millibits | Bits per target | Correct | Accuracy |
| --- | ---: | ---: | ---: | ---: |
| Historical candidate | 25,347,655 | 4.29913 | 903 | 15.32% |
| Smoothed unigram | 25,475,246 | 4.32077 | 903 | 15.32% |
| Smoothed previous-byte bigram | 23,806,501 | 4.03774 | 1,708 | 28.97% |

The bigram reduces loss by **6.08%** against the historical candidate. It uses
only the previous byte. This is a useful lower bound for the next integer
model's target.

Reversing the previous-byte input vector preserves its histogram and breaks
its alignment with each target. Under this control, the bigram changes 4,794
predictions, its loss rises to 35,452,385 millibits, and correct predictions
fall to 557. The candidate and unigram keep the same scores. This supports a
narrow mechanism finding: this partition contains useful local context, and
the bigram uses it.

**Failure recorded:** the historical candidate fails a context-use claim by
construction. Its good probability score measures a learned constant prior.
The next candidate should beat the integer bigram on fresh documents and
show a loss increase under a declared context control. Document families,
training bytes, smoothing, and gates should be fixed before that evaluation.

## FERAL: fourteen missing textual labels have recoverable source values

All 1,147 exported IDs and textual gold answers match the pinned original
FinQA test file. All fourteen empty textual answers have a numeric execution
answer and an arithmetic program. Independent rational arithmetic reproduces
**14 of 14** within the source's five-decimal precision.

The result lists each repair candidate with its ID, source value, program,
exact fraction, and precision check. A new benchmark version can use these
execution values after it fixes numeric units and percent conversion. The
original score remains **168 / 1,147**.

**Failure recorded:** the old text-answer field leaves fourteen rows without
a usable target. The source's execution field supplies a clear repair path.
Gold-program access belongs to this label audit. A retrieval-plus-calculator
comparison must infer its program from the question and retrieved evidence.

The next FERAL comparison should group by issuer, report evidence support,
and separate retrieval, program construction, arithmetic, and answer format.
These fields will make each failed answer useful for selecting the next fix.

## Shared lesson and next work

Both diagnostics separate the measured score from its cause. Each research
line now needs a simple baseline, a control that tests use of the proposed
signal, and a failure record that changes the next design.

Reasoner next needs a fresh-family comparison against the equally optimized
search baseline and a lexical control. ZERO.4 next needs matched training
arms for its replay projection on a fresh task. Weight multiplicity next
needs a controller that evaluates the final p99 resource gate while retaining
the separate hard timeout. These preparation steps can proceed while the
Solomon and FERAL follow-up contracts take shape.

## Verification

- Six unit tests cover the integer scorer, context control, artifact checks,
  rational arithmetic, source identity, and label precision.
- The historical candidate's integer loss and accuracy replay exactly.
- A second complete audit produces identical result bytes.
- The committed-result check binds source identities and replays every label
  calculation in ordinary CI.

Run `npm run test:research-context-and-labels` for the local checks. Rebuilding
the result also requires the source repositories and the original FinQA file
identified in the plan and result manifest.
