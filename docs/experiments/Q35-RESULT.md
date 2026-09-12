# Q3.5 result — sparse random-feature semantic probe

- Status: completed, **`feature_no_go`**
- Zero repository: `atimics/zero-grounded-literary-lm`
- Source commit: `cb57a0170b17bcdacaab67efb95ca04233a6a3cd`
- Zero PR: https://github.com/atimics/zero-grounded-literary-lm/pull/240
- ilxyr preregistration: [`Q35-SPARSE-SEMANTIC-HEAD-PREREGISTRATION.md`](Q35-SPARSE-SEMANTIC-HEAD-PREREGISTRATION.md)
- Scope: feature-level diagnostic. No package, canonical, runtime, language, or
  promotion claim.

This is an upstream result recorded from the Zero repository. It is not an
ilxyr-prospectively-registered experiment and carries no ilxyr ledger
authority. It is reported here so the research pathway map can account for it
without rewriting chronology.

## What ran

The Q3.5 preregistration was executed exactly once at the frozen commit. One
feature extraction over the Q3.4 `mixed-training.tok` trained three heads:

- **sparse** — ReLU(P x) with top-307 winner-take-all over 6,144 expanded units;
- **dense** — ReLU(P x) with no winner-take-all;
- **linear** — the unchanged Q3.4 1,536-to-5 head.

The projection is a frozen ternary {-1, 0, +1} matrix, 6,144 × 1,536, density
1/10, SHA-256 `efdf4306…`.

## Result

| Arm | Features | Update 100 accuracy | Per class | Feature gate |
| --- | --- | ---: | --- | --- |
| linear | 1,536 raw | 0.416 | 0.01 / 0.08 / 0.49 / 0.92 / 0.58 | fail |
| dense | 6,144 ReLU(P x) | 0.200 | all one class | fail |
| sparse | 6,144 ReLU(P x) + WTA | 0.200 | all one class | fail |

The linear arm reproduced Q3.4's recorded result exactly (cross-entropy
1.3289, accuracy 0.4160, identical per-class vector), validating the harness.
Both expanded arms sat at chance with cross-entropy pinned to ln(5) and
collapsed to a single predicted class.

## Mechanism

A post-hoc, exploratory diagnostic measured the expanded code on 500 holdout
records:

| Quantity | Raw | Expanded post-ReLU |
| --- | ---: | ---: |
| mean | 0.0031 | 4.8783 |
| std | 1.0000 | 7.1832 |
| nonzero fraction | — | 0.4967 |

Across-record coefficient of variation of unit means: 1.1214.

The expanded code is healthy and informative. The failure is an
**optimization-scale interaction**, not a representational limit: the frozen
unit-entry projection produces features about 7× the raw scale over 4× the
inputs, and the unchanged **global gradient-norm clip** in `q32_head_update`
suppresses every step, leaving the 30,725-parameter head at uniform logits.

## What this does and does not close

- It closes the frozen Q3.5 intervention: as specified, sparse random features
  do not unlock semantic routing at this optimizer.
- It does **not** close the fly-brain architecture family, because the active
  constraint is now identified as scale and clipping rather than the sparse
  code itself.
- It leaves Q3.4's semantic gap open. The raw features do carry signal at the
  current exposure (41.6%), so the gap is not pure undertraining.

## Recorded next boundary

Two separately registrable interventions:

1. **Fan-in scaled projection.** Scale P by 1/sqrt(154) so post-ReLU
   activations have unit scale, with the optimizer unchanged. Tests the
   architecture without touching the optimizer.
2. **Per-parameter clipping.** Keep the unscaled projection and replace the
   global clip. Isolates the optimizer interaction.

A go on either opens the packaging experiment that carries the projection into
the runtime and runs the unchanged Q3.4 package gates.

## Governance note

This result should be imported into ilxyr as an upstream evidence record rather
than registered as a prospective ilxyr experiment. The frozen Q3.5
preregistration and its outcome are preserved in the Zero repository; the
ilxyr ledger should not imply that this run carried ilxyr forecast or funding
risk.
