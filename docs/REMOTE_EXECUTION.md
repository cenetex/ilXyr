# Remote execution protocol

ilXyr remote execution is a sealed-package protocol. It is not a command to run a checkout on a
cloud machine.

## Roles

- The ilXyr ledger compiles the experiment, records forecasts and funding, allocates a signed
  budget, and issues one short-lived authorization.
- A provider adapter can only preflight, launch, observe, and collect. The adapter consumes the
  package by digest.
- The execution node verifies every input digest before starting the job. It produces a
  metrics-only result and a signed DSSE/SLSA execution report outside the guest.
- The report intake loads the trusted executor keys, authorization, launch receipt, environment,
  package, and compiled experiment from its own ledger. It does not trust copies supplied by the
  reporting node.
- `ilxyr.cenetex.com` is the read-only public projection. It is not the report intake and it has no
  launch or spending credentials.

## Control flow

1. Compile a `remote-v1` experiment using public weights, `approved_image_only` code,
   `network=denied`, and `metrics_only` export.
2. Admit and allocate it through the normal forecast, funding, signed-budget, executable, argument,
   and acknowledgement gates.
3. Build an `ilxyr.executor_job_package.v1`. Its compiled experiment, environment, arguments,
   inputs, executable, oracle, harness, machine image, runtime, target order, output set, allocation,
   and reporting policy are immutable.
4. Run `ilxyr remote-package-verify` against the authoritative workspace.
5. Run `ilxyr remote-authorize` to record one expiring authorization. This does not launch compute.
6. The dispatcher runs adapter preflight, writes a durable launch reservation, and then calls
   launch with that reservation's idempotency key. A lost response is retried with the same key.
7. Observation is read-only. Collection cannot launch, restart, or extend a run.
8. The execution node submits one signed report to the separate authenticated intake endpoint once
   that service is published in `/.well-known/ilxyr.json`.
9. The single writer runs the equivalent of `ilxyr remote-report-accept`. Exact retries are
   idempotent; a different report for the same launch is rejected.
10. A separate projector may publish the accepted, verified result on the public site.

## Local protocol commands

```text
ilxyr remote-package-verify <workspace> <environment.json> <job-package.json>
ilxyr remote-authorize <workspace> <environment.json> <job-package.json> <budget-id> <authorization-id> <expires-at-ms>
ilxyr remote-report-accept <workspace> <execution-report.json>
```

These commands implement local single-writer protocol steps. They do not provide an HTTP intake,
an AWS adapter, or a compatible Cenetex environment. The fake adapter conformance test starts no
process and creates no cloud resource.

## Current limit

The authenticated network intake, public projection from an accepted ledger, reproducible Cenetex
build, independent conformance receipt, and AWS adapter remain roadmap work. Discovery must keep
report intake marked unavailable until the real authenticated endpoint is deployed.
