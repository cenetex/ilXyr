# Phase 0.5 cloud execution amendment

## Status

Authorized on 2026-08-30 by the client statement, “ok lets do it.” This
amendment moves the fresh Phase 0.5 execution to one bounded AWS CPU instance.
It does not authorize a corpus, model training, or a change to the mathematical
surface.

The interrupted local run is diagnostic only. Its first 432 measurements used
the expected executable, but the executable path was rebuilt before later
cells. No part of that run may be resumed or sealed as the cloud result.

## What cloud isolation must guarantee

Cloud placement is not itself the control. Before launch, the dispatch job
must bind and publish one immutable package containing:

- the exact Linux Zero executable and SHA-256 digest;
- the exact ilXyr controller and revision;
- the Phase 0.5 plan and freshly generated representation manifest;
- the target-order and memory limits;
- both memo allocation policies; and
- the workload, launch, and collection scripts.

The instance downloads that package by digest. It must not clone a branch,
pull new commits, or compile a replacement executable. The controller checks
the executable digest before and after every representation and before and
after parallelism calibration.

## Frozen venue and budget

- AWS EC2 `c6i.4xlarge`, on demand, in `us-east-1`;
- one instance and one execution lock;
- Ubuntu 24.04 amd64;
- maximum 31,764 instance-seconds;
- maximum EC2 cost of USD 6.00 at the frozen USD 0.68/hour planning price;
- workload timeout of 30,900 seconds, leaving time to publish evidence; and
- automatic instance termination on success, failure, or deadline.

This is a new hardware-specific frontier. It does not rewrite or numerically
combine the earlier Mac measurements.

## Two experiment identities

`phase05-cloud-frontier-default-v1` runs the complete 828-representation
manifest with the default 1,024-entry, power-of-two doubling policy.

`phase05-cloud-memory-presized-v1` uses the same executable, plan, targets,
orders, and two-GiB decision gate. It changes only the initial memo capacity to
8,388,608 entries. Its surface is derived mechanically after the default run:
the smallest-dimension memory-affected representation in each affected type.
This rule is frozen before results exist.

Recursive Weyl canonicalization is excluded from both identities. It is a
separate algorithmic experiment and cannot be mixed into this allocator test.

## Required telemetry and decision

Zero emits a progress record before each resize with the live entry count,
entry size, old and requested capacities, and projected simultaneous bytes.
ilXyr retains the last record even when the ten-second measurement deadline
kills a query.

The comparison reports, per selected cell:

- live entries and `entries × 164` bytes;
- process RSS and the RSS-to-live-entry ratio;
- table capacity and temporary old-plus-new allocation;
- default and presized classifications; and
- whether the two-GiB boundary moved.

If any default memory failure returns below the gate when presized, the report
must state that the observed memory frontier is allocation-policy-dependent.
Time and order-sensitivity results remain separate facts.

