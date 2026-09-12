# Research step 53: FERAL requests expose a context gap

The strict request control fixes the opened wrong-index answer and answers all
22 invented numeric questions. It abstains on all three older numeric development
questions, which v2 answers correctly. V3 remains a comparison control. The next
research target is the mapping from a question to a source fact using document
context.

## What changed

The earlier selector reduces `S&P 500 Index` to the word `index`. In the completed
comparison it selected a Dow Jones index when S&P 500 was missing. The selected
numbers and arithmetic were consistent with that different index.

V3 first records the operation and ordered entity labels and years. Each selected
fact must match that request. Label normalization folds case and whitespace and
removes terminal full stops. It keeps numbers, single letters, internal punctuation,
word order and qualifiers. A regression check also preserves year-bearing names
such as Target 2030 Fund alongside their separate 2025 fact period. Missing
entities, years, conflicting values and ambiguous
requests retain explicit reasons. Both the calculator and operand control use the
same source selection and denominator checks.

Fourteen local tests cover the request, source, ambiguity and replay rules.
The request parser covers eleven declared arithmetic forms in two wording styles.
The templates are development material. The two earlier calculators keep their
frozen source bytes. [SOURCES.json](SOURCES.json) binds the new control, tests,
diagnostic and older inputs.

## The results that matter

Each diagnostic invocation makes 111 development predictor calls, including one
replay. Fresh evaluation calls are zero. The same-implementation replay checks
record integrity; hand-written expected values, fact order and source changes
check the meaning of the invented requests.

| Control | Invented canonical correct | Invented plain wording correct | Wrong numeric on invented cases | Older numeric correct |
| --- | ---: | ---: | ---: | ---: |
| V1 | 5/11 | 0/11 | 0 | 2/3 |
| V2 | 10/11 | 0/11 | 1 | 3/3 |
| V3 | 11/11 | 11/11 | 0 | 0/3 |
| V3 operand only | 1/11 | 1/11 | 20 | 0/3 |

All four controls correctly abstain on the two older required-abstention cases.
The opened wrong-index case is separate from these counts: v2 repeats `234/287`,
while v3 records `missing_requested_entity`. Adding the requested S&P 500 fact
with an invented value of 468 gives the declared ratio `1/2`.

A second invented case changes the two investment baselines. Final wealth of
120 from 50 and 300 from 200 gives a return difference of 90 percentage points.
V2 subtracts final wealth directly and returns -180. V3 selects all four facts
and returns 90. A missing baseline causes abstention.

The three older misses identify the cost of strict matching:

- Masco common stock needs a mapping to a shorter table label and a shared
  investment baseline stated in prose.
- Private investor repurchase claims needs the table category and its context.
- Research and development costs needs a mapping to expense.

[RESULT.json](RESULT.json) retains the counts and source-linked traces.
[FAILURES.json](FAILURES.json) preserves the wrong-index error, unequal-baseline
error and strict-label coverage failure. The shared ledger now has 70 entries;
all 69 earlier entries remain identical.

## The next comparison

[NEXT.json](NEXT.json) defines the next preparation step. A context-aware selector
must record the requested operation, ordered facts, and source words that justify
each label or shared-baseline mapping. The comparison needs unfamiliar entities,
independent wording, distractor indices, changed context, and explicit abstentions.
The frozen coverage-gain and wrong-answer rules stay in view.

The model candidate and new evaluation roster still need to be frozen. These
opened cases belong to development. The original 228-case result remains the
record of its completed comparison.

This gives the shared program a useful separation: arithmetic validity, source
identity, interpretation and coverage have distinct evidence. Reasoner needs a
benefit from guidance, Solomon needs reliable confidence, ZERO.4 needs retained
capability, and weight multiplicity needs sufficient yield within its budget.
Each next design uses the failure that identifies its missing capability.
