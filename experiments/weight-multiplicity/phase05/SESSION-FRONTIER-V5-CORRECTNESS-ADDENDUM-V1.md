# Prepared-DAG frontier Version 5 correctness addendum

This is an append-only clarification to `SESSION-FRONTIER-V5-HOLD.md`. The
Version 5 result, summary, hashes, and Hold decision remain unchanged.

The Version 5 report says that all 827 completed representations had no
observed disagreements and identical deterministic projections across two
prepared replays. That statement is true, but one representation needs a more
precise account of how correctness was observed.

For E8 `[0,0,2,1,2,0,0,3]`, all three prepared orders and both prepared
replays completed all 32 target entries. The same-run fresh recursive reference
completed only 5 entries before the depth-374 request reached the ten-second
hard timeout. Prepared replay identity proves deterministic prepared output; it
does not by itself prove agreement with the recursive algorithm for the other
27 entries.

The sealed Version 4 record supplies the missing internal comparison. Version
4 completed the same frozen target set with the direct coefficient-space
recursive engine. After deduplicating by exact request, both versions contain
12 unique requests. All 12 Version 5 prepared multiplicities match the Version
4 recursive multiplicities. The sorted compact `{request, multiplicity}` maps
have the same SHA-256:

`2bd8df410586f0a4f58e2e95ac667fba4da71b5afc9d1fa671aa68cb3c7d2f22`.

There are 12 agreements and zero disagreements. The full answer map and the
projection recipe are sealed in
`session-frontier-v5-correctness-addendum-v1.json`.

This closes the specific cross-engine comparison gap and does not change the
Version 5 count of 827 passes. It is still internal, cross-version evidence.
It is not an independent audit.

LiE Version 4 remains in its separate category as an independent predecessor
witness. It did not execute the Version 5 prepared binary, so it is not a
direct independent witness for this result. A direct current-binary LiE check
remains pending.

Evidence identities:

- Version 4 compressed result SHA-256:
  `1dc6fd54cf8236f8ef78ec4776ec769e4ef8da52f02efd352ce6d8b2d2e44db9`;
- Version 5 compressed result SHA-256:
  `996232dace6728e1b669d3ae83b2750c92e4a61fd685033d9517ab32f3d413d4`;
- Version 5 summary SHA-256:
  `84e477eda7790440b0e88258ec357eb4ecb17af64bc1f4277f2c56cb85e98b6c`;
- unchanged Version 5 report SHA-256:
  `9570eec4dcf3494ae46e3eba4cfd08e60b242af147cf00af85dac04a3b0f399b`;
- addendum JSON SHA-256:
  `4ad0ef7ec7787798e89fcb285b9b9a0bf244a156f8151f3509e4cfbe81d598c9`.

The frontier decision remains Hold. No corpus generation or training is
authorized.
