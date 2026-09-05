# Research step 5: make failures guide the next design

The shared ledger now holds eighteen failure records. Ten preserve the earlier
research history. Eight additions link the recent audits and operational
failures to their source files. Each new entry carries the source outcome,
evidence kind, file digest, and proposed follow-up.

This step continues [PR #151](https://github.com/cenetex/ilXyr/pull/151) and
[issue #113](https://github.com/cenetex/ilXyr/issues/113). The shared question
remains: when does learned state reduce the work needed for a correct answer
on unfamiliar inputs?

## Five next designs

| Research line | Failure that informs the design | Next change |
| --- | --- | --- |
| Reasoner | Lexical guidance matches the task model on the opened cohort. The current 5.8 machine record reports a measurement floor. The 5.9a result misses several gates. | Give all six arms equal search optimizations, keep the model fixed, and compare fresh families. |
| Solomon | The historical integer model emits the same logits for each context. A train-only bigram lowers the original loss by 6.08%. | Require context-sensitive outputs and include the integer bigram on fresh documents. |
| ZERO.4 | Earlier replay guards hit the cumulative ceiling or stalled. The later projection traces record accepted full-scale updates across all three seeds. | Compare the frozen reference, task-only continuation, ordinary replay, and replay with projection at equal compute on a fresh task. |
| FERAL | Fourteen empty labels have recoverable programs and numeric values. The original score remains 168/1,147. | Freeze a separate target version with explicit units and a retrieval-plus-calculator control; report both target versions. |
| Weight multiplicity | The pilot hit its resource gate. The later tail calibration completed, then its wrapper failed. | Integrate accounting into each query completion, retain failed work, and replay the original tail trace before a new corpus run. |

The [five design reports](../../examples/constraints/research-step-5/) include
matching earlier records, evidence references, and a proposed change. Each
report binds the normalized ledger bytes. Tag matches prompt review and
support replication or control changes through the normal PR flow.

## Checks and repairs

The original PR's report schema failed strict validation because its array
conditions lacked an explicit array type. Its sequence test also expected
JSON Schema to reject duplicate sequence numbers. The repaired runtime now
checks sequence order, unique verdict identities, correction chains, and
the unchanged prefix when appending records.

The behavior checks exercise evidence changes, verdict changes, path escape,
duplicate tags, exact tag matches, corrections, and an existing output file.
They reproduce all five saved design reports from the bound ledger. The
schema suite also reads every new verdict and report.

The first ten imported entries have reference-only evidence. The eight new
entries pass local file and digest checks. These checks establish source
identity. The scientific conclusions retain the scope of the earlier
experiments and opened-data audits.

## Failures retained for follow-up

- Reasoner 5.8's prose summary differs from its current machine record. The
  ledger records that mismatch separately from the development decision.
- The weight multiplicity closeout separates a completed scientific
  calibration from its later wrapper failure.
- The raw calibration trace fetch returned an expired AWS SSO token in
  research step 3. The next local work is runner integration and replay
  preparation; trace verification resumes once access is refreshed.

The next implementation step connects the tested resource component to the
real corpus runner, including trace persistence and worker completion after
a Hold. Paid execution follows a concrete package and cost review.
