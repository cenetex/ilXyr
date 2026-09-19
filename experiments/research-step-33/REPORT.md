# Research step 33: freeze the weight corpus source kit

The weight-multiplicity line now has a verified source kit for its next full
corpus run. It binds the original oracle sources, the recovered calibration
trace, all 14 resource-policy files, and a fixed Linux build tool. Two
independent LiE builds match. LiE and Zero agree on three known answers.

The next step is the full cloud controller and result checker, followed by
machine, storage, watchdog and price preflight. Corpus generation remains
pending, with 458,750 planned rows and zero new rows in this step.

## The concrete change

The historical corpus packager copies the oracle runner and three libraries.
The later fixed resource policy needs a fourth library and its complete source
bindings. The new source kit closes that input gap. The historical execution
files remain the record of their earlier runs.

`weight_source_kit.py` reads committed repository files and verifies each
external input against `SOURCE-PLAN.json`. It selects six native Zero build
files and two license files from the verified original archive. The complete
LiE archive keeps its original sources and file modes. The kit also includes
the saved trace, tail report, trace checker and fixed Bison package.

The archive is deterministic. Its verifier checks the outer hash, file roster,
file sizes, source hashes and policy bindings before extraction. It rejects
links, duplicate paths, path traversal and file/directory collisions. A second
build of the final kit produced identical bytes.

| Prepared item | Verified value |
| --- | --- |
| Source kit | 16,465,920 bytes, 34 files |
| Kit SHA-256 | `30e2926603988c29c5ff0d24138fd59d16c05eb21f01cc5bcfce00009d6433dd` |
| Source commit | `3e6a931b1fb8af385f753011e3b94bc29e839b44` |
| Resource-policy files | 14, each matched to its frozen hash |
| Saved trace | 26,624 verified queries |
| Saved trace p99 | 39.60266599999886 ms |
| Fixed full-workload p99 limit | 50 ms |
| New full corpus rows | 0 |

The policy still fixes a 30,000 ms hard query timeout, 2,430,387 calls,
8,474,852 ms of total query time, and 2,119 seconds of workload wall time.
It keeps eight LiE workers, two Zero workers, the original generator and target
order, and the existing memory limits. The saved per-query trace establishes
its recorded query facts. Full-workload wall time will be measured in the new
cloud run.

## Native build and correctness evidence

The CI job uses the fixed Node image recorded in `SOURCE-PLAN.json`, with
Node 22.22.0, GCC 12.2.0, Python 3.11.2 and Bison 3.8.2. It fetches each exact
public input and verifies its hash before entering the container. Network
access is disabled inside the build container.

LiE is built twice in separate directories with the original compile flags and
`SOURCE_DATE_EPOCH=1112054400`. Both executables have SHA-256
`bf34052d0fd655ba975bd03c892454b0ef1298994bc72aceaf6706b6cc65d83c`.
Zero builds from its original six files and passes its native self-test. Its
executable SHA-256 is
`8e273da671bb0a883bc5668e3e76e409a98b59c54b2cc94977bc052b3b7ee9bf`.

| Type | Highest weight | Target | LiE | Zero |
| --- | --- | --- | --- | --- |
| A1 | [1] | [1] | 1 | 1 |
| A1 | [2] | [0] | 1 | 1 |
| A2 | [1, 1] | [0, 0] | 2 | 2 |

These are small correctness fixtures. The next full run will provide cost,
resource and corpus evidence on its frozen cloud machine. The nine local
archive tests, the full research suite and the Linux check passed.

## Failures and lessons retained

`FAILURES.json` separates observed preparation failures from source-review
findings:

- The historical packager omits the later resource-policy inputs. The source
  kit includes the complete policy closure. The next execution command must
  select that policy explicitly.
- The first download guard allowed 64 MiB; the original calibration package is
  99,548,216 bytes. A verified 128 MiB bound allowed recovery. The original
  package and both nested oracle archives matched their recorded hashes.
- The local Docker client could not reach its configured daemon. The fixed
  Linux build ran in GitHub CI.
- Source review found that the first extraction draft dropped LiE's build
  script execute bit. The correction preserves file modes and has a regression
  test. Native execution then passed.

The earlier Phase 0 Stop, pilot resource failure and post-measurement wrapper
failure remain part of the program record. They motivate the fixed resource
policy and the next result checker's handling of partial output.

## How this advances the shared program

The common research question is whether a small learned component improves a
larger system under a fixed cost and evidence contract. Weight multiplicity
first needs a verified target corpus. This step makes the exact oracle,
resource policy and calibration evidence travel together. Reasoner and
Solomon use the same principle when they bind controls, confidence rules and
complete evaluation costs before opening fresh data.

`NEXT-DESIGN.json` sets the next bounded implementation task: build the full
controller and result checker around this source kit, retain every attempted
query, and accept a corpus manifest only after the final resource checks. The
priced launch package follows cloud preflight.

## Evidence

- [Source plan](SOURCE-PLAN.json), [kit identity](KIT.json), and
  [complete file bindings](KIT-FILES.json)
- [Unpacked policy check](POLICY-CHECK.json) and
  [saved-trace verification](TRACE-CHECK.json)
- [Linux build and correctness result](LINUX-SMOKE.json)
- [Result](RESULT.json), [failure record](FAILURES.json), and
  [next controller design](NEXT-DESIGN.json)
- [Pull request 190](https://github.com/cenetex/ilXyr/pull/190)
