# Proposed Phase 1 oracle resource clause v2

Status: returned for client review; not yet authorized

This clause replaces the 1,000 ms per-query generation gate. It does not
change the corpus distribution or authorize corpus generation by itself.

1. The final exact nearest-rank p99 across all attempted LiE oracle calls in a
   corpus run must be at most **50 ms**. A completed run above 50 ms is a
   corpus Hold.
2. Any individual oracle call still running at **30,000 ms** is aborted and
   causes an immediate corpus Hold.
3. The controller must continuously calculate and checkpoint the cumulative
   p99 for visibility. The 50 ms distributional decision is made on the final
   completed call set, not on a small early prefix.
4. Existing frozen limits remain binding: at most **2,430,387 oracle calls**,
   **8,474,852 ms** of total oracle query time, and **2,119 seconds** of
   generator wall time.
5. Existing memory limits remain binding: an 8 MiB operational divergence
   threshold and a 2 GiB formal limit for each LiE worker, plus the existing
   16 GiB aggregate process limit.
6. Every query record must preserve sequence, slice, type, representation,
   target, depth, returned multiplicity, multiplicity bit length, disposition,
   worker, status, and elapsed time. A Hold must identify its triggering
   query when one exists.
7. A top-50 latency checkpoint and breakdowns by type, representation, target
   depth, multiplicity bit length, and inside/outside the 0–31 label range must
   be maintained throughout the run and preserved even if the run stops.
8. Generation cost and progress must be reported continuously against the
   frozen call, query-time, and wall-time limits.
9. Any resource Hold or arithmetic disagreement stops corpus acceptance. It
   does not authorize a retry, threshold change, candidate-order change, or
   corpus rescope.

The 50 ms number is mechanical: `ceil(39.602666 ms × 1.25) = 50 ms`. There is
no discretionary floor or adjustment.

The calibration had 26,624 calls, while expected generation has 1,861,415 and
may run as high as the binding limit of 2,430,387. Calibration p99.9 was
442.404 ms and the maximum was 884.604 ms. The 50 ms p99 gate is therefore
known to be tight at the larger sample size; it may produce a Hold without an
oracle regression. This warning is part of the clause and is not permission
to change the frozen number after a run.
