# Session correctness addendum Version 1 — Hold

This append-only addendum addresses the five representations whose exactness
was unknown in the sealed bounded-session frontier Version 3. It does not
rewrite that report and makes no time or memory claim.

The correctness-only controller used a 120-second per-query hard timeout. It
compared the bounded-session executable at Zero revision `65e3523` with the
fresh-memo recursive-canonicalization reference at revision `51b594f`. For
each representation it requested the same 32 targets as the sealed Version 3
frontier, in ascending, descending, and seeded order, plus two ascending
replays.

Four of the five gaps are closed:

- D8 `[0,0,1,1,2,4,0,0]`: pass;
- E7 `[1,1,5,1,0,0,0]`: pass;
- E7 `[0,0,7,1,0,0,0]`: pass; and
- E8 `[0,0,2,1,2,0,0,3]`: pass.

Each passed representation completed all 32 cold-reference targets and all
160 session-to-reference comparisons. Across the four representations there
were 640 observed comparisons, zero multiplicity disagreements, and zero
replay failures.

E8 `[0,0,8,0,0,0,0,0]` remains unknown. Its cold reference and all five
session runs reached the 120-second hard timeout before their first answer.
The addendum records zero observed comparisons and an unobserved replay for
this representation. Empty output is not treated as agreement.

The result is therefore Hold: four prior unknowns become observed passes, one
remains unknown, and no correctness failure was observed. The sealed Version
3 resource Hold remains unchanged. Its one-second time boundary and memory
record must not be inferred from this longer correctness-only run.

LiE Version 4 remains a separate independent witness for recursive
canonicalization only. It does not independently validate the session memo.

Evidence identities:

- correctness plan SHA-256:
  `804ceb2977508d6553e83fa3b525cbad69dfac50ccd50a156537805036d833fd`;
- result SHA-256:
  `2c36e7fea57806c0265c9983e982c25a88aec1a6aa770a146b8966b114347617`;
- controller SHA-256:
  `d5a54e17b050175845dd9d47a928fa4f27ae2b91073a254a240b0dd7408118e8`;
- cold-reference Zero executable SHA-256:
  `e09f8059d77598b969f33f24e6e9c38818c195b6f61aed699c771f45f1019914`;
- bounded-session Zero executable SHA-256:
  `626a28f53e6e94bc04724dabe3df71c9b1da9e0cb1cb56305ada07d95e9931a7`;
- sealed Version 3 source result SHA-256:
  `370361788e71538e357faa31d3179a1ba500d7661d243cd7030d5320c3cb97e2`.

No corpus generation or model training is authorized.
