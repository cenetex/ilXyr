# Phase 1 tail calibration authorization

Date: 2026-09-01

Status: authorized subject to exact-package approval

The client authorizes one telemetry-only replay of the frozen Phase 1 yield
pilot. It must use the same AWS AMI, `c6i.4xlarge` instance type, eight LiE
workers, two Zero workers, manifest, generator seed, candidate order, and
oracle sources as the stopped corpus run.

Every pilot query must record its identity, latency, returned multiplicity,
and multiplicity bit length. The run must maintain a top-50 latency checkpoint
and report p95, nearest-rank p99, p99.9, maximum, tail breakdowns, calibration
call count, and projected generation call count.

The proposed generation p99 limit is frozen before measurement as 1.25 times
the exact nearest-rank calibration p99, rounded up to the next whole
millisecond, with no discretionary floor or adjustment. The independent
per-query hard abort is 30,000 ms.

The run may use one AWS `c6i.4xlarge` for at most ten minutes and USD 0.12 of
estimated EC2 compute. It may not write corpus records or train, evaluate, or
promote a model or oracle. Corpus generation requires a separate approval
after the trace and numeric resource clause return for review.
