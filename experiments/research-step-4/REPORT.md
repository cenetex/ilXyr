# Research step 4: keep mechanism claims tied to controls

Date: 2026-09-05

The [result](RESULT.json) checks existing public evidence from thirteen pinned
source objects. The [plan](PLAN.md) was committed before calculation. This
step recomputes paired costs and audits optimizer traces.

## Reasoner: the semantic control is the next important comparison

The original 5.5 fixed-transfer cohort contains 128 families with four paired
settings each. These are point estimates from the original pipeline. The
later optimized speed comparison remains a separate measurement.

| Task guide compared with | Verifier-cost ratio | CPU ratio | Families won / tied / lost by verifier cost |
| --- | ---: | ---: | ---: |
| Target-only search | 0.9398 | 1.4580 | 65 / 0 / 63 |
| Source-free local guide | 0.8252 | 1.2044 | 78 / 0 / 50 |
| Semantic frequency | 0.9080 | 1.0203 | 76 / 4 / 48 |
| Raw lexical guide | 1.0062 | 1.0046 | 58 / 14 / 56 |
| Prior feature removed | 0.9785 | 1.0061 | 66 / 16 / 46 |

Ratios below one favor the task guide. Verifier costs use `(checks + 1)`.
Timing uses per-episode medians over the twelve recorded passes. Each family
has equal weight. The full result preserves every family and all four cells.

The task guide and lexical control are close on both measures. Removing the
source-prior feature changes verifier cost by about 2.2%. The learned guide
has value as a search policy; these controls make the specific contribution
of semantic source transfer a separate question. The next comparison should
apply the same hashing and sorting improvements to all six arms, then test
a fresh family cohort with the model fixed. Its decision should cover CPU,
verifier work, exact answers, and the semantic control together.

**Failure retained:** the original pipeline's lower verifier count came with
higher paired CPU cost against source-free search. The later engineering
work improves that cost. Both measurements belong in the record.

## Later Reasoner results and a report mismatch

The current 5.8 machine record has sixteen families and a
`measurement-floor` decision. Its full/source-free point ratio is 1.1040.
The prose file describes twelve families and a different earlier ratio.
Both files are pinned in this audit. The machine record supplies the current
values here; the prose needs a source-linked correction upstream.

This corrects the earlier progress note, which used the twelve-family prose.

The 5.9a record has sixteen families, a 0.6312 point ratio, and a one-sided
upper ratio of 1.0232. Its decision remains `no-go`. The failed gates include
the upper confidence limit, family win lower bound, required strata,
mechanism effects, and derangement randomization. The latter p-value is
0.375. These records point to better controls and task design before another
sealed transfer claim.

## ZERO.4: measure projection against ordinary replay

The three optimizer traces reproduce every recorded guard count.

| Seed | Accepted updates | Projected trials | Mean removed fraction on projected trials | Direct replay slice evaluations |
| --- | ---: | ---: | ---: | ---: |
| 1 | 600 | 335 | 3.23% | 3,600 |
| 2 | 700 | 423 | 3.67% | 4,200 |
| 3 | 600 | 326 | 3.23% | 3,600 |

All 1,900 trials committed at full scale. The projection changed 1,084 of
them. Every trial received six direct replay slice checks. Each seed keeps
its original `go` decision.

This gives a useful mechanism target: small direction changes accompanied
successful acquisition and retention. A matched control is needed to measure
their contribution. The next fresh-task design has four arms:

1. The frozen initialization as a reference.
2. Continuation on the new task.
3. Continuation with ordinary replay.
4. The same replay with projection and direct cumulative checks.

The three training arms should share initialization, task examples, optimizer
settings, seeds, and an outer compute cap. Record task bytes, replay bytes,
gradient work, every rejected trial, direct checks, and total runtime for each
arm. Compare learning and retention at equal compute as well as equal update
counts. The frozen reference has zero training cost.

Use fresh task families for the new comparison. Fix selection on development
data, then evaluate the selected artifacts once on a separate final set.
Report each replay slice beside the existing aggregate retention measure.

## What unifies the next work

Every line now has the same three questions: which signal does the model use,
what simple method could explain the score, and what does each failed attempt
cost? Solomon's context control, FERAL's label audit, Reasoner's semantic
control, ZERO.4's replay comparison, and weight multiplicity's full call
accounting give concrete ways to answer them.

Four unit tests cover paired identity, exactness, time validity, and rejected
projection-trial accounting. A second complete audit produces identical
bytes. CI checks the committed result bindings and arithmetic.
