# Research step 17: retention by source

ZERO.4's five-arm runner now records loss and scored windows for each retention
source, its change from the initial model, and the largest source regression.
The native evaluator collects these values during the existing forward passes.
The controller checks source order, identity, kind, weight, coverage, and
agreement with the combined mean.

This closes a measurement gap before the next fresh-task comparison. A single
mean can stay steady while one source loses capability. The new fields make
that case visible and give the next study a place to apply declared source
limits.

## Evidence that changes the design

The existing Q2.9 result provides a separate reason to keep an independent
language screen. Its first-hit selector stopped at update 50 after quantity
training loss improved 81.0518% and replay training loss rose 0.12325%. The
selected candidate passed that training-side rule. Its later language screen
resolved no-go:

| Measure | Recorded value | Frozen threshold | Decision |
| --- | ---: | ---: | --- |
| BLiMP correct choices | 535/1,000 | At least 522/1,000 | Pass |
| TinyStories bits per byte | 2.579735 | At most 2.553140 | Fail |

The audit checked the candidate's 4,920,400 bytes against its frozen digest,
the quantity-to-language binding, the gate contract, and the result manifest.
It decoded the saved BLiMP correctness bits and all 1,000 TinyStories score
rows. Independent arithmetic reproduced 535 correct choices and the weighted
TinyStories score over 509,034 target bytes.

The [source result](https://github.com/atimics/zero-grounded-literary-lm/blob/95a35e2e02a8f5e3cedf3b9ecce66f0ce45ad377/benchmarks/zero4-q29-v1/language-gate/results/result.json)
retains the later language failure. The earlier quantity record keeps its
candidate-frozen decision. The shared failure ledger now links both stages.
The raw training checkpoint remains represented by its recorded digest; this
audit verified the quantized candidate used by the language gate.

## Native checks and retained mistakes

Eleven focused checks and the 35-check native self-test passed. A controlled
fixture keeps the mean at one while doubling one source's loss; its reported
worst-source regression is 100%.

A mixed native probe covers foundation, text, and channel inputs with weights
one through six. Every source loss exactly matches a separate evaluation of
that source. A request for thirteen windows across six sources scores twelve
under the existing balanced sampler. Both requested and actual counts are
now retained.

The complete five-arm smoke passed 79 native processes. All sixteen scored
training checkpoints remain available. All four active arms still match the
historical trainer's final checkpoint bytes, including optimizer and RNG state.
The toy comparison keeps its earlier 5/5 oracle arithmetic, 0/5 final artifacts,
and inactive projection during four training attempts.

The first mixed-source fixture failed because two UTF-8 files contained bytes
above the toy model's 128-token vocabulary. The corrected fixture uses fixed
ASCII strings. [DEVELOPMENT-FAILURE.json](DEVELOPMENT-FAILURE.json) retains the
failed process and stderr digests. This fixture mistake has its own record.

## Bound source and next move

[SMOKE.json](SMOKE.json) is copied from Zero commit
`973fe8f6c956366bff267e65dceae58b851f7881`. Its SHA-256 is
`284d9da82f27e7aad6a867e11813505a4e7854714d4debe8228307a01c4752d9`.
All nineteen implementation bindings and six historical evidence bindings
were checked. [RESULT.json](RESULT.json) retains those checks and the Q2.9
arithmetic. The original trainer and shared Makefile retain their frozen bytes.

Next, freeze fresh task and retention cohorts with overlap checks, source
limits, and a separate language screen. Keep final-answer gates and complete
work in the comparison. The existing training guard continues to use its
historical six-slice mean.

Across the program, the measurement rule is becoming clearer: identify who
chooses the answer, measure complete answers and their cost, and inspect what
each source loses. Reasoner's matched search controls, Solomon's answer
ownership, FERAL's arithmetic controls, and the oracle resource trace all
serve that same question.
