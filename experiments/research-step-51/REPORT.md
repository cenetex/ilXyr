# Research step 51: five approved runs and their next decisions

All five approved runs have finished. Every instance terminated, and the
collector verified deletion of its volumes and network interfaces. Four
result checks passed again after download. ZERO.4 preserved a storage failure
before scientific work. The individual cost ceilings sum to $14.70 before
tax; actual provider billing remains uncollected.

The shared question stays clear: **where does learned state earn its full cost
on unfamiliar inputs?** These results sharpen the next intervention for every
project. They also show why exact answers, confidence, coverage, retained
knowledge and execution cost each need their own evidence.

| Project | Verified result | Next tangible move |
| --- | --- | --- |
| Reasoner | Revised guidance missed both fixed benefit gates on 128 fresh families. All 2,048 measured replays verified. | Change the guidance mechanism or representation. Keep lexical guidance and semantic frequency as cost references. |
| FERAL | V2 answered 77/82 canonical numeric questions and 0/82 paraphrases. It correctly abstained on 63/64 required cases. | Diagnose wording failures and the one erroneous answer on a required-abstention case. Prepare a fact and operation selector with explicit ambiguity handling. |
| Solomon / NSRL | Smoothed suffix counts had the lowest confidence error on the fixed twelve-document panel. All five methods chose the same bytes. | Use smoothed counts as the confidence reference. Inspect document differences before registering another fresh comparison. |
| Weight multiplicity | The original corpus policy reached its workload-call limit. It preserved 79,452 training rows. | Compare observed stratum yield and rejected or duplicate draws with the pilot projection. Retain the original resource Hold. |
| ZERO.4 | The disk-reserve check stopped the host before the scientific controller. | Size a replacement disk for the observed image footprint plus the fixed output and archive reserve, then test and publish the package. |

## Reasoner: reduced scoring calls still leave a failed benefit test

The fixed comparison contains 128 families, four views per family, four methods
and twelve passes. It produced 49,152 fresh episode visits. The independent
checker replayed all 2,048 distinct measured results after download.

| Reference | Guide CPU ratio | CPU upper bound | Verifier-work ratio | Work upper bound |
| --- | ---: | ---: | ---: | ---: |
| Lexical guidance | 1.000772 | 1.002549 | 0.994070 | 1.040046 |
| Semantic frequency | 0.996838 | 1.001755 | 0.951811 | 1.024960 |

The rule required a CPU point ratio at most 0.95 and both one-sided 98.75%
upper bounds below one against each reference. Both comparisons failed.
Family resampling keeps the four views together. Repeated passes describe
variation on this fixed machine.

The earlier opened change reduced prior-score calls by 99.02%. This fresh
result now supports a change to the guidance mechanism before another run.
[REASONER-CHECK.json](REASONER-CHECK.json) retains the complete comparison.

## FERAL: canonical coverage exposes the next selection problem

The frozen roster contains 228 questions from three 2025 company reports:
164 numeric cases and 64 required abstentions. Twelve passes over three
controls produced 8,208 predictor calls and 684 distinct results.

| Method | Canonical numeric answers | Paraphrase numeric answers | Correct required abstentions | Wrong numeric answers |
| --- | ---: | ---: | ---: | ---: |
| Calculator v1 | 40/82 | 0/82 | 64/64 | 0 |
| Calculator v2 | 77/82 | 0/82 | 63/64 | 1 |
| Operand-only control | 8/82 | 0/82 | 63/64 | 70 |

V2's canonical coverage gain passed its rule. Its paraphrase gain was zero,
and the extra numeric answer on a required-abstention case failed the error
and abstention rules. The outcome is `no_go`.

Arithmetic earns its place after correct selection: v2 has much stronger
canonical accuracy than the operand-only control. Wording and ambiguity now
supply concrete targets for the next selector. The three-company roster is
the scope of this result. [FERAL-CHECK.json](FERAL-CHECK.json) retains company,
table-family, wording and operation breakdowns.

The [opened failure inspection](FERAL-DIAGNOSTIC.json) now identifies the error.
A question requests the S&P 500 Index, whose figures were removed. V2 selects
the Dow Jones technology index instead and computes a ratio from those figures.
The next control must check the requested entity as well as the selected source
and arithmetic. The 82 paraphrases divide into forty unsupported question
shapes and forty-two distinct-year checks. This inspection adds zero calls.

