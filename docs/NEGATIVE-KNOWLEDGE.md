# Shared failure records

Each useful failure should change the next experiment. This ledger connects
the result, its tested mechanism, and the next design change across the lab.
It continues [issue #113](https://github.com/cenetex/ilXyr/issues/113).

The first ten entries preserve the earlier Q2.3–Q2.5, integer-routing,
oracle-frontier, and NSRL head-search records. Ten additions carry the
research audits into the same view: Solomon context use, FERAL labels,
Reasoner semantic controls and development failures, the corpus pilot Hold,
the calibration wrapper failure, the stale 5.8 prose report, and the
[runner accounting repairs](../experiments/research-step-6/REPORT.md).

## Records and evidence

[`verdict.schema.json`](../schemas/verdict.schema.json) describes a result.
Each verdict includes the mechanism, tags, summary, evidence reference,
author, and recording time. New research records also name the project,
evidence kind, original outcome, and the change needed in a follow-up.

Use `posthoc_diagnostic` for an audit of opened data and
`existing_public_result` for an imported experiment result. Use
`operational_failure` for a failed execution or wrapper. A diagnostic finding
keeps the historical experiment's score and decision in its stated scope.
For example, the completed tail calibration and its later wrapper failure
keep separate classifications.

[`negative-knowledge-ledger.v1.json`](../examples/constraints/negative-knowledge-ledger.v1.json)
stores the ordered history. The append operation preserves every earlier
entry. Corrections add a new verdict with `supersedes_ref`; current design
reports use the latest correction while the ledger keeps the full history.

The checker validates contiguous sequence numbers, unique identities,
correction order, each declared verdict field, and each declared digest.
The first ten imported entries currently have `reference_only` evidence.
The ten later entries have local evidence whose bytes are checked against
their SHA-256 references. New recording authors identify the model agent.

## Use failures in the next design

The design report matches mechanism tags and includes the evidence links and
follow-up notes. It also records the proposed change. Its recommendation is
advisory: `review` directs attention to matched records; `proceed` means the
ledger has an open evidence gap for those tags. Exact tag repeats are marked
explicitly. A new control, replication, or changed representation can share
tags with a prior failure.

Each generated report binds the ledger it read. The digest uses two-space
JSON with a trailing newline. The example
[next-design reports](../examples/constraints/research-step-5/) cover all five
research lines.

```bash
node scripts/constraint-diff.mjs \
  --ledger examples/constraints/negative-knowledge-ledger.v1.json \
  --experiment-id reasoner.next-controls.v1 \
  --tags semantic-transfer,learned-search,lexical-control \
  --change 'Use equal search optimizations and fresh families.' \
  --output /tmp/reasoner-next-controls.json

node scripts/constraint-diff.mjs \
  --ledger examples/constraints/negative-knowledge-ledger.v1.json --verify
```

To append a verdict, place its file under `examples/constraints/` using its
ID followed by `.verdict.json`, with the `verdict:` prefix removed. Bind its
evidence bytes, then produce a new ledger file:

```bash
node scripts/constraint-diff.mjs \
  --ledger examples/constraints/negative-knowledge-ledger.v1.json \
  --append-verdict examples/constraints/example.new-result.v1.verdict.json \
  --output /tmp/next-negative-knowledge-ledger.json
```

Review and commit the appended ledger through the normal PR flow. Output
paths must be new files. `node scripts/constraint-diff.mjs --self-test`
checks ordering, corrections, preserved history, source changes, tag matches,
and CLI writes. Ordinary schema CI runs these behavior checks too.
