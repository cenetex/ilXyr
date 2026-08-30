# Zero to Solomon Q22 bridge

The shared-task bridge completed prospectively on 2026-08-30. All three frozen
Solomon seeds selected all 500 promotion operations exactly and agreed on every
case. The result is recorded as EXP-007.

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
`artifact://sha256/b5c374b548a52e457577524b131cc52f12b875b85506cb1c470770dcf16e6dd6`.

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

The Solomon model, compute budget, seeds, forecasts, evaluation firewall, and
outcome rule were frozen in `examples/experiments/solomon-q22` before the run.
The complete result and evidence bundle are published at NSRL merge commit
`82be778f5d2a9d6d4f798ff4b9ab5ec3c583745b`; the result SHA-256 is
`afaba78f3f31fb95a24f74b76672ed2adb2afc480240c08a613fcc5fbf222c28`.

This closes the operation-routing bridge. It does not establish arithmetic
answer generation or general language quality. See [`EXP-007`](EXP-007.md) for
the result, forecast settlement, source pins, and next decision boundary.
