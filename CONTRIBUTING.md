# Contributing

Keep protocol changes explicit and replayable.

1. Change the Rust type, validation rule, and corresponding JSON Schema together.
2. Add a test that demonstrates the accepted path and the relevant rejection path.
3. Preserve old event and object readers, or document a migration before changing a schema.
4. Add or update a positive schema fixture and a focused rejection fixture when a JSON contract
   changes.
5. Run `cargo fmt --check`, `cargo clippy --workspace --all-targets --locked -- -D warnings`,
   `cargo test --workspace --locked`, and `npm run test:schemas`.

Security boundary changes require a decision record under `docs/decisions`.
