# Phase 0.6 retained-surface LiE preflight authorization

Date: 2026-08-31

Status: authorized

The client approved the preflight named in the re-scoped manifest. The run is
limited to the 572 retained representations that passed the Phase 0.5 Zero
frontier but were not timed under LiE during Phase 0.6.

The frozen surface contains 18,304 generated targets and 4,218 unique
queries. Every unique query has a completed historical Zero answer. The run
performs two complete LiE passes, checks all 4,218 differential answers,
checks all 4,218 replays, and applies the existing 1.0 second query and 2 GiB
worker gates.

The execution remains bounded to one AWS `c6i.4xlarge` for at most 30 minutes
and no more than $1.00 of planned EC2 compute. Automatic termination is
mandatory.

A pass requires all 572 representations to pass, 4,218 exact Zero/LiE
agreements, 4,218 deterministic replays, matching pinned LiE source and
executable hashes, and the accepted governance record. Any failure is Hold.

This authorization does not permit corpus generation, model training, source
modification, or oracle promotion. A successful preflight returns evidence
for client review; corpus generation remains a separate approval.