## Solomon: the best confidence control changes on fresh documents

All five methods made the same 261 byte mistakes on 384 windows from twelve
documents. The study ran 300 processes and recorded 9,600 probability rows,
including 1,920 native forward calls.

| Confidence method | Equal-document Brier error |
| --- | ---: |
| Native | 1.071032 |
| Point mass | 1.359375 |
| Smoothed point mass | 1.232962 |
| Empirical suffix counts | 1.017686 |
| Smoothed suffix counts | 0.883474 |

Lower Brier error is better. Smoothed suffix counts improved on empirical
counts here; the earlier sixteen-window diagnostic had favored empirical
counts. That reversal makes document shift useful evidence for the next
confidence design. The fixed-panel interpretation keeps linked document
groups, paired document differences and inference costs visible. Its scope
is confidence at fixed chosen bytes. [SOLOMON-CHECK.json](SOLOMON-CHECK.json)
retains exact fractions and per-document costs.

## Weight: preserve the call frontier and the partial corpus

The workload reached its original limit of 2,430,387 oracle calls. Complete
accounting contains 2,430,395 calls across the recorded phases. The downloaded
trace and corpus files pass the independent checker exactly. The result is
`verified_hold` with reason `oracle_call_limit`.

The partial training file has 75,000 zero-multiplicity rows, 965 one-multiplicity
rows, 2,119 rows in the 2–7 stratum and 1,368 rows in the 8–31 stratum. The
measured cumulative p99 is 3.904847 ms; its stage is `measurement_only`.
Final p99 acceptance follows completion of the whole corpus under the original
policy. The next audit should explain how stratum yield and repeated draws
used the projected call allowance. [WEIGHT-CHECK.json](WEIGHT-CHECK.json)
retains the trace check and partial-file roster.

## ZERO.4: the image footprint changes the disk requirement

The 80 GiB root filesystem had 27,919,421,440 free bytes after image preparation.
The fixed reserve required 39,795,556,352 bytes for output, archive, one upload
part and host reserve. The gap was 11,876,134,912 bytes, about 11.06 GiB.
The host stopped at the storage check, preserved its logs and terminated.
Scientific calls were zero.

The next package must account for the actual occupied space of this machine
image and runtime. The existing model, data and endpoint rules provide the
scientific reference for that repair. Its package bytes and budget can be
reviewed after the replacement passes the same host checks.

## Shared evidence and failure history

The shared ledger grew from 38 to 69 entries. Twenty-six additions import
verified design limits and repairs from steps 32–50. Five additions record
these cloud outcomes. The original 38 entries are preserved exactly.
[FAILURE-IMPORT.json](FAILURE-IMPORT.json) binds all nineteen intervening source
records. Passing injected controls retain their classification in those
records. [LEDGER-CHECK.json](LEDGER-CHECK.json) verifies all 69 verdict bindings;
59 entries also bind local evidence bytes. The first ten retain their original
reference-only status.

The next-design reports for [Reasoner](reasoner-design.json),
[FERAL](feral-design.json), [Solomon](solomon-design.json),
[weight multiplicity](weight_multiplicity-design.json) and
[ZERO.4](zero4-design.json) bind the same ledger and state the next intervention.
This connects the program through evidence and cost while keeping each
project's scientific unit and outcome rule clear.

[EXECUTIONS.json](EXECUTIONS.json) binds the approved packages and launches.
[COLLECTION.json](COLLECTION.json) binds immutable downloads and provider
cleanup. [VERIFICATION.json](VERIFICATION.json) records independent checks.
The scientific values and decisions match after download. Six aggregate CPU
sums differ below 0.000000000000001 seconds because of floating-point addition
order; both values are retained.

[FAILURES.json](FAILURES.json) also preserves two operator errors from this
closeout: decoding already decoded console text, and starting two offline
checks before extraction finished. Reading the returned text and waiting for
extraction resolved them. The same scientific checks then passed.

The full local schema suite passed in 143.21 seconds. The ledger checker
verified every declared verdict field and evidence hash.
