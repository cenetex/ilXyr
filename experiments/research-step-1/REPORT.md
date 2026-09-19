# Research step 1: results and next decisions

Date: 2026-09-05

The shared question is: **when does learned state reduce the work needed for
a correct answer on unfamiliar inputs?** Each project tests a different part
of that question. Exact checkers measure correctness. Simple models measure
how much work the learned component adds. Full cost includes preparation,
search, checking, and retained capability.

The [runner](../../scripts/research_baselines.py) checked 31 source objects
and calculated five compact diagnostics. The [result](RESULT.json) binds
every input, the fixed [plan](PLAN.md), and the runner. This step used existing
public records. Scientific outcomes retain their original dates and scope.

## Reasoner: bring the current evidence into the program

ilXyr's prior frontier stopped at Reasoner (3,9). The upstream line now has a
complete 5.0–5.4 series, fresh-family 5.5 work, and a 5.6 development result.
The first five runs contain two passes and three no-go results:

| Version | Decision | Constraint learned |
| --- | --- | --- |
| 5.0 | No-go | A target residual can weaken a useful source guide. |
| 5.1 | Pass | Exact semantic adaptation retained a useful source prior. |
| 5.2 | No-go | Aggregate gains need broad gains across individual families. |
| 5.3 | Pass | One fixed corruption model and source prior cleared the gate. |
| 5.4 | No-go | A one-check baseline leaves no measurable search headroom. |

The new audit matched all 36 paired point estimates in the 5.5 speed analysis
across 128 equally weighted families. The improved task guide has a CPU ratio
of 0.806779 against equally improved target-only search on that public cohort.
That is a 19.3% measured reduction on the recorded host. Its verifier-check
ratio is 0.940 with an interval that includes one in the source analysis.
The speed result and the semantic-transfer claim therefore remain separate.

Reasoner 5.6 retains its development search no-go and both channel-readiness
failures. The scientific decision is still open. In particular, the learned
channel retained the same candidate-set size as the prior at matched coverage.

**Next move:** freeze a fresh-family comparison of the improved guide,
equally improved target-only search, and lexical-role controls. Keep task
family as the independent unit. Use the current learned artifact unchanged.
Record both full runtime and verifier work, with per-family effects.

## Solomon: establish the simple baseline

The fixed alpha-1 smoothed unigram uses 9,324 training targets and scores all
5,896 public evaluation targets. Its top-one prediction is the space byte.
It gets 903 correct: **15.3155%**, exactly the recorded successor's top-one
accuracy. Its floating-point loss is 4.320969 bits per target.

Source inspection shows that the historical successor fits byte counts,
installs constant embeddings, and zeros attention and feed-forward weights.
The historical integer NLL result remains valid on its original objective.
The new floating-point likelihood is a separately named diagnostic.

**Constraint:** a frequency model can satisfy the old likelihood comparison.
**Next move:** place a smoothed unigram, a smoothed bigram, and a
context-sensitive learner on one common objective. Change context while
keeping targets fixed. Record which predictions and losses change. Freeze
future capability evaluation on new documents.

## ZERO.4: close the source check and design the comparison

All eleven bound source artifacts from EXP-004 and EXP-005 matched their
recorded SHA-256 values. The three result files agree with the family claim:

| Seed | Committed updates | Selected public replay regression | Promotion exact-artifact rate |
| --- | ---: | ---: | ---: |
| 1 | 600 | 1.0423% | 98.4% |
| 2 | 700 | 1.1833% | 99.6% |
| 3 | 600 | 1.2753% | 96.4% |

**Constraints:** local safety can accumulate into drift; stronger checks can
stop learning; changing step length can exhaust the same direction. Q2.6
changed the direction and passed the fixed family rule.

**Next move:** compare four arms on fresh task families: plain replay,
replay-gradient projection, projection with direct functional checks, and
projection with direct checks plus joint optimizer rollback. Keep model,
training bytes, seed set, task order, and compute equal. Select development
settings before the final family split opens. Report retained capability,
new-task accuracy, accepted work, rejected work, and total runtime. Record
the incremental value of each guard.

## FERAL: measure the error surface before another model run

The audit joined every input and prediction by unique ID and reproduced the
original score: **168/1,147 = 14.6469%**.

| Outcome | Questions |
| --- | ---: |
| Correct with a present gold answer | 168 |
| Empty gold answer | 14 |
| Numeric disagreement | 877 |
| Numeric gold with non-numeric output | 63 |
| Boolean error | 14 |
| Other answer error | 11 |

The original denominator remains 1,147. Accuracy on the 1,133 questions with a
present gold answer is a diagnostic 14.8279%. The corpus contains 100 issuer
groups; the largest contributes 65 questions. Future uncertainty estimates
should keep each issuer's questions together.

**Constraints:** the error surface includes label quality, answer format,
and numerical reasoning. The stored predictions also need confidence and
citation fields for support and abstention claims.

**Next move:** review the 14 empty labels against the fixed source data. On a
development panel, compare the base model, a strict answer-format control,
and retrieval plus an exact calculator. Keep the prompt and retrieval bytes
bound. Use fresh future and issuer splits for the later release decision.

## Weight multiplicity: preserve the measured tail and the wrapper failure

The latest completed measurement contains **26,624 calls**. Its p99 is
39.602666 ms. The frozen rule gives `ceil(p99 × 1.25) = 50 ms`.
Expected generation is 69.91 times the calibration size; the binding call
limit is 91.29 times that size. About 20.2% of calls returned values above
the accepted 0–31 label range, including all 50 slowest calls.

The measurement completed. A later shell-quoting error failed the wrapper.
The recovered records keep both facts. The old per-query Hold also stays in
the record: the same E7 query took 1,019.389 ms in the pilot and 754.776 ms in
calibration.

**Constraint:** the candidate stream spends substantial work on labels it
later rejects, and individual timings vary across runs.
**Next move:** finish the controller for the already proposed 50 ms final
p99 clause, with a separate 30-second hard abort. Preserve the candidate
distribution and the original call, query-time, wall-time, and memory caps.
Prepare a new frozen package and its cost for the next execution decision.

## Sequence and failure handling

1. Publish this shared baseline audit and update the program's current view.
2. Run the Solomon context diagnostic and FERAL label audit on existing data.
3. Prepare the ZERO.4 comparison and Reasoner fresh-family contracts.
4. Complete the weight-multiplicity controller checks and execution package.
5. Compare the next decisions with the constraints already recorded here and
   in the pathway map. A repeated failure should identify a changed mechanism
   or close that branch.

The open negative-knowledge work in ilXyr PR #151 provides the proposed
queryable constraint format. These records can feed that work after its
checks pass. This report keeps one explicit next step per line in the meantime.
