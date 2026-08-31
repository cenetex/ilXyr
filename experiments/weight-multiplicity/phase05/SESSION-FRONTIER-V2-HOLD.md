# Bounded-session frontier Version 2 — Hold

The bounded session memo does not clear the full Phase 0.5 resource gate.
Across the frozen 828-representation roster:

- 815 representations passed exactness, replay, per-query time, p95 time, and
  known-memory requirements in all three target orders;
- seven were `time_fail` because at least one query exceeded one second even
  though the order's p95 remained below one second;
- four were `order_sensitive` because the p95 pass/fail decision changed with
  target order; and
- two E8 representations were `time_fail_memory_unknown` after every grouped
  order hit the ten-second hard timeout on its first query.

The four p95 order-sensitive representations are:

- E7 `[1,1,5,1,0,0,0]`: ascending 1,104.808375 ms, descending
  0.061708 ms, seeded 1,018.096750 ms;
- E7 `[0,0,7,1,0,0,0]`: ascending 2,297.231750 ms, descending
  0.045583 ms, seeded 1,953.500042 ms;
- E8 `[1,1,2,0,0,1,1,0]`: ascending 1,099.235166 ms, descending
  0.027750 ms, seeded 1,041.703709 ms; and
- E8 `[3,0,0,1,0,0,0,4]`: ascending 1,167.064333 ms, descending
  0.046834 ms, seeded 1,291.563959 ms.

The very small descending p95 values do not mean that every descending query
passed. Each of those groups had one expensive first query above one second.
The report therefore keeps the p95 order effect and the per-query failure as
separate facts.

Exactness was observed and passed for 826 representations, with no
disagreements and no replay failures. Exactness is unknown, not passed, for
the two all-timeout E8 representations `[0,0,2,1,2,0,0,3]` and
`[0,0,8,0,0,0,0,0]`. No empty comparison is treated as agreement.

Maximum known grouped incremental memory was 21,479,424 bytes, far below the
2,147,483,648-byte limit. Memory remains unknown for the two all-timeout E8
representations because external RSS sampling was unavailable. No value is
substituted for their exact peak or incremental memory.

Parallelism candidates 1, 2, 4, and 8 all met the p95 limit, but each included
at least one query above one second. Safe parallel workers under the full time
contract is therefore zero.

This result is a Hold for the separate bounded-session and order-sensitivity
stage. It does not rewrite the canonicalization-only cold Hold or the sealed
Phase 0 Stop. The LiE Version 4 result remains a separate independent
correctness witness: 496 agreements and zero disagreements. It is not part of
the internal resource measurement.

Evidence identities:

- plan SHA-256:
  `343bc1501db9505ed7b709c7bf36dab4357ef1f47347039149c0382a60393de0`;
- representation manifest SHA-256:
  `bf729002860ddb81c5116f910d0d9849bcab5501a422e6d7fbf77e04b2ed3b7e`;
- measurement capture SHA-256:
  `3fe4a64a07c61cc33eb8e8e06f896a129c3f36a8955464867d3f4ea475e098b1`;
- finalized uncompressed result SHA-256:
  `4d4fa4dfcb3e51b2ce4443a10d0e906be8f7f2fd41df08aa0b26bd203b5f1b9e`;
- finalized compressed result SHA-256:
  `e0c55c0038119136d5b3d39fb13231fb15f8146a52cd7ff6246591f48f4e9a4f`;
- compact summary SHA-256:
  `f928ec7b90581bd7689545eada4f8396cb2d884c9385ae618f7c6424cd4b3a5c`;
- Zero executable SHA-256:
  `9292f74a97cc6a6979137b53b67535c26e4897bc822fdbad6559ccb41ceabbfa`;
- measurement controller revision:
  `cccf37ea0180c3013d58254cd0c4e7bc94d35183`; and
- evidence finalizer revision:
  `fa41242b58d6f0153394810b06747f52226579af`.

No corpus generation or training is authorized.
