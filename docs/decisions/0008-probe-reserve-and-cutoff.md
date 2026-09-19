# ADR 0008: A bounded probe lane, so small runs cost small ceremony

- Status: proposed
- Date: 2026-09-15

## Context

The protocol's admission cost is fixed while the cost of what it admits varies by orders of
magnitude. Registering one experiment takes four contributions, a compile, two forecasts from
distinct identities, a funding commitment, and an admission decision — ten ledger operations
and, because of `reviewer_separation` and `forecaster_separation`, at least two actors who are
not the proposer.

That is the right price for a flagship run. It was measured this epoch against a run that was
not one. `crownless.moves.v3` trained a 5M-parameter model for 8000 steps on one g5.xlarge:
**twelve minutes of compute and $1.50**. Its contract cycle cost more than the run in every
resource the lab actually rations — a second model spawned to supply an independent review, two
human decisions, and roughly an hour of wall-clock coordination. The ratio inverts further as
the work gets smaller, and the smallest work is where most of the learning happens: the finding
that mattered this epoch came from a 240-row offline scoring pass that cost nothing and was
never registered at all.

The failure mode this produces is not that probes are expensive. It is that **probes route
around the ledger**. An operator with a ten-minute question does not spend an hour registering
it, so the ledger sees the flagship runs and misses the work that produced the insight. A
ledger that only records what was ceremonious enough to register is not a record of the
research.

ilXyr already has the lane this calls for. `run_sandbox` consults no compiled experiment, no
admission decision, no forecast quorum and no funding commitment; it checks the signed budget
and runs. The lane is unused for exploratory work anyway, and the reason is visible in
`check_capacity`: **sandbox and promoted allocations draw from one shared `general_limit`.**
Replication has a reserve that is both floor and ceiling. The sandbox lane has neither. An
operator who opens the fast lane cannot bound what it will consume, and an epoch that fills
with promoted allocations starves it. Faced with an unbounded lane next to a bounded one,
operators reasonably choose the ceremony they can predict.

## Decision

**Gates divide into two classes, and only one of them scales with stakes.**

*Integrity gates* establish that a recorded result means what it says: the outcome contract
frozen before execution, metrics sourced from artifacts matching their recorded hashes, the
append-only record, thresholds that cannot move after a result is seen. These do not weaken for
small runs. If anything they matter more there, because small runs are where unexamined claims
originate.

*Allocation gates* exist because compute and attention are scarce and claims compete for them:
the forecast quorum, stake minimums, funding commitments, reviewer and forecaster separation,
external preregistration. These are proportionate to what is at stake. Below a declared
threshold there is nothing to allocate and no competing claim to adjudicate, and charging for
them buys nothing.

The sandbox lane already implements that split. What it lacks is a bound, so:

1. **`EpochBudget.probe_reserve_pct` reserves a share of the epoch for the sandbox lane, and
   that share is both its floor and its ceiling** — the same shape `replication_reserve_pct`
   has had since ADR 0004. Sandbox allocations are capped at the reserve and promoted work
   cannot reach it. An operator declaring a 5% probe reserve on a 1000-credit epoch has said,
   in one signed number, "exploration may spend up to fifty credits this epoch without asking
   anyone, and may not spend the fifty-first."
2. **The cutoff is a refusal, not a warning.** Exceeding the reserve fails closed with a message
   naming the remedy: promote the work to a full experiment and claim general capacity through
   admission. Iteration is cheap until the budget says stop, and then it stops.
3. **A zero reserve preserves today's behaviour exactly.** Budgets that do not declare one keep
   drawing sandbox work from the general pool, and — because the field is omitted from the
   serialized form when zero — budgets signed before this ADR produce an unchanged signing
   payload and keep verifying.
4. **Probe evidence stays probe evidence.** The lane still records `lane: sandbox`, and nothing
   here lets it support a claim. Promotion remains the path from a probe to a result the ledger
   will stand behind, and promotion pays full admission.

## Consequences

Each reserve rounds up to whole credits. Budget validation requires both
rounded reserves to fit within the epoch. Promoted allocations count only
their own pool when a probe reserve is declared, so either lane can spend first.

An operator can now open the fast lane with a bounded blast radius, which is the condition
under which using it is a reasonable decision rather than an act of faith. Exploratory work
becomes cheap enough to register, so the ledger sees the probes as well as the flagships, and a
promoted claim can cite the probes that motivated it.

The reserve is a per-epoch number, so a lab that wants finer control gets it by shortening the
epoch, not by adding another dial.

What this ADR does **not** fix, and what the same epoch measured: `ExecutableCap.allowed_argument_sets`
matches the full argument vector exactly, and the budget carrying it is Ed25519-signed by a
human. Sweeping one knob — `--steps 8000` to `--steps 32000` — is a new argument vector and so
requires a newly signed budget. Three probes this epoch would have needed three signing
ceremonies, which is a second, independent source of the friction described above and is not
addressed here. Bounded parameter ranges inside a signed cap are the obvious answer and a
larger security question than this change should carry; it deserves its own record.
