# Zero to Solomon Q22 bridge

The shared-task bridge is ready for prospective experiment design. It is not a
replication result.

The executable contract is
`examples/shared-tasks/zero-solomon-q22-operation-v1.json`. It freezes:

- 9,500 training-only Q22 JSONL rows at SHA-256
  `815fac312664f49eaaa33942828ffa1511fd81091ccd88d47b4480b6c27a5fa4`;
- the disjoint 500-row promotion TSV at SHA-256
  `9270ea2b72af90235407bd7924a0864b8eba35b2969e1657ed1c15bf04449519`;
- seeds 1, 2, and 3 and the common integer parts-per-million exact-operation
  metric;
- the Zero channel encoding and verifier at one exact public source commit;
- the Solomon byte encoding and independent kernel-aware verifier at one exact
  public source commit; and
- the SHA-256 value of every encoding, manifest, and verifier entry point.

Its deterministic ilXyr artifact reference is
`artifact://sha256/984cc50b986532506eb2148be561404075de37b24c135a260130f5a6f02ae848`.

Shared-task v2 requires these source snapshots. A contract cannot claim to be
executable using only human-readable encoding and verifier names.

Register it in a new workspace with:

```bash
cargo run -p ilxyr-cli -- init /tmp/ilxyr-q22-bridge
cargo run -p ilxyr-cli -- shared-task-register \
  /tmp/ilxyr-q22-bridge \
  examples/shared-tasks/zero-solomon-q22-operation-v1.json
cargo run -p ilxyr-cli -- verify /tmp/ilxyr-q22-bridge
```

The next authorized action is to write and preregister one Solomon training
experiment against this exact task. The bridge implementation does not choose
a Solomon model, compute budget, equivalence tolerance, or promotion rule, and
it does not open the frozen evaluation set to model training.
