# Negative-knowledge constraint database

Issue: [#113](https://github.com/cenetex/ilXyr/issues/113). Status:
**adopted 2026-09-04**.

## Problem

43 no-go/negative results are registered across repos in heterogeneous formats
(`no-go`, `complete-no-go`, `measured-local-no-go`, `decision.outcome`, prose).
The recurring pattern — transfer failure, nine consecutive C-line no-gos — was
invisible until a manual cross-repo report.

## Solution

Three additions make negative knowledge machine-readable and queryable at
design time:

1. **Canonical verdict schema** (`ilxyr.verdict.v1`) — a single machine-readable
   verdict for every completed experiment outcome, including no-go results.
   Each verdict carries a `taxonomy` field classifying the negative result as
   `transfer`, `interference`, `measurement`, `venue`, or `implementation`.

2. **Append-only negative-knowledge ledger** (`ilxyr.negative_knowledge_ledger.v1`)
   — a ledger of negative verdicts spanning all registered families. Entries are
   never modified or deleted; corrections append a new entry with
   `supersedes_ref`. Monotonic `seq` values prevent silent deduplication.

3. **Design-time constraint-diff report** (`ilxyr.constraint_diff_report.v1`) —
   produced before a new experiment SPEC is admitted. The report diffs the
   SPEC's declared `mechanism_tags` against every ledger entry, surfacing
   repeated failure patterns before the run starts. The `constraint-diff.mjs`
   script generates reports and supports `--self-test`.

## Canonical verdict schema

Schema: [`schemas/verdict.schema.json`](../schemas/verdict.schema.json)

Every completed experiment — positive or negative — produces a verdict artifact.
The verdict captures the mechanism tested, structured tags for cross-repo
diffing, and a taxonomy classification.

| Field | Type | Description |
| --- | --- | --- |
| `schema` | const | `ilxyr.verdict.v1` |
| `id` | string | `verdict:<experiment-id>` |
| `experiment_id` | string | Experiment identifier |
| `family` | enum | `zero` or `solomon` |
| `outcome` | enum | `go`, `no_go`, `complete_no_go`, `measured_local_no_go`, `execution_failure` |
| `taxonomy` | enum | `transfer`, `interference`, `measurement`, `venue`, `implementation` |
| `mechanism` | string | Human-readable description of the mechanism tested |
| `mechanism_tags` | string[] | Lowercase tags for cross-repo diffing (e.g. `replay-guard`, `cumulative`) |
| `summary` | string | One-paragraph prose summary |
| `lineage_note` | string? | Guidance for follow-ups — what NOT to repeat |
| `evidence_ref` | artifact_ref | Content-addressed evidence artifact |
| `retro_registration_ref` | string? | Retro-registration spec id if imported via retro lane |
| `recorded_by` | actor | Who recorded the verdict |
| `recorded_at_ms` | integer | Recording timestamp |

A `go` verdict may only have `measurement` or `implementation` taxonomy. All
other taxonomies are reserved for negative results.

## Append-only negative-knowledge ledger

Schema: [`schemas/negative-knowledge-ledger.schema.json`](../schemas/negative-knowledge-ledger.schema.json)

The ledger aggregates negative verdicts across all families. It is append-only:
entries are never modified, reordered, or deleted. Corrections add a new entry
with `supersedes_ref` pointing at the superseded verdict; the prior entry
remains in the ledger permanently.

Ledger entries carry a monotonic `seq` to prevent silent deduplication. The
ledger only contains negative outcomes (`no_go`, `complete_no_go`,
`measured_local_no_go`, `execution_failure`). A `go` verdict is a valid verdict
artifact but is not a ledger entry.

Fixture: [`examples/constraints/negative-knowledge-ledger.v1.json`](../examples/constraints/negative-knowledge-ledger.v1.json)

## Design-time constraint-diff

Schema: [`schemas/constraint-diff-report.schema.json`](../schemas/constraint-diff-report.schema.json)

Script: [`scripts/constraint-diff.mjs`](../scripts/constraint-diff.mjs)

Before a new experiment SPEC is admitted, the proposer declares its
`mechanism_tags`. The constraint-diff tool matches those tags against every
ledger entry and produces a report with:

- `matches` — each registered negative result sharing at least one tag
- `taxonomy_counts` — per-taxonomy count of matching prior results
- `summary` — human-readable design-time warning
- `recommendation` — `proceed`, `review`, or `blocked`

The recommendation logic:

- `proceed` — no matching negative constraints (matches is empty)
- `review` — matching constraints exist but no exact mechanism-tag repeat
- `blocked` — at least one match shares ALL proposed tags (exact repetition)

### Usage

```bash
# Generate a constraint-diff report
node scripts/constraint-diff.mjs \
  --ledger examples/constraints/negative-knowledge-ledger.v1.json \
  --experiment-id zero.q27.seed2.permutation-guard.v1 \
  --tags replay-guard,cumulative,permutation,quantity-gate \
  --output /tmp/constraint-diff.json

# Self-test
node scripts/constraint-diff.mjs --self-test
```

Fixtures:
- [`examples/constraints/constraint-diff-review.v1.json`](../examples/constraints/constraint-diff-review.v1.json)
- [`examples/constraints/constraint-diff-proceed.v1.json`](../examples/constraints/constraint-diff-proceed.v1.json)

## Registered negative knowledge (as of 2026-09-04)

| Seq | Verdict | Family | Outcome | Taxonomy | Mechanism tags |
| ---: | --- | --- | --- | --- | --- |
| 0 | EXP-001 Q2.3 local guard | zero | no_go | transfer | replay-guard, local-budget, quantity-gate |
| 1 | EXP-002 Q2.4 cumulative guard | zero | no_go | interference | replay-guard, cumulative, quantity-gate |
| 2 | EXP-003 Q2.5 backtracking | zero | complete_no_go | interference | replay-guard, cumulative, backtracking, quantity-gate |
| 3 | EXP-008 shortcut-resistant routing | solomon | no_go | transfer | shortcut-resistant-routing, integer-perceptron, operation-routing |
| 4 | Weight-multiplicity Phase 0 | zero | complete_no_go | venue | oracle-frontier, weight-multiplicity, resource-bound |
| 5 | NSRL target-margin | solomon | measured_local_no_go | measurement | hard-negative-margin, output-matrix-only, target-rank |
| 6 | NSRL NLL guard | solomon | no_go | interference | output-head-search, nll-guard, document-disjoint |
| 7 | NSRL NLL safe-set | solomon | no_go | interference | output-head-search, nll-guard, document-disjoint, safe-set |
| 8 | NSRL cross-document stability | solomon | no_go | interference | output-head-search, cross-document, nll-guard |
| 9 | NSRL trust-region | solomon | no_go | interference | hard-negative-margin, trust-region, nll-guard, document-disjoint |

## Versioning

These schemas follow the same versioning policy as all ilXyr artifacts
([`docs/LEDGER-VERSIONING.md`](LEDGER-VERSIONING.md)):

- Within a major version, changes are additive-only (new optional fields, new
  enumerated values).
- Required-field additions require a new major version.
- Unknown fields always reject.
- Unknown major versions fail closed.
