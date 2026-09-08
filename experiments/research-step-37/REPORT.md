# Research step 37: Solomon has a full confidence controller

Solomon now has the controller and collected-result checker for its fixed
twelve-document confidence comparison. The full design has 300 separate
worker processes, five methods, five passes and 9,600 probability rows.
This step verifies the machinery on the sixteen previously opened windows.
Fresh-document model calls and new paid instances remain zero.

The local and Linux checks each completed ten worker processes and 160 rows.
All twenty worker stdout and stderr files match across platforms. The
independent checker reproduces all five exact scores from
[step 32](../research-step-32/SMOKE.json). It also verifies the complete outer
controller cost, including preparation, building, validation and result sealing.

## The earlier confidence failure stays visible

All five methods choose the same bytes and make four mistakes on the sixteen
opened windows. Lower normalized Brier error is better.

| Method | Normalized Brier error | Mistakes | Zero probability for the true byte |
| --- | ---: | ---: | ---: |
| Native confidence | 0.702257 | 4 | 2 |
| Point mass | 0.500000 | 4 | 4 |
| Smoothed point mass | 0.459847 | 4 | 0 |
| Empirical suffix counts | 0.436361 | 4 | 4 |
| Suffix counts with one observation of prior mass | 0.494994 | 4 | 0 |

The native confidence model has the highest error on these opened windows.
The exact fractions remain in [SMOKE.json](SMOKE.json). The fresh panel will
test confidence under document shift. Its interpretation stays bounded to the
twelve fixed documents, their two strata and the ten linked document groups.

## Complete work and costs

Each worker receives the fixed artifact and its document's contexts. Gold bytes
stay in the controller. The original candidate and all five worker methods
remain fixed. The controller follows the step 32 schedule, records the planned
command and input hashes, and starts a new process for each method/document pair.

Every process keeps stdout, stderr, exit status, user CPU, system CPU, wall time
and observed peak RSS. Compiler and build records stay separate from worker
records. An outer process measures the whole child controller. Its total
includes the controller's input checks and final collection work. The checker
requires those total costs to cover the recorded children.

The checker uses the expected supervisor hash from collection. It verifies the
file manifest, executable, inputs, commands, full schedule, method accounting
and stable vectors across passes. It reconstructs every control probability
vector from training memory and context. For native output it checks component
bounds, the chosen byte and repeated vectors; the separate opened reference
check preserves parity with the original evaluator.

Brier scores use exact fractions. Scores average within documents before equal
document weighting. Cost comparisons use median whole-process CPU over five
passes for each document, then equal-document geometric ratios. Fiction and
nonfiction stay separate in the report. A zero measured CPU denominator keeps
an explicit unresolved ratio. The ten linked groups remain in the result.

## Failures found and retained

The first independent check failed because I assumed that the native integer
probability masses always summed to 32,767. The frozen approximation produces
varying totals: 32,771 through 33,007 on these sixteen windows. The earlier
reports already normalized each vector by its observed sum. The corrected
checker follows that definition and reproduces their exact scores. The first
check failure was reproduced from its preserved six-file implementation.

A review also found that the outer wrapper needed its own cancellation handler.
The repair forwards cancellation to the child controller and active worker.
Tests exercise both controller levels, deadlines, partial native output and
restored signal handlers. A failed native worker records its confirmed calls
and the upper bound for started work, with the actual failed call count marked
unknown when evidence is incomplete.

Thirteen focused tests also reject changed files, extra files, changed job
inputs, altered control probabilities, incomplete job coverage and cost records
that omit child work. Probability quantization ties and varying native mass
have dedicated cases. [FAILURES.json](FAILURES.json) separates observed failures,
review findings and injected checks.

## Next move and the shared program

The next Solomon deliverable is an immutable cloud execution package. It must
bind the machine, compiler environment, CPU and memory limits, storage limits,
watchdog, price and approval to this controller kit. The controller already
requires a matching cloud execution record for the full panel. The small
opened check supplies engineering evidence; its timings stay in that scope.

The shared method now has a concrete form: hold the answer-producing method
fixed when testing confidence, hold common search work fixed when testing
guidance, and charge the complete process in both cases. Preserve each failure
so the next experiment changes a specific decision.

| Project | Next deliverable |
| --- | --- |
| Reasoner | Fresh-family exclusions and comparison controller for eligible scoring; 396 earlier families are inventoried. |
| Solomon / NSRL | Fixed cloud package and free preflight for the 300-process confidence panel. |
| ZERO.4 | Fresh task and retention rosters, per-source limits, and a separate language screen. |
| FERAL-7B | A new bounded capacity decision for the fixed package; fresh calculator coverage checks. |
| Weight multiplicity | The published 90-minute run after approval for its exact $2 package. |

## Inspect and reproduce

- [Controller contract](CONTROLLER-CONTRACT.md)
- [Result](RESULT.json), [inputs](INPUTS.json), [source kit](KIT.json), and [failures](FAILURES.json)
- [Controller PR 195](https://github.com/cenetex/ilXyr/pull/195)
- [Passing Linux run](https://github.com/cenetex/ilXyr/actions/runs/34288908944)

Run the controller's `opened` mode with the step 32 prepared inputs. Then pass
the saved supervisor-file hash to `check_solomon_study.py`, together with the
published step 32 smoke record as `--opened-reference`. Keep its collected files
intact so the checker can verify every hash.
