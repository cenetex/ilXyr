# Reasoner 4 typed-role representation audit

The frozen audit asks whether examples expose six point-language roles from
Reasoner 3.9: candidate, goal, subtract, absolute, multiply, and nonzero. The
source evaluator is pinned to Zero commit
`3b917b6f54d151a43dd65e45f094606272d166c5`. Each opaque raw symbol has
16 demonstrations. Capture reads the input pair and observed output. It emits
64 numbers per symbol. The role label and family metadata stay outside the
capture and predictor paths.

The fit split contains ten balanced signed-input families in a four-column
grammar. The fresh held split contains five opposing-sign and zero-boundary
families in both a four-column grammar and a bracket-arrow grammar. The fit
and held families and symbols are disjoint, and the input construction changes.
The held split includes the familiar four-column form and the new bracket-arrow
form. The
six source operators are shared. The parser normalizes both grammars before
the probe. The audit measures six-role decoding from normalized numeric
demonstrations across new input families. Equal predictions across renderings
check parser normalization and role decoding together. The future sealed
law-composition panel remains closed.

## Opened local smoke

Before the final freeze, a one-seed development smoke used the earlier held
seed 91. Its raw examples, captured states, and raw predictions remain in
[`opened-smoke`](opened-smoke/). It exercised grouped fit selection, symbol
header features, a scrambled-example control, a role-swap counterfactual,
both surface grammars, random projections, and one label permutation. It
captured 18 rows with 288 pinned evaluator calls. The probe smoke used 180
rows and 0.539 CPU seconds. Held role accuracy was 433,333 ppm, worst role
accuracy was zero, scrambled accuracy was 133,333 ppm, label-shuffle accuracy
was 200,000 ppm, and the margin over the header-only probe was 333,333 ppm.
These are opened development readings. They are not a three-seed audit result.

The fresh held seed 20260926 replaced the opened panel before full fitting.
The final [contract](../../examples/diagnostics/reasoner-4-representation-audit.json)
preserves every original metric threshold, regularization value, and seed.
Twenty label permutations per seed form a 60-run empirical null. The run
records its 95th percentile and the role-swap null. Probe selection uses five
family-grouped folds within fit data. Held data enter the final score once.

## Package and execution

The [package record](PACKAGE.json) binds a 17,162,240-byte repaired archive at
`04697f765f84feae91543e0ecc85bddf44f398e75700beffade5f3010f6b80bb`.
The archive includes the exact source files, input and state artifacts, audit
contract, code, profile, and pinned Linux NumPy wheel. Package verification
passed locally. The package replay compiled the pinned source and checked
2,880 evaluator calls across 180 captured rows. Every fit and held output
matched. The scrambled control changed 712 outputs. Captured states matched
their input demonstrations.

The [execution profile](EXECUTION-PROFILE.json) selects one AWS `c6i.large`
in `us-east-1` with a 900-second cap and a $0.15 before-tax ceiling. The
compute rate ceiling is $0.085 per hour. Live preflight must confirm the
account, machine, image, network, permissions, storage, price, package object,
and EC2 dry-run. An earlier archive was staged and passed free preflight; its receipts are retained in [superseded-v5-stage](superseded-v5-stage/). The repaired archive includes the full packaged import graph and a fit-only runtime check. The [stage](STAGE.json) names immutable S3 version `VsWOddEQ4UzjacnTC_zgsl1lhy2FQaGB`. The [free live preflight](PREFLIGHT.json) passed all 12 checks with zero instances created and a current $0.085/hour rate.

## First cloud attempt and repair

The first bounded host ran the v6 archive at `a8f2aed5e368455591013e6b849c0c87e2343fed854abb7abbf2e4cb84e576b4`. Its [failure record](failed-v6-run/COLLECTION.json) binds the launch instance, provider tags, and versioned S3 outputs. Docker returned exit 125 while creating a nested bind mount inside a read-only mount. The host stopped before the probe. EC2 reports it terminated, with zero attached volumes and network interfaces. The first attempt produced no scientific measurements. Its [terminal receipt](failed-v6-run/TERMINAL.json) and [error log](failed-v6-run/probe.stderr.log) are preserved.

The v7 bootstrap uses three sibling directory mounts: the verified package and archive are read-only, and output is writable. A tiny container smoke uses the same Docker flags before fitting. The pinned source, generated panels, seeds, probe, thresholds, and execution profile remain byte-identical to v6. The archive verifies locally, and the packaged import check runs a fit-only optimizer step. A fresh preflight will precede any retry. No three-seed measurements or decision-table outcome exist yet.

The two attempts share a $0.15 before-tax envelope. At $0.085 per hour, two full 900-second host bounds cost $0.042500 compute. Two 80 GiB EBS bounds cost $0.004446, and IPv4 costs $0.002500. The package reserves $0.010000 for requests and storage and $0.090000 for transfer. The combined bound is $0.149446 before tax. The first host ended far before its 900-second cap, which gives further margin.
