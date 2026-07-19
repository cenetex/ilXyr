# Roadmap

The roadmap is sequenced around the research program in `docs/PROGRAM.md`: bootstrap the two
model families onto the protocol first, add service and cloud machinery only when the program
needs it.

## V1 — protocol proof (implemented and reviewed)

The local vertical slice meets its stated exit criteria as of 2026-07-18. The review record is
in `docs/V1_REVIEW.md`; later phases must preserve these lifecycle and replay invariants.

- Immutable protocol objects and resolved lineage.
- Forecast and compute-funding gates.
- Deterministic admission and public-weight local execution.
- Outcome resolution, Brier scoring, and verified replay.
- Admission closes experiment inputs, a model identity receives one forecast position, and an
  experiment ID receives at most one completed run.
- Completed-run finalization is resumable and idempotent; ledger mutation is confined to validated
  workflows that verify the existing chain before append.
- All published schemas compile under strict Draft 2020-12 validation and carry positive and
  focused negative fixtures.
- Grounding-authority records and additive certificates over declared domains.
- Sandbox and promoted lanes connected by a deterministic, directional-baseline ratchet.
- Ed25519-verified epoch budgets rooted in immutable trusted policy keys.
- Exact executable-argument allowlists, resolution-weighted disagreement allocation, handle-level
  role separation, calibration updates, and fail-closed unattended execution inside
  acknowledgement thresholds.

## V1.1 — family onboarding and the continuous loop (protocol implemented)

The implementation review is in `docs/V1_1_REVIEW.md`. Protocol mechanics are complete, and the
available frozen family results have now been settled without converting a failed family decision
into a promoted claim.

- Implemented immutable retro-registration with deterministic replay, a dedicated evidence lane,
  explicit `grounded`/`forecast_risked` semantics, and fail-closed terminal runs.
- Implemented shared task contracts for SHA-256 data/eval bindings, metric and seed contracts,
  family encodings/verifiers, and one designated proposer per family.
- Implemented Zero q22r and Solomon successor-v2 `local-command` metric adapters. Solomon replayed
  successfully from a clean remote checkout for authorized NSRL access. Zero seed 2 replays from a
  public, hash-pinned model artifact, and the completed three-seed aggregate independently registers
  the grounded one-go/two-no-go family decision.
- Implemented the idempotent library/CLI cycle: propose → forecast → allocate → run → settle,
  unattended only inside an existing signed epoch budget.
- Upstream evidence settled on 2026-07-19: the Solomon replay commit is remote-advertised, Zero
  seeds 1 and 3 are published on `main`, and the aggregate is a family no-go. The failed seeds did
  not touch their disjoint promotion sets; ZERO.3 remains promoted.
- Next research gate: preregister a new Zero follow-up that addresses the observed faculty/replay
  conflict. Independently, extract the real q22r shared contract with frozen data hashes and add a
  Solomon-compatible encoding and verifier; neither task licenses promotion of the failed result.
- Per-project pipelines remain source harnesses; `ilxyr verify` can replace their evidence ledger
  only after each frozen replay has been registered.

## V1.2 — replication bridge and live gates

- Additive evidence graph with `supports`, `contradicts`, `replicates`, `depends_on`,
  `supersedes`, `subsumes`, and `derived_from` edges; contradictions coexist and the query
  interface returns evidence state, never truth values.
- Replication contracts with compile-time tolerance bounds: capability replication and
  computational equivalence as distinct declared targets.
- Promoted-spine replication requirement (provenance-disjoint independence) and the
  reserved replication budget share; spine claims must be stated on shared task contracts.
- The Zero→Solomon replication bridge as the first cross-family experiment, after a Zero family
  result clears its preregistered multi-seed gate.
- Forecast closing windows and proper-scoring credit accounting for live experiments.
- Demotion challenge windows for contradicted promoted claims (deferred sketch in
  ADR 0004).

## V2 — service boundary (when multi-writer need is real)

- HTTP API generated from the same protocol types; authenticated multi-writer event ingestion.
- Identities, roles, quotas, and idempotency keys.
- Cloud executor adapters consuming compiled experiments by immutable digest.
- Protected-weight lanes and attested executors, only if the program ever holds weights that
  need them; see `docs/SECURITY.md`.
