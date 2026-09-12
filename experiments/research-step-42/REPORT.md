# ZERO.4: separate replay and retention windows

The native trainer now accepts explicit text windows at the existing
512-token context. The prepared data contains 81 final retention windows and
577 replay windows across the six original sources. Every window contains
512 input tokens and their next-token targets, stored as 513 consecutive tokens.
All 658 windows pass native input checks and a separate source-origin check.

| Source | Final retention windows | Replay windows |
| --- | ---: | ---: |
| Foundation | 1 | 1 |
| Shakespeare | 16 | 128 |
| Blake | 16 | 64 |
| Crowley | 16 | 128 |
| KJV | 16 | 128 |
| Literary dialogue | 16 | 128 |

The opened native test runs all five methods: frozen weights, task only,
replay, replay with the guard, and replay with the guard and projection.
Every original window loss matches the older evaluator on identical inputs.
The raw-source path preserves complete checkpoint bytes and sampling records
for all four training methods. Linux and Mac checks pass. Address and undefined
behavior checks also pass locally. These checks use a small synthetic model.
Production-teacher forward passes and new paid instances are zero.

## The failed capacity assumption

The first plan assigned Blake 16 final windows and 128 replay windows. At
513 tokens each, disjoint windows would require 73,872 tokens. The source
contains 65,811. [CAPACITY-FAILURE.json](CAPACITY-FAILURE.json) retains this
failure before any candidates were selected.

[PLAN-v2.json](PLAN-v2.json) keeps all 16 Blake final windows and fixes its
replay quota at 64. That revision was committed as
`ff3efabbd9716012cbd0579f9ea522b79434d583` before selection. The original
[PLAN.json](PLAN.json) remains available.

## What is separate, and what was seen earlier

The final windows come from the original training partitions. They may have
trained the initial teachers. That is the capability this retention test asks
the student to preserve during new adaptation. The final windows stay separate
from all new replay windows, the declared Q2.6 evaluation windows, and the
step 41 task-training text under the checks described below.

Selection retains 1,043 candidate decisions: 658 accepted, 379 rejected for
shared source positions, five rejected for shared selected text, and one
repeated candidate start. The complete decision sequence replays exactly.
A separate checker reads the original token files, checks each origin and pack,
sorts intervals to detect shared positions, and checks exact 64-character
text spans after case and spacing normalization. All selected windows are
separate under those checks, including comparisons across the six sources.
Shorter shared phrases and semantic similarity remain coverage questions.

Foundation's final window covers source positions 199 through 711. Its replay
window covers positions 836 through 1348. Both retain the 512-token model
context. The new explicit reader makes each complete window a valid input,
which resolves the older reader's minimum-length requirement for two internal
partitions in every file.

Replay can use the whole original source. Twenty-seven selected replay windows
touch the old validation partitions, including the foundation window. Earlier
published scores stay preserved. Any later score on those old validation
windows belongs to an exposed development diagnostic in this series.
The separate final windows carry the new retention measurement.

## The guard and the final test have different jobs

The first replay window of each source is its guard probe. Replay training
can use that example. The existing cumulative guard still compares the
six-source mean against the immutable initial teacher with its 0.015 limit.
Projection and backtracking retain their published numerical implementation.

The final retention files carry an endpoint role in their binary header.
The native reader rejects that role for training. An evaluation process scores
every listed endpoint window and writes each loss, target count and input
identity. It also reports each source's mean and the weighted total; the
study invokes all six sources with equal weight. Learned-state digests before
and after evaluation must match.

This is a new measurement series with a new sampling rule. It preserves the
historical raw-source reader and the earlier result files. The packed evaluator
uses `zero.literary_eval.v3` and a companion per-window record. The raw-source
path retains `zero.literary_eval.v2`.

## A mean can hide a source loss

The opened test supplies a direct example. The guarded method accepts all four
updates. Its mean endpoint loss falls from 4.85686731 to 3.81208634, an
improvement of 21.51%. Its dialogue endpoint loss rises from 4.85775232 to
5.06267738, a regression of 4.22%.

Those figures describe the synthetic fixture. They establish a measurement
limit: one improving average can coexist with a worsening source. The full
comparison needs source-specific limits fixed before model evaluation.
[FAILURES.json](FAILURES.json) preserves the source losses and their receipts.
This extends the earlier Q2.9 finding, where a replay training proxy passed
while the separate TinyStories gate failed.

## Verification and retained failures

The eight small data tests check the failed capacity assumption, byte order,
window boundaries, roles, channel targets and the independent checker. The
native test checks four paired replay samples, all five endpoint evaluations,
12 exact per-window matches with the older evaluator, and complete old-path
checkpoint parity for four training methods. Thirteen malformed or misused
inputs receive clean native rejections. They cover sizes, roles, vocabulary,
channel boundaries and training access to endpoint files.

The native audit also verifies the token identities and target counts for all
81 final windows and 577 replay windows at context 512, using input inspection.
[ORIGIN-CHECK.json](ORIGIN-CHECK.json) records the independent source check.
[NATIVE-CHECK.json](NATIVE-CHECK.json) and
[SANITIZER-CHECK.json](SANITIZER-CHECK.json) retain the opened results. Each
sanitizer build compares its old and new paths with the same flags; small
floating-point differences between build configurations stay in their records.

The first opened replay invocation omitted the separate foundation teacher
while retaining its default weight. The native startup check rejected it.
The synthetic fixture now sets that absent teacher's weight to zero. The
failed invocation and its source remain in custody. The first strict portable
build also exposed an unused parameter in the historical kernel; the fixed
flags retain that source and exempt unused-parameter warnings. An early audit
started before compilation finished; its failed process receipt is preserved.

## Next step in the shared program

The next ZERO.4 step is to connect the five-method comparison controller to
these packed files. It must bind the production teacher lineage, per-source
limits, task answers, paired language baseline, checkpoint selection by total
work, and one final endpoint evaluation after selection. Its full cloud
package and budget follow that preparation.

The shared program now has three separate questions: who supplies the answer,
what learned state changes the required work, and which prior capabilities
survive new work. Reasoner measures guidance against strong search controls.
Solomon separates answer ownership from confidence. ZERO.4 separates the guard
from its final retention test. FERAL keeps evidence-use results beside setup
failures. Weight multiplicity keeps structural transfer beside resource limits.
Each comparison should retain source-level losses and complete work, so an
improving average keeps its limits visible.

## Reproduce

[KIT.json](KIT.json) binds the source kit. It includes the exact upstream files,
the derived-source builder, the data selector, and both checkers. From the
unpacked kit, use the verified step 41 input directory as `prepared-step41`:

```sh
python3 scripts/zero4_window_data.py prepare --prepared prepared-step41 --out windows
python3 scripts/zero4_window_data.py check --prepared prepared-step41 --out windows
python3 scripts/check_zero4_window_roster.py --prepared prepared-step41 --windows windows --out origins.json
python3 scripts/check_zero4_windows.py --source source --out opened-checks --fresh windows
```

Use a fresh output directory for each attempt. The selector keeps every
candidate decision. The native check keeps each child process receipt and
partial result. Prepared packs, failed attempts and source archives stay in
private custody; this report publishes their compact records and hashes.
