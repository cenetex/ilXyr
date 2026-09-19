# ZERO.4: the bounded cloud package

The full ZERO.4 comparison now has a sealed cloud package. Its source and
input checks pass locally. The fixed Linux image passes the small native
study through the new runtime. Fourteen host and transport tests pass,
including controlled failures during setup, storage, execution and collection.

The package is ready for staging and free provider preflight. AWS sign-in is
pending. The full production comparison follows preflight and approval for
this exact package and its cost ceiling.

## What is fixed

The package contains the [step44 source kit](../research-step-44/KIT.json),
all 63 full input and source files, the runtime, the host script, launch and
preflight tools, and collection code. It verifies the original source kit,
each prepared file, the prepared manifest and every host file. The full input
check makes zero production teacher forward calls.

The [execution plan](EXECUTION-PLAN.json) uses one `c6i.4xlarge` in `us-east-1`,
with sixteen CPUs, 32 GiB host memory and an encrypted 80 GiB root volume.
The image, root snapshot, network and role are fixed for provider preflight.
The container has 24 GiB memory, sixteen CPU slots, 1,024 process slots,
a read-only root, a 512 MiB temporary filesystem and network access disabled.
The runtime image fixes GCC 12.2 and Python 3.11.2.

The five methods, three seeds, training CPU allowance, case roster and final
outcome rules stay fixed in the step44 plan. Each full comparison covers all
500 task cases, 1,005 BLiMP pairs, 1,000 story windows and 81 retention windows
for each of fifteen selected models. All model choices finish before final
scoring begins.

## Shutdown, cost and storage

A shutdown timer is the host's first action. Setup has twenty minutes, and the
controller has its full twelve-hour allowance. Collection and shutdown fit
inside a **13½-hour instance limit**. The launcher requests one instance with
termination on shutdown and root-volume deletion. Collection checks provider
termination, volume deletion and interface cleanup before downloading results.

The plan has a **$12 ceiling before tax**. The rates in the plan are ceilings
that current provider prices must meet during free preflight. The arithmetic
uses the full time, storage and download allowances:

| Cost item | Ceiling in USD |
| --- | ---: |
| Instance compute | 9.1800 |
| Root volume | 0.1200 |
| Public IPv4 | 0.0675 |
| Retained objects | 0.4416 |
| One bounded result download | 1.6200 |
| Requests | 0.0100 |
| Calculated total | 11.4391 |
| Remaining margin | 0.5609 |

The host checks free disk space after image setup. It reserves room for the
full study output, the result archive, one upload part and an extra GiB.
The result archive permits 16 GiB of study output plus 64 MiB of overhead.
It uses at most five parts of at most 4 GiB each. Every part has a SHA-256
and an immutable storage version. An ordered receipt binds the parts and
the complete archive.

Before each upload, the collector saves the expected part name, size and
hash. An uncertain response therefore leaves an exact record for later
inspection. Successful earlier parts keep their version receipts. Byte,
member or time limits produce an incomplete collection record. The receiver
checks complete part coverage and the joined archive hash before extraction.

## Checks and failures

The controlled host tests verify the timer, fixed container limits, free disk
reserve, package identity, safe launch arguments, approval and preflight
requirements, cleanup and exact-version collection. Tests also change part
order, remove a part, corrupt stored bytes and interrupt the second upload.
Each case preserves the useful partial record or stops at the intended check.
An uncertain launch response keeps the exact submitted request and its status.

A further probe found a preflight binding gap: a receipt for a different run
ID could reach the fake provider. The launcher had checked package identity
and age, while the empty-output check belonged to another run. The repaired
receipt binds the run ID, and the regression stops before any provider call.
The failing probe remains in [FAILURES.json](FAILURES.json).

The first local host check also hit a sandbox restriction on the shell log
pipe. Its output remains recorded. The tests passed with host permission,
using fake AWS and Docker commands throughout. The AWS identity check still
reports an expired sign-in session.

The fixed-image check reconstructs the exact source kit and runs the tiny
synthetic study. It uses the full input manifest as metadata; production
input bytes loaded in that check are zero. The full production archive is
verified separately by local extraction and hash checks. The runtime retains
whole-container memory and CPU counters, plus memory-exhaustion events. These
small checks verify execution and accounting. The paid comparison will supply
the new research result.

## Package and next move

[PACKAGE.json](PACKAGE.json) binds the **54,886,400-byte** archive:
`0ed0d960d8cfbe7e4e86d600c490867c732c4ac2d3cd462f8ccbb1b9f7e35ac3`.
[RESULT.json](RESULT.json) records the checked scope and runtime evidence.
[PREFLIGHT.json](PREFLIGHT.json) lists the completed local checks and the
remaining provider checks. Full archives and failure records remain in
`outputs/zero4-cloud-step45-20260912`.

After AWS sign-in, the next move is to stage this exact package, verify its
stored version, check live prices and permissions, and perform the free EC2
dry run. The launch request then presents this package and the $12 ceiling.

This extends the shared method used by Reasoner and Solomon: count complete
process work, retain failures, and judge benefit against a simple reference
under fixed task rules. ZERO.4's case scoring and retention gates remain those
of the earlier sealed study. The next independent preparation is the cloud
host for Reasoner's four-method comparison. Solomon's step38 and weight
multiplicity's step35 packages await their exact run approvals. FERAL's next
local move is fresh calculator coverage, with the closed capacity window
kept in its record.
