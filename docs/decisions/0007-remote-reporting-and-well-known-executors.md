# ADR 0007: remote reporting and well-known executor environments

- Status: accepted protocol decision
- Date: 2026-08-30

## Context

A remote execution node needs to return a result to ilXyr. Letting the node write directly to the
public site or authoritative ledger would let the party making a claim also publish that claim as
verified. A cloud machine running a mutable checkout would keep the same drift problem as a local
machine.

The public site must report compatible environments and verified results without becoming an
executor, a spending authority, or a writable evidence store. Cenetex will provide the first
well-known environment, but another operator must be able to build the same environment and run
the same conformance suite from public source.

## Decision

The execution node submits a signed `ilxyr.execution_report.v1` to a separate reporting service.
The public site remains a read-only projection. Until the reporting service exists, discovery says
that submission is unavailable and publishes no dead write endpoint.

The report binds all of these values:

- immutable job package reference;
- one-run authorization and launch references;
- executor environment reference;
- executor service identity and trusted signing key;
- provider instance and frozen machine image;
- canonical run record and output digests; and
- SLSA provenance carrying the same run, package, environment, authorization, and launch refs.

The verifier checks signatures and every binding before any ledger write. An exact retry is
idempotent. A second report for the same launch is a conflict. The execution node cannot mark its
own report verified.

The pure report check establishes signature and package binding only. The implemented local
single-writer ingestion step additionally resolves trusted keys, the compiled experiment,
one-run authorization, signed budget, allocation, durable launch reservation and receipt,
environment, and package from its own ledger. It rechecks authorization, metric and output names,
runtime, provider identity, and the frozen outcome contract before a write. A caller-supplied key
file, authorization reference, or package is not a trust root by itself.

An executor environment is a content-addressed manifest over its source release, build recipe,
runner, kernel, root filesystem, SBOM, build provenance, isolation policy, capabilities, and
conformance suite. The public baseline requires one job per VM, a read-only root filesystem, no
host mounts or interactive access, no guest metadata service, no signing key in the guest, and
report assembly outside the guest.

The public registry uses separate states:

- `reference_candidate`: source and required controls are public, but no accepted manifest and
  conformance receipt exist;
- `compatible`: the manifest and conformance receipt pass the ilXyr checks;
- `verified`: an individual signed execution report passes the independent verifier;
- `reproduced`: a second independent trusted environment obtains the declared compatible result.

Compatibility never implies a verified scientific result. A verified result never implies a
reproduced build or independent reproduction.

## Service boundary

The intended flow is:

```text
sealed package + one-run authorization
  -> execution node
  -> signed DSSE/SLSA execution report
  -> separate authenticated report intake
  -> independent verifier
  -> single-writer ilXyr ledger
  -> read-only public projection
  -> ilxyr.cenetex.com
```

The intake service must enforce body limits, short-lived one-run authentication, launch
idempotency, rate limits, and write-once object storage. It has no launch authority. The public
site has neither intake credentials nor ledger write credentials.

## Reference environment

`executor/cenetex-public-v1/` is the open reference profile. Its first accepted manifest must pin
one source commit and every built artifact digest. A different operator can build the same commit,
publish its own provenance, and run the same conformance suite. Cenetex is an operator identity,
not a special verification rule.

The first profile is public-weight only. Protected weights, guest network access, hardware
attestation, and reproducible-build status are outside the first acceptance claim. Reproducible
build status requires independent matching builds; it is not inferred from a Nix recipe alone.

## Consequences

- Report verification can be implemented and tested before a cloud launcher exists.
- The public site can be public without exposing a write or spend surface.
- The Cenetex environment remains honestly marked as a candidate until real artifacts and an
  independently accepted conformance receipt exist.
- A later AWS adapter can use Zero's proven controls without making AWS the protocol.
- The local single-writer intake and its authenticated HTTP boundary exist. Operating it with real
  TLS and authoritative trust roots, plus a transparency log and independent conformance runner,
  remains roadmap work.
