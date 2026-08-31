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
8. After a launch is recorded, the intake operator issues one short-lived report credential. Only
   its domain-separated SHA-256 digest enters the ledger. The bearer secret goes to the host-side
   reporter, never to the guest.
9. The execution node submits one signed report to the separate authenticated intake endpoint once
   that service is deployed and published in `/.well-known/ilxyr.json`.
10. The single writer runs the equivalent of `ilxyr remote-report-accept`. Exact retries are
    idempotent; a different report for the same launch is rejected.
11. A separate projector may publish the accepted, verified result on the public site.

## Local protocol commands

```text
ilxyr remote-package-verify <workspace> <environment.json> <job-package.json>
ilxyr remote-authorize <workspace> <environment.json> <job-package.json> <budget-id> <authorization-id> <expires-at-ms>
ilxyr remote-report-accept <workspace> <execution-report.json>
```

These commands implement local single-writer protocol steps. They do not provide an AWS adapter or
a compatible Cenetex environment. The fake adapter conformance test starts no process and creates
no cloud resource.

## Authenticated network intake

`ilxyr-intake` is the separate HTTP boundary around the same ledger verifier. It has two commands:

```text
ilxyr-intake issue <workspace> <authorization-id> [ttl-seconds] [max-rejected-attempts]
ilxyr-intake serve <workspace> [--bind <ip:port>] [--max-body-bytes <bytes>] [--requests-per-minute <count>] [--allow-public-bind]
```

`issue` works only after the matching authorization and launch receipt exist. It returns the
bearer token once. An exact retry returns the immutable credential record with a null token because
plaintext credentials are never stored. The token is bound to the exact authorization, launch,
package report-size limit, expiry, and rejected-attempt limit.

The server exposes only `GET /healthz` and `POST /v1/reports`. A report request requires an exact
`Content-Length`, `Content-Type: application/json`, and `Authorization: Bearer <token>`. Chunked
bodies are rejected. The service applies a hard body limit before parsing, the package-specific
limit after authentication, an in-memory peer rate limit, and a durable per-credential rejection
limit. Unknown tokens do not write to the ledger. Accepted report retries are read-only and return
the same report reference.

The safe default is loopback. A non-loopback bind requires an explicit flag and must sit behind a
TLS reverse proxy with its own header/body limits, connection and request timeouts, client-aware
rate limits, and log redaction. The service account should have write access only to the
authoritative ilXyr workspace. It must have no cloud, build, signing, or public-site deployment
credentials. See `crates/ilxyr-intake/README.md` for the operating boundary.

## Current limit

The authenticated network intake is implemented but not deployed. Public projection from an
accepted ledger, a reproducible Cenetex build, an independent conformance receipt, and an AWS
adapter remain roadmap work. Discovery must keep report intake marked unavailable until the real
TLS endpoint and its authoritative trust roots are operating.
