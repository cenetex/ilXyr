# Research step 55: reuse exact answers and measure row capacity

The weight pilot now reuses exact query results in fixed buffers, applies query
and orbit exclusions before selection, and records new accepted rows as its
selected set grows. A finite-roster check computes how many requested rows can
be assigned under those rules. Eighteen tests pass, including 576 comparisons
with exhaustive assignments. Linux and Mac produce the same development record.

The work exposes two useful failures. A fixed batch starting point can starve a
range that could use a known answer. Also, perfect raw label matches can coexist
with an unreachable row quota. Both failures are preserved in the shared ledger,
which now has 73 entries. All 71 earlier entries remain identical.

## What the cache changes

The key contains the canonical type, highest weight and target weight. Cache
identity binds the oracle contract, including its executable, coordinate mapping
and query format. A stored answer retains the sequence of the query that first
produced it. Labels remain exact decimal strings, including values larger than
machine integers. Hash-table collisions compare the full key bytes.

Payload, index and record metadata use fixed buffers. Entry and payload limits
are checked before each new oracle call. Capacity reserves space for the maximum
allowed answer length. A full cache retains its known answers and returns an
explicit stop reason. The buffer allocation is separate from the host's full
process-memory limit.

In the declared repeated-rejection fixture, the uncached control makes four
answer calls and retains two rows. The cached control makes three calls and
retains the same two rows. The cached rejection still counts as a candidate
evaluation. Candidate draws, construction failures, query and orbit exclusions,
cache hits, calls, accepted rows and incomplete batches each have their own record.

## Scheduling failure and repair

The original builder starts each batch at the first unfinished range. In the
new two-range fixture, both ranges propose the same query. The first range
reserves it, receives an answer outside its requested range, and releases it.
It repeats that sequence next batch. The later range receives no usable turn.

| Two-batch control | New answer calls | Cache hits | Accepted rows |
| --- | ---: | ---: | ---: |
| Original fixed start | 1 | 1 | 0 |
| Rotating unfinished ranges | 1 | 1 | 1 |

Rotation changes which unfinished range gets the first turn. The second control
retains the reachable row and preserves the remaining quota hold. The initial
reuse test exposed this failure when it tried to read the absent accepted row.
The original ordering remains an explicit control.

The candidate and original batch functions are copied from the frozen source.
[CANDIDATE-SOURCE.json](CANDIDATE-SOURCE.json) binds each copied block, and tests
compare every copied byte. Further tests compare the instrumented batch with the
original across three seeds, four root-system types and occupied selections.
The revised pilot adds the declared rotation option. The full future training
builder must use that same option and selection core.

## Capacity failure

A complete, declared two-query fixture contains a dominant target and its
non-dominant partner. Both answers have label 1, so raw label yield is 2/2.
Both queries share one orbit. With one allowed row per orbit, the maximum valid
assignment is **one of the two required rows**. The finite-roster checker proves
that limit and can reassign shared orbits when a valid allocation exists.

The real candidate generator also exposes a small boundary. For the A1
highest-weight-1 smoke, it selects one row against a requested quota of two.
It then exhausts candidate draws within the batch guard. Both cached and
uncached native controls preserve that quota hold.

A sampled pilot records candidate support as `unknown`. Its block-rate projection
is an empirical diagnostic. Complete finite-roster evidence has its own scope.
These records keep row capacity, sampling yield and budget estimation separate.

## Native and local verification

The fixed Linux image builds the same pinned LiE and Zero sources used by the
existing oracle checks. The new pilot smoke makes **15 native calls per
invocation**: one LiE warmup, seven LiE workload calls and seven Zero checks.
Every observed label agrees with the declared A1 answer and with both oracles.
The native repeated-rejection fixture reduces new query pairs from three to two
and retains the same row. The native generator smoke preserves its expected
quota hold.

[NATIVE-SMOKE.json](NATIVE-SMOKE.json) retains every native observation, selected
row and stop reason. [RUNTIME-CHECK.json](RUNTIME-CHECK.json) binds the executable
hashes and the identical Linux/Mac development outputs. [RESULT.json](RESULT.json)
contains seven development cases; each invocation makes 12 declared-answer calls
and zero native calls. The native smoke is recorded separately. The full local
schema suite and source CI pass. [VALIDATION.json](VALIDATION.json) binds their
receipts and [SOURCES.json](SOURCES.json) binds the implementation.

[FAILURES.json](FAILURES.json) preserves the original scheduling failure, finite
capacity failure and expected cache-capacity stop. Tests also cover invalid
oracle answers, incomplete batches, source identity changes, quota overflow and
storage limits.

## Next move across the program

[NEXT.json](NEXT.json) calls for a frozen native training-source pilot package
and an independent result checker. It must measure occupancy, bind both controls,
account for every call and draw, and retain the existing corpus and resource
gates. Its full comparison still needs a fixed package, price and approval.
The original step 51 partial corpus and call-limit hold remain authoritative.

This gives the shared program a concrete rule: measure the useful result after
all selection rules have applied. FERAL needs the requested source facts,
Reasoner needs guidance that improves search, Solomon needs useful confidence,
ZERO.4 needs retained skills, and weight multiplicity needs new eligible rows
within its budget.
