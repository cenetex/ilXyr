# Research step 54: weight sampling spends its budget on repeated rejections

The saved weight run made 2,403,763 generation calls. **1,962,195 calls (81.63%)
repeated an earlier generation query**, and 1,960,732 of those repeats missed the
requested multiplicity range. The generator releases rejected query keys, which
allows later batches to ask the exact oracle again. Every repeated query in the
saved trace has the same exact value.

The next design needs a cache for known query results and a pilot that measures
new accepted rows under the final selection rules. A larger call allowance would
carry the same declining yield forward.

## Evidence and scope

The streaming auditor reads the completed step 51 trace and partial training
corpus. It checks the fixed trace hash, completion and dispatch sequences,
canonical type and weight identity, consistent exact labels, recorded query
purpose, and all 79,452 corpus records against successful matching trace rows.
It makes **zero new oracle calls**. The earlier independent result check remains
the authority for runtime, resource limits and corpus validity.

[RESULT.json](RESULT.json) contains every measured slice and consecutive call
block. [PILOT.json](PILOT.json) retains the original projection. Source hashes,
including the exact frozen generator, appear in [SOURCES.json](SOURCES.json).
The trace contains 2,430,395 calls: eight warmups, 26,624 pilot calls and
2,403,763 generation calls. Its SHA-256 is
`39c24773e4b8cdf73402573afe729ea3c9b2bafaf47831168e9b9e420ff79169`.

The audit finds 441,568 distinct generation queries. Of 79,557 calls matching
the requested range, 79,452 appear in the partial corpus. The remaining 105 are
zero-label matches beyond filled slice quotas. The source checks quotas after
batch results arrive. All nonzero matching calls appear in the corpus.

## The pilot estimated a different yield

The pilot samples with replacement. Its budget formula divides required rows by
raw matching calls per attempt, then adds uncertainty and a margin. Generation
first excludes selected query keys and occupied weight orbits. Rejected keys and
orbits become available again. As selection grows, these rules change the pool
that reaches the oracle.

| Training slice | Pilot raw matches / 1,024 | Distinct pilot matching queries | Generation matches / calls |
| --- | ---: | ---: | ---: |
| 1, dominant | 483 | 234 | 517 / 301,409 |
| 1, other | 427 | 296 | 448 / 330,434 |
| 2–7, dominant | 172 | 128 | 1,077 / 419,570 |
| 2–7, other | 172 | 159 | 1,042 / 418,812 |
| 8–31, dominant | 157 | 108 | 709 / 457,945 |
| 8–31, other | 153 | 138 | 659 / 400,488 |

“Other” means a non-dominant target. The six nonzero slices produce 4,452 rows
from 2,328,658 calls: **0.191%** usable yield. Their pilot raw yields range from
14.94% to 47.17%. This is an opened diagnostic of the original sampler and quotas.
The trace proves repetition and yield drift. It lacks the rejected candidate
draws and orbit occupancy needed to divide that drift among its causes.

The decline continues through the run:

| Generation calls | New nonzero corpus rows | Repeated queries |
| --- | ---: | ---: |
| 1–250,000 | 3,012 | 102,829 |
| 250,001–500,000 | 654 | 190,437 |
| 500,001–750,000 | 251 | 206,317 |
| 2,000,001–2,250,000 | 53 | 225,548 |
| Final 153,763 calls | 30 | 139,421 |

The fixed workload call cap remains 2,430,387. Training contains 75,000 zero
rows and 4,452 nonzero rows. The completed-run outcome remains `verified_hold`.

## Next tangible move

[NEXT.json](NEXT.json) specifies a bounded query cache and a selection-aware
pilot. The pilot must measure usable new rows as selected queries and orbits
accumulate. It must record candidate draws, exclusions, cache hits, new calls,
accepted rows, and candidate support for each quota. An invented finite-support
case will test whether a perfect raw label rate can still exhaust usable rows.

Cache reuse should preserve exact type and weight identity. A cached result can
serve another requested range, while selection still follows the same quotas
and orbit rules. Its memory limit and stop reason must be explicit. The new
package and budget follow after local tests and a source review.

[FAILURES.json](FAILURES.json) records the sampling failures and the local verdict
field error. The shared ledger now contains 71 entries; all 70 prior entries
are preserved. The audit has 13 invented-trace tests covering repeated failures,
pilot duplicates, cross-range reuse, corpus provenance, exact large labels,
sequence changes and resource bounds. Final validation receipts accompany this
report in [VALIDATION.json](VALIDATION.json).

This supports one shared research rule: measure the capability at the point
where the project needs it. FERAL needs the right source facts, Reasoner needs
guidance that improves search, Solomon needs useful confidence, ZERO.4 needs
retained skills, and weight multiplicity needs usable new rows within budget.
