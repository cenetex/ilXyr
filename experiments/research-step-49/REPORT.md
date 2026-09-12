# FERAL: a fixed cloud host for the fresh coverage comparison

The next FERAL comparison measures how much of the evidence the calculator
can use across two question styles. All 16 host tests and the fixed-image check pass. This step packages the
[step 48 controller](../research-step-48/REPORT.md), three controls, the fixed
2025 company reports, runtime tools, shutdown timer and result collection.
The source and prepared inputs rebuild byte for byte from the published kit.

## Scientific question

The study has 228 questions from Microsoft, Apple and Costco reports:
164 numeric targets and 64 required abstentions. Each question has a paired
plain-English form. Calculator v1, calculator v2 and the single-operand
control run in separate processes. Twelve passes rotate their order. The
36 workers make 8,208 predictor calls, producing 684 distinct results.

The gate applies to each question style. V2 must improve company-averaged
correct numeric coverage by at least ten percentage points over both controls.
Its wrong numeric answer count must stay at or below each control, and all
64 required abstentions must be correct. Every answer, source span, selected
series, repeated row and recorded work count must pass the separate checker.

The invented fixture gives a clear reason to run this test. V2 answers all
21 canonical numeric questions and abstains on all 21 paired paraphrases.
Its arithmetic succeeds once it selects the right facts. Varied wording is
the next test of fact and operation selection. These observations belong to
the engineering fixture; the fresh questions remain reserved for cloud use.

## Host and cost

The [execution plan](EXECUTION-PLAN.json) fixes one `c6i.large` in `us-east-1`,
with two CPUs, 4 GiB host memory and an encrypted 80 GiB root volume. The
container uses one CPU, 3 GiB memory, 256 process slots and a 512 MiB temporary
filesystem. It reads an immutable package and runs offline. Python 3.11.2
comes from the same fixed image used by Reasoner step 46. Node 22.22.0 is bound
to its official archive and executable hashes.

The host arms its shutdown timer first. Setup has ten minutes. The study has
a five-minute process limit and the separate checker has thirty seconds.
Collection and shutdown fit inside the **30-minute instance limit**. The
receiver verifies termination, volume deletion and interface cleanup before
it accepts the stored result objects. Failed stages and partial outputs are
kept with their causes.

The proposed **$0.15 ceiling before tax** includes compute, storage, requests
and one download. Free preflight checks current provider rates against each
fixed ceiling. Each fractional cost is rounded up to six decimal places.

| Cost item | Ceiling in USD |
| --- | ---: |
| Instance compute | 0.042500 |
| Root volume | 0.004445 |
| Public IPv4 | 0.002500 |
| Retained objects | 0.009814 |
| One bounded download | 0.036000 |
| Requests | 0.010000 |
| Calculated total | 0.105259 |
| Remaining margin | 0.044741 |

Collection permits a 160 MiB archive in one immutable object. The host checks
space for the output, archive, upload copy and a GiB reserve. The collector
records each object's expected size and hash before upload, then binds its
storage version. Changed bytes stop collection before extraction.

## Checks and retained failures

The host tests cover the early timer, fixed machine and container limits,
changed package bytes, insufficient disk space, safe launch arguments,
matching preflight identity, partial uploads and result collection. A separate
tamper check changes an inner report and rebuilds the outer archive hashes;
the prepared input inventory still catches that changed report.

[FAILURES.json](FAILURES.json) preserves two local preparation failures.
The sandbox first denied the process pipe used for bootstrap logging. The
same fifteen tests passed with the needed local process access. The added
tamper test then reused a create-only archive path and stopped at
`FileExistsError`. It now keeps the original and changed archives at separate
paths, and the focused check passes.

The [fixed-image check](https://github.com/cenetex/ilXyr/actions/runs/34716907398)
passed all 58 invented cases and 174 distinct results. Their stable rows match
step 48. The downloaded records pass the independent checker again from
their new paths. [RESULT.json](RESULT.json) binds both checks and the runtime
record. Whole-container peak memory was 134,246,400 bytes with a 3 GiB limit
and zero memory-exhaustion kills. These are engineering measurements.
Paid instances created and fresh predictor calls remain zero.

## Package and next move

[PACKAGE.json](PACKAGE.json) binds the **41,840,640-byte** host archive:
`c392e3a51d333e2a48b04bf91f9b6cab3959953b9afbd585f8aab59dd381872c`.
Its source commit is `4eafdd9ad5e9eb84959624b7a41e0c1461c108cb`.
Rebuilding it with the CI merge identity reproduces the CI archive hash;
every other package member is identical.
[The provider check](PREFLIGHT.json) awaits a refreshed AWS session. Once
staging and free preflight pass, the launch approval binds this exact package
and the $0.15 ceiling.

This step connects FERAL to the common research method: use fixed unfamiliar
inputs, compare against simple controls, charge the complete process, and
keep failures beside scores. Reasoner measures verified search work, Solomon
measures confidence error, ZERO.4 measures retained capability, and weight
multiplicity measures exact-domain transfer under resource limits. FERAL
adds source-backed answer coverage and correct abstention. Across these
projects, the useful learned component should earn its added cost at the
specific decision where the simpler method fails.
