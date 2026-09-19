# Bounded-session frontier Version 3 — Hold

Version 3 is the controlling bounded-session result for Zero PR #150 at
commit `65e3523`. It repeats the Version 2 roster and orders after the PR gained
an optional presized-memo audit control. Version 2 remains sealed against its
earlier executable and is not rewritten.

Across the frozen 828-representation roster:

- 812 representations passed the complete resource and observed-correctness
  requirements;
- nine were `time_fail` because at least one query exceeded one second;
- four were `order_sensitive` because the p95 pass/fail result changed with
  target order; and
- three were `time_fail_memory_unknown` after a grouped order hit the
  ten-second hard timeout.

The four p95 order-sensitive representations are:

- D8 `[0,0,1,1,2,4,0,0]`: ascending 1,564.278208 ms, descending
  0.445875 ms, seeded 1,717.639042 ms;
- E7 `[1,1,5,1,0,0,0]`: ascending 3,189.149750 ms, descending
  0.053166 ms, seeded 1,021.828334 ms;
- E8 `[1,1,2,0,0,1,1,0]`: ascending 1,098.658750 ms, descending
  0.033375 ms, seeded 1,046.408208 ms; and
- E8 `[3,0,0,1,0,0,0,4]`: ascending 1,170.211292 ms, descending
  0.037750 ms, seeded 1,282.547334 ms.

Every descending group above still had an individual query over one second.
The p95 order effect and the per-query failure remain separate facts.

Exactness was observed and passed for 823 representations. There were no
observed disagreements and no replay failures. Exactness is unknown, not
passed, for five representations: D8 `[0,0,1,1,2,4,0,0]`, E7
`[1,1,5,1,0,0,0]`, E7 `[0,0,7,1,0,0,0]`, E8
`[0,0,2,1,2,0,0,3]`, and E8 `[0,0,8,0,0,0,0,0]`. The first two completed
all grouped orders but their cold reference hit the hard timeout. The final
three also had at least one grouped hard timeout.

Maximum known grouped incremental memory was 21,495,808 bytes, far below the
2,147,483,648-byte limit. Grouped memory is unknown for the three
`time_fail_memory_unknown` representations. Exact peak and incremental memory
are null for each timed-out order; no warm or sampled value is substituted.

Parallelism candidates 1, 2, 4, and 8 met the p95 limit but each included at
least one query above one second. Safe parallel workers under the full time
contract is zero.

This is a Hold for the current bounded-session and order-sensitivity stage.
The session memo materially reduces grouped cost, but it does not clear the
frozen frontier. The canonicalization-only Hold and the sealed Phase 0 Stop
remain separate records.

LiE Version 4 remains a separate independent correctness witness for the
canonicalization stage: 496 agreements and zero disagreements. It is not part
of this internal resource measurement and is not described as an independent
audit of ilXyr or Zero.

Evidence identities:

- plan SHA-256:
  `0af98a10412b085f204edb9ec58c8a5a10101f0956fc42b2b0aaeb972af30665`;
- representation manifest SHA-256:
  `e4345e005c28996fb17b3af5b7882bca35ea0ab6a97fe49df2190d0393497392`;
- measurement capture SHA-256:
  `22fa14c1ff777f7ba3faf7404494c98d56176f3c169b7b5a5f0404f15b69bf94`;
- finalized uncompressed result SHA-256:
  `3fa76f3b81d33a4aeb8d796726cde3a59a2c05a23922fa83ea034e763c483cc1`;
- finalized compressed result SHA-256:
  `370361788e71538e357faa31d3179a1ba500d7661d243cd7030d5320c3cb97e2`;
- compact summary SHA-256:
  `e21ea0de680fe6313ce662ae8aee5455957c6edeefd3bb8e6f51a99b99f90a80`;
- Zero executable SHA-256:
  `626a28f53e6e94bc04724dabe3df71c9b1da9e0cb1cb56305ada07d95e9931a7`;
- measurement controller revision:
  `9cefcdc45a313f8c7f8c393fa265c28400374912`; and
- evidence finalizer revision:
  `23c81304ab27e69232375a64d5391f160fbd7fa4`.

No corpus generation or training is authorized.
