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
  successfully from an unauthenticated clean checkout of public NSRL. Zero seed 2 replays from a
  public, hash-pinned model artifact, and the completed three-seed aggregate independently registers
  the grounded one-go/two-no-go family decision.
- Implemented the idempotent library/CLI cycle: propose → forecast → allocate → run → settle,
  unattended only inside an existing signed epoch budget.
- Upstream evidence settled on 2026-07-19: the Solomon replay commit is remote-advertised, Zero
  seeds 1 and 3 are published on `main`, and the aggregate is a family no-go. The failed seeds did
  not touch their disjoint promotion sets; ZERO.3 remained promoted at that checkpoint.
- EXP-001 grounds the completed Zero Q2.3 seed-2 local-guard diagnostic. The observer mechanics
  passed, but the guard accepted all 200 attempts and cumulative replay reached 2.685%; promotion
  and replication seeds remained sealed.
- EXP-002 prospectively executed Q2.4's cumulative direct functional replay budget. It enforced
  the 1.5% boundary, then stopped after 66 commits and eight consecutive rollbacks before a public
  checkpoint. EXP-003 prospectively executed eight-scale deterministic backtracking under the same
  authority. It admitted five additional commits, including one at 1/128, then exhausted every
  scale on eight consecutive attempts before a public checkpoint. EXP-004 prospectively executed
  Q2.6's global replay-tangent projection under the same authority. Seed 2 resolved go after 700
  full-scale commits; the selected public checkpoint and exactly one disjoint promotion evaluation
  passed. EXP-005 then executed replication seeds 1 and 3 against the frozen scientific contract,
  with independent forecasts and AWS provenance. Both resolved go after 600 full-scale commits.
  The all-three-seeds conjunction passed, making the seed-2 artifact promotion-eligible as ZERO.4.
  The upstream result is verified; local ilXyr ledger import and settlement remain pending.
- Independently, extract the real
  q22r shared contract with frozen data hashes and add a Solomon-compatible encoding and verifier;
  neither task licenses promotion of a failed result.
- Per-project pipelines remain source harnesses; `ilxyr verify` can replace their evidence ledger
  only after each frozen replay has been registered.

## V1.2 — replication bridge and live gates

The interoperability and generic graph foundation is implemented: ledger-verified native
evidence bundles, a strict bundle schema, RO-Crate 1.3 / PROV-O export, unsigned in-toto Statement
v1 export, a side-effect-free MLflow REST bridge manifest, and deterministic executable
preregistration packages with OSF receipt-gated admission. Signed DSSE ingestion now verifies
in-toto Statement v1 payloads, SLSA/native run bindings, and trusted Ed25519 executor identities.
The generic claim/replication layer also records typed edges, freezes capability/equivalence
contracts before execution, allocates the signed reserve, settles forward risk and mechanical
provenance independence, enforces exact shared-task binding for spine candidates and replication
experiments, and derives passive spine eligibility. These mechanisms do not substitute for a real
cross-family replication, OSF-side authentication, hardware attestation, or SLSA level assessment.

- Implemented additive evidence graph with `supports`, `contradicts`, `replicates`, `depends_on`,
  `supersedes`, `subsumes`, and `derived_from` edges; contradictions coexist and the query
  interface returns evidence state, never truth values.
- Implemented replication contracts with pre-run tolerance bounds: capability replication and
  computational equivalence as distinct declared targets.
- Implemented promoted-spine eligibility from an exact shared-task anchor, forward risk, cold
  replay, mechanically provenance-disjoint replication, and the reserved replication budget share.
- The Zero→Solomon replication bridge as the first cross-family experiment. The Zero family gate
  is clear; bind the concrete ZERO.4 capability to the shared task and finish the Solomon encoding
  and verifier before preregistration.
- Execute the ADR 0005 NSRL p10m managed pilot: implement a native content-addressed checkpoint
  bundle and source-pinned adapter, settle the frozen baseline and exact-restart checks, then record
  a continue, candidate, or freeze decision. Stewardship does not change the model's
  `experimental` status.
  Initial intake and public baseline completed on 2026-08-28 with a continue-experimental decision;
  the exact source commit and weight licence remain provenance blockers, five measured gates fail,
  and independent evidence remains unopened.
- Forecast closing windows and proper-scoring credit accounting for live experiments.
- Demotion challenge windows for contradicted promoted claims (deferred sketch in
  ADR 0004).
- Add an authenticated OSF adapter that creates/inspects registrations and verifies remote package
  content while preserving the implemented offline receipt gate.
- Add hardware remote-attestation and Sigstore/transparency-log verification around the implemented
  signed DSSE ingestion path.
- Extend the implemented passive one-claim query to graph traversal and authenticated service
  access while preserving the same agent admission and signed-policy boundary.

## V2 — service boundary (when multi-writer need is real)

- HTTP API generated from the same protocol types; authenticated multi-writer event ingestion.
- Identities, roles, quotas, and idempotency keys.
- Cloud executor adapters consuming compiled experiments by immutable digest.
- Protected-weight lanes and attested executors, only if the program ever holds weights that
  need them; see `docs/SECURITY.md`.
