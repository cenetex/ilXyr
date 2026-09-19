# Recursive-folding cold replay Version 1 — Hold

Recursive Weyl canonicalization recovered all 35 former Phase 0 Version 2
timeouts. All 19,139 recoverable recorded requests completed, and all 19,104
requests with frozen labels returned the same exact multiplicity.

Canonicalization alone does not clear the one-second time boundary. Two E8
requests exceeded it:

- height 6: 1,223.490083 ms; and
- height 8: 2,757.216 ms.

All 248 cells had measured memory below the two-GiB limit. Maximum measured
incremental memory was 5,128,192 bytes. There were no hard timeouts, unknown
memory cells, oracle errors, or exactness mismatches.

This is a Hold for the canonicalization-only resource stage, not an amendment
to the sealed Phase 0 Stop. It establishes the cold delta before session
persistence. The separately authorized session-memo stage may now be measured;
its effect must not be combined with this result.

Evidence identities:

- plan SHA-256:
  `4355bc8a9d156fb7ae3ae9f3867bb0d91f80e76d6b6ac9c56f85cb4bcc4611a1`;
- uncompressed result SHA-256:
  `722539ae1083263dcff72a34ea33a200d11763147d0d500ed63e293e95f352c7`;
- compressed result SHA-256:
  `68a37cbb77109144883849cf1313e9159750f28b4528a9c6f0d08e6a7fa90ef7`;
- Zero executable SHA-256:
  `e09f8059d77598b969f33f24e6e9c38818c195b6f61aed699c771f45f1019914`;
  and
- controller revision:
  `28eb7da08c53dbd9e241add7f5f3451e10e860bc`.

No corpus generation or training is authorized.
