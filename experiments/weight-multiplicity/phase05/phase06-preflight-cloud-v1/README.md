# Phase 0.6 LiE preflight cloud evidence

This directory seals the successful retained-surface preflight from run
`20260831212800`. The result is `preflight_pass`: all 572 representations,
4,218 differential comparisons, and 4,218 replay comparisons pass.

- `launch.json` binds the cloud host, package, frozen inputs, build identity,
  budget, and automatic shutdown.
- `terminal-status.json` is the final exit, runtime, and cost receipt.
- `results/preflight-evidence.json.gz` contains every representation result,
  both complete LiE passes, resource measurements, comparisons, replay checks,
  calibration records, and per-type tested ceilings.
- `results/runner-summary.json` is the compact decision surface.
- `results/lie-build.json` records two independent matching builds of the
  unchanged LiE source.
- `results/cloud-sha256sums.txt` preserves the hashes written by the cloud
  runner for the uncompressed result files.
- `results/sha256sums.txt` seals the checked-in compressed evidence and compact
  records.

The private bootstrap trace is intentionally excluded because it may contain
short-lived instance-metadata authorization material. It does not affect the
decision. The checked-in runner standard-error log is empty.

No corpus was generated and no model was trained.
