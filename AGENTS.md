# Repository agent instructions

## Governance

Every change must use a branch and pull request. The repository-specific flow
below replaces parent-workspace references to a separate merge-triage identity
and hold period; neither exists in this solo-maintainer repository.

- For ordinary paths, `github-actions` approves the exact pull-request head
  after the required path-policy check passes.
- Changes to workflows, CODEOWNERS, licenses, security or governance policy,
  or any `AGENTS.md` require an administrator to comment
  `/approve-protected <exact-head-sha>` on the pull request.
- That command is owner authorization. The bot approval that follows is not an
  independent human review and must never be described as one.
- A new push invalidates the authorization. Use the new head SHA.
- Merge only after the required review and the `rust`, `msrv`, `schemas`, and
  `gatekeep` checks pass. The author may merge the ready pull request.
- Never change branch protection to merge an ordinary pull request. Emergency
  changes require explicit owner authorization and an append-only record under
  `docs/governance/`.

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
