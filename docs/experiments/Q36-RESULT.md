# Q3.6 result — projection-scale and gradient-clip factorial probe

- Status: completed, **`feature_no_go`** for all three hypotheses
- Zero repository: `atimics/zero-grounded-literary-lm`
- Source commit: `8f048aab1f922e65abfbebef86f200e84ab528cd`
- Zero PR: https://github.com/atimics/zero-grounded-literary-lm/pull/240
- Zero preregistration: `benchmarks/zero4-q36-factor-probe-v1/PREREGISTRATION.md`
- Scope: feature-level diagnostic. No package, canonical, runtime, language, or
  promotion claim.

Upstream result recorded from the Zero repository. Not an ilxyr-prospectively-
registered experiment; it carries no ilxyr ledger authority.

## What ran

A 3 × 3 factorial over the Q3.5 frozen representation, one feature extraction,
seed 2, 100 updates: features {linear, dense, sparse} × scale {unscaled,
fan-in} × clip {global, per-parameter}. Linear anchor reproduced Q3.4 exactly
(0.416).

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

The sparse winner-take-all code is the **most linearly separable**
representation tried, and a trivial nearest-centroid readout on it matches the
gradient-trained raw linear head (0.416). The representation carries class
signal; the gradient-trained head is what fails.

## What this closes

The fixed-random-feature family, at this exposure. Neither projection scale nor
gradient clipping changes the outcome, the sparse code is linearly at least as
good as the raw features, and a perfect simple readout on it is ~0.42 — far
below the 0.80 semantic gate. The gap is in the frozen representation and/or
the training exposure, not the readout architecture.

## Recorded next boundary

The 0.80 semantic gate needs a representation or supervision change, not a
larger random readout. A further fly-aligned probe would be a closed-form
readout (nearest centroid or ridge) on the sparse code to remove the Adam
pathology, but this diagnostic already estimates its ceiling at ~0.42, so it is
lower priority than a representation or exposure experiment.

## Governance note

Import as an upstream evidence record. `diagnostics.json` and
`separability.json` are post-hoc, exploratory, and did not change the recorded
decision.
