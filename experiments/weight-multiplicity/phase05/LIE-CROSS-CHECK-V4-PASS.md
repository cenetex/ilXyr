# LiE cross-check Version 4 — Pass

Version 4 reran the exact 496 frozen Version 3 witness cases against the
recursive-canonicalization-only Zero executable. All cases agreed exactly: 16
for each of the 31 supported types, including all seven E7 and all eight E8
fundamental representations.

This is the independent correctness witness for Zero revision
`51b594fc4ca4f4613ab943f54e78668516d1b7b9`. It is separate from the internal
Zero/ilXyr audit and from the cold resource result.

Evidence identities:

- case manifest SHA-256:
  `cef67e70a8865fba8c0e03be7688c455c7da75b00e823c68003c3da42d6b04e4`;
- result SHA-256:
  `f5e724365db6a8f815c133133b21bd9acbbb8245035e8e111b0ef2bd7c16449b`;
- Zero executable SHA-256:
  `e09f8059d77598b969f33f24e6e9c38818c195b6f61aed699c771f45f1019914`;
  and
- LiE executable SHA-256:
  `aaf91a06cb8012f27d1f7baf9e2d753726fe386c79e68ce88efb9abb01d4cd11`.

This Pass clears the independent correctness gate for recursive
canonicalization. It does not clear the cold resource Hold and does not
authorize corpus generation or training.
