# Research step 29: approved FERAL run awaits GPU capacity

The user approved the cache-repaired package for one paid instance, one hour,
and **$3 before tax**, with a five-minute follow-up. Fresh provider checks,
package version and checksum checks, and each free launch dry run passed.
AWS then returned `InsufficientInstanceCapacity` in all four supported zones:
`us-east-1d`, `us-east-1a`, `us-east-1b`, and `us-east-1c`.

A query for each exact request confirmed zero instances before the next
attempt. A final project query also found zero active instances. These
attempts used **$0 of the approved instance compute budget** and produced
zero model answers. [CAPACITY-FAILURES.json](CAPACITY-FAILURES.json) records
all four failures and hashes of the private provider receipts.

## Price check failure

The third zone's first preflight stopped when the whole provider price
document changed. Inspection showed that the complete selected Linux GPU
rate entry stayed identical at $2.24208 per hour. Fresh checks compared that
entry and retained the current document checksum. The one-hour estimate
remains $2.99208 with the full $0.75 reserve.
[PRICE-CHECK-FAILURE.json](PRICE-CHECK-FAILURE.json) preserves the failed
assertion, both document hashes, and the verified rate comparison.

## Next step

The active follow-up will try at most one zone every five minutes until
17:05 UTC on September 8, 2026 (10:05 in Vancouver). It will launch the
single approved instance when capacity is available. Each attempt uses fresh
checks and a new request record. A successful launch fixes the one-hour
shutdown deadline. The follow-up then collects scientific results, verifies
instance and volume cleanup, and publishes the evidence. If capacity remains
unavailable at the retry cutoff, it will pause and report the blocker.
[FOLLOW-UP.json](FOLLOW-UP.json) records this scope.

The frozen package remains
`25c350b4819e499bcf1adabe56d5d05cb8ef7c07daccb13d7a221545cd74d821`.
The first model check covers CUDA placement and synthetic generation in the
same loaded process that will answer the 1,147 scored inputs. The synthetic
row has zero score weight. The original calculator and operand-only arms
remain the comparison controls. [EXECUTION-STATUS.json](EXECUTION-STATUS.json)
binds the package, approval receipt hash, and limits.

The shared program question remains the value of added learned work against
a simple control. Capacity is an execution constraint; the scientific model
comparison awaits its measured answers. The earlier cache failure and both
full-roster calculator results stay in [step 28](../research-step-28/REPORT.md).
Reasoner's matched benefit-gate failure stays in [step 26](../research-step-26/REPORT.md).
Raw provider and authorization receipts remain in local custody. The research
report publishes the compact findings and their receipt hashes.
