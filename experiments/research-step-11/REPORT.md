# Research step 11: ZERO.4 retention controls

ZERO.4 now has an executable five-arm comparison in
[Zero PR #237](https://github.com/atimics/zero-grounded-literary-lm/pull/237).
It separates task learning, replay, the acceptance guard, and tangent
projection. Each scored point keeps its full training checkpoint, final-answer
counts, retention loss, and work through evaluation.

## The comparison

| Arm | Purpose |
| --- | --- |
| Frozen weights | Measure the initial model. |
| Task training | Measure adaptation to the new task. |
| Task and replay | Measure the effect of replay. |
| Replay and guard | Measure acceptance checks and backtracking. |
| Replay, guard, and projection | Measure the added effect of projection. |

The extra guard arm strengthens the four-arm sketch from step 10. The last
pair differs only in transaction mode. All replay arms must consume matching
training windows over their common attempt prefix. Every arm begins with the
same model, and every seed starts with fresh optimizer and random state.

The runner selects the latest fully scored checkpoint inside each fixed CPU
ceiling. It includes child CPU, controller work assigned to the arm, and the
shared setup cost each arm would incur as a separate run. Overall CPU and wall
time are separate fields. Failures, timeouts, and points above the ceiling
remain in the raw record.

## Failure retained

All five toy arms score **5/5 on oracle arithmetic and 0/5 on correct final
artifacts**. The oracle field executes the supplied bound target request before
model generation. The final-artifact field scores the complete model-driven
path. This gives a concrete measurement boundary: success inside a component
can coexist with failure on the user's answer.

Both guarded arms backtracked on their first attempt. Projection stayed
inactive in the four-attempt fixture. A separate numerical self-test exercises
active projection and state restoration. These observations describe known toy
inputs; Q2.6 keeps its original scientific result and scope.

Earlier fixture attempts exposed an incompatible learned-position model and
an incorrect header offset. The first CI run exposed a missing parent folder,
a registry omission, and source-hash conflicts with older studies. The report
upstream preserves these failures. The final build keeps the historical trainer
at its original hash and applies a checked patch to a separate diagnostic
trainer. The shared Makefile also keeps its original hash; a separate
Makefile holds the new targets. The Reasoner smoke passes with those targets
isolated.

## Evidence and checks

[RESULT.json](RESULT.json) is an exact copy of the upstream smoke at
`95a35e2e02a8f5e3cedf3b9ecce66f0ce45ad377`:

- Source path: `benchmarks/zero4-retention-controls-v1/SMOKE.json`.
- Result SHA-256: `71782a62ff754aa2856aef2fa94629d48cd78a372f03c8a42b23455c69b57547`.
- All 19 source bindings were verified against committed bytes during import.
- Seven focused tests and the 35-check native numerical self-test passed locally.
- The five-arm comparison completed 79 native processes and four paired replay samples.
- All 16 scored training checkpoints retain their original bytes after the run.
- All four active arms match the historical trainer's full final checkpoint,
  including optimizer and random state.

The [upstream plan](https://github.com/atimics/zero-grounded-literary-lm/blob/95a35e2e02a8f5e3cedf3b9ecce66f0ce45ad377/benchmarks/zero4-retention-controls-v1/PLAN.md)
defines the controls and cloud-package work. The source and patch hashes bind
the separate diagnostic trainer. Local timing stays in the raw engineering
output. Linux and macOS run the same smoke in CI.

## Next step for each line

| Line | Tangible preparation already delivered | Next move |
| --- | --- | --- |
| Reasoner | Six matched arms, fresh-family generator, independent answer replay, and a frozen source archive. | Bind the archive to a cloud machine, compiler, watchdog, storage, and cost ceiling. |
| Solomon | Fixed-answer confidence controls and exact Brier checks. | Freeze a fresh corpus for the three model components and three confidence controls, with complete inference cost. |
| ZERO.4 | Five matched retention arms with checkpoint and process records. | Freeze fresh task and retention cohorts, overlap checks, model lineage, CPU ceilings, answer gates, and analysis. |
| FERAL-7B | Reviewed target version two and an evidence-only calculator control. | Package the base model and calculator against the same gold-free inputs and separate targets. |
| Weight multiplicity | Completed-query accounting and failure retention in the real runner. | Freeze the resource policy; replay the original trace when AWS access is restored. |

Solomon and ZERO.4 now expose the same measurement risk in different forms.
Solomon's old probability score can improve at fixed answers. ZERO.4's oracle
component can pass while final answers fail. The common comparison should
therefore keep correct final answers, probability quality, and complete work
as separate measures. Fresh-input controls decide which learned component earns
its place.
