# Research step 34: run and verify the fixed weight corpus

The weight-multiplicity line now has a frozen controller package for the full
458,750-row corpus. It selects the fixed resource policy, keeps one original
launch deadline, and checks durable result files before accepting a corpus.
Its 19 Linux tests pass, including an actual runner Hold with tiny test oracles
and cleanup of a detached child process.

The next step is the cloud launch package: exact machine and boot image,
storage, early shutdown watchdog, current price, and a fixed cost ceiling.
New full corpus runs and new paid instances both remain at zero for this step.

## What the controller does

The package contains the verified source kit from step 33 and the new runtime
controller, result checker and process cleanup code. A readback checks every
file before extraction. Two package builds produced identical bytes.

| Prepared item | Verified value |
| --- | --- |
| Controller package | 16,537,600 bytes, 8 files |
| Package SHA-256 | `13ac113cff5db7a22b66fdd9f1176746fb7d9a79e0a1ef0b1c8af6adde218712` |
| Controller source commit | `96dd64c8e0487df7e49b054082d680f9bd2c5573` |
| Scientific source kit | Step 33, SHA-256 `30e2926603988c29c5ff0d24138fd59d16c05eb21f01cc5bcfce00009d6433dd` |
| Resource-policy files | All 14 original bindings preserved |
| Unpacked preparation | Passed; zero oracle processes started |
| Saved calibration trace | All 26,624 queries verified again |

Preparation checks the policy and saved trace, then records the exact full
corpus command. Execution uses the original oracle sources, eight LiE workers,
two Zero workers, and the frozen generator, target order and resource limits.
The command selects `--resource-policy` explicitly.

The controller builds both oracles with the tested Linux build procedure and
checks their executable hashes before the workload. It reads the saved
terminal JSON files after the producer exits. Stdout stays available as a log.

Every runtime step shares the original launch deadline. The outer launch
window is capped at 5,400 seconds. Build work has a 260-second guard, with
300 seconds reserved for result checks and another 300 for collection.
The workload keeps its existing 2,119-second resource rule. File inventory
also observes the original deadline. The early instance shutdown watchdog
will be supplied by the next cloud launch package.

## What result acceptance checks

The checker distinguishes a verified corpus, a verified Hold, and incomplete
or invalid output. It checks:

- ordered attempts, unique dispatch numbers, setup and workload counts,
  status counts, label ranges, total query cost, exact final p99 and the 50
  slowest queries;
- the full checksum roster, frozen source and policy hashes, final resource
  state, complete worker memory records and memory limits;
- every corpus partition's compressed and plain hashes, byte and row counts,
  distributions, unique query keys, and labels against the workload trace;
- differential oracle records, arithmetic agreement and completion floor;
- transformed target pairs and their recorded reflection words;
- the original full-run arguments and the collected native executable bytes;
- producer exit, deadline and cleanup records.

A verified Hold keeps its failed attempts and partial file names. The checker
rejects a Hold that leaves a sealed corpus manifest. It also rejects a success
claim backed by provisional tail statistics, an interrupted process, missing
memory evidence, changed labels or changed executable files.

These checks establish the prepared run's source, output and resource
integrity. The full cloud run will supply the corpus and its measured costs.

## Tests and failures retained

The fixed Linux image passed all 19 tests. Local tests passed 18 cases; Linux
CI covers the platform-specific child cleanup case. The full research suite
also passed.

The actual runner fixture starts eight warmups and then receives invalid
answers from eight tiny test-oracle processes. It retains all 16 attempts and
returns a verified Hold. Real symbolic oracle queries and new corpus rows in
this fixture are both zero. Its timing values are engineering diagnostics.

A separate test makes a leader exit with code zero while its detached child
continues. The controller runs as an ordinary Linux process, adopts the child,
stops it and reaps it. The process result becomes failed, with zero remaining
children. Linux provides this adoption through its
[child-subreaper facility](https://man7.org/linux/man-pages/man2/PR_SET_CHILD_SUBREAPER.2const.html).

Two earlier Linux checks failed before workload queries. The temporary mount
blocked executable files, so the test oracle produced `spawn EACCES` during
warmup. The first assertion ran before its diagnostic files were saved. The
next attempt saved the Hold, process log and mount flags before assertions,
which exposed the cause. The corrected test mount permits those executable
fixtures. The same frozen scientific inputs then passed the Linux tests.

`FAILURES.json` and `LINUX-FIXTURE-FAILURE.json` preserve those failures.
`LINUX-VALIDATION.json` records the final test results and artifact hashes.
The complete logs and source package are retained with local experiment
custody and in the linked CI artifacts.

## How this advances the shared program

The program needs each failure to identify its cause. A resource Hold, an
invalid oracle answer and an execution-environment failure lead to different
next actions. This controller keeps those distinctions explicit. It follows
the same evidence rule used for Reasoner and Solomon: freeze the inputs and
account for the complete work before judging the learned component.

The next bounded task is recorded in `NEXT-DESIGN.json`: complete and preflight
the cloud launch package, publish its exact expected cost and ceiling, then
seek approval for that concrete run.

## Evidence

- [Controller plan](CONTROLLER-PLAN.json), [package identity](PACKAGE.json),
  [file bindings](PACKAGE-FILES.json) and [preparation result](PREPARE.json)
- [Linux validation](LINUX-VALIDATION.json),
  [Linux fixture failure](LINUX-FIXTURE-FAILURE.json) and [failure record](FAILURES.json)
- [Result](RESULT.json) and [next launch design](NEXT-DESIGN.json)
- [Final Linux checks](https://github.com/cenetex/ilXyr/actions/runs/34276719487)
- [Pull request 191](https://github.com/cenetex/ilXyr/pull/191)
