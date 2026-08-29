# NSRL checkpoint custody

ilXyr registers NSRL checkpoints as immutable metadata and imports the locally verified bytes into
its SHA-256 blob store. The large model and optimizer files remain outside Git. Registration does
not endorse model quality or grant execution authority.

## Register a checkpoint

The registration binds a clean Git commit and tree, the `NSRLPM1` model, its `NSRLBPE1` tokenizer,
model card, source-built executable, and optional `NSRLPO1` continuation state. New handles require
the explicit acknowledgement:

```bash
cargo run -p ilxyr-cli -- init /path/to/pilot-workspace
cargo run -p ilxyr-cli -- nsrl-register \
  /path/to/pilot-workspace \
  examples/nsrl/p10m-v10-registration.json \
  /path/to/nsrl \
  --execute
```

Before appending to the ledger, the adapter checks the source commit and tree, requires a clean
tracked worktree, rejects artifact paths that resolve outside the source root, streams each file
through SHA-256, checks its exact byte length, and imports it under `blob://sha256/`. The model and
continuation are separate ledger objects and use separate handles. `ilxyr verify` re-hashes every
stored blob as well as the JSON object and event chains.

Inspect the immutable checkpoint or its effective gates:

```bash
cargo run -p ilxyr-cli -- nsrl-show /path/to/pilot-workspace MODEL_REF
cargo run -p ilxyr-cli -- nsrl-status /path/to/pilot-workspace MODEL_REF
```

## Record gate evidence

Gate evidence is append-only. An outcome can be `passed` or `failed`; a gate with no evidence stays
`unopened`. ilXyr verifies every declared evidence artifact against the supplied evidence root
before recording it:

```bash
cargo run -p ilxyr-cli -- nsrl-gate-record \
  /path/to/pilot-workspace \
  examples/nsrl/p10m-v10-generation-gate.json \
  /path/to/ilxyr
```

Later evidence may supersede the effective status without rewriting an earlier object. Status is
candidate-eligible only when all eight ADR 0005 gates have a recorded pass. The provenance gate
cannot pass when the source is unpublished or the weight licence is absent.

NSRL handles are enforced at the experiment boundary. A `model://nsrl/` actor and a
`weight://nsrl/` experiment input must resolve to the registered checkpoint before ilXyr accepts
the contribution, forecast, funding record, or compiled experiment.

## Current p10m intake

The registered example is the production `NSRLPM1` output-calibration-v10 checkpoint, not the older
successor-v2 benchmark. Its source, model, tokenizer, executable, and optimizer identities are in
`examples/nsrl/p10m-v10-registration.json`; the executed intake and public-baseline measurements
are in `examples/nsrl/p10m-v10-pilot-evidence.json`.

The hidden panel was not opened. Integrity and public learning pass. Numeric health, generation,
context, serving, and provenance fail. Independent evidence stays unopened. The checkpoint remains
`experimental` and is not candidate-eligible.

The later output-matrix target-margin pilot is recorded separately as a negative exact-check
result in `examples/families/nsrl-target-margin-v1.retro.json`. It replayed exactly and stayed
numerically safe, but failed its public-development rank and NLL gates; public test and hidden
evidence remained closed. See `docs/experiments/NSRL-P10M-TARGET-MARGIN.md`.

Its fixed-schedule trust-region follow-up is registered in
`examples/families/nsrl-target-margin-trust-region-v1.retro.json`. All 48 proposed batches across
three rates worsened canonical NLL on the same disjoint guard and were rejected. No full candidate
was selected, and development, test, open-generation, and hidden evidence stayed closed.

The canonical-NLL head follow-up is registered in
`examples/families/nsrl-direct-head-nll-guard-v1.retro.json`. Its selected unit move improved the
64-window proposal but worsened a different-document 32-window guard, so it was restored in round
zero. Exact model and trace reruns passed. Development was unchanged; test, open-generation, and
hidden evidence stayed closed.
