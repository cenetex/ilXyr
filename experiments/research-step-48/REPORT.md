# FERAL: a bounded comparison with independent trace checks

The three-control runner is ready for a fixed cloud host package. It preserves
the step 47 test: 228 questions, three controls, 12 passes, one worker, and a
fixed case order. The full run will make 8,208 predictor calls and retain 684
distinct results. Every arm receives the same evidence. Each pass rotates the
arm order. Fresh predictor calls remain zero in this preparation step.

Local, Linux, and Mac checks each pass nine worker processes over two invented
table families. Each check retains 522 predictions and verifies 174 distinct
results. Their stable output hashes match. All 19 unit checks pass locally
and in both CI environments. The source archive also passes the opened run
after unpacking. [KIT.json](KIT.json), [RESULT.json](RESULT.json), and
[PLATFORM-CHECKS.json](PLATFORM-CHECKS.json) bind the evidence.

## The opened result shows a wording limit

The engineering fixture contains 58 cases: 42 numeric questions and 16 required
abstentions. Each canonical question has a paired plain-English form with the
same evidence and target. All three controls correctly abstain on all 16
evidence-fault cases.

| Fixed control | Correct canonical numeric answers | Correct paraphrase numeric answers | Wrong numeric answers |
| --- | ---: | ---: | ---: |
| Calculator v1 | 10/21 | 0/21 | 0 |
| Calculator v2 | 21/21 | 0/21 | 0 |
| v2 operand-only | 2/21 | 0/21 | 19 |

These are invented development cases. They show the scope of the current
question rules and exercise the checker. The fixed benefit rule requires v2
to improve correct numeric coverage by at least ten percentage points over
both references in each question style, with controlled error counts and all
required abstentions correct. The paraphrase result exposes a coverage gap
even when the canonical forms work. The 228 fresh report questions remain
reserved for the cloud comparison.

## Two engineering failures are retained

The first local collection check found a path mismatch. Its supervisor used a
temporary path alias, while the child recorded the resolved path. The two
public controller entry points now resolve their input, output, and worker
roots before recording commands. The local and Mac CI checks cover that path.

The first independent checker also accepted an altered source-selection trace.
For one v2 lookup, the selected-series field was changed from operating income
to net income while the saved operand still named Operating income. The
alteration covered all three passes, and the output hashes and inventories
were rebuilt. The checker accepted all three changed rows.

The repair ties selected-series order to the operand labels and checks how
far selection progressed before an abstention. It covers both v1 and v2
traces. The preserved earlier checker still accepts the saved alteration when
replayed from a moved archive. The repaired regression check rejects it.
[FAILURES.json](FAILURES.json) records both failures and the original checker
and archive hashes.

## What the runner and checker retain

Each worker directory contains the two frozen calculator sources, a small
entry point, and the input file. Predictor inputs contain the question and
supplied evidence. Targets and evaluation labels reside in the grader data.
Each worker writes complete prediction lines as it runs. Its process record
keeps stdout, stderr, exit status, deadline signals, CPU, wall time, and peak
resident memory. The controller retains partial output when a child fails.

Full cloud execution first rebuilds the questions and targets from the fixed
report bytes. It compares the rebuild with the sealed data and runs the
independent JavaScript target checker. The main process includes that work,
all worker processes, and collection writing. A separate process records the
cost of checking the saved collection. Parent costs include their waited
children once. The current timing records describe engineering checks.

The comparison has a 300-second controller limit, 15-second child limits,
four-MiB log and worker-output ceilings, and a 64-MiB collection ceiling.
Cloud mode requires the bound inputs, fixed report bytes, implementation
hashes, runtime identities, worker count, limits, and a cloud execution record.
The later host package will bind those fields to the machine and launch budget.

The checker validates every source span, selected label, period, value, unit,
arithmetic result, printed answer, and work count. All repeated outputs must
match. Quality counts each distinct case once. Saved reports break results
down by company, table family, question form, wording, and evidence fault.
They include paired changes against each reference and between question styles.

The unit checks alter targets, source spans, values, arithmetic, work counts,
series labels, repeated outputs, process scope, and child costs. They also
exercise missing output, extra files, input fields containing targets,
output limits, deadlines, and controller failures. A moved collection passes
the same independent check from its saved files.

## Next step and shared research question

The next execution step is the immutable cloud host package, its free provider
checks, and its exact budget. The learned-component question is also clearer:
can a selector map varied questions to the right facts and operation while the
exact engine owns arithmetic? The [FERAL v3 proposal](../../docs/FERAL-7B-V3-XBRL-REGULATORY-PROPOSAL.md)
provides the next design for concept and context selection. Its tagging tasks
will need their own fresh examples and scoring rules.

This follows the same method as Reasoner: test the learned choice against a
simple reference and keep verification exact. Solomon's compact learning,
ZERO.4's retained capability, and weight multiplicity's exact model structure
use the same requirements for fixed inputs, complete costs, and retained
failures. Here the wording gap is the useful finding that guides the next
candidate.

## Reproduce the invented check

Use a fresh output directory at each step, from the unpacked source archive:

```sh
python3 -B scripts/test_feral_coverage.py
python3 -B scripts/research_feral_coverage.py prepare --raw raw --out prepared
python3 -B scripts/research_feral_coverage.py opened --prepared prepared --out opened --work worker
python3 -B scripts/check_feral_coverage.py --prepared prepared --collected opened --supervisor-sha256 EXPECTED_SUPERVISOR_SHA256 --out checked
```

Use the SHA-256 of `opened/SUPERVISOR.json` for the checker argument. The source
archive includes the prepared-test sources and fixed report copies. Its local
check uses the invented tables. Raw reports, complete process captures, and
the earlier accepted alteration remain in local custody; Git carries the code,
fixtures, plans, and compact result records.
