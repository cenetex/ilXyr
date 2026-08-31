# Repository agent instructions

Follow the workspace engineering contract in the parent directory.

## Execution venue

Read `docs/CLOUD-EXECUTION.md` before starting a benchmark, frontier,
profiling run, large evidence build, or other resource-heavy job.

- Use the local workstation for builds, unit tests, smoke tests, and small
  diagnostics.
- Use the approved cloud environment for a full reportable run when it is
  expected to take more than five minutes, use more than 25% of available
  local memory, create more than one GiB of temporary data, or materially
  interfere with other work.
- Do not silently fall back to a full local run when a cloud path is missing
  or broken. Stop after the local smoke test and repair or add the cloud path
  through a pull request.
- Compare performance only when baseline and candidate use the same frozen
  cloud machine, image, compiler, worker count, limits, and target order.
- A working cloud environment does not by itself authorize paid compute.
  Freeze the package and budget, then obtain explicit launch approval.

