# Research program

What the lab studies. The rest of `docs/` is the machinery that holds it accountable.

## Mission

Produce a family of certified micromodels: small enough to audit fully, trained
deterministically enough to replay exactly, gated so every capability claim is
verifier-certified. The foundation is evidence, not parameter count. The scaling axis is the
number of certified faculties and expert models and the deterministic router that composes
them — never scale.

## Two families, one method layer

Consolidation happens at the evidence layer: each family keeps its own codebase and emits
ilxyr protocol objects.

- **Zero — science substrate.** Float micro LM in dependency-free C11; one person can verify
  the whole system by inspection. Validators live outside the model; fluency is never
  validity. Role: fast falsification of architecture, curriculum, and faculty routing. Its
  go/no-go registry is replaced by this ledger.
- **Solomon — deployment substrate.** Integer-only Rust training stack for deterministic
  CPU/WASM artifacts: native-integer updates, exact replay, checked numeric health. Role:
  harden and ship what Zero proves; compete on tokens-per-watt, cold start, and reproducible
  traces.
- **Certified gates — method, not family.** From the predecessor crlplrimes: grounding
  operators, certificates, and the promoted/sandbox boundary, absorbed into the protocol
  (`docs/PROTOCOL.md`, decided extensions). The predecessor repository is then frozen as an
  archive; its C library is not maintained.
- **Braid — data plane.** Braid compiles governed datasets, representations, target streams,
  rights records, split seals, and verification evidence. Braid releases are immutable inputs;
  they never authorize model training or promotion.

## Active model lines

ZERO.4 and ZERO.5 are separate states, not one checkpoint chain.

- **ZERO.4 is promoted.** Q2.6 passed all three declared seeds and remains the deployed quantity
  model.
- **ZERO.5 is active research.** It is the dependency-free C11 training line at a fixed
  4,852,992-parameter base. Its C experiments start from the selected C2 checkpoint, not from
  ZERO.4. The line is not promoted.
- **C5 is a private terminal lineage.** C5.1 tested a 25% Braid structured-text mixture and
  resolved no-go outside the ilXyr ledger. C5.2 keeps that stream fixed and adds a 193,264-
  parameter verified state-target head, for 5,046,256 total parameters. Its authorized run
  finished, but the frozen contract forbids public results. No follow-up run is authorized while
  the decision remains private.

The machine-readable source of truth is [`docs/lab-registry.json`](lab-registry.json), with the
public view at [`docs/program-registry.html`](program-registry.html). External runs remain marked
external until ilXyr imports them; their chronology is never rewritten as forecast-risked.

## Parallel substrates, shared surface, directed flow

The families develop in parallel and meet at declared joints:

- **Shared task contracts** — frozen dataset hashes, encoding, metric definitions, eval set,
  and verifier, consumed by both harnesses. On a shared contract, a Zero number and a Solomon
  number mean the same thing.
