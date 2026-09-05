# Research step 3: exact oracle cost accounting

Date: 2026-09-05

The proposed weight-multiplicity resource clause now has a tested accounting
component at `scripts/lib/oracle-resource-accounting.mjs`.

It maintains the exact nearest-rank p99 after each call. Two ordered heaps
store each latency once, so a progress check reads the current p99 directly.
Every attempted call contributes to the denominator, including returned
values above 31 and oracle errors. The component preserves the first Hold,
its triggering query, the top fifty queries, and grouped cost summaries.
Each summary reports call count, total time, mean time, and maximum time.

The limits match the recorded clause: final p99 at most 50 ms, hard timeout
at 30,000 ms, at most 2,430,387 calls, 8,474,852 ms total query time, and
2,119 seconds wall time. The distribution gate applies when the caller marks
the full call set complete. An early high p99 remains visible as progress.

## Checks and access failure

The tests compare every prefix of four distributions against an independent
sorted reference. They also cover equal latencies, the exact 50 ms boundary,
the exact hard-timeout boundary, call and time caps, incomplete runs, failed
calls, final-state changes, query identity, and preserved first failures.
The limits are checked against the original calibration closeout in CI.

The original 26,624-call trace has a source-bound checker at
`scripts/check-weight-multiplicity-resource-trace.mjs`. It checks the recorded
p99, maximum, label-range counts, and top-fifty type counts. Its output keeps
wall-time and corpus-acceptance decisions separate from latency arithmetic.

**Access failure recorded:** retrieval of the pinned S3 trace version returned
`Token has expired and refresh failed`. The local trace search found the
closeout records. The stored-trace replay remains pending a refreshed AWS
session. The synthetic behavior checks pass.

## Controller integration next

The current corpus runner still uses the original per-query generation gate.
The new component is ready for the following integration:

1. Record each oracle completion before deciding whether to dispatch more
   work. On a Hold, stop dispatch and collect every call already in flight.
   Keep the frozen candidate order and stable query identities.
2. Declare the warm-up and workload boundary explicitly. Preserve warm-up
   records and bind the full counted call set in the run contract.
3. Persist query records and resource progress during both pilot and corpus
   generation. Attach final selection dispositions to query identities.
4. Enforce the worker timer, memory limits, and remaining call capacity.
   Evaluate final p99 before sealing the corpus. Include the trace and cost
   summaries in the artifact checksums.
5. Freeze the integrated package and its cost before the next paid run.

This sequence carries forward the useful earlier failure: the expensive tail
contains out-of-range results that still cost real oracle work. Those calls
belong in both resource accounting and later model-efficiency comparisons.

Run `node scripts/test-oracle-resource-accounting.mjs` for the local checks.
