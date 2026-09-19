# Reasoner: a fresh roster with a complete rejection audit

The next Reasoner comparison now has 128 fixed families. The roster excludes
all 396 prior source, development, fixed-transfer, matched and opened families
by both target behavior and primitive set. It also excludes 259 exact source
solutions or declared development solutions.

The seed and selection rules were committed before generation in commit
`97a32af`. Each of four cells contains 32 families: sparse or dense mixing,
crossed with distinct or repeated target roles. The generator selects the
first eligible candidate for each ordinal. Its 234 candidate decisions include
106 rejections: 95 omit the required mixing role and 11 repeat an excluded
solution. Every decision is retained in [DECISIONS.json](DECISIONS.json).

The C and JavaScript implementations agree on all candidate decisions,
source-solution exclusions, accepted maps, surface names, public examples and
shortest program lengths. There are 127 families with minimum length four and
one with minimum length three. Length is recorded after acceptance. Selection
uses the frozen freshness rules.

## A useful failure in the previous check

A controlled alteration showed that the old checker accepts a later eligible
candidate with an invented rejection tally. For ordinal zero, the first
candidate was eligible at nonce zero. The altered roster used nonce three and
claimed three mixing-role rejections. The old checker accepted it.

The old check reconstructed accepted rows and checked that rejection counts
added up to the nonce. The new check reconstructs every candidate in order and
compares its first failing predicate with an independent C replay. It also
checks the exact plan, exclusion list, source-solution mask, native header and
generation summary. [LEGACY-CHECK-PROBE.json](LEGACY-CHECK-PROBE.json) preserves
the controlled alteration. The earlier measured cohorts and primary no-go
retain their original source and evidence.

Primitive-set identity is also stronger. The old key kept role order. The new
key sorts the eight affine maps and retains duplicate maps. A permutation of
familiar operations therefore keeps the same exclusion key. All 396 prior
families have distinct keys under this stronger definition. A controlled
permutation exercises the reuse guard in both implementations.

## Verification and custody

The validation reads 31 hash-bound files from the published step 36 source.
It builds the native replay, checks six native guard cases, checks the fixed
roster, and tests altered records and exclusions. Each process has a bounded
runtime and retained stdout, stderr, CPU, wall and memory receipts. These
measurements document the engineering checks. All 14 JavaScript integrity
cases and six native guard cases pass. Linux, Mac CI and the local audit
produce identical copies of all eight stable artifacts. Local address and
undefined-behavior checks pass and preserve the same native trace.
[PLATFORM-CHECKS.json](PLATFORM-CHECKS.json) binds the results.

The first native prototype had a conflicting main-function macro. It was
repaired by using the existing source header with its renamed entry point.
The first platform test then caught an altered exclusion file, but its test
expected the wrong wording in the error. The test expectation was corrected.
Linux then stopped on GCC warnings in a guard fixture and an unused training
function from the frozen source. The guard fixture is initialized, and both
platform audits use Clang. These failures are retained in
[FAILURES.json](FAILURES.json).

The fresh roster has zero method evaluations and zero model calls. The
opened ranking failure remains: the full guide used 243 verifier checks,
compared with 211 for semantic frequency and 176 for lexical guidance on the
step 36 examples. The new roster prepares a fair test of that ranking issue.

## Next move and the shared program

[NEXT-CONTROLLER.json](NEXT-CONTROLLER.json) gives the next implementation:
48 isolated processes for the same four methods, 12 repetitions, and the same
family and arm orders. Every family has two source-guide views and two tie
views. Warmup and measured visits total 49,152. Independent replay will check
2,048 distinct method-and-view results, while repeated rows must agree.
The worker smoke will use the already opened step 36 families.

The full controller will retain preparation, ranking, verifier, fallback and
whole-process costs. It will use lexical guidance and semantic frequency as
cost references. Its statistical gates, cloud image and budget will be fixed
before the paid comparison.

This carries the shared research method one step earlier: record the complete
selection history as well as the complete execution history. Solomon already
retains document intake failures and has a tested cloud package. Reasoner now
retains each family rejection. ZERO.4's next rosters need separate task,
retention and language coverage. FERAL needs fresh calculator coverage and a
new bounded capacity decision. Weight multiplicity awaits its published
package's paid-run approval.
