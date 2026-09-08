# Research step 24: approved Reasoner run and FERAL coverage audit

The user approved the published Reasoner package for one instance, at most one
hour, and $0.50 before tax. The free dry run passed again. AWS launched
`i-0ffba5be5a2f4141b` at 07:12:34 UTC on September 8. The original binding fixes
the deadline at 08:12:13 UTC. Its actual startup script matches the rendered
bytes exactly. The host armed its shutdown timer, downloaded the exact package
version, and completed its fixed runtime image pull. [AUTHORIZATION.json](AUTHORIZATION.json) and
[LAUNCH.json](LAUNCH.json) preserve the approval and live observation.

The run uses the exact [published package](../research-step-23/REPORT.md):
`e7da18889a91796c2c42f49832b2e89dcb565dd4eefeec9b8b9307e72b26ec4d`.
Its result, collected object versions, independent replay, provider termination,
and cost estimate will follow the terminal state. The six-arm comparison keeps
its frozen question, inputs, compiler, and decision rules.

## What caused FERAL's abstentions

A read-only audit of the published control outputs traced all 1,147 cases in
each arm. Both controls used the same selection rules and had the same reason
counts. [FERAL-COVERAGE.json](FERAL-COVERAGE.json) binds the original prediction
files and every count.

| Recorded reason | Cases |
| --- | ---: |
| Question requires distinct years | 708 |
| Unsupported question form | 203 |
| Matching evidence series missing | 121 |
| Requested year missing | 10 |
| Conflicting values | 7 |
| Ambiguous series | 5 |
| Unsupported adjustment | 2 |
| Answer returned | 91 |

The two question filters account for 911 of 1,056 abstentions, or 86.27%.
This localizes the calculator's coverage gap before changing its arithmetic.
The distinct-year rule excludes same-date comparisons and other question forms
that need separate handling. The next control design should classify question
and evidence forms, then freeze expanded rules before grading fresh cases.
The original scores and every abstention retain their existing result.

The shared lesson is to measure the contribution after each gate. Reasoner
compares learned guidance with lexical guidance. FERAL's coverage audit shows
how early input rules can dominate an otherwise correct arithmetic component.
