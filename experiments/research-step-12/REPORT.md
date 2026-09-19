# Research step 12: bind the oracle resource policy

The real weight-multiplicity corpus runner now accepts the proposed final-p99
policy. It fixes the recorded caps before the first workload query and checks
final p99 before writing the pending corpus manifest. The
[policy file](RESOURCE-POLICY.json) binds the historical inputs and current
implementation by hash.

| Limit | Fixed value |
| --- | ---: |
| Final nearest-rank p99 | 50 ms |
| Hard timeout per LiE query | 30,000 ms |
| Workload calls, including the pilot | 2,430,387 |
| Total workload query time | 8,474,852 ms |
| Workload wall time | 2,119 seconds |
| LiE workers | 8 |
| Zero differential workers | 2 |

The original calibration fixed these values. Its full 26,624-query trace still
needs replay after AWS access is restored. The source-bound closeout supplies
the proposed limits. A fresh cloud package and launch approval will establish
the next execution.

## What the policy changes

The existing command path keeps its earlier per-query rule. Selecting
`--resource-policy` uses the fixed workload caps and the 30-second hard timer.
An early high p99 stays visible as progress. Only the complete workload gives
the final p99 decision. The command requires the full frozen plan and rejects
the smoke, pilot-only, and calibration modes for this policy.

The pilot still supplies its yield and cost projection. That projection stays
diagnostic: the caps fixed at startup remain binding. Call capacity is reserved
before dispatch. A Hold stops new work and collects every query already running.
Out-of-range values and failed calls count toward both query cost and the tail.

The final check is part of the function that writes the pending corpus
manifest. A failed resource gate preserves the trace and terminal evidence.
Successful output binds the exact policy bytes in its corpus manifest and
checksum list. The failure path also includes the policy in its checksums.

## Setup and workload

The calibration's query set starts after worker setup. The policy follows that
same boundary. A separate complete trace includes warmups, their query costs,
and setup wall time. Every workload row carries its complete-trace sequence
number as well as its workload sequence number.

This keeps two useful answers available: whether the calibrated workload fits
its fixed clause, and how much total oracle work the run consumed. The cloud
receipt must also retain instance time, build and setup work, result sealing,
storage, and the Zero differential checks. These supply the full execution cost
for a later comparison with learned models.

## Controlled failure evidence

The [smoke result](RESULT.json) records twelve groups of correctness checks:

- Read-only policy validation starts zero oracle processes.
- Changes to limits, source, candidate seed, and counted population are rejected.
- Warmups stay in the full trace while workload accounting matches the calibration.
- A 1,001 ms out-of-range call remains counted; a complete 100-call fixture has
  p99 exactly 50 ms and passes the final gate.
- Two 51 ms calls among 100 give p99 51 ms. The fixture ends on Hold before a
  pending manifest is created.
- A one-call allowance with two workers dispatches one call.
- A reduced 1 ms query-cost cap triggers a Hold. The fixture retains both
  in-flight results, their total cost of 5 ms,
  and the first triggering query.
- A wall-time Hold stops dispatch; the exact 30,000 ms boundary triggers the
  hard-timeout gate; an empty completed call set ends on Hold.
- Pilot projections preserve the fixed caps.

These are controlled correctness fixtures. Their supplied latencies test the
decision rules. The retained Holds describe expected test outcomes. The earlier
pilot resource failure and post-measurement wrapper failure retain their
original research records.

The existing real-worker timeout test, batch-order tests, resource-accounting
tests, and corpus self-test also pass locally. The legacy cloud package entry
point keeps its self-test path; the new policy validator loads only when its
option is selected.

## Reproduce the preparation

```bash
npm run test:weight-multiplicity-resource-policy
node scripts/run-weight-multiplicity-phase1-corpus.mjs \
  --check-resource-policy experiments/research-step-12/RESOURCE-POLICY.json
```

To prepare a new policy after a reviewed source change, write a new file with
`node scripts/prepare-weight-multiplicity-resource-policy.mjs NEW_POLICY.json`.
The writer preserves an existing destination.

Next, package the bound source and original oracle archives. Freeze the machine,
compiler, storage, watchdog, price evidence, and cost ceiling. Replay the
original calibration trace when access is restored, then complete preflight
before requesting launch approval.

The shared research question gains a concrete cost rule here: every attempted
oracle query contributes, including candidates that the eventual model will
never see. A learned component must be compared with that complete work record.
