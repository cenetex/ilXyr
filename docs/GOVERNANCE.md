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

## Emergency override

Repository admins can bypass protection (`enforce_admins` is off) so that a
broken Actions pipeline cannot deadlock the repository. Any such bypass
should be recorded in the PR conversation.

Enforcement is live as of 2026-08-24. See docs/GOVERNANCE.md.
