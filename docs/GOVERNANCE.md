# Development flow

ilXyr is a solo project. Its development process is optimized for fast,
traceable iteration:

```text
request -> branch -> pull request -> checks -> merge -> verify
```

The request authorizes the work. The pull request is the collaboration and
tracking surface. The `rust`, `msrv`, and `schemas` checks protect the
default branch. When they are green and GitHub reports the pull request
mergeable, a developer or coding agent may merge it.

No separate approval is required for workflow, security, license, governance,
or agent-instruction changes. The former `gatekeep` status, automated review,
`/approve-protected <sha>` command, protected-path labels, and external hold
notice are retired.

GitHub already records the request, diff, discussion, checks, author, merge, and
resulting commit. Do not duplicate that record in an approval ledger.

Ask the owner only for a material decision that is ambiguous or difficult to
reverse. Secret handling, data loss, external publication, and unbounded paid
compute still need deliberate care; ordinary coding, merging, deployment, and
rollback do not need extra paperwork.

## Intended GitHub settings

- Changes to `main` arrive through pull requests.
- Required checks are `rust`, `msrv`, and `schemas`.
- No approving review is required.
- Branches must be current when GitHub needs that to give a reliable check
  result.
- Administrators and installed coding agents may merge green pull requests.

Historical files under `docs/governance/` describe the retired system. They
are records, not current instructions.
