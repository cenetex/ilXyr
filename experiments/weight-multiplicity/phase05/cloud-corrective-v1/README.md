# Corrective cloud audit evidence Version 1

This directory freezes the successful corrective cloud audit from Zero
workflow run
[33353839104](https://github.com/atimics/zero-grounded-literary-lm/actions/runs/33353839104).

The run used one c6i.4xlarge for 247 seconds and recorded an estimated EC2 cost
of $0.046655555556. Instance `i-07ed6044d7463a155` is terminated. No corpus was
generated and no model was trained.

## Files

- `launch.json`: immutable launch receipt.
- `terminal-status.json`: terminal completion and cost receipt.
- `results/allocator-audit-v1.json`: five-representation allocator comparison.
- `results/exactness-correction-v1.json`: append-only correction of two false
  exactness labels.
- `results/lie-cross-check-v5.json`: 496-case exact-binary LiE witness.
- `results/execution-record.json`: revisions, executable identities, and caps.
- `results/sha256sums.txt`: result-file checksums.

## Top-level identities

- `launch.json` SHA-256:
  `82e9ece8160bf52c0ea46351e1e186680b7c44d9a43a3410b4340b731353c9c8`.
- `terminal-status.json` SHA-256:
  `0a12b75e713bbf1668f9b2e5af2a3a984c6221169156739d83a15e7362333682`.

Run `sha256sum --check sha256sums.txt` from the `results/` directory to verify
the four result records.
