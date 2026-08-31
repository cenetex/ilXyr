# PR 92 governance-transition override

- Date: 2026-08-31
- Repository: `cenetex/ilXyr`
- Pull request: `#92`
- Pull-request head: `711c69dfe30e5dc8f8a616e02be01b487bb47cd2`
- Merge commit: `35d6974e4b61306cfda3f8b4182d781545d750ca`
- Merge time: `2026-08-31T21:56:40Z`
- Operator: `atimics`

## Reason

PR 92 replaced the old `pull_request` governance workflow with the trusted
base-branch `pull_request_target` workflow. GitHub evaluated the pull request
with the old workflow definition, but that definition no longer matched the
new event. The new definition was not yet on the default branch. As a result,
the required `gatekeep` status could not be created for the transition pull
request even though all runnable code-health checks passed.

The same pull request repaired the solo-maintainer review deadlock, so the new
protected-path authorization command could not be used until the pull request
was merged.

## Authorized action

The owner explicitly authorized one guarded transition operation. It:

1. changed the required approving-review count from one to zero;
2. temporarily removed only `gatekeep` from the required status checks;
3. merged PR 92 only if its head still matched the SHA recorded above;
4. restored the required approving-review count to one;
5. restored `gatekeep` and enabled strict status checks; and
6. changed default Actions permissions from write to read while retaining the
   ability of the two governance workflows to request their narrow review and
   status permissions.

The operation installed an exit handler that restored the old review, status,
and Actions-permission settings if a step failed before the intended settings
were fully installed.

## Verification

- PR 92 is merged as `35d6974e4b61306cfda3f8b4182d781545d750ca`.
- Branch protection again requires one approval and dismisses stale reviews.
- Branch protection is enforced for administrators.
- Strict status checks are enabled.
- The required GitHub Actions contexts are `rust`, `msrv`, `schemas`, and
  `gatekeep`.
- Default Actions permissions are read; pull-request approval remains allowed
  when a workflow explicitly requests the required permission.

This is an owner-authorized operational record, not independent evidence. The
follow-up pull request containing this file is the end-to-end test of the new
protected-path approval procedure.