- **Directed capability flow** — Zero explores in float ("is this learnable?"); what passes
  its gates, Solomon replicates under declared tolerances ("does it survive integer
  arithmetic and ship?"). The reverse also works: a Solomon-native surface becomes shared by
  adding a float reference replication, as successor-v2's float32 baseline already did
  informally.
- **Private substrate research** — questions the other family cannot share (Solomon's
  reachable-update capacity and numeric health; Zero's fluency-versus-validity probes) run
  sandbox-tier on family-specific benchmarks.

**Spine rule:** a claim enters the promoted spine only if stated on a shared task contract.
Substrate-private results stay sandbox-tier until they are. The first shared contract is
Zero's q22r quantity-faculty task.

## Flagship: the Zero→Solomon replication bridge

Replicate a Zero-proven result under Solomon integer training, recorded with a `replicates`
edge. The contract declares both targets in advance (ADR 0004): capability replication within
a stated tolerance, and per-input agreement over the full eval set. Cross-family replication
is the lab's strongest independence, so the bridge doubles as the spine's replication
mechanism.

The frozen Q2.2-R family decision is a grounded no-go: seed 2 passed, while seeds 1 and 3 failed
the joint quantity/replay contract. The bridge therefore cannot treat Q2.2-R as a Zero-proven
capability. The Q2.3 local guard also ended no-go: it accepted all 200 updates while cumulative
replay reached 2.685%. Q2.4 then enforced a cumulative boundary but stopped after 66 commits and
eight guarded rollbacks. Q2.5 then tested deterministic candidate backtracking under the same
authority: five scaled updates committed before eight attempts exhausted every registered scale.
It never reached a public checkpoint, so EXP-003 resolved no-go. EXP-004 then prospectively tested
Q2.6's global all-slice replay-tangent projection while preserving every gate. Diagnostic seed 2
resolved go after 700 full-scale commits; the selected public checkpoint and one-time disjoint
promotion evaluation passed. EXP-005 then executed seeds 1 and 3 as separate runs under the
unchanged design. Both resolved go after 600 full-scale commits, so the all-three-seeds
conjunction passed and ZERO.4 is current upstream. The Zero family gate is now clear. The bridge
still needs frozen shared-task data bindings and a Solomon-compatible encoding and verifier.
The verified Braid StateBridge symbolic view is not admitted as a shared task while the C5
decision remains private. It stays an input artifact and does not replace q22r by declaration.

## NSRL p10m managed pilot

ADR 0005 accepts operational stewardship of the production `NSRLPM1` p10m lineage for a 30-day
managed pilot. It remains an `experimental` Solomon asset. NSRL owns the integer model,
tokenizer, artifact formats, and execution code; ilXyr owns source-pinned execution, budgets,
evaluation contracts, evidence, checkpoint comparison, and lifecycle decisions.

The first objective is trustworthy custody, not fluency. Intake must preserve the current negative
generation results, keep the production lineage separate from the successor-v2 benchmark, and
verify artifact digests plus byte-identical restart. A checkpoint can become a candidate only after
all integrity, numeric-health, learning, generation, context, serving, provenance, and independent-
evidence gates pass together. Better likelihood by itself is not promotion evidence.

The first managed intake ran on 2026-08-28. It registered the v10 model and continuation bindings,
reproduced deterministic generation and the public development baseline, and kept the hidden panel
unopened. Integrity and learning passed; numeric health, generation, context, serving, and
provenance failed; independent evidence remains unopened. The lineage continues as experimental.

## Bootstrap

1. V1 control plane: authority records, certificates, signed budgets, sandbox/promoted lanes,
   allocation, thresholds, and calibration — implemented in this repository.
2. Retro-registration and family replay adapters — implemented; Solomon replay passes from a
   fresh remote checkout for authorized NSRL access, Zero q22r seed 2 is grounded from a public,
   hash-pinned selected model, and the completed three-seed no-go decision is separately grounded.
3. Shared-task contracts and the continuous loop-cycle driver — implemented; the real q22r shared
   task remains blocked until both family encodings/verifiers and data hashes exist.
4. EXP-001 grounds Q2.3's local-guard no-go, EXP-002 records Q2.4's prospective cumulative-guard
   no-go, and EXP-003 records Q2.5's prospective deterministic-backtracking no-go. EXP-004 records
   Q2.6's prospective seed-2 replay-tangent go while preserving full gates for spine claims.
   EXP-005 records independent seed-1 and seed-3 go results and the verified family go. Its
   upstream evidence still needs to be imported into the local ilXyr ledger.
5. Bind the ZERO.4 capability to a real shared task, add the Solomon-compatible encoding and
   verifier, then preregister and execute the bridge.
6. Implement the native NSRL checkpoint registration and source-pinned adapter, then execute the
   p10m intake and baseline defined by ADR 0005 without changing its experimental status.
7. Reconcile the active ZERO.5 C0–C5 decision lineage and Braid inputs into the ilXyr registry.
   This public registry now identifies the evidence debt. Completed upstream runs must be
   imported honestly; no new run may bypass ilXyr registration.

## Operating model

No human in the operational loop (ADR 0003). Model actors do the research; the human signs
policy and audits the ledger.

- **Sandbox lane** — one call records spec, run, and evidence. Constraints, not ceremony:
  allowlisted executables, policy-checked arguments, compute caps.
- **Promoted lane** — full ceremony by model actors under handle-level role separation;
  forecasts close before execution; settlement builds per-handle calibration records.
- **Ratchet** — a sandbox result beating a registered baseline at sufficient authority
  becomes eligible for promoted compilation. Computed, never granted.
- **Cross-project admission** — Braid may deliver a verified input and ZERO may freeze an
  executable contract, but a new run starts only after ilXyr registration. A run already in
  progress may finish and must then be imported with its real chronology.
- **Scholars** — researcher agents (`.claude/agents/prior-art-scholar.md`) find verified
  prior art before a claim is preregistered or published. Reports carry `review` authority
  and only fetch-verified citations; each promoted claim states its novelty boundary. This
  is practice, not protocol: reports feed reviewer contributions and EXP docs.

A human-signed epoch budget is spent by a deterministic allocator ranking experiments by
resolution-weighted forecaster disagreement per credit cost; near-unanimous experiments
starve. Credits are allocation-only. The human keeps the constitution, the credit mint,
boundary acknowledgements, and batched review.

## Demoted paths

The allocator is the abandonment mechanism: paths advisors do not disagree about are never
funded. Demoted at consolidation; re-entry only as forecasted, allocator-funded experiments:

- ARC-AGI coverage pushes, haiku/corpus-proxy suites, program-synthesis and holographic/VSA
  sandboxes, and the Signal systems vignettes;
- Solomon Council v0 (its dissent-preserving review ideas may return as ledger review
  policy); and
- Solomon multimodal and literary-swarm suites.

Demotion is not deletion: archives remain replayable, outside the promoted surface.
