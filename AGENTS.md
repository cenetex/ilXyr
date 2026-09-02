# Repository agent instructions

## Development flow

A clear request in chat, an issue, or a pull request authorizes normal work.
Start from the request itself; do not require a separate issue, form, label,
approval comment, or evidence record.

Every code change uses a branch and pull request. Developers and agents may
create and update pull requests, merge them when GitHub reports the required
checks green, deploy, verify, and roll back. Workflow, security, license,
governance, and agent-instruction files use the same path as ordinary code.

The pull request, check results, commits, and deployment history are the audit
trail. There are no required reviews, exact-SHA approval commands, protected-path
labels, hold periods, or external merge queues.

Use the smallest useful check while iterating. Before merge, run the relevant
Rust, MSRV, and schema checks. Ask the human only when the request leaves a
material product choice unresolved or an action is irreversible, affects an
outside party, exposes secrets, risks data loss, or commits to an unbounded
cost.

## Execution venue

Read `docs/CLOUD-EXECUTION.md` before a benchmark, frontier or profiling run,
large evidence build, or other resource-heavy job.

- Use the local workstation for builds, unit tests, smoke tests, and small
  diagnostics.
- Use the configured cloud environment when a full run would take more than
  five minutes, use more than 25% of local memory, create more than one GiB of
  temporary data, or materially disrupt other work.
- Keep baseline and candidate performance runs on the same frozen machine,
  image, compiler, worker count, limits, and target order.
- A request that names a bounded paid run or budget authorizes it. Otherwise,
  present the expected cost before starting paid compute.
- Do not commit credentials, private data, or generated runtime artifacts.

## Completion

Work is complete when the requested behavior exists, relevant checks pass, the
pull request is merged, and any deployment or experiment requested by the user
has been verified. Fix forward or roll back if verification fails.
