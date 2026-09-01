# Phase 1 corpus run 20260901012539: Hold

## Outcome

The approved corpus package launched correctly, both oracle builds reproduced,
and the instance shut itself down. Corpus generation stopped during the yield
pilot because one successful LiE query took 1,019.389 ms, above the fixed
1,000 ms per-query limit.

This is the agreed resource gate doing its job. The timeout has not been
raised, the package has not been retried, and no corpus or model artifact was
accepted.

## Measurements at Hold

- Oracle calls: 19,105.
- Mean query latency: 1.704 ms.
- Median query latency: 0.157 ms.
- p95 query latency: 2.165 ms.
- Maximum query latency: 1,019.389 ms.
- Returned multiplicity: 2,633,282,666,151,119,789.
- Generator wall time: 6.593 seconds.
- Instance elapsed time: 70 seconds.
- Estimated EC2 cost: USD 0.013222222222.
- Frozen corpus budget: not created because the Hold occurred during pilot.

The existing Hold record does not identify the type, representation, or target
weight of the slow query. That is an observability defect. The controller now
adds the complete query identity to future per-query Hold details.

## Receipt erratum

The outer cloud receipt says `status: complete` with runner exit code 2. The
runner summary correctly says `status: hold`. The wrapper used “complete” to
mean that it had safely handled the runner's accepted Hold exit, but that word
is misleading in a scientific receipt. Future receipts now preserve
`status: hold` while still shutting down normally.

This erratum does not change the run result. The immutable runner Hold is the
authoritative scientific outcome.

## Deliverables and authority

- Corpus records sealed: zero.
- Corpus manifest: unavailable.
- Stratum yields: unavailable.
- Zero differential corpus sample: not reached.
- Retry: not authorized.
- Model training and evaluation: not authorized.

The compact machine-readable closeout is
`phase1-corpus-run-20260901012539-closeout-v1.json`. Large logs and the stopped
run remain under the immutable S3 prefix recorded there.
