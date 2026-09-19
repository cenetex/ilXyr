# Integer-model feasibility note

## Finding

An integer research model for the 32-label multiplicity task is technically
plausible, but it is not justified under the current SOW because the project
stops at the oracle frontier before any float reference model or frozen corpus
exists.

NSRL already provides native-integer CPU and WASM training components, exact
model replay, integer normalization, checked saturation, and categorical
output heads. A 32-class exact-output head is comfortably inside that existing
kind of arithmetic. The likely new work would be the structured encoder for a
Cartan matrix, root coordinates, highest-weight coordinates, and target-weight
coordinates. That encoder does not exist as a validated weight-multiplicity
model today.

## What can be reused

- deterministic integer weights, updates, and checkpoint replay;
- fixed-width categorical logits and exact argmax;
- CPU-only training and WASM-compatible inference kernels;
- saturation, reachability, and numeric-health checks; and
- model and evidence hashing patterns.

## What still needs evidence

- a permutation- and rank-aware structured encoder;
- a float reference model that first passes the signed transfer gates;
- a matched integer/float corpus and selection protocol;
- exact-match retention after integer training or conversion;
- per-stratum behavior, especially multiplicities 8–31; and
- ACR-2 behavior after discretization.

## Recommendation

Do not begin an integer port. If a later scope revision first produces a
passing or otherwise useful float model, run a separate NSRL feasibility phase
with a matched architecture and frozen degradation limits. The current blocker
is exact-label generation at the required Lie types and ranks, not integer
model arithmetic.
