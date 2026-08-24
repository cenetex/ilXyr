# Governance (enforced)

The workspace `AGENTS.md` describes the contract; this document records how
it is actually enforced for this repository as of 2026-08-24.

## Enforced mechanics

| Contract rule | Enforcement |
| --- | --- |
| Every change goes through a PR | Branch protection on `main`: direct pushes rejected, PR required |
| cenetex bot reviews every PR | `.github/workflows/cenetex-review.yml` posts an approving review on policy-safe PRs |
| Protected paths escalate to human review | The bot refuses to approve PRs touching `.github/workflows/**`, `CODEOWNERS`, `LICENSE`, `docs/SECURITY.md`, or `AGENTS.md`; it labels them `review:human-required` and comments. A human approval then satisfies the gate. |
| Required CI checks pass | Required status checks: `rust`, `msrv`, `schemas`, `validate` |
| Stale approvals don't count | Dismiss-stale-reviews is on: every new push resets the bot's approval, and the workflow re-reviews automatically |

## Not currently enforced

- **Hold period**: GitHub branch protection cannot express time-based gates.
  Merges are gated on approval + checks only.
- **Merge triage**: merges are performed by the author once gates pass; there
  is no separate merger identity.

## Enforcement scope

Protection applies to **all** actors including repository admins
(`enforce_admins` is on), so the sole maintainer is subject to the same
gates as agents.

## Emergency override

There is no push-level bypass. If the Actions pipeline breaks and blocks
merges, the recovery path is deliberate friction: disable branch protection
via Settings or the API, land the fix, re-enable protection. Any such
disable window should be recorded in an issue.

Enforcement is live as of 2026-08-24. See docs/GOVERNANCE.md.

- 2026-08-24: adversarial test suite passed (5/5).
- escalation path verified on protected-path PR.
