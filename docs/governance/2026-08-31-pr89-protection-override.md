# PR 89 branch-protection override

- Date: 2026-08-31
- Repository: `cenetex/ilXyr`
- Pull request: `#89`
- Pull-request head: `5597ddbc3d9d983c5aaca31ccbb8377551bc1689`
- Merge commit: `6f2dbe53db8e050c8b00a00b407197d9fee8359e`
- Merge time: `2026-08-31T19:52:40Z`
- Operator: `atimics`

## Reason

PR 89 added the repository `AGENTS.md`, so the old path workflow marked it
`review:human-required`. GitHub prevented the PR author from approving their
own PR. Branch protection required one approval and enforced the rule for
administrators. The documented solo-maintainer path was therefore impossible.

## Authorized action

The owner explicitly authorized a temporary change of the required approving
review count from one to zero, followed by the merge of the already-green PR
and immediate restoration to one. A guarded operation restored the old value
even if the merge command failed.

## Verification

- PR 89 is merged as `6f2dbe53db8e050c8b00a00b407197d9fee8359e`.
- The required approving review count was read back as one after the merge.
- Dismiss-stale-review behavior remained enabled.
- The PR retained `review:human-required` and had no approving review. This is
  evidence that the old label was advisory and the old protected-path process
  was not viable for a solo maintainer.

The available token could not read the organization audit-log endpoint, so
this record does not claim independent audit-log confirmation of the setting
window.
