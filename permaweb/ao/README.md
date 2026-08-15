# ilXyr AO registry process

`ilxyr-registry.lua` stores proposal and review state for the permanent dApp.
Every change is an AO message signed by the sender's wallet.

## State transitions

- `Propose` creates a proposal that can receive reviews.
- `Review` requires an identity other than the proposer.
- `Address-Review` lets the proposer respond to a review. Only the original reviewer can use
  `Resolve-Review`.
- `Promote` locks the proposal after every required check passes.
- `Forecast` rejects the proposer and permits one forecast per wallet.
- `Fund` records one current compute-credit commitment per wallet.
- `Publish-Evidence` is restricted to configured publisher authorities and cannot replace an
  existing experiment identity.
- `Index-Snapshot` creates the next `ilxyr.index.v1` file; its request includes
  `generated_at` and may include `ledger_head`.
- `Set-Index-Tx` advances the canonical index pointer by exactly one sequence.

The dApp does not run experiments. The existing ilXyr control plane runs approved experiments. It
then sends verified evidence through `Publish-Evidence`.

## Deployment

Spawn an AOS 2 / HyperBEAM process owned by the publisher wallet, load the Lua source, then set the
resulting process ID as `VITE_ILXYR_AO_PROCESS` before building the frontend.
