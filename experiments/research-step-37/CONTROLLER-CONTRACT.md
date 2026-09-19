# Solomon confidence controller

Use the unchanged candidate, training memory, document roster and schedule
from [step 32](../research-step-32/REPORT.md). The full panel contains twelve
documents, 32 windows per document, five methods and five passes: 300 separate
worker processes and 9,600 probability rows. The native worker performs 1,920
forward calls. The four controls use the frozen training memory.

The five methods are native confidence, a point mass, a smoothed point mass,
empirical suffix counts, and suffix counts with one observation of uniform
prior mass. Their chosen byte follows the existing suffix selection. Targets
stay in the controller; each worker receives its artifact and 64-byte contexts.

## Source and execution

Validate every prepared file, the stored model and memory, the fixed plan,
the roster, and the complete schedule before any worker starts. Copy the
bound source into a new build directory. Build with the fixed Cargo command,
locked dependencies and offline mode. Retain compiler and build receipts.
Copy the compiled worker into the collected result and record its hash.

The cloud entry point requires a run identity, package hash, prepared-input
hash, all six implementation hashes, machine fields, exact compiler identity
and bounded limits. The checker can run on a different collection host.

The outer cloud package still needs its image, compiler environment, CPU and
memory limits, storage limits, watchdog, staging, price and approval. Its
launcher supplies and verifies provider identity. This controller executes
inside that already bounded environment.

Controller limits accept at most 1,800 seconds in total, 300 seconds for the
build, 120 seconds per document worker, five seconds of child termination
grace and one MiB of logs per process. The outer process allows two extra
seconds of termination grace so the child can stop its active worker. The
eventual execution record may choose tighter limits.

## Work and failure accounting

Keep each planned job's index, pass, document, method, command and input hashes
before starting it. Keep stdout, stderr, exit status, whole-process user and
system CPU, wall time and observed peak RSS. A failed worker ends the attempt.
All completed jobs and partial files remain available; later jobs stay unstarted.

Record confirmed native calls separately from the maximum calls in started
native jobs. A failed native worker can leave its actual call count unknown.
Record that uncertainty. Treat SIGTERM and SIGINT as cancellation at both
controller levels. Stop the active process group and restore signal handlers.
Use fresh result and build directories for each attempt.

The outer process measures the complete child controller, including source
preparation, building, job supervision, probability checks and final result
sealing. Keep setup and worker costs separately. Derive controller overhead
from the whole-process CPU receipt after subtracting those children. The
inner pre-seal timers describe a stage; the outer receipt supplies total cost.

## Collected-result checks

The caller provides the expected supervisor-file hash from collection. Check
its controller receipt and the complete file manifest. Reject changed files,
extra files, symbolic links, incomplete attempts, missing jobs, altered job
inputs, different executable bytes, invalid process records and cost records
that omit child work.

Rebuild every control vector from frozen memory and context. For native rows,
check component bounds, positive mass, the suffix-selected byte, and identical
vectors across all five passes. The separate opened reference check compares
the native worker with the original evaluator. Preserve the raw native mass:
the integer approximation produces a varying total. Compute Brier error with
exact rational probabilities obtained by dividing by each vector's actual sum.
Quantization can also create a tie in displayed masses while the original
chosen byte remains fixed.

Average Brier error within each document, then weight documents equally.
Retain mistakes, zero-target probabilities and fiction/nonfiction summaries.
For each document and method, take median whole-process CPU across five
passes. Report paired document differences and equal-document geometric cost
ratios. A zero measured CPU denominator produces an explicit unresolved ratio.
The ten linked document groups remain attached to the result. The frozen
panel is a diagnostic; its promotion scope stays as defined in step 32.

## Small check

The opened entry point uses the same sixteen historical windows, one document,
two passes and ten processes. It confirms 32 opened native calls and zero fresh
model calls. Its fixed ceiling is 240 seconds, with a 180-second build limit
and 15 seconds per worker. The independent check must reproduce all five
exact scores in the published step 32 smoke record. Timings from this check
remain engineering records.
