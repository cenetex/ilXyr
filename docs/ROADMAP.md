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
- The q22 bridge now has frozen training/evaluation hashes plus public, source-pinned Zero and
  Solomon encodings and verifiers. EXP-007 subsequently ran the preregistered three-seed Solomon
  class head: every seed scored 500/500 and all predictions agreed. This closes the narrow bridge
  without authorizing general Solomon promotion.
- Per-project pipelines remain source harnesses; `ilxyr verify` can replace their evidence ledger
  only after each frozen replay has been registered.
- The active ZERO.5 C line is now explicit in the lab registry. C0 selected the governed lossless
  tokenizer, C1 proved native C training, C2 selected the Atlas checkpoint, C3 through C4.3
  recorded a sequence of useful no-go curriculum repairs, and C5.1 found that a 25% Braid
  structured-text mixture did not transfer into the frozen retrieval audit. C5.2 TargetBridge
  finished under a private-result boundary at 5,046,256 total parameters. Its public decision is
  withheld and no follow-up is authorized. These upstream runs are evidence
  debt until imported; none is silently treated as ilXyr-native or forecast-risked.
- The checked-in machine-readable lab registry and its internal-reference validator now make
  Braid inputs, ZERO model lines, experiment controls, evidence state, and the current decision one
  reviewed surface. A new run must carry an ilXyr registration before execution.

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
- Implemented rival-mechanism tournaments with prospectively frozen metric predictions,
  disagreement-per-credit observation ranking, exhaustive decision tables, fail-closed evidence
  resolution, and per-rival Brier settlement.
- Implemented replication contracts with pre-run tolerance bounds: capability replication and
  computational equivalence as distinct declared targets.
- Implemented promoted-spine eligibility from an exact shared-task anchor, forward risk, cold
  replay, mechanically provenance-disjoint replication, and the reserved replication budget share.
- The Zero→Solomon replication bridge is complete as EXP-007. The task, both family
  implementations, fixed compute budget, evaluation firewall, and agreement rule were bound
  before the three-seed go. EXP-008 tested a harder surface without prefix shortcuts and resolved
  no-go: seed rates were 42.5–53.3%, the worst class was 0%, and agreement was 53.1%. The fixed
  sparse class-head branch is closed at this boundary; a successor needs a new representation or
  objective and fresh evaluation templates.
- Execute the ADR 0005 NSRL p10m managed pilot: implement a native content-addressed checkpoint
  bundle and source-pinned adapter, settle the frozen baseline and exact-restart checks, then record
  a continue, candidate, or freeze decision. Stewardship does not change the model's
  `experimental` status.
  Initial intake and public baseline completed on 2026-08-28 with a continue-experimental decision;
  the exact source commit and weight licence remain provenance blockers, five measured gates fail,
  and independent evidence remains unopened.
- Braid StateBridge is not admitted as a second cross-family task while the C5.2 decision remains
  private. Its symbolic representation remains an input artifact, not a Solomon-compatible
  contract or capability claim.
- Forecast closing windows and proper-scoring credit accounting for live experiments.
- Demotion challenge windows for contradicted promoted claims (deferred sketch in
  ADR 0004).
- Add an authenticated OSF adapter that creates/inspects registrations and verifies remote package
  content while preserving the implemented offline receipt gate.
- Add hardware remote-attestation and Sigstore/transparency-log verification around the implemented
  signed DSSE ingestion path.
- Extend the implemented passive one-claim query to graph traversal and authenticated service
  access while preserving the same agent admission and signed-policy boundary.

## V1.3 — digest-bound executor contract (in progress)

The next executor milestone is a package and adapter contract, not a cloud launch. ADR 0006 defines
the boundary and adapts the proven parts of Zero's AWS workflows without making AWS workflow YAML
the ilXyr protocol.

Experiment-specific AWS execution already exists and is the preferred venue
for approved resource-heavy runs. The milestone below generalizes that proven
path; it is not the project's first cloud capability. See
`docs/CLOUD-EXECUTION.md` for the current venue and run rules.

- Published the plain public API and protocol index at `ilxyr.cenetex.com`; proposal data, write
  routes, the authoritative ledger, and cloud-launch authority remain off that hosted surface.
- Implemented strict executor-environment, executor-job-package, signed execution-report,
  conformance-suite, signed conformance-report, materialization, preflight-receipt, and
  verification-summary schemas. The read-only CLI verifies environment, package, materialized
  artifacts, independent conformance, and signed report bindings before ledger ingestion. These objects freeze exact
  source commits, archives, executables, oracles, harnesses, data, models, machine shape and image,
  budget, target order, allocation, network/export policy, and expected receipts by SHA-256.
- Added the Cenetex public executor v1 open reference profile. It remains a
  `reference_candidate`, not a compatible environment, until real build artifacts and an accepted
  independent conformance receipt exist. Its machine-readable build contract and draft suite now
  separate portable offline checks from the Linux Firecracker checks that still must be built and
  reproduced.
- Implemented no-launch artifact preflight. It binds the exact environment and package, requires
  every frozen resource once, rejects missing files, digest or size drift, changed target order,
  traversal, and symlinks, and emits a receipt that cannot authorize launch or carry guest secrets.
- Implemented the provider-neutral adapter boundary with preflight, launch, observe, and collect
  operations. Its fake node proves side-effect-free preflight, reserve-before-launch recovery,
  provider idempotency, read-only observation/collection, and no duplicate launch after a lost
  response. The conformance path starts no process and creates no cloud resource.
- Implemented the local single-writer report-intake path. It resolves trusted keys, authorization,
  launch receipt, environment, package, signed budget, allocation, compiled metrics, output set,
  runtime, and outcome from the ledger; exact retries are idempotent and launch reuse conflicts.
- Implemented the separate authenticated network report-intake service defined by ADR 0007. It
  uses hashed, short-lived, one-run credentials, strict body and peer-rate limits, bounded durable
  rejection records, single-writer serialization, and no launch code. It remains undeployed.
- Operate that intake behind TLS with a dedicated authoritative workspace and trust roots, then
  publish its endpoint in discovery. Add the separate read-only projector from accepted ledger
  records. The public site must not become the intake service.
- Extract an AWS adapter from Zero's OIDC, conditional-write locks, resolved machine identity,
  launch-relative watchdog, independent-target, and read-only collection patterns. All preflight
  and conformance tests must avoid paid compute.
- Freeze the normal frontier and presized-memory audit as separate experiment IDs, packages,
  budgets, locks, and results. Do not transfer unused budget or state between them.
- Require explicit approval for one minimal-cost diagnostic package. Admit scientific cloud work
  only after its result bundle and signed executor attestation verify end to end.

No paid cloud work is authorized by the V1.3 roadmap itself. See ADR 0006 and ADR 0007.

## V2 — service boundary (when multi-writer need is real)

- The first single-writer corpus service slice now exposes immutable Braid-style releases,
  verified S3/Azure Blob receipts, and SageMaker/Azure ML input handoffs. It deliberately does not
  claim multi-tenant authorization or perform cloud API side effects.
- HTTP API generated from the same protocol types; authenticated multi-writer event ingestion.
- Identities, roles, quotas, and idempotency keys.
- Cloud executor adapters consuming compiled experiments by immutable digest.
- Protected-weight lanes and attested executors, only if the program ever holds weights that
  need them; see `docs/SECURITY.md`.
