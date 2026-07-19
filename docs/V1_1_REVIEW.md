# V1.1 family-onboarding review

- Review date: 2026-07-18
- Scope: shared-task contracts, retro-registration, Zero and Solomon local harness adapters,
  and the policy-bounded loop-cycle driver
- Verdict: protocol implementation accepted; empirical family onboarding is partial because the
  upstream frozen artifacts are not yet equally replayable

## Implemented

- `SharedTaskContract` freezes SHA-256 dataset and evaluation-set bindings, ordered metric and
  seed contracts, per-family encodings and verifiers, and one designated proposer identity for
  each of Zero and Solomon. Registration is immutable and idempotent. Compilation resolves the
  task to an artifact hash and rejects a mismatched family, proposer, dataset, eval set, metric
  list, or seed list.
- Retro-registration freezes a source commit, external artifact hashes, replay command, metric
  contract, seeds, and grounding authority before process creation. Only `exact_check` and
  `deterministic_replay` authority are accepted. Replay output must attest the exact frozen source
  snapshot as well as the metric keys. A successful replay records `retro` evidence and
  permanently marks the result `grounded=true`, `forecast_risked=false`.
- Failed or malformed retro replays are terminal records and cannot create evidence. An ambiguous
  started-without-completion retry fails closed; completed replay finalization is resumable and
  idempotent.
- `loop-cycle` accepts one complete proposal package and performs propose → forecast → allocate →
  run → settle under an existing signed epoch budget. Exact retry inputs reuse frozen objects and
  a settled retry performs no ledger writes. Proposal generation and scheduling remain external
  actors; the driver does not invent proposals or silently expand signed policy.
- Family adapters verify a clean exact Git commit and emit the declared metrics plus an exact
  source-snapshot attestation. The
  Solomon adapter invokes the real successor-v2 trainer/evaluator/checker. The Zero adapter invokes
  the frozen q22r evaluator and refuses to run when any replay artifact is absent.

## Family evidence audit

### Solomon

Pass on a clean clone of local commit `90ba65361efed6ba39019de2302a9e5b0c46f108` using
`scripts/harness-solomon-successor-v2.mjs`. The full `retro --execute` path then recorded four
content-addressed objects across five hash-linked events, and `ilxyr verify` passed:

| Metric | Replayed value |
| --- | ---: |
| Targets | 5,896 |
| Integer-transformer NLL | 25,347,655 millibits |
| Uniform NLL | 47,168,000 millibits |
| Retrieval NLL | 38,271,425 millibits |
| Byte-ngram NLL | 38,025,720 millibits |
| Float-transformer NLL | 40,847,697 millibits |
| Candidate zero-probability windows | 0 |
| Frozen checker promotion | pass |

The commit exists in the local NSRL repository but was not present at the observed GitHub branch
head (`c7ee7f3f0c1ca82814db011a40000991f37ea139`). The replay is locally grounded; independent
checkout remains blocked until the source commit and artifacts are published.

### Zero

Grounded at public commit `d561954f93733e95876632311a56a5eaac4c9c9b`. The selected seed-2
model was regenerated from the frozen Q2.2/Q2.2-R lineage and matched both hashes recorded by the
original selection: checkpoint SHA-256
`16fca2e1bf1977fbafd68720f61f7769da7ff05f7f15865f1491112493fb50cd` and quantized model SHA-256
`0fe6e507f8d8ae5bc51e615be79b72425410664976ecc4fbeebb594319f67e8d`. A fresh public checkout
then replayed the adapter with exact-request rate `0.976`, exact-artifact rate `0.976`, replay
regression `0.019190680564071187`, zero rejected-state mutations, and every frozen seed gate
passing. The resulting authority is deliberately scoped to seed 2. Family promotion remains
blocked until seeds 1 and 3 run and pass the independently frozen pipeline.

### First q22r shared task

The shared-task protocol is ready, but a real q22r contract has not been registered. A contract
consumed by both harnesses requires the actual dataset and eval-set SHA-256 values plus a Solomon
q22r encoding/verifier. Those inputs do not exist in the inspected repositories. Publishing a
contract with placeholders or treating the Zero report itself as the dataset would overstate the
evidence, so registration remains deliberately blocked.

## Verification

The V1.1 suite adds tests for immutable shared tasks, designated family proposers, retro success,
terminal retro failure, no forecast-risk claim, and an idempotent end-to-end loop cycle. The schema
suite covers the new shared-task and retro-registration contracts and both family plan templates.
