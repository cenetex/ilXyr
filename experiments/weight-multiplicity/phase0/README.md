# Weight-multiplicity Phase 0 evidence

`frontier-v1.json.gz` is the byte-sealed first binding frontier result. Its
uncompressed SHA-256 is recorded in `frontier-v1-summary.json` and in the
Version 2 plan.

Version 1 is preserved but superseded because its positive-stratum candidate
sampler proposed unconstrained root-lattice points rather than verified
lowering paths. This made the E7 and E8 positive-label yield uninterpretable.
No Version 1 records are silently removed or relabeled.

The corrected plan is
`examples/weight-multiplicity/phase0-frontier-plan-v2.json`. Version 2 changes
only the positive-candidate proposal. It retains the signed contract,
coordinates, seed, label quotas, time limit, memory limit, and oracle binary.

`frontier-v2.json.gz` is the corrected binding result. Its compact decision
record is `frontier-v2-summary.json`. The result is Stop at the oracle/resource
gate; Phase 1 was not opened.

Replay the hashes, counts, predecessor link, safe boundary, and Phase 1 closure
with:

```sh
npm run test:weight-multiplicity-evidence
```
