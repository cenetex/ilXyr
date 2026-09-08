# Research step 22: FERAL control results and model startup failure

The replacement run completed both controls on all 1,147 revised FinQA cases.
The model worker failed during CUDA setup and produced zero answers. The
comparison remains incomplete. [SCORES.json](SCORES.json) preserves the grades;
[FAILURE.json](FAILURE.json) records the startup error and repair.

| Arm | Revised correct | Original correct | Explicit abstentions |
| --- | ---: | ---: | ---: |
| Evidence calculator | 24 / 1,147 (2.09%) | 19 / 1,147 | 1,056 |
| Operand-only control | 3 / 1,147 (0.26%) | 0 / 1,147 | 1,056 |
| Frozen Qwen model | Startup failed; 0 rows | Unknown | Unknown |

The calculator answered 91 cases. It returned 21 correct numeric answers and
received credit for three required abstentions. The operand-only control's
three correct cases were required abstentions. The calculator's five-case smoke
had scored 4/5; the full roster exposes a much larger coverage gap. These are
diagnostics on the already known FinQA roster. Fresh-input claims require a
separate frozen comparison.

All 40 output object versions were collected. Every size and SHA-256 matched.
The frozen comparison source archive reproduced both saved grades exactly.
[COLLECTION.json](COLLECTION.json) binds each object version and digest. The
[public research archive](https://github.com/cenetex/ilXyr/releases/tag/research-step-22)
contains the approved source package, raw control rows, logs, and regrading record.

## Startup failure and repair

The runtime check found one NVIDIA L40S with CUDA available. It verified every
model file. The fresh base worker then called `torch.cuda.reset_peak_memory_stats(0)`
before initializing its own CUDA allocator and raised `Invalid device argument`.
The runtime check had run in a separate process. [RUNTIME.json](RUNTIME.json) and
[BASE-FAILURE.json](BASE-FAILURE.json) preserve that distinction. The earlier
NVIDIA GRID daemon warning remains in the host log; the successful CUDA runtime
check supports the allocator diagnosis.

The repair initializes CUDA in each base worker before resetting counters. An
initialization failure keeps memory usage unknown. Eighteen execution test groups
pass, including a cold allocator and a failed initialization. This is a local
regression check. The next GPU comparison needs a newly frozen package and a
fresh execution decision.

## Launch, collection, and cost

The run was `feral-finqa-20260908T061358Z`, instance `i-0c979a0b88567f77d`,
launched September 8 at 06:14:02 UTC with a 07:13:58 UTC deadline and $3 cap
before tax. AWS first returned `InsufficientInstanceCapacity` in `us-east-1a`.
The exact client-token lookup returned zero instances. The next request used an
existing subnet in `us-east-1b` with the same VPC, security group, main route
table, network ACL, machine, image, package, and budget.
[CAPACITY-FAILURE.json](CAPACITY-FAILURE.json) retains both network digests.

The host ran for about 602 seconds and shut down through its exit handler.
AWS confirms termination and root-volume deletion. The conservative estimate
uses 981 seconds through the first saved terminal observation plus the full
$0.75 reserve: **at most $1.361 before tax under the frozen price estimate**.
The actual invoice amount remains unknown. [TERMINATION.json](TERMINATION.json)
preserves provider evidence and the calculation. The
[earlier operator failure](../research-step-21/REPORT.md) retains its own outcome.

## Next shared step

FERAL needs a CUDA startup check inside the same process that loads the model,
followed by the repaired full comparison. Its controls also need an explicit
coverage analysis before wider calculator claims.

Reasoner is preparing the fixed six-arm, 128-family, 12-pass cloud comparison.
Its primary question is whether learned task guidance improves both CPU cost
and verifier work over matched lexical guidance. Across both projects, the
program asks whether learned state earns its cost on unfamiliar inputs, with
simple controls, complete costs, raw failures, and fixed decision rules.
