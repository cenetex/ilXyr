# Cloud execution

This page answers one operational question: should a job run on the developer
workstation or in the approved cloud environment?

## Venue policy

Local execution is for fast feedback:

- compile and link checks;
- unit, schema, and self-tests;
- a small representative smoke test; and
- read-only inspection and result verification.

Use the approved cloud environment for the full run when any of these are
true:

- the run is expected to take more than five minutes;
- it may use more than 25% of available local memory;
- it may create more than one GiB of temporary data;
- it is a full frontier, benchmark, profile, calibration, or replay; or
- its timing or memory result will be entered as evidence.

Choose the venue before the full run begins. Use the general AWS launcher or
the existing experiment-specific AWS pattern. A launcher repair belongs in a
pull request before the full run.

The thresholds above select a venue. They do not authorize spending. A paid
launch still needs an explicit approval tied to a frozen package and budget.

## Fair performance comparisons

Changing the machine can change the result. A candidate cloud run cannot be
reported as a speedup over a local baseline.

For a performance comparison, freeze and run both baseline and candidate with
the same:

- provider, region, instance type, CPU architecture, and resolved machine
  image;
- compiler, flags, runtime, and dependencies;
- worker count, memory and time limits, target roster, target order, and
  replay count; and
- controller and measurement method.

If an older baseline was measured elsewhere, rerun it in the new venue. Keep
the old evidence sealed and name the new comparison as a separate series.

## Required workflow

1. **Freeze.** Record source commits, plan and manifest hashes, executable or
   source archive hashes, machine identity, compiler settings, ordered work,
   limits, watchdog, maximum runtime, and maximum cost.
2. **Test locally.** Build the package, run self-tests, and run only a small
   representative smoke test.
3. **Package.** Create an immutable archive. A worker must never execute a
   branch, mutable object key, or live checkout.
4. **Preflight.** Verify credentials, resolved image, capacity shape, storage,
   price evidence, permissions, package hashes, and output location without
   starting paid compute.
5. **Authorize.** Bind explicit launch approval to the package identity and
   cost ceiling.
6. **Launch asynchronously.** Arm the shutdown watchdog before setup work.
   Publish immutable launch identity and running status. Do not hold an agent
   or local terminal open for the duration of the job.
7. **Observe and collect.** Observation must not launch, restart, or extend
   the instance. Collect results from immutable storage after terminal state.
8. **Verify and import.** Check package, result, receipt, and executable hashes;
   confirm the instance terminated; then add the compact evidence and report
   through a pull request. Keep large temporary captures out of Git.

## Current implementation map

ilXyr now has a general AWS launcher. The command flow is:

```text
remote-aws-stage
remote-aws-preflight
remote-authorize
remote-aws-launch
remote-aws-observe
remote-aws-collect
remote-report-accept
```

The launcher checks the exact AMI ID and digest tag. It also checks the
instance architecture, subnet, security groups, IAM profile, package object,
result bucket, frozen price evidence, and cost ceiling. EC2 `DryRun` proves
launch permission during preflight. Launch creates one private instance with
encrypted storage, IMDSv2, termination-on-shutdown, and a stable client token.
The frozen bootstrap script arms the watchdog.

The existing experiment-specific AWS pattern remains useful:

- `scripts/aws/weight-multiplicity-phase06-package.sh` builds a digest-bound
  package and runs its local checks;
- `scripts/aws/weight-multiplicity-phase06-run-instance.sh` performs a free
  AWS dry run or creates the approved instance;
- `scripts/aws/weight-multiplicity-phase06-user-data.sh` verifies package and
  plan identities, writes status and results to immutable storage, enforces
  time and cost bounds, and shuts the instance down; and
- `experiments/weight-multiplicity/phase05/phase06-cloud-v1/` shows the sealed
  launch, terminal, build, result, and checksum records from a completed run.

New heavy weight-multiplicity runs should reuse this structure with a new
experiment identity, package, budget, storage prefix, runner, and result
schema. They must not reuse Phase 0.6 approval or object keys.

`docs/decisions/0006-digest-bound-cloud-executor.md` defines the common adapter
and its operating rules.

`docs/CLOUD-TRAINING.md` covers the provider-neutral OCI training record. It
does not replace this execution-venue policy.

## Failure rules

- If preflight fails, do not launch.
- If the package or resolved machine identity changes, freeze a new package
  and repeat approval.
- If a run fails, collect its terminal record. A retry needs a new execution
  record and must stay inside its own approved budget.
- If terminal state or shutdown cannot be proved, treat the run as an
  operational incident before doing more scientific work.
- If exact peak memory cannot be observed, report it as unknown. Do not turn a
  placeholder or lower bound into a measurement.
