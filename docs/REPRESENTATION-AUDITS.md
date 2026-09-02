# Frozen representation audits

A frozen representation audit answers one question before another training run:

> Does the current model state expose stable task evidence to a small probe?

The audit keeps the source model fixed. It fits a small probe on a development
split. It then scores held-out groups, seeds, and controlled swaps. The result
guides the next research branch.

## Contract

[`representation-audit.schema.json`](../schemas/representation-audit.schema.json)
defines the contract. Every audit records:

- exact source models, code revision, and evidence;
- fit and evaluation splits with group axes;
- the frozen state or feature vector to inspect;
- capture-code and probe-code digests;
- a small probe, its parameter limit, and grouped fit-split cross-validation;
- label-shuffle, prefix-only, random-projection, and swap controls;
- frozen metrics and a decision table; and
- an execution profile plus every open item.

The source model stays fixed. Probe output is diagnostic evidence. Existing
promotion gates keep their authority. Sealed panels stay closed.

## States

A `draft` lists at least one open item. This makes missing hashes, code, or
runtime identity visible.

A `frozen` audit has an empty `unresolved` list. It binds exact input hashes, a
probe implementation digest, a representation dimension, and an execution
profile. Freeze the audit before fitting the probe.

## Decision rule

First, every required control must pass. A failed control resolves
`invalid_controls` and opens a review of the split, labels, and shortcuts.

A valid audit resolves one of three signal outcomes:

- `stable_signal`: every required metric passes across groups, swaps, and
  seeds. This supports a head, objective, or adapter branch.
- `localized_signal`: the overall metric passes while a group, swap, or seed
  metric misses. This supports representation repair or focused data review.
- `insufficient_signal`: the overall metric misses after controls pass. This
  supports a representation branch, data review, or a line stop.

These outcomes guide the next contract. They carry no promotion authority.

## Prepared audits

Three line-specific drafts turn the current research priorities into concrete
work:

| Line | Draft | Main question |
| --- | --- | --- |
| Solomon EXP-008 | [`exp-008-representation-audit.json`](../examples/diagnostics/exp-008-representation-audit.json) | Does the 8,192-feature map keep stable operation evidence across held-out templates and distractor swaps? |
| NSRL p10m | [`nsrl-p10m-representation-audit.json`](../examples/diagnostics/nsrl-p10m-representation-audit.json) | Do the six frozen layers keep cross-document context and distractor evidence? |
| Reasoner 4.0 | [`reasoner-4-representation-audit.json`](../examples/diagnostics/reasoner-4-representation-audit.json) | Do fresh examples expose stable typed roles before an adapter contract? |

The EXP-008 draft already binds the three model hashes and the published train
and promotion hashes. The NSRL draft keeps the independent panel closed. The
Reasoner draft keeps unseen law composition for the later prospective
contract.

## Run sequence

1. Resolve every item in `unresolved`.
2. Change `state` to `frozen` and run the profile checker.
3. Capture frozen states with the exact source revision and execution profile.
4. Fit only the declared probe on the fit split.
5. Run every control and held-out group.
6. Publish the metrics, representation hashes, probe hash, and resolved
   decision as evidence.

Model-specific code may capture native integer features, NSRL residual states,
or Transformers hidden states. The audit contract stays the same across those
sources.

## Check and classify

Check a draft or frozen contract with:

```bash
npm run check:research-profile -- examples/diagnostics/exp-008-representation-audit.json
```

For a frozen audit, pass a second JSON file with one finite number for each
declared metric name:

```bash
npm run check:research-profile -- frozen-audit.json measurements.json
```

The checker binds both files by SHA-256. It applies control gates first, then
the overall and group/stability gates. Its output includes the outcome and
allowed next steps. Each supplied metric must already summarize the full
declared seed and group matrix. The experiment runner remains responsible for
those measurements and their evidence traces.

Run `npm run test:research-profiles` for focused contract and decision tests.
