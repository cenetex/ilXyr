# Phase 1 corpus launch attempt 20260901010516: Hold

## Outcome

The corrected package `9051ec3574db0f9a88e93ba867b3637eb8616ff90e0b91657ac7b56983b4db3e`
launched on AWS instance `i-0d744d3300a164f0b` at
`2026-09-01T01:16:05Z`. The instance shut itself down after the corpus
controller exited with code 1. No corpus was sealed and model training remains
unauthorized.

The run passed package verification, both LiE builds matched, Zero built and
passed its self-test, and the oracle budget froze before the first corpus
record. The controller then completed 112,640 oracle calls and wrote live
progress before failing.

## Cause

`BudgetTracker.snapshot()` used `Math.max(...latencies)`. Expanding the
112,640-element latency array exceeded the Node.js call-stack limit during a
progress checkpoint. This is a controller telemetry defect, not an oracle
failure or a mathematical result.

The terminal receipt also reported 684 elapsed seconds and USD 0.1292 because
the launch reused the earlier preflight epoch. AWS records the actual launch at
01:16:05Z and the terminal receipt was stored at 01:17:33Z. The receipt's
elapsed-time and cost fields are invalid; exact billed cost is not yet known.

## Correction

- Compute the latency maximum with a bounded loop and cover a 200,000-sample
  snapshot in the self-test.
- Reject paid launches whose supplied launch epoch is more than 60 seconds old.
- Keep this run immutable. Do not reuse its package key, run ID, or output
  prefix.
- Require a new frozen package, free preflight, and explicit approval before a
  retry.

## Preserved evidence

- Frozen budget: 2,430,387 oracle calls, 8,553,459 query milliseconds, and
  2,139 wall seconds at the binding limits.
- Last progress: 112,640 calls, 90,682.271 query milliseconds, and 17.691 wall
  seconds inside the generator.
- Reproducible LiE executable SHA-256:
  `bc1099ccfa0f890868e2261c106ede4fd0e52dcd86a4d03b16318ba39674e974`.
- Zero executable SHA-256:
  `ebe34bf41f9deb1728628ebcb0d8046386ed0dc1cacccdd64ef643f616b505a1`.
- Corpus records: zero sealed.
- Training artifacts: none.
