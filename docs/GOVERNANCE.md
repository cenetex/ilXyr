# Governance

This document records the governance that is actually enforced for this
repository as of 2026-08-31. It does not claim an independent reviewer, a
merge-triage service, or a hold period that does not exist.

## Enforced mechanics

| Rule | Enforcement |
| --- | --- |
| Every change uses a pull request | Branch protection rejects direct pushes to `main` |
| Required CI passes | `rust`, `msrv`, `schemas`, and `gatekeep` are required |
| Ordinary paths receive automated review | The trusted base-branch workflow approves the exact pull-request head |
| Protected paths need deliberate owner action | An administrator must comment `/approve-protected <exact-head-sha>` before the bot approves that commit |
| A new push invalidates approval | Stale reviews are dismissed and the new head is reviewed again |
| Administrators follow the same merge gate | Branch protection is enforced for administrators |

The automated reviewer is the repository `github-actions` identity. Calling it
an independent human reviewer or a separate `cenetex` principal would be
false. For a protected change, the administrator command is owner
authorization and the resulting review is an owner-authorized bot approval.
It is not an independent review.

## Protected paths

The path policy in `scripts/governance-path-policy.mjs` protects:

- `.github/workflows/**`;
- `CODEOWNERS`, `.github/CODEOWNERS`, and `docs/CODEOWNERS`;
- root license files beginning with `LICENSE`;
- `docs/SECURITY.md` and this document;
- append-only audit records under `docs/governance/`;
- the governance path-policy program and its tests; and
- every `AGENTS.md`.

The review workflow uses `pull_request_target`, reads policy from the trusted
base commit, never checks out pull-request code, binds its review to the event
head SHA, checks old and new names for renamed files, checks that SHA again
after reading the file list, and cancels stale runs. Protected paths receive a
successful policy status but no approval, so the required-review gate remains
unsatisfied until owner authorization.

## Protected approval procedure

1. Wait for the protected-path comment from `github-actions`.
2. Review the diff and copy the 40-character head SHA from that comment.
3. As a repository administrator, add a comment containing only:

   ```text
   /approve-protected <exact-head-sha>
   ```

4. The default-branch approval workflow verifies administrator permission,
   open pull-request state, the exact current head, and the presence of a
   protected file. It then approves that SHA as `github-actions` and records a
   receipt comment.
5. Any later push dismisses the review. Repeat the process with the new SHA.

This procedure exists because GitHub does not let an author approve their own
pull request. It creates a clear owner decision without pretending that a solo
maintainer supplies independent review.

## Merge behavior

There is no separate merge-triage identity and no time-based hold. The author
may merge after the required approval and checks pass. Branch protection is
configured to require the branch to be current with `main`, so overlap is
resolved and CI reruns before merge.

CI runs on pull requests and on pushes to `main`. It does not run a duplicate
push suite for every feature-branch commit.

## Emergency override

The normal protected command must be used whenever Actions works. If the
governance workflow itself is broken, the owner may explicitly authorize a
temporary protection change. The operator must:

1. record the pull request, exact head, reason, old setting, and intended new
   setting;
2. make only the narrow change needed for the merge;
3. restore protection in the same guarded operation;
4. verify the merged commit and restored live settings; and
5. add an append-only record under `docs/governance/`.

The first such record is
`docs/governance/2026-08-31-pr89-protection-override.md`.

## Settings outside Git

The repository files cannot enforce mutable GitHub settings by themselves.
The intended live settings are:

- pull requests required for `main`;
- one approving review with stale reviews dismissed;
- administrator enforcement enabled;
- strict status checks enabled;
- required contexts `rust`, `msrv`, `schemas`, and `gatekeep` from GitHub
  Actions; and
- default workflow permissions set to read, while the two governance
  workflows request their narrow write permissions explicitly.

After a governance change, verify these settings through the GitHub API and
record any drift. Do not infer the live settings from this file alone.
