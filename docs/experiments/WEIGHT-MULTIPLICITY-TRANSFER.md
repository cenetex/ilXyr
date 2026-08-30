# Verified-oracle weight-multiplicity transfer

- Contract: `weight-multiplicity-transfer-r3`
- Contract status: signed execution contract
- Current execution status: not started
- Current milestone: Week 1 specification freeze
- Machine-readable contract:
  [`examples/weight-multiplicity/rev3-contract.json`](../../examples/weight-multiplicity/rev3-contract.json)
- Contract schema:
  [`schemas/weight-multiplicity-program.schema.json`](../../schemas/weight-multiplicity-program.schema.json)
- Signed source:
  [`docs/contracts/WEIGHT-MULTIPLICITY-TRANSFER-R3.md`](../contracts/WEIGHT-MULTIPLICITY-TRANSFER-R3.md)
- Received source SHA-256:
  `e77a6341155242a7e08e8a0675100fd347fbf1d637c58092561ea2c052dc6b3c`
- Canonical repository copy SHA-256:
  `5cbd190d12cc3f40a3dcd62cd793f9da0b8252a6314e06128a1b80cb373222be`

## Question

Can a small model trained on exact weight-multiplicity examples transfer to unseen ranks and to
non-dominant weights at those ranks?

This is a prospective program. No oracle frontier, corpus, training run, or scientific result has
been recorded yet. A negative result is an accepted delivery outcome, but it must come from the
frozen tests rather than from an implementation failure.

## Frozen design

The first task is exact integer weight multiplicity from 0 through 31. Decision data is balanced
across `0`, `1`, `2–7`, and `8–31`. Natural-distribution results retain values above 31, report
their frequency, and count them as incorrect in the end-to-end number.

Training uses classical ranks through 5. Twenty-five percent of training and development targets
are non-dominant, but no two training or development targets may expose the same Weyl orbit.
Classical ranks 6–8 and all exceptional types stay outside training.

Three full models use seeds 1, 2, and 3. A fourth null model sees only family, rank,
highest-weight height, target depth, and scalar target magnitude. It cannot read root, weight, or
Weyl data. A transfer claim must beat this shortcut model by the frozen absolute and confidence
margins.

## Decision order

1. Measure the symbolic oracle frontier and label yields.
2. Freeze the measured oracle-call, CPU, and wall-clock budget.
3. Generate and hash the accepted corpus partitions.
4. Train the three full models and the shortcut baseline.
5. Run ACR-1 before opening the other blind results.
6. If integrity is clean, run classical cross-rank, ACR-2, shortcut, exceptional, natural, and
   disagreement evaluations.
7. Settle one of `pass`, `classical_pass_exceptional_hold`, `rescope`, or `stop`.

ACR-1 is an integrity procedure. A repairable failure creates a new experiment version and reruns
affected work; it does not become a scientific Stop. A clean model that is truly wrong on the
adjoint cases does Stop.

ACR-2 is the unseen-rank Weyl-invariance gate. Its absolute floor is below the easier classical
cross-rank floor. The main test is whether accuracy drops by no more than three percentage points
between each hidden dominant base set and its non-dominant orbit partners.

Exceptional types are judged separately with representation-clustered bootstrap intervals. An
interval that crosses its threshold produces Hold, not a forced Pass or Fail.

## Change control

This contract is immutable once execution begins. A changed split, seed, model input, threshold,
budget rule, or repair rule requires a new contract ID and a new source hash. Old versions remain
visible.

Run `npm run test:schemas` to validate the contract and its fail-closed regression cases.
