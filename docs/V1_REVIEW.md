# V1 acceptance review

This is the original V1 review. The V1.1 additions and upstream family-evidence audit are recorded
separately in `docs/V1_1_REVIEW.md`.

- Review date: 2026-07-18
- Scope: `ilxyr-core`, the reference CLI, promoted and sandbox workflows, signed policy,
  autonomous allocation, V1 schemas, and V1 security claims
- Verdict: accepted for the stated local, single-writer, public-weight protocol and policy proof

V1 demonstrates that immutable contributions can be compiled into a frozen experiment, gated by
forecasts and compute commitments, executed through the local adapter, resolved into
authority-bearing evidence, calibrated, and verified through the content-addressed ledger. It also
demonstrates signed epoch policy, deterministic allocation, unattended in-policy execution, a
fast sandbox lane, promotion eligibility, and additive certificates. It is not accepted as a
hostile-code sandbox, protected-weight runtime, continuous proposal-generation loop, replication
system, or multi-writer service.

## Exit criteria

| Criterion | Review result |
| --- | --- |
| Immutable protocol objects and lineage | Pass: IDs cannot be reused within an object type; compiled lineage resolves to artifact hashes. |
| Forecast and compute gates | Pass: distinct identities, checked credit totals, rejected-admission recovery, and accepted-admission closure are covered. |
| Deterministic admission | Pass: decisions derive from frozen objects; accepted reevaluation is idempotent. |
| Public-weight execution | Pass for cooperative local harnesses: the full local security capability set is enforced, output keys match the frozen metric contract, and the adapter uses an absolute executable, no shell, a cleared environment, closed stdin, direct-child timeout, and capped capture. |
| Resolution and scoring | Pass: exactly one frozen outcome is required before evidence and multiclass Brier settlements are recorded. |
| Grounding and certificates | Pass: evidence provenance is resolved to existing lineage/budget/run artifacts; certificate predicates must match evidence and name an existing checked run over a declared domain. |
| Signed policy | Pass: immutable trusted Ed25519 keys verify canonical epoch-budget signatures and bind signer ownership, executable/argument/network policy, caps, baselines, and acknowledgement thresholds. |
| Autonomous allocation | Pass: candidates are ranked by resolution-weighted disagreement per credit; unanimous, over-cap, self-reviewed, and self-forecasted candidates fail closed. |
| Two lanes and ratchet | Pass: allowlisted sandbox runs reserve budget, record authority-bearing evidence, and compute promotion eligibility from signed directional baselines. |
| Calibration | Pass: settlement appends per-handle Murphy reliability and resolution records and resumes without duplicate updates. |
| Ledger verification | Pass: object digests, event hashes, chain links, and referenced artifact presence are verified. |
| Schema contracts | Pass: every published Draft 2020-12 schema compiles in strict mode and has positive and focused rejection fixtures. |

## Revisions made during review

- Made contribution IDs immutable, matching the existing forecast, funding, and experiment ID
  rules.
- Closed forecasts and funding after accepted admission or execution start while keeping rejected
  experiments open for additional inputs.
- Limited each actor identity to one forecast per experiment. Model identities use versioned
  `model_ref` values so aliases cannot multiply stake.
- Made accepted admission idempotent and completed runs terminal. Completed-run retries never
  duplicate execution and resume only missing evidence or forecast settlements; ambiguous
  started-but-not-completed unattended retries fail closed.
- Restricted local execution to the capability set it actually enforces: public weights,
  arbitrary code, open network declaration, artifact export, and an absolute executable. Admission
  is recomputed immediately before process creation.
- Required executor metric keys to exactly match the frozen experiment metric set and surfaced
  output-contract failures on terminal run records.
- Confined object and event mutation to core workflows and made append validate the existing event
  chain and artifact references before extending it.
- Replaced unchecked stake and funding aggregation with fail-closed checked arithmetic.
- Tightened validation for URI handles, actor/model-ref consistency, duplicate seeds and handles,
  metric descriptions, expected outputs, NUL bytes, and unknown JSON fields.
- Aligned the V1 input schemas with the stricter structural runtime rules and added strict
  Draft 2020-12 compilation plus positive and negative fixtures for all published schemas;
  cross-field semantic checks remain authoritative in `ilxyr-core`.
- Extended `status` with execution-start and latest-run state, so an unresolved terminal run is
  still inspectable even though it creates no evidence.
- Rebased the evidence/autonomy mechanics into V1: grounding authority, additive certificates,
  signed epoch budgets, policy keys, allocation, threshold authorization, sandbox execution,
  directional-baseline promotion, role separation, and calibration are runtime workflows rather
  than design-only schemas.
- Froze complete sandbox plans before allocation, reused reservations on safe retries, required all
  declared provenance artifacts to exist, and bound executable argument vectors into signed caps.
- Kept the local trust claim narrow: private signing keys remain external, the initial public-key
  trust action is explicit, and manual `--execute` remains the human override for boundary cases.

## Residual limitations

- The local executor does not isolate the filesystem, network, syscalls, CPU, memory, or process
  tree. It kills only the direct child, and a descendant retaining an output pipe may prevent clean
  collection. Manual `--execute` or a matching signed-policy authorization accepts this host-level
  risk.
- The executable path is frozen but its file contents are not digest-pinned. Exact binary replay
  remains a harness/deployment responsibility until a later allowlist or attested executor exists.
- The event ledger is single-writer without inter-process locking, event signatures, or an external hash
  anchor. Verification detects accidental or uncoordinated modification; it cannot stop an
  administrator from rewriting the ledger and every hash.
- `verify` checks storage and chain integrity. It does not re-execute experiments or semantically
  recompute every historical admission and settlement.
- Numeric outcome predicates are not proven disjoint or exhaustive at compile time. Resolution
  fails closed when zero or multiple predicates match.
- Actor identities and the initial policy-key trust action are self-declared local protocol data,
  not authenticated principals. Allocations are ledger reservations, not external scheduler or
  billing reservations.
- Sandboxed-lane means ceremony-light, not OS-sandboxed: it uses the same cooperative local-command
  executor and inherits all of its host-level limitations.
- Authority levels and certificate checker/domain claims are declared protocol records. V1 verifies
  referenced artifacts and the certificate predicate against recorded evidence, but it does not
  execute arbitrary checkers, authenticate issuers, or produce remote attestations.
- V1.1 subsequently implemented the loop-cycle driver, family harness adapters,
  retro-registration, and shared-task contracts. Zero/q22r seed 2 is now grounded from a public,
  hash-pinned model artifact; family promotion remains blocked on seeds 1 and 3. Replication/spine
  settlement and the evidence graph remain later work. The replication-contract schema is a
  decided input contract, not an implemented workflow.

## Verification commands

```bash
cargo fmt --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cargo +1.85.0 test --workspace --locked
npm ci
npm run test:schemas
```

The toy CLI sequence in `README.md` remains the acceptance path for a manual protocol replay.
