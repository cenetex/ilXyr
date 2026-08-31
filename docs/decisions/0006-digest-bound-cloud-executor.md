# ADR 0006: digest-bound cloud executor

- Status: proposed roadmap decision
- Date: 2026-08-30

## Context

ilXyr has a synchronous `local-command` executor. It is useful for public-weight experiments, but
it does not isolate the host, attest the machine, or provide a general remote execution boundary.
Moving the same mutable checkout to a cloud machine would not fix those limits.

Zero's AWS workflows provide useful implementation evidence. They bind source archives, runners,
budgets, instance identity, and results; use conditional writes for execution locks and receipts;
enforce launch-relative watchdogs; and separate launch from collection. They are experiment-specific
AWS workflows, not a provider-neutral ilXyr executor.

Braid may supply a governed dataset release by immutable digest. A Braid release does not authorize
training and must not become an implicit mutable input.

## Decision

The unit of remote execution will be an immutable executor job package. A provider adapter consumes
the package by digest. It must not execute a branch, tag, mutable object key, or live checkout.

A package freezes:

- one experiment ID and compiled experiment artifact;
- source repository commits and source archive digests;
- executable, oracle, harness, data, model, and configuration digests;
- provider, region, machine type, architecture, machine image, storage, and relevant runtime;
- maximum time and cost, price evidence, watchdog behavior, and shutdown policy;
- ordered targets, concurrency, allocation, retry, and failure policy;
- network and export policy;
- expected result and attestation formats; and
- the trusted executor identity expected to sign the result.

Provider resolution must happen before sealing. A lookup such as “current Ubuntu image” is not an
execution input. Its resolved image ID and required digest belong in the sealed package.

The normal frontier and a presized-memory audit are different experiments. They must use different
experiment IDs, job package digests, budgets, execution locks, and result records. Neither run may
borrow unused budget or alter the other's target order.

A job package proves identity, not authorization. Existing admission, funding, and signed epoch
budget checks remain mandatory. A dispatcher must verify both the package digest and the current
authorization before it creates cloud resources.

## Adapter boundary

A provider adapter has four logical operations:

1. `preflight(package_digest)` checks permissions, capacity shape, immutable inputs, and price
   evidence without starting paid compute.
2. `launch(package_digest, authorization_ref)` creates one idempotent execution and returns a
   write-once launch receipt.
3. `observe(launch_receipt)` reports provider state without changing compute state.
4. `collect(launch_receipt)` returns a digest-indexed result bundle and signed executor attestation.

Collection cannot launch, restart, or extend compute. Recovery requires a new, explicitly
authorized execution record linked to the failed receipt. Provider-specific identifiers live in
receipts, not in the scientific experiment contract.

Workers must verify every input digest before process creation, execute the sealed entry point,
publish write-once identity/status/result receipts, and terminate inside the frozen watchdog. The
collector verifies those receipts and the result bundle before ilXyr ingests attestation or evidence.

## Delivery sequence

1. Publish this decision and the plain, read-only protocol/API index at `ilxyr.cenetex.com`. Keep
   proposal data, write routes, and cloud-launch authority off the public site.
2. Add a strict executor-job-package schema, a deterministic pack/verify command, positive fixtures,
   tamper fixtures, and golden digest tests. No cloud calls.
3. **Implemented:** add the provider-neutral adapter interface and a fake adapter conformance
   suite. The remote profile uses the same admission, signed-budget, allocation, executable, and
   argument gates while preserving the existing local executor behavior.
4. Extract an AWS adapter from the proven Zero patterns: OIDC, conditional object writes, resolved
   AMI identity, instance watchdogs, independent targets, and a read-only collector. Tests and
   permission preflight must not start compute.
5. Freeze the two real job packages: normal frontier and presized-memory audit. Review package
   digests, machine type, budgets, target order, and allocation policy before authorization.
6. Run one explicitly approved, minimal-cost diagnostic package. Only after its receipts and
   attestation verify may a scientific cloud run be considered.
7. Add the V2 authenticated service API after the adapter contract and recovery rules are stable.

No paid cloud work is authorized by steps 1 through 5.

## Rejected alternatives

- **Run a mutable checkout on AWS.** This moves the drift problem; it does not remove it.
- **Make AWS workflow YAML the protocol.** It binds ilXyr to one provider and mixes scientific
  identity with orchestration details.
- **Let the portal launch instances directly.** The portal is a collaboration surface and does not
  hold ledger or spending authority.
- **Combine the frontier and memory audit in one run.** Shared process state, optional stopping, and
  budget transfer would weaken the comparison and recovery boundary.
