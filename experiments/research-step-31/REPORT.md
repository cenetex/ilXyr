# Research step 31: Reasoner's cost is mostly before search

Removing the prior feature reduces CPU cost. The remaining task guide
costs more than semantic frequency. In the opened 128-family cloud
result, the guide with the prior feature removed uses **14.31% more family-weighted CPU**
than that simple control. It uses more CPU in all 128 families.

Search occupies only **3.12% of the full guide's measured wall time**.
Even assigning zero time to that entire phase leaves the full guide 19.03%
above semantic frequency in aggregate wall time. The guide with the prior feature removed
retains a 10.53% gap under the same calculation. These are accounting bounds
with every other recorded stage held fixed. They identify work that the next
implementation must change. They are separate from a measured speedup or a
fresh scientific result.

## Where the prior feature costs time

All values below sum the same 6,144 measured visits per arm, across twelve
passes. They use the saved monotonic wall timers.

| Stage | Full guide | Guide with prior feature removed | Full minus removed |
| --- | ---: | ---: | ---: |
| Scoring | 1,196.402 ms | 750.426 ms | +445.976 ms |
| Sorting | 1,257.798 ms | 1,350.604 ms | -92.806 ms |
| Other episode work | 2,640.432 ms | 2,639.545 ms | +0.887 ms |
| Whole measured episodes | 5,094.631 ms | 4,740.576 ms | +354.056 ms |

The full guide's scoring increase exceeds the net episode increase because
sorting offsets part of it. The independent process-CPU clock gives a
354.045 ms increase across measured visits. Stage wall times and process CPU
remain separate in [ANALYSIS.json](ANALYSIS.json).

The scoring timer contains prior-mass construction, the other features,
feature transforms, tie keys, and the linear score. The saved timers locate
the increase in that combined stage. Time inside the prior function alone
remains unknown.

## Work and task structure

Ratios use per-episode median CPU across passes and equal family weights.
The verifier metric is checks plus one, matching the original analysis.

| Comparison | CPU ratio | Verifier-work ratio |
| --- | ---: | ---: |
| Full guide / matched lexical guide | 1.000405 | 1.036041 |
| Full guide / guide with the prior feature removed | 1.074027 | 1.011300 |
| Guide with prior feature removed / semantic frequency | 1.143114 | 0.953054 |

The guide with the prior feature removed saves about 4.69% in the family-weighted verifier
metric against frequency while spending more CPU. Its verifier-work ratios
by original stratum are 0.7313, 1.2046, 0.7748, and 1.2086. The alternating
role strata carry higher verifier work. All four strata carry higher CPU
cost. This pattern belongs to opened data and helps select the next test.
The original matched primary no-go and its frozen uncertainty bounds remain
in [step 26](../research-step-26/REPORT.md).

The frozen source also clarifies the field called `source_artifact_reads`.
It assigns 905 declared guide bytes plus 16 weight bytes per full-guide visit,
and 16 weight bytes when the prior feature is removed. All guided processes
load the same 1,863-byte model file. The field describes this byte accounting;
physical I/O timing is a separate quantity. The source loop evaluates the
prior once for each of 4,096 candidates per full-guide visit, or 25,165,824
times across its measured visits. [SOURCE-AUDIT.json](SOURCE-AUDIT.json)
records the source functions and the counting rule.

## Verification and reproduction

The diagnostic verifies 146 saved input files against the published collection
manifest and checks 26 frozen source bindings. It reads all 72 native processes
and 73,728 warm-up and measured visits. It checks complete rosters, paired
orders, stable repeated behavior, exact-answer flags, timer accounting, and
process costs. It independently reproduces all original process totals and
paired point ratios. The 3,072 independent replays remain part of the earlier
cloud result. This step adds read-only analysis of those outputs.

Seven focused tests cover wall-versus-CPU accounting, offsetting stages,
family weighting, missing and duplicated work, altered repeated behavior,
invalid counters, changed file bytes, and retained failed attempts.
[INPUTS.json](INPUTS.json) binds the inputs and implementation.

```bash
python3 scripts/test_research_reasoner_costs.py
python3 scripts/research_reasoner_costs.py \
  --results /path/to/collected \
  --source /path/to/frozen/reasoner/source \
  --out /tmp/reasoner-cost-diagnostic
```

Use a fresh output directory. The input is the collection published in
[research-step-26](https://github.com/cenetex/ilXyr/releases/tag/research-step-26).
Its source is bound by the [step 23 package](../research-step-23/REPORT.md).

## Next mechanism and the shared program

The next engineering test should reduce feature and ranking work before
search. [NEXT-DESIGN.json](NEXT-DESIGN.json) proposes scoring bounded batches
from the proposals that remain useful after public evidence. Apply the shared
filter and ranking work to semantic-frequency and lexical controls too.
Preserve exact verification, the fallback, and complete costs. First check
behavior on a small opened fixture; then freeze a fresh-family comparison.
Semantic frequency now belongs beside lexical guidance as a cost reference.

The same method applies across the program: locate what learned state can
change, measure the complete work around it, and retain failures by source.
The pending deliverables remain concrete:

| Project | Next tangible deliverable |
| --- | --- |
| Reasoner | An evidence-filtered scoring check with matched controls and explicit fallback receipts. |
| Solomon / NSRL | Fresh document roster with overlap checks, followed by the five confidence arms with separate full-process costs. |
| ZERO.4 | Fresh task and retention rosters, per-source limits, and a separate language screen. |
| FERAL-7B | The approved fixed model comparison when capacity becomes available; separate fresh coverage testing for calculator v2. |
| Weight multiplicity | The full corpus cloud package bound to the recovered calibration trace and original candidate distribution. |

FERAL's [twelve capacity failures](../research-step-30/REPORT.md) remain an
execution constraint. Its paused follow-up and unused instance-compute budget
are preserved. Each new paid comparison will use its own frozen package and
explicit budget decision.
