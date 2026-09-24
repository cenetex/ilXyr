# ilXyr AO registry process

`ilxyr-registry.lua` stores proposal and review state for the permanent dApp.
Every change is an AO message signed by the sender's wallet.
The revision flow uses `ilxyr.registry-state.v2`. Configure the web app with a
process running this version.

## State transitions

- `Propose` creates revision 1 and records its signed AO message ID.
- `Review` requires an independent wallet, the current revision number, and its exact message ID
  as `proposal_ref`.
- `Address-Review` creates one successor revision. The owner sends the current `review_id`, the
  next `revision`, the exact `predecessor_ref`, a response, and a complete revised `contract`.
  Earlier reviews remain in the history. The contract must change.
- `Resolve-Review` lets the original reviewer acknowledge a linked successor. This records a
  separate acknowledgement and leaves the review intact.
- `Promote` locks the proposal after a fresh independent review of the current revision passes
  every required check. It records the exact proposal and current review message IDs. A blocking
  review of that revision requires another successor.
- `Forecast` rejects the proposer and permits one forecast per wallet.
- `Fund` records one current compute-credit commitment per wallet.
- `Publish-Evidence` is restricted to configured publisher authorities and cannot replace an
  existing experiment identity. It accepts canonical artifact references,
  bounded index fields, and valid transaction IDs.
- `Index-Snapshot` creates the next `ilxyr.index.v1` file; its request includes
  an ISO UTC `generated_at` and may include an artifact-form `ledger_head`.
  A current index transaction must be set first so the successor has an exact
  `previous_index_tx`.
- `Set-Index-Tx` advances the canonical index pointer by exactly one sequence.

The dApp does not run experiments. The existing ilXyr control plane runs approved experiments. It
then sends verified evidence through `Publish-Evidence`.

The required permaweb tests run real AO handlers with Lua 5.3 harnesses. They
check rejected proposal and index transitions and pass a successful snapshot
to the same index validator used by the publication CLI.

## Deployment

Spawn an AOS 2 / HyperBEAM process owned by the publisher wallet, load the Lua source, then set the
resulting process ID as `VITE_ILXYR_AO_PROCESS` before building the frontend.
