# Phase 0.5 evidence

This directory holds the client-approved Phase 0.5 correctness witness,
dimension-indexed resource frontier, integrity hashes, and decision report.

`SESSION-CORRECTNESS-ADDENDUM-V1-HOLD.md` appends the separate 120-second
correctness-only follow-up for the five exactness-unknown Version 3
representations. It closes four gaps and leaves one E8 representation unknown;
it does not change the resource frontier.

No corpus or model-training artifact belongs here. Corpus generation remains
unauthorized until the client accepts the completed Phase 0.5 report.

Current append-only evidence:

- `COLD-REPLAY-V1-HOLD.md` and `cold-replay-v1.json.gz` record the
  canonicalization-only replay of the complete recoverable Phase 0 Version 2
  request stream.
- `LIE-CROSS-CHECK-V4-PASS.md` and `lie-cross-check-v4.json` are the separate
  independent LiE witness for that canonicalization-only Zero revision.
- `SESSION-FRONTIER-V2-HOLD.md`, `session-frontier-v2.json.gz`, and the compact
  summary record the separate bounded-session memo and order-sensitivity
  stage. The raw result is compressed; the summary is the review surface.
- `SESSION-FRONTIER-V3-HOLD.md`, `session-frontier-v3.json.gz`, and its compact
  summary repeat that stage against Zero PR #150. Version 3 remains an
  append-only predecessor.
- `SESSION-FRONTIER-V4-HOLD.md`, `session-frontier-v4.json.gz`, and its compact
  summary repeat the same frozen roster after direct coefficient-space Weyl
  folding. Version 4 is the controlling frontier evidence: 825 of 828
  representations pass, while one time failure, one order-sensitive case, and
  one time-fail/memory-unknown case keep the decision at Hold.
