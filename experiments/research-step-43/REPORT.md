# ZERO.4: choose once, then test retention and language

The five-method controller is ready for cloud packaging. It finishes every
checkpoint choice before it opens final task, retention or language tests.
The source kit passes the opened native check and the address and undefined
behavior sanitizer check. Production input preparation verifies 63 files,
including the original ZERO.3 teacher. Production model forward calls remain
zero in this step.

The useful failure survives the new controller. On the tiny synthetic model,
guarded replay accepts all four updates, yet dialogue endpoint loss rises
**4.22%** and story bits per byte rise **17.18%**. Exact task artifacts remain
**0/5**. The exact parser control checks **5/5**. Both guarded candidates fail
the fixed final gate. These figures describe the opened engineering check.
The full fresh-roster comparison follows in a separate cloud run.

## The fixed comparison

The [revised plan](PLAN-v2.json) uses frozen, task-only, plain replay, guarded
replay and projected replay, with seeds 1, 2 and 3. Each arm starts from the
same teacher with fresh optimizer and random state. The three replay methods
must consume identical samples through their common attempt prefix.

Each trained arm gets at most 100 attempts, in chunks of 10, with a
600-second training CPU allowance. The controller selects the latest complete
checkpoint inside that allowance. A chunk that finishes over the allowance
stays in the record and its full work stays in actual cost. The frozen teacher
is the fallback. The selection file binds every chosen model before any final
evaluator starts.

Each selected model receives all 500 fresh task cases, 1,005 BLiMP pairs,
1,000 story windows and 81 retention windows from six sources. The foundation
source has one window; the other sources have sixteen each. These are the
hash-bound data from [step41](../research-step-41/REPORT.md) and
[step42](../research-step-42/REPORT.md). Frozen baselines run again on these
same cases. Each arm and seed gets a fresh evaluation process for every
endpoint family.

A guarded candidate passes only when every seed meets all these conditions:

- At least 25 more exact task artifacts than both frozen and plain replay.
- Each source's mean retention loss grows by at most 1.5% against frozen.
- BLiMP accuracy falls by at most 1.5 percentage points.
- Story bits per byte grow by at most 1.5% against frozen.
- Every planned arm and endpoint completes, with zero state mutations after
  a rejected request across all arms.

The decision covers these fixed cases and three seeds. The report keeps each
seed, source and paired case change. Descriptive standard errors show observed
case variation. The single foundation window has an unknown sampling error.

The task uses a fixed operation grammar. Its parser and exact kernel therefore
form a complete reference. Learned task results concern operation routing
while retaining prior skills. The primary question is whether a guarded method
earns its cost against plain replay under the shared training allowance.

## What the checks caught

The [first plan](PLAN.json) retained automatic validation inside each training
chunk. Static inspection after its opened check showed that the packed trainer
scores every replay window at each report: 577 replay windows in the full
roster, plus task validation. Checkpoint selection uses only CPU and progress.
The revised plan was committed before implementing an explicit option to skip
that extra scoring. Native guard probes remain active. The old trainer, the
new default and the option all produce identical checkpoint bytes and sample
logs for all four training methods in the opened check.

The new task trace agrees with the historical evaluator on every count and
mean target score for all five opened models. The complete opened study has
39 native process records: five builds, eight training chunks, 25 endpoint
processes and one exact parser control. Eighteen altered-record checks cover
missing cases, wrong identities, invalid counts, changed window inputs,
invented predictions and source means, changed CPU totals, early endpoint
access and a changed sealed choice.

Two further native checks cover partial outcomes. A one-microsecond training
allowance forces all four trained arms to keep their first completed chunk
and select the frozen fallback. A one-record training input triggers four
native rejections. That comparison keeps all five fallback endpoint results
and remains incomplete.

Build and test failures are kept in [FAILURES.json](FAILURES.json). They include
an ambiguous source anchor, an altered-record test that reached a different
check, a missing Linux POSIX declaration, a Mac deprecation warning and a Mac
processor-count declaration hidden by the POSIX setting. The source anchor,
test target and compiler settings are repaired. Address and undefined behavior
sanitizers pass the complete opened, budget and failure checks.

## Cost and custody

Training CPU includes native work, guard probes, checkpoint copies, sample
checks and charged controller work. Setup and final evaluation are separate
costs. Actual totals include every completed, failed and over-budget child,
plus controller and replay-check CPU. Records also keep wall time and peak
child memory. A whole-process-tree memory ceiling and measurement belong in
the cloud host package.

The source kit is **6,696,960 bytes**, with SHA-256
`67f14e2ee85563c6a8f4a8419322c5de5f788d83b74755a1643670ee0cf3299e`.
All 61 archive entries match the checked source. It includes the pinned
upstream source, licenses, both plans, the controller and the opened checks.
[KIT.json](KIT.json) binds every file. [PREPARED.json](PREPARED.json) binds the
47,987,778 bytes of full inputs and source. [RESULT.json](RESULT.json) keeps
the compact check results. Large models, process records and failed checks
remain in the local `outputs/zero4-controller-step43-20260912` custody folder.

To reproduce the small check from an extracted kit:

```sh
python3 scripts/test_zero4_study.py
python3 scripts/check_zero4_study.py --source source --out opened
python3 scripts/check_zero4_study.py --source source --out sanitized --sanitize
```

Use a fresh output directory each time. Full execution needs the fixed cloud
machine, image, compiler, memory limit, package, preflight and budget approval.

## Place in the research program

This uses the same complete-process accounting as the Reasoner and Solomon
controllers. The shared method is now concrete: fix fresh cases, include a
simple reference, preserve every failed attempt, count all work, and apply the
task's correctness and retention limits before making a benefit claim.

| Project | Prepared next move |
| --- | --- |
| Reasoner | Fix the cloud host for the four-method controller from step40. |
| Solomon | Run the step38 package after its exact $0.25 approval. |
| Weight multiplicity | Run the step35 package after its exact $2 approval. |
| FERAL | Keep the expired capacity window closed; prepare fresh coverage checks. |
| ZERO.4 | Fix the cloud host and budget for this sealed five-method comparison. |

The next ZERO.4 step is cloud packaging and a free preflight. The package will
bind the full schedule and preserve these outcome rules.
