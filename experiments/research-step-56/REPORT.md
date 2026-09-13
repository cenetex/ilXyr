# Research step 56: trace the native pilot from calls to useful rows

The weight pilot now has a frozen source package, a bounded controller and two
saved-result checks. The Python check follows every native call, cache answer,
selection decision and cost counter. A separate replay reproduces the candidate
order from the frozen seed and saved answers. Package preparation creates all
sixteen planned job commands with zero oracle starts.

The native A1 smoke passes both checks. It records one LiE warmup, one LiE
workload call and one Zero comparison call. All 805 decision events verify.
The pilot retains one row against its requested quota of two and records the
expected candidate-exhaustion hold. This result tests the package's record path;
the full pilot's capacity and cost remain open research questions.

## The failure that improved the record

The first independent replay rejected the row-limit fixture with
`checkpoint cost counters differ`. The pilot had counted the next matching
label before stopping at its accepted-row limit. Its event stream omitted that
decision. The repaired recorder emits `occupancy_limit` before the hold, then
releases the uncommitted row. All twelve saved fixture records now verify.

[INITIAL-CHECK.json](INITIAL-CHECK.json) preserves the failed replay.
[REPAIRED-CHECK.json](REPAIRED-CHECK.json) preserves the repair. The regression
test removes the new decision event and reproduces the original failure.

A second failure occurred after the native smoke completed. The host-side
checker tried to save its result in the container-owned directory and raised a
permission error. Both verification steps now run in the same fixed container.
The completed native record and the failed verification write have separate
entries in [FAILURES.json](FAILURES.json). That file also records the initial
manifest-field error, which the roster guard caught before a worker started.

The shared failure ledger now has 75 entries. All 73 earlier entries remain
identical. The two new entries cover the missing decision and the verification
write failure.

## What each check establishes

The independent Python replay recomputes canonical query and orbit identity,
reservations, query and orbit exclusions, exact labels, cache provenance,
accepted rows, released rows, counters, block projections and stop conditions.
The native layer checks call order, input coordinates, saved answer identity,
failures, timeout status and the required Zero comparisons.

A new LiE answer receives a Zero check on the first successful combination of
type, requested range and target status, then when the canonical query hash is
zero modulo 100. Every selected comparison must agree exactly. Failed calls
retain their source sequence and duration. A stopped native call leaves an
incomplete record for collection.

The generator replay uses the frozen candidate code and seed with the saved
answers. It reproduces the complete decision-stream hash and result. Together,
the two checks cover the proposed candidates and the rules applied to them.
Both checks run again after downloading the native smoke, with zero new oracle
calls. [NATIVE-SMOKE.json](NATIVE-SMOKE.json) keeps the compact call, result and
verification records.

## The frozen comparison

[PILOT-PLAN.json](PILOT-PLAN.json) opens the existing 245 training-source
representations. Four seeds each compare the same four controls. Their order
rotates across seeds to balance the position of each control.

| Control | Exact-answer cache | First unfinished range |
| --- | --- | --- |
| Uncached fixed | Off | Original fixed start |
| Cached fixed | On | Original fixed start |
| Uncached rotated | Off | Rotates each batch |
| Cached rotated | On | Rotates each batch |

Each job requests 4,096 accepted rows across four multiplicity ranges and two
target statuses. Its bounds are 50,000 draws, 20,000 new LiE calls, 50,000 answer
evaluations, 1,024 batches and 180 seconds. It uses one LiE worker. Each job
starts with fresh worker and cache state.

The controller reserves time for building, verification and collection within
3,900 seconds. It samples summed descendant memory every 20 ms against a 2 GiB
limit. The record labels the observed peak as sampled and keeps exact peak
memory unknown. Bounded logs, result files and event streams retain stopped
work. A failed process or verification ends further job execution and records
every remaining job as skipped. Successful quota holds remain saved outcomes.

The controller tests replace native execution with bounded process fixtures.
They check build and job failures, failed verification, ordered jobs, cleanup
and the time reserved for collection. The Linux test also observes a real small
child process to check the memory reader. The native A1 smoke exercises the real
job driver and both result checks.

## Package and validation

[PACKAGE.json](PACKAGE.json) binds the 16,578,560-byte source archive to source
commit `57db690ec7c03dd19d6358bb52d173111a4bcd07`. Its SHA-256 is
`adea1791925e3336d28e4a26ccc80c5c20baa7892fc84675b422e325295569c7`.
The archive includes the exact original source kit and the new pilot code.
Verification checks the full file roster, every digest, safe archive paths and
preserved original source bytes. Local unpacking and preparation pass.

The three new Python suites contain 41 tests. All pass on Linux. The local Mac
run passes 40 and skips the Linux memory observation. The existing 18 selection
tests also pass. The full local schema suite passes in 123.13 seconds. Source
CI passes Rust, the minimum supported Rust version, schemas and the application
checks. [VALIDATION.json](VALIDATION.json) binds these receipts, and
[SOURCES.json](SOURCES.json) binds the source files.

The next weight step is the fixed host wrapper, price record and free cloud
preflight for this source package. Paid execution follows approval of the exact
host package and cost ceiling. The step 51 partial corpus and its call-limit
hold remain the current full-run evidence.

## The shared next move

Each project tests whether retained state produces more useful verified results
within a fixed cost. The useful unit depends on the task:

| Project | Useful unit | Next step from its recorded failure |
| --- | --- | --- |
| FERAL | The facts required by the user's question | Add source-context links for fact selection, preserve the wrong-index and numeric regressions, and use separately written wording. |
| Reasoner | Correct search completed with less work | Prepare a different source of guidance after the fresh-family benefit gates failed. |
| Solomon | Confidence that helps on a new document | Audit document shift in the saved panel against the smoothed suffix-count control. |
| ZERO.4 | New skill learned with earlier skills retained | Keep the disk-reserve repair bound to its prepared replacement package and pending approval. |
| Weight multiplicity | A new row that passes query, orbit and range rules | Complete host preparation for the bounded occupancy comparison. |

[NEXT.json](NEXT.json) preserves these next steps. The common measurement is the
useful result after all task rules have applied, together with the work spent
on rejected candidates, failed calls and incomplete attempts.
