# Research step 32: fresh Solomon documents and separate confidence costs

Solomon now has **384 selected byte-prediction windows from twelve public
documents**, plus a native worker for each of its five confidence methods.
The source intake covers 8,523,061 bytes. The documents and windows were
fixed before model scoring. Fresh-document scores remain pending.

The worker reproduced the earlier sixteen-window result using separate
processes. Its native arm reads the 443,564-byte frozen model. Each simple
control reads the same 9,388 training bytes stored in that model. Every arm
selects the same answer; the comparison concerns confidence and complete cost.

## Sources and scope

The fixed panel contains six fiction and six nonfiction documents, with a
different primary author for each. Project Gutenberg lists each source as
public domain in the USA. The source kit retains the complete text, catalog,
source license, retrieval receipt, and SHA-256 for every document.

| Fiction | Nonfiction |
| --- | --- |
| [Pride and Prejudice](https://www.gutenberg.org/ebooks/1342), Austen | [Walden and Civil Disobedience](https://www.gutenberg.org/ebooks/205), Thoreau |
| [Sherlock Holmes](https://www.gutenberg.org/ebooks/1661), Doyle | [On the Origin of Species](https://www.gutenberg.org/ebooks/1228), Darwin |
| [The Time Machine](https://www.gutenberg.org/ebooks/35), Wells | [The Wealth of Nations](https://www.gutenberg.org/ebooks/3300), Smith |
| [A Tale of Two Cities](https://www.gutenberg.org/ebooks/98), Dickens | [The Art of War](https://www.gutenberg.org/ebooks/132), Sunzi, translated by Giles |
| [Frankenstein](https://www.gutenberg.org/ebooks/84), Shelley | [On Liberty](https://www.gutenberg.org/ebooks/34901), Mill |
| [Tom Sawyer](https://www.gutenberg.org/ebooks/74), Twain | [Autobiography](https://www.gutenberg.org/ebooks/20203), Franklin |

The tested artifact is the calibrated suffix-memory candidate from NSRL
commit `96321943e1da7b67bf6c9b4954ff14e6057ac433`, model SHA-256
`37acae6a4f763182730c76f762c351eda5bb37d6d197358c252733b1f08dca10`.
The reference set covers its complete recorded training text, stored memory,
and previously opened evaluation text. This is a fixed English document
panel for that candidate. Semantic dependence and unrecorded exposure remain
unknown. Earlier promoted and experimental model records keep their scope.

## Failures that changed the intake

The [first plan](ROSTER-PLAN.json) selected evenly spaced byte positions.
Two contexts landed mostly in page-layout spacing and failed the minimum
text-length check. The failure preserves their exact bytes in
[SELECTION-V1-SHORT-CONTEXTS.json](SELECTION-V1-SHORT-CONTEXTS.json).

[Version 2](ROSTER-PLAN.v2.json) chose the first eligible position within
1,024 bytes of each anchor. Only those two windows moved: 19 and 8 bytes.
The remaining windows kept their positions. That roster then failed the
rule requiring zero shared 32-byte phrases across fresh documents. Two
contexts shared phrases with other books, including “in the most comprehensive
sense” and a reference to repeal of the American Stamp Act. The six overlapping
spans remain in [SELECTION-V2-MATCHES.json](SELECTION-V2-MATCHES.json).

[Version 3](ROSTER-PLAN.v3.json) keeps every version-2 window. It treats these
partial shared phrases as links between documents. The twelve documents form
ten groups. Any uncertainty resampling must keep linked books together and
preserve their original document weights. Whole-context repetition, duplicate
documents, and substantial sampled document overlap still block intake.
The zero-32-byte-overlap rule against prior candidate data also stays fixed.

All 5,508 saved overlap checks passed under version 3. The selected contexts
have zero 32-byte matches against prior candidate data. One shorter 16-byte
span matches the earlier evaluation text and remains visible in the record.
[ROSTER.json](ROSTER.json), [OVERLAP.json](OVERLAP.json), and
[OVERLAP-SUMMARY.json](OVERLAP-SUMMARY.json) preserve the bytes, offsets,
rules, groups, and results. These revisions all preceded fresh model scoring.

The implementation record also keeps a Rust integer-type build error, an
incorrect assumption that the upstream tree contained a root license file,
and a local shell-permission test failure. Their repairs and evidence are in
[FAILURES.json](FAILURES.json).

## Separate confidence work

The new worker accepts 64-byte contexts. Gold target bytes stay in the
controller. Native inference uses the existing evaluator with a fixed dummy
target, then converts its logits to the original integer probabilities.
The worker batches at most 32 contexts; the frozen evaluator uses one thread
below 512 items. Each other arm computes its answer and probabilities directly
from the exported training memory.

The five methods are native probabilities, full confidence, fixed smoothing,
empirical suffix counts, and suffix counts with one observation of uniform
prior mass. The native and fixed vectors match the legacy evaluator exactly.
Independent Python count and fraction arithmetic checks the other vectors.

The opened fixture reproduces these mean Brier scores:

| Method | Mean Brier | Mistakes | Zero-probability targets |
| --- | ---: | ---: | ---: |
| Native | 0.702257 | 4 | 2 |
| Full confidence | 0.500000 | 4 | 4 |
| Fixed smoothing | 0.459847 | 4 | 0 |
| Empirical suffix counts | 0.436361 | 4 | 4 |
| Suffix counts with uniform prior | 0.494994 | 4 | 0 |

[SMOKE.json](SMOKE.json) records exact fractions and work counts. The native
worker makes sixteen forward calls, while each simple control makes zero.
Each arm has its own receipt for process CPU, wall time, peak memory, inputs,
and outputs. The legacy reference makes its original 32 calls. This is an
engineering parity check on opened data; performance comparisons belong to
the future fixed-machine run.

Eleven Python tests cover source boundaries, layout failures, phrase groups,
retained prior-data exclusions, duplicate documents, balanced process order,
changed inputs, probability rows, and preserved failed attempts. Two Rust
tests check suffix selection and fixed probability construction. The full
local research suite passed once shell process substitution was available.
Linux CI repeats the native parity check using the pinned public source.

## Prepared work and the next run

[SCHEDULE.json](SCHEDULE.json) fixes 300 processes: five arms, twelve documents,
and five passes. The arm order rotates so each arm occupies every position
once within each document. All arms use the same selected contexts. The
planned output contains 9,600 probability rows, including 1,920 native forward
calls. Scores will average windows within documents and then weight documents
equally; fiction and nonfiction will also be shown separately.

The primary cost record will include each process's loading, inference,
probability construction, and output formatting. Build and controller costs
will remain separate. [RUN-DESIGN.json](RUN-DESIGN.json) and
[PREPARED-BINDINGS.json](PREPARED-BINDINGS.json) bind the source kit and inputs.
The cloud controller, full-result checker, fixed machine and compiler,
resource limits, shutdown guard, staging checks, and priced approval are next.
The source kit is preparation for that work. Its [archive receipt](KIT.json)
binds 148 files in a 3,816,487-byte archive, verified by reading every archived
file back. The archive remains in local custody while this PR is reviewed.

To reproduce the opened native check from these committed records:

```bash
python3 scripts/research_solomon_confidence.py prepare \
  --nsrl-repo /path/to/nsrl \
  --plan experiments/research-step-32/ROSTER-PLAN.v3.json \
  --frozen experiments/research-step-32 \
  --out /tmp/solomon-prepared
python3 scripts/research_solomon_confidence.py smoke \
  --prepared /tmp/solomon-prepared --out /tmp/solomon-smoke
```

Use fresh output directories. Locked Rust dependencies must already be
available for the offline build; CI fetches them before the check.

The shared research question becomes more precise: identify the decision a
learned component controls, then measure its quality and all the work around
it. Solomon holds answers fixed while testing confidence. Reasoner's
[cost diagnostic](https://github.com/cenetex/ilXyr/pull/188) locates work before
search. Both now have concrete measurements that can explain a failed claim.
