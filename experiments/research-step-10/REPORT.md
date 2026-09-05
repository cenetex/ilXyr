# Research step 10: Solomon confidence controls

Solomon now has an executable comparison that holds chosen bytes fixed while
changing confidence. [NSRL PR #57](https://github.com/atimics/nsrl/pull/57) adds
native probabilities, full confidence, and fixed smoothing to the evaluator.
It records the old error, exact normalized Brier score, and zero-probability
targets for each arm. Its Linux smoke passed in CI.

## Failure retained

The current combined candidate makes 2,482 mistakes on 5,896 targets. Its
reported probability error is 260,536,589. Putting full confidence on each
existing chosen byte gives an error of 162,655,388: a 37.5691% reduction with
every answer unchanged.

The score is distance from a one-hot target, scaled by 32,767. Full confidence
therefore has error `2 * 32767 * mistakes`. This is an analytic consequence of
the existing count and scorer. It exposes a limit of the measurement: a lower
score alone is insufficient evidence for better probability estimates.

| Component | Recorded mistakes | Recorded error | Full-confidence error |
| --- | ---: | ---: | ---: |
| Combined | 2,482 | 260,536,589 | 162,655,388 |
| Transformer only | 5,094 | 337,139,495 | 333,830,196 |
| Suffix memory only | 2,482 | 384,884,984 | 162,655,388 |

The original promoted artifact keeps its status and scores. This audit uses the
later `calibrated-v2-suffix-memory` artifact. The constant-context successor
examined in [step 2](../research-step-2/REPORT.md) belongs to an earlier source
revision; both findings retain their own lineage.

## Small native check

The checker evaluates 16 known windows spread across the existing evaluation
file. All three arms make four mistakes. It verifies all 48 probability vectors
with independent fraction arithmetic. Their mean Brier scores are 0.702257 for
native probabilities, 0.500000 for full confidence, and 0.459847 for fixed
smoothing. Their zero-probability target counts are two, four, and zero.

These are engineering checks on opened data. The next scientific comparison
needs a fresh corpus and complete inference costs. The current aggregate
records support full-confidence arithmetic; full-set native Brier scores need
new evaluation output.

The first checker assumed consecutive windows. The native evaluator spreads
capped windows across the file, so that check failed. The corrected checker
verifies the existing spread rule. The upstream report preserves this mistake
and the strict Clippy failure on existing dependency warnings.

## Evidence and checks

[RESULT.json](RESULT.json) is a byte-for-byte copy of the upstream smoke at
NSRL commit `96321943e1da7b67bf6c9b4954ff14e6057ac433`:

- Upstream path: `benchmarks/integer-transformer-proof-v1/probability-controls-smoke.json`.
- Result SHA-256: `2791ceff8223c576123eba84cadc3092412e8d0ad70dda85535550daa4902e53`.
- Model SHA-256: `37acae6a4f763182730c76f762c351eda5bb37d6d197358c252733b1f08dca10`.
- All 22 source bindings were checked against committed bytes during import.
- Four Rust tests and six altered-row rejection checks passed locally.
- The 16-window native smoke reproduced locally and passed on Linux CI.

The [upstream report](https://github.com/atimics/nsrl/blob/96321943e1da7b67bf6c9b4954ff14e6057ac433/docs/probability-controls-v1.md)
contains the reproduction commands and exact score definitions. The shared
ledger gains a measurement failure bound to this result. Earlier entries retain
their bytes and order.

## Program progress

Reasoner's [six-arm runner](../research-step-9/REPORT.md) merged through
[Zero PR #236](https://github.com/atimics/zero-grounded-literary-lm/pull/236) at
`977f7addac17762b22d55fe2acb6f3f62c507a94`. The matched-control check passed
on merged main. Its source archive remains bound to the reviewed PR commit.

The next Solomon package should compare all three confidence controls for the
combined, transformer-only, and suffix-memory-only models on the same fresh
corpus. ZERO.4 next needs its four-arm retention comparison. FERAL next needs
the model and calculator package with target version two. Weight multiplicity
next needs its frozen resource policy and original trace replay.

The shared rule is now more concrete: keep correct-answer counts, confidence
quality, and complete work as separate measurements. Each learned component
earns its role through a matched comparison on unfamiliar inputs.
