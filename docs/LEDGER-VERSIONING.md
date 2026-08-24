# Ledger and Schema Versioning Policy

Issue: [#27](https://github.com/cenetex/ilXyr/issues/27). Status: **adopted
2026-08-24**. Every protocol change (#16, #17, #18, #19, #20, #23–#25, #28)
must be checked against this document before implementation.

## Architecture facts this policy builds on

- The ledger (`events.jsonl`) stores only tiny hash-chained event envelopes:
  `event_type`, `aggregate_id`, `actor`, `artifact_ref`, `occurred_at_ms`,
  `previous_event`, `event_hash`. Envelope schema: `ilxyr.event.v1`.
- Payloads live outside the chain as immutable content-addressed objects
  (`objects/sha256/<digest>`); events point at them by digest.
- Event hashes cover envelope fields only — never artifact contents.
- All model types use `#[serde(deny_unknown_fields)]`; JSON Schemas are strict
  Draft 2020-12.

## Rules

### 1. Ledgers are never migrated or rewritten

"Migration" means loader-side versioning only. A v0.1 ledger must open,
verify, and replay identically forever (enforced by
`tests/golden_ledger.rs` + `MANIFEST.sha256`). If a change breaks that test,
**the change is wrong**.

### 2. Event envelope versions are permanent

`ilxyr.event.v1` is frozen. A hypothetical breaking envelope change (hash
scheme, canonicalization) creates `ilxyr.event.v2`, which must be readable
alongside v1 in the same repository code. There is no conversion step.

### 3. New event types are additive

New lifecycle events (branch activation, paper settlement, condition
evaluation) add new `event_type` strings. Loaders **fail closed** on unknown
event types: older code reading a newer ledger refuses rather than silently
ignoring events, because silently dropped events corrupt derived state.
Upgrading code is the price of reading newer ledgers; downgrading readers is
never supported.

### 4. Artifact schemas version independently

- Each schema carries its own version (`ilxyr.<name>.v<major>`) inside the
  stored artifact; consumers dispatch on it.
- Within a major version, changes are **additive-only**: new optional fields,
  new enumerated values behind `#[serde(default)]`. Required-field additions
  require a new major version.
- Adding a new major version means adding a new schema file plus fixtures;
  old majors remain valid and readable forever (artifacts are immutable).
- Unknown fields always reject (`deny_unknown_fields` stays). Unknown major
  versions fail closed like unknown event types.

### 5. Derived-state compatibility is part of review

A PR that changes any model type must state in its description which golden
assertions could be affected and why replay is preserved. Reviewers (bot
escalation or human) should reject silent derived-state drift.

## Enforcement

| Rule | Mechanism |
| --- | --- |
| Rules 1 | `tests/golden_ledger.rs` — manifest byte check, chain verify, derived-state assertions |
| Rules 2–3 | Code review; `deny_unknown_fields` compile-time posture |
| Rule 4 | Schema fixtures (positive/negative) required for every schema PR |
| Rule 5 | PR description checklist |

## Worked example

Adding #18's branch-activation events:

- New `event_type` strings (e.g., `BranchActivated`): additive, allowed under
  rule 3. Old binaries cannot read new ledgers — acceptable and intended.
- New branch-condition artifacts: new schema `ilxyr.condition.v1` under rule 4.
- No change to the envelope, hash scheme, or existing types: golden test keeps
  passing untouched.
