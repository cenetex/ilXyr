# Research step 36: Reasoner scores the eligible proposals

Reasoner now has a shared scoring implementation that uses public evidence
before feature computation. On four opened families, it reduces prior-score
calls from 65,536 to 644 across the same 16 measured visits per guide arm.
That is a 99.02% reduction in those calls. Scored semantic groups fall from
47,644 to 432 for each comparison arm.

The learned ranking still has a clear opened-case failure. The full task guide
uses 243 verifier checks, compared with 211 for semantic frequency and 176 for
matched lexical guidance. Its prior-feature ablation uses 233. The shared
implementation change preserves those rankings and exact answers.

These are opened engineering results and exact work counts. Fresh-family
scoring and new paid instances in this step are both zero. The original
[matched primary no-go](../research-step-26/REPORT.md) keeps its source,
proposal rules, uncertainty bounds and decision.

## The concrete change

The [earlier cost diagnostic](../research-step-31/REPORT.md) showed that most
work happened before search. The source scored every candidate even though
its comparator already placed proposals matching the public example first.

The new planner forms semantic groups from the observed primitives and public
example. It computes the fixed features for eligible groups, processes scoring
in batches of at most 64, and keeps at most 64 proposals in a bounded heap.
It then sorts those proposals with the shared comparator.

All four arms use that implementation: semantic frequency, task guidance,
raw lexical task guidance, and task guidance with the prior feature removed.
The model remains the same 1,863-byte artifact with SHA-256
`db0afc1e460df5192917fac1f8129a2ec1e753ddb67939a975076fae5579bb7a`.
The feature definitions and normalization remain fixed.

The reference computes every feature and sorts every group, then selects the
same eligible proposals. The candidate and reference agree on eligible feature
digests, proposal keys, exact answers, verifier counts and fallback receipts.
An independent JavaScript implementation reconstructs each public task, checks
features and ordering, and checks accepted maps on all 125 input points.

The planner receives public candidate evidence, guide weights and a tie salt.
The verifier challenge follows planning. It uses the first syntactic candidate
with a wrong map, shared by all four arms. The exact verifier and canonical
fallback retain their earlier implementations. This challenge and eligible
proposal rule define the new engineering comparison; prior results keep their
original rules.

## What the work counts establish

| Arm | Prior-score calls, reference | Prior-score calls, eligible | Verifier checks |
| --- | ---: | ---: | ---: |
| Semantic frequency | 0 | 0 | 211 |
| Task guide | 65,536 | 644 | 243 |
| Raw lexical task guide | 65,536 | 644 | 176 |
| Guide with prior feature removed | 0 | 0 | 233 |

Each row covers the same four families, two source views and two tie views.
Reference and candidate have identical verifier counts. The four opened
families retain 25, 28, 45 and 63 eligible programs per visit, represented by
17, 18, 30 and 43 semantic groups. Every normal visit returns an exact answer.

The implementation still enumerates all 4,096 programs and scans their group
membership. Complete process CPU, wall time, preparation, peak memory and stage
timers stay in the raw engineering receipts. A fresh fixed-machine comparison
will decide the overall cost effect. The present result supports reduced
feature work and preserved behavior.

## Verification and failures

Linux and macOS each passed 280 native visits, 76 independent measured replays
and 258 heap-size checks against a full sort. The selection checks include
extreme scores and ties. Their stable rows match the local result byte for
byte. Four altered feature, proposal, verifier and fallback records fail
independent replay. Local address and undefined-behavior checks also pass for
the heap cases and all eight arm/planner processes.

Each arm and planner runs in its own process. One warmup and one measured
pass cover all 16 views. Additional cases force zero proposal budget, an empty
eligible set and a verifier cap. Zero budget and an empty set each reach
canonical fallback and recover the exact answer. The cap case stops after one
invalid verifier challenge, with its failed-answer record preserved.

A separate child with an unavailable model exits after zero episode visits.
Its stdout, stderr and terminal record are saved before checking its status.

The first Linux and macOS jobs passed their behavior checks, then artifact
collection failed. The uploader rejected a colon in receipt filenames. The
failure log is retained; that attempt produced no downloadable raw CI artifact.
The corrected filenames use a hyphen. Both later jobs passed and published
33 raw files each. [FAILURES.json](FAILURES.json) keeps this collection failure
separate from the opened ranking result and forced guard cases.

The first report check after merge also found a portal dependency failure.
Its build, render checks and lint passed, then the security audit flagged
`sharp` and `fflate`. The follow-up pins Miniflare to the patched `sharp`
0.35.4 and refreshes `fflate` to 0.7.5. The failure log and advisory links
remain in [FAILURES.json](FAILURES.json).

[INPUTS.json](INPUTS.json) binds all 66 collected platform files and 31 source
files. [SMOKE.json](SMOKE.json) records the model, cohort, source hashes and
stable work counts. [PLATFORM-CHECKS.json](PLATFORM-CHECKS.json) records the
matching platform results and local sanitizer receipt.

## Next step and shared program

The next deliverable is a fresh-family roster and comparison controller using
this shared implementation. It will exclude source, development, earlier
fixed-transfer, matched and opened-smoke behaviors and primitive sets. Both
lexical guidance and semantic frequency remain cost references. Full process
costs, verifier work, fallback work and failed attempts remain in the result.
[NEXT-DESIGN.json](NEXT-DESIGN.json) fixes this direction before that roster.

This step sharpens the common research method: remove shared overhead, then
identify the decision that learned state must improve. Reasoner now has a
proposal-scoring path with fewer feature calculations and an exposed ranking problem. Solomon separates
answer ownership from confidence. ZERO.4 checks retained capability by source
and through language tests. FERAL separates evidence coverage from execution
failures. Weight multiplicity prepares exact labels under explicit resource
limits.

The other next moves remain concrete:

| Project | Next deliverable |
| --- | --- |
| Solomon / NSRL | Full controller and result checks for the fixed fresh-document roster. |
| ZERO.4 | Fresh task and retention rosters, per-source limits, and a separate language screen. |
| FERAL-7B | A new bounded capacity decision for the fixed approved package; fresh calculator coverage checks. |
| Weight multiplicity | One run of the published 90-minute, $2 package after its exact approval. |

## Reproduce and inspect

```sh
make -f Makefile.reasoner55-eligible reasoner55-eligible-check
```

Run that command in the frozen upstream source. Set
`REASONER_ELIGIBLE_RECEIPTS` to a fresh output folder to keep all process files.
The command runs the small opened check.

- [Source PR 239](https://github.com/atimics/zero-grounded-literary-lm/pull/239)
- [Passing platform run](https://github.com/atimics/zero-grounded-literary-lm/actions/runs/34283379346)
- [Initial collection failure](https://github.com/atimics/zero-grounded-literary-lm/actions/runs/34282868772)
- [Result](RESULT.json), [failures](FAILURES.json), and [next design](NEXT-DESIGN.json)
