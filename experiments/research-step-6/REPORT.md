# Research step 6: preserve the cost of failure

The weight multiplicity corpus runner now records each LiE query as it
finishes. A Hold stops new dispatches. Every query already running still
reaches accounting and the trace. Successful batches retain candidate order
for corpus selection.

This addresses a failure in the runner at source commit
`2524e2112ce0b08aa1470ce6ff81fab9512f99e2`. Its batch helper returned every
result before the budget loop began. The budget loop threw at the first
failed result, so later completed work could be omitted from its counters.

## What the runner now records

`evidence/oracle-attempts.jsonl` holds the complete sequence of LiE
completions. Each row carries a separate dispatch number, setup or workload
phase, slice, target, worker, elapsed time, result, and query disposition.
The disposition describes the result before corpus selection.

`evidence/oracle-accounting.json` checkpoints the exact p99, top fifty
latencies, first Hold, file digest, and grouped call costs. Warmup calls
remain visible in the setup count. The historical workload budget retains
its own count and clock. Current per-query and frozen budget rules continue
to govern the runner. The proposed 50 ms p99 rule remains the next policy
to package and review.

The worker pool reserves call capacity before dispatch. The terminal path
keeps checksums for the failure record and query evidence. Worker setup now
runs inside cleanup handling. Memory checks finish before the corpus
manifest is published; the final rename publishes the manifest after its
evidence and checksums are written.

## Additional findings

Transformed ACR-2 targets inherited their base target's depth. The runner
now updates depth through each reflection. ACR-1 retains an explicit
unavailable depth. Exterior candidates can have negative depth, which has
its own accounting group.

The check after merging research step 5 failed in a Rust service test while
reading an empty workspace config. Its directory helper added a thread
counter to a clock value. Different pairs can share a sum. The retry passed;
[PR #157](https://github.com/cenetex/ilXyr/pull/157) keeps those fields
separate and creates each test directory exclusively. The
[failed run](https://github.com/cenetex/ilXyr/actions/runs/33958618795)
remains part of the record.

## Local verification

The real query-batch function was tested with controlled workers. A failed
first call and a later completed call produce two trace rows and include
both costs. Other cases cover completion order, a one-call budget shared by
two workers, worker exceptions, malformed multiplicities, the existing
1,000 ms gate, setup counts, and depth groups.

A tiny executable exercises the real worker timeout. A separate command
test supplies an incorrect warmup answer and verifies the terminal Hold
and every saved checksum. These are bounded correctness fixtures.

The existing resource tests retain the proposed final 50 ms p99 and
30,000 ms hard-timeout checks. Both cloud package builders include the new
modules and run the packaged entry point's self-test.

## Next step

Prepare the new resource-policy package with the original candidate order,
the fixed limits, all attempted calls, and a complete final p99 decision.
Replay the saved calibration trace once AWS access is refreshed. Measure
the instrumented runner and its control in the same cloud environment under
an approved cost ceiling.
