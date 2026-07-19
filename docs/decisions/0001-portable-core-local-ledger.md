# ADR 0001: Portable protocol with a local reference ledger

- Status: accepted
- Date: 2026-07-18

## Context

The first ilxyr implementation must prove that forecasts, funding, security policy, execution, and
evidence form a coherent research transaction. Beginning with a specific cloud scheduler would mix
that protocol with provider identity, queues, storage, and billing details.

## Decision

Define the research objects and gates in a provider-neutral Rust library. Use canonical JSON,
SHA-256 content addressing, and a single-writer JSONL event chain as the local reference adapter.
Support one shell-free executor for public-weight toy experiments. Represent all external resources
as opaque URI handles.

## Consequences

The complete protocol can be tested and replayed on a laptop, and future adapters have a concrete
compatibility target. The local ledger is not horizontally scalable and the executor is not a
sandbox. Neither may be presented as a production multi-tenant security boundary.
