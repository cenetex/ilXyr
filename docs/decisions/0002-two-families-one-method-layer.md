# ADR 0002: Two model families and a method layer

- Status: accepted
- Date: 2026-07-18

## Context

The lab consolidates three predecessor projects: a certified-gate neural-symbolic C library
(crlplrimes), an integer-only deterministic training stack in Rust (Solomon/NSRL), and a
dependency-free float micro language model in C11 (Zero). All three independently converged on
the same epistemics — frozen contracts, external verifiers, exact replay, promotion gates —
but maintain three parallel evidence pipelines and three candidate identities. The open
question was whether the program has two or three model families, and whether consolidation
means merging codebases.

## Decision

The program has exactly two model families. Zero is the science substrate: cheapest iteration,
one-person-comprehensible, used for hypothesis falsification. Solomon is the deployment
substrate: integer training, exact replay, CPU/WASM artifacts. The certified-gate project is
not a family; its grounding-operator vocabulary, certificates, and promoted-spine boundary are
absorbed into the ilxyr protocol, and its repository is then frozen as an archive.

Consolidation is protocol-level, not repository-level. Families keep separate codebases and
emit ilxyr objects; the ledger replaces the three per-project evidence pipelines. The lab's
identity is micromodelling: certified, replayable, comprehensible models, scaled by adding
certified faculties and experts rather than parameters.

## Consequences

One evidence surface replaces three. The first protocol obligations are grounding-authority
levels, certificate objects, and a retro-registration path for already-frozen family results.
The predecessor C library stops being maintained, and demoted sandbox efforts re-enter only as
forecasted, funded experiments. The flagship cross-family test of this structure is the
Zero→Solomon replication bridge. See `docs/PROGRAM.md`.
