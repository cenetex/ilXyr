# Reasoner: an isolated four-method comparison

The comparison controller is ready for cloud packaging. It implements the
128-family roster from step 39 with four methods, 12 passes and 48 separate
worker processes. Each process makes one warmup pass and one measured pass
over 512 family views. The full comparison will contain 49,152 episode visits
and 2,048 distinct measured results for independent replay.

The opened check uses the four step 36 families. Local, Linux and Mac checks
each pass eight worker processes, 256 episode visits and 64 independent
measured replays. Their stable result hashes match. All 17 failure cases
pass on each platform. The 516 independent heap cases and eight small plan
tests pass. Local address and undefined-behavior checks pass for all four
methods. Fresh-family episode visits and new paid instances are both zero.

## The earlier ranking failure remains

| Method | Verifier checks across the 16 opened views |
| --- | ---: |
| Semantic frequency | 211 |
| Full task guide | 243 |
| Lexical task guide | 176 |
| Guide with its prior feature removed | 233 |

The controller preserves the fixed model and eligible proposal planner from
source commit `0c5253604593acb3b9294fcc00c90f59b7dbbd3c`. The native wrapper
changes the process entry point and supplies the frozen families and orders.
The episode search, features, verifier and canonical fallback stay bound to
that published source. The wrapper initializes its input data before each
process and loads the same model for the three guide methods.

The task order is a fixed shuffle for each pass. All methods share that order
for warmup and measurement. Process order rotates across the four methods;
each method occupies each position three times in the full comparison.
[PLAN.json](PLAN.json) was committed in `61e5f49` before the opened run.
[SCHEDULE.json](SCHEDULE.json) records the full process and task order.

## Complete work and failure records

Every child retains stdout, stderr, CPU, wall time and peak memory. Native
records separate model loading, preparation, adapter work, enumeration,
grouping, scoring, sorting, receipt work and search. Each row also records
verifier checks and fallback work. The outer process measures the controller,
including its build, workers, independent replay and evidence collection.
The later collection checker retains its own CPU, wall time and replay costs.

The first checker accepted a controlled alteration that added one to every
heap-comparison count. All 256 altered rows remained consistent with their
repeated copies. The corrected checker reconstructs the heap comparisons,
batch counts, selected count and maximum batch. It also reconstructs the
features, proposal order, verifier work, fallback work and exact answer map.
The original checker, altered rows and acceptance record remain in private
custody. [FAILURES.json](FAILURES.json) records the probe and repair.

Further cases alter features, answers, counts, task order and collection
records. Worker cases cover a missing model, an expired deadline and an
invalid compiler. The controller retains its partial collection before
reporting failure. The first random-sequence unit fixture also had an
incorrect expected value; an independent JavaScript calculation confirmed
the Python sequence, and the test expectation was corrected.

## Fixed outcome rules

The full guide must improve on both lexical guidance and semantic frequency.
For each reference, its whole-worker CPU point ratio must be at most 0.95,
and the upper uncertainty bound must be below one. Its verifier-check upper
bound must also be below one. Every answer and repeated result must verify.

CPU comparisons pair the 12 process passes, including model loading, warmup,
measured work and output. Verifier comparisons keep each family's four views
together and retain the four fixed cells. The plan specifies 20,000 bootstrap
draws, a fixed generator and seed, and one-sided 98.75% upper bounds for the
four required comparisons. Pass resampling describes variation within the
selected machine and run. Family resampling describes this fixed task design.
The opened checks remain engineering evidence.

## Next step and shared research method

The next Reasoner step is an immutable cloud host package with a fixed image,
compiler, runtime, memory limit, deadline and price. Its free preflight and
exact package-and-budget approval precede the full comparison.
[KIT.json](KIT.json) identifies the reproducible source archive.

The shared method now covers both selection history and execution history.
Reasoner retains each candidate rejection and each process failure. Solomon
has a prepared document panel and a published cloud package. Weight
multiplicity has its published resource limits and cloud package. Their paid
approvals remain pending. ZERO.4 next needs separate fresh task, retention and
language rosters. FERAL retains its expired capacity window and its earlier
runtime failure; fresh calculator coverage remains useful preparation.

## Reproduce the opened check

From the unpacked source kit, use a fresh output folder for every attempt:

```sh
python3 scripts/research_reasoner_study.py prepare --source source --out prepared
python3 scripts/research_reasoner_study.py opened --prepared prepared --out collected --work build-work
```

The collection checker takes the saved supervisor digest and creates a
separate verification folder. The CI workflow exercises that checker and
all failure cases. [PLATFORM-CHECKS.json](PLATFORM-CHECKS.json) binds its
platform receipts. [SMOKE.json](SMOKE.json) records the opened result.
