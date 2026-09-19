# Phase 0.6 cloud evidence

This directory seals the persistent LiE bake-off from run
`20260831185858`. The result is a technical reduced surface and a formal
`hold`. No corpus was generated and no model was trained.

- `launch.json` binds the host, package, source commits, budget, and S3 keys.
- `terminal-status.json` is the final auto-termination and cost receipt.
- `results/phase06-evidence.json.gz` contains both complete 2,701-request
  passes, every parsed response, latency and RSS measurements, the tested
  ceilings, and differential comparisons.
- `results/runner-summary.json` is the compact decision surface.
- `results/lie-build.json` binds the unchanged LiE source to the Linux
  executable used by the run.
- `results/sha256sums.txt` seals the checked-in files and records the hash of
  the uncompressed raw evidence.

The two failed launch attempts are recorded one level above this directory.
Both stopped before an oracle query. They are operational evidence, not part
of the mathematical result.
