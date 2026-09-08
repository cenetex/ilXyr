# Research step 26: Reasoner matched comparison completed no-go

The fixed learned task guide missed both benefit gates against raw lexical
guidance on 128 fresh families. The full comparison completed correctly.
Every answer passed the exact verifier; the cloud run completed 3,072
independent replays. This is a scientific no-go for the fixed primary claim.

## Primary result

Ratios are learned task guidance divided by raw lexical task guidance.
Lower values mean less work. The frozen rule required both one-sided 95%
upper bounds below 1 and exact answers throughout.

| Metric | Family-weighted ratio | One-sided 95% upper bound |
| --- | ---: | ---: |
| CPU | 1.000405 | 1.001546 |
| Verifier checks + 1 | 1.036041 | 1.077057 |

Both upper bounds exceed 1. CPU is nearly equal by the point estimate;
verifier work is about 3.6% higher. These bounds establish the failed benefit
gates. They do not by themselves establish a significant increase in cost.
[ANALYSIS.json](ANALYSIS.json) preserves exact values, stratum results,
family wins, ties, losses, and every secondary comparison.

The primary ratios use median episode CPU across 12 passes, equal weights
for four views in each family, and 5,000 bootstrap draws within four strata.
The independent family count is 128. Freshness means new target behaviors and
primitive sets within the existing four-stratum composition design. The
study uses the original fixed model and common executable, compiler, worker,
input order, and search limits for all six arms.

## Full cost and secondary comparisons

Across the 12 task-guide processes, total CPU was 14.164 seconds versus
14.148 seconds for lexical guidance. Process totals include family setup,
model loading, warm-up, and measured visits. Both arms reached a reported
peak resident memory of 45,285,376 bytes. These whole-process totals remain
separate from the primary family-weighted episode statistic.

The task guide's CPU ratio against target-only search was 0.716968. Its
ratio against semantic-frequency guidance was 1.227735, and its ratio
against task guidance with the prior feature removed was 1.074027.
These secondary results guide the next diagnostic. The frozen primary
reference remains lexical guidance.

## Collection and cleanup

The user approved the exact [step 23 package](../research-step-23/REPORT.md)
for one hour and $0.50 before tax. [Step 24](../research-step-24/REPORT.md)
records the launch. The host completed in about 18.1 minutes, then shut down.
Provider observation confirms termination of `i-0ffba5be5a2f4141b` and
deletion of its root volume. The host's own terminal record precedes shutdown;
[TERMINATION.json](TERMINATION.json) adds independent provider evidence.

Collection verified all 241 immutable output versions, totaling 60,087,559
bytes. Source bindings and both executable hashes match the frozen source.
All 72 process files and 73,728 warm-up and measured episode visits passed
validation. Local read-only analysis reproduced the saved paired metrics and
all bootstrap results exactly. The 3,072 independent replays ran in the
frozen cloud environment. [VERIFICATION.json](VERIFICATION.json) records
that scope, and [COLLECTION.json](COLLECTION.json) binds every object.

The conservative estimate is $0.3365 before tax, using launch through the
provider observation plus the full $0.25 reserve. Actual invoice cost remains
unknown. Raw outputs, logs, executable bytes, and collection receipts are
bound by [RELEASE-ARCHIVE.json](RELEASE-ARCHIVE.json) and published with
checksums in [research-step-26](https://github.com/cenetex/ilXyr/releases/tag/research-step-26).

## Next research decision

Keep lexical guidance as the reference. First inspect where prior-feature
work is spent and how results change across the four fixed strata. Treat
that inspection as a diagnostic on opened data. Then freeze one changed
mechanism and its fresh-family comparison before another full run.

FERAL's [repaired package and calculator v2](../research-step-25/REPORT.md)
are now published; [FERAL-PUBLICATION.json](FERAL-PUBLICATION.json) verifies
the downloaded bytes. Its baseline GPU run awaits package-and-budget
approval. Calculator v2's next step is a fresh coverage roster.

The program's shared test is whether an added learned component earns its
full cost against a strong simple control. Reasoner now has a clear failed
primary comparison. FERAL has a recorded coverage gap and a way to separate
startup, selection, and arithmetic. Both results narrow the next mechanism
worth testing. Earlier failures and historical successes keep their scope.
