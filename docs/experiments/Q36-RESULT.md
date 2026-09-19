# Q3.6 result — projection-scale and gradient-clip factorial probe

- Status: completed, **`feature_no_go`** for all three hypotheses
- Zero repository: `atimics/zero-grounded-literary-lm`
- Execution source commit: `8f048aab1f922e65abfbebef86f200e84ab528cd`
- Zero PR: https://github.com/atimics/zero-grounded-literary-lm/pull/240
- Zero preregistration: `benchmarks/zero4-q36-factor-probe-v1/PREREGISTRATION.md`
- Scope: feature-level diagnostic. No package, canonical, runtime, language, or
  promotion claim.

Upstream result recorded from the Zero repository. Not an ilxyr-prospectively-
registered experiment; it carries no ilxyr ledger authority.

## What ran

Eight expanded arms form a 2 × 2 × 2 factorial: features {dense, sparse} ×
scale {unscaled, fan-in} × clip {global, per-parameter}. A ninth arm is the
linear reference. All use the Q3.5 frozen representation, one feature
extraction, seed 2, and 100 updates. The linear reference reproduced Q3.4
exactly (0.416).

## Result

Every expanded arm scored 0.200 (chance) at update 100; the linear anchor
scored 0.416.

- H-scale (fan-in scaled projection, global clip): **not supported**
- H-clip (unscaled projection, per-parameter clip): **not supported**
- H-interaction (both): **not supported**

## Decisive observation

For the sparse arm, `global` and `per-parameter` clipping produced
**byte-identical head-state digests at every measurement**. Both clips are
inactive: the expanded-arm gradient norm is below 1 and every element is below
1. Clipping is not the constraint because neither clip engages; the expanded
heads move only through tiny, inconsistent gradients and Adam stalls.

## Class-separability diagnostic

A post-hoc nearest-centroid diagnostic (means from 1,000 records, test on the
500-record semantic holdout):

| Features | Accuracy |
| --- | ---: |
| raw 1,536 | 0.300 |
| dense unscaled | 0.332 |
| **sparse unscaled** | **0.420** |
| dense fan-in | 0.328 |
| sparse fan-in | 0.416 |

The sparse winner-take-all code has the highest observed nearest-centroid
accuracy in this diagnostic: 42.0%, compared with 30.0% for raw features. It
also approaches the gradient-trained raw head's 41.6%. This comparison measures
one readout, sample, and split. Establishing the best achievable linear score
would require additional fitting and independent evaluation.

## Supported conclusion

The eight registered expanded arms missed the 80% semantic gate at this
exposure. Scale and clipping changes left their accuracy at 20%. The 42%
centroid result is an observed score; the achievable accuracy of other
readouts remains an open empirical question.

## Recorded next boundary

A bounded comparison of centroid, regularized linear, and ridge readouts can
help separate fitting quality from representation quality. Choose settings on
a development split and freeze them before testing fresh examples. A later
representation or exposure experiment should use that fitted reference and
the same cost accounting.

## Governance note

Import as an upstream evidence record. `diagnostics.json` and
`separability.json` are post-hoc, exploratory, and did not change the recorded
decision.

## Source verification

The [result](https://github.com/atimics/zero-grounded-literary-lm/blob/b00574b21ddeac22e378aebc04157330110f959c/benchmarks/zero4-q36-factor-probe-v1/seed2/result.json)
and [centroid diagnostic](https://github.com/atimics/zero-grounded-literary-lm/blob/b00574b21ddeac22e378aebc04157330110f959c/benchmarks/zero4-q36-factor-probe-v1/seed2/separability.json)
were checked on 2026-09-19 at evidence commit `b00574b21ddeac22e378aebc04157330110f959c`.
Upstream PR #240 was open. Its historical interpretation calls 42% a ceiling;
this summary limits the conclusion to the measured readout and sample.
