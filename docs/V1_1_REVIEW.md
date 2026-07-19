# V1.1 family-onboarding review

- Review date: 2026-07-18; empirical audit updated 2026-07-19
- Scope: shared-task contracts, retro-registration, Zero and Solomon local harness adapters,
  and the policy-bounded loop-cycle driver
- Verdict: protocol implementation accepted; the available frozen family evidence is registered.
  Solomon is remotely checkoutable for authorized users but not public, and Zero's completed
  three-seed result is a grounded family no-go.

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
  Solomon adapter invokes the real successor-v2 trainer/evaluator/checker. The Zero seed adapter
  invokes the frozen q22r evaluator and refuses to run when any replay artifact is absent. The
  multi-seed adapter re-executes the published aggregate checker, validates all three decisions and
  failed-seed stop rules, and refuses to turn the aggregate no-go into promotion evidence.

## Family evidence audit

### Solomon

Pass on a clean checkout of commit `90ba65361efed6ba39019de2302a9e5b0c46f108` using
`scripts/harness-solomon-successor-v2.mjs`. The exact commit is advertised as
`codex/publish-solomon-successor-v2` on the NSRL remote and was replayed again from a fresh clone.
The full `retro --execute` path then recorded four
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

NSRL remains a private GitHub repository. The source is independently checkoutable by authorized
users, but unauthenticated public replay remains unavailable; this access limitation is not
silently described as public grounding.

### Zero

Seed 2 is grounded at public commit `d561954f93733e95876632311a56a5eaac4c9c9b`. Its selected model
was regenerated from the frozen Q2.2/Q2.2-R lineage and matched both hashes recorded by the
original selection: checkpoint SHA-256
`16fca2e1bf1977fbafd68720f61f7769da7ff05f7f15865f1491112493fb50cd` and quantized model SHA-256
`0fe6e507f8d8ae5bc51e615be79b72425410664976ecc4fbeebb594319f67e8d`. A fresh public checkout
then replayed the adapter with exact-request rate `0.976`, exact-artifact rate `0.976`, replay
regression `0.019190680564071187`, zero rejected-state mutations, and every frozen seed gate
passing. That authority remains deliberately scoped to seed 2.

Seeds 1 and 3 then ran the frozen acquisition policy and both stopped after replay exceeded 2% on
two consecutive full evaluations. Their disjoint promotion sets remained untouched. The published
three-seed aggregate at public merge commit `d0ed47e2dffd0c6709da9b1970a8a3f9db4f3ad3`
was replayed through `scripts/harness-zero-q22r-multiseed.mjs` and registered in a fresh ledger:

| Seed | Decision | Operation rate | Exact-artifact rate | Replay regression |
| ---: | :---: | ---: | ---: | ---: |
| 1 | no-go | 0.818 | 0.818 | 0.026854690374003717 |
| 2 | go | 0.976 | 0.976 | 0.019190680564071187 |
| 3 | no-go | 0.764 | 0.764 | 0.02587369711833232 |

The aggregate registration records `completed_seeds=3`, `go_seeds=1`, `no_go_seeds=2`,
`family_promotion_eligible=0`, and `failed_seed_promotion_evaluations=0`. It produced four
content-addressed objects across five hash-linked events; `ilxyr verify` passed. This grounds the
negative family decision, not a ZERO.4 promotion. ZERO.3 remains current.

### First q22r shared task

The shared-task protocol is ready, but a real q22r contract has not been registered. A contract
consumed by both harnesses requires the actual dataset and eval-set SHA-256 values plus a Solomon
q22r encoding/verifier. Those inputs do not exist in the inspected repositories. Publishing a
contract with placeholders or treating the Zero report itself as the dataset would overstate the
evidence, so registration remains deliberately blocked.

## Verification

The V1.1 suite adds tests for immutable shared tasks, designated family proposers, retro success,
terminal retro failure, no forecast-risk claim, and an idempotent end-to-end loop cycle. The schema
suite covers the new shared-task and retro-registration contracts and all three family plan
templates.
