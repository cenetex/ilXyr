# Research step 57: close the ZERO.4 adapter failure

The approved ZERO.4 replacement passed its storage check, then stopped at the
study controller before any native process. The cloud adapter omitted the
`cloud_adapter=True` flag required for full prepared inputs. The host saved its
complete failure archive and shut itself down. Provider reads verified removal
of its disk and network interface.

The repair passes that flag from the cloud adapter. A new regression test
reproduces the original failure through the command entry point. With the repair,
the same test reaches a controlled native build boundary. A direct study call
still requires the cloud adapter. All 19 controlled host tests pass.

The shared question remains: **does new learning produce more useful answers
while retaining earlier skills within a fixed cost?** This attempt supplies
execution evidence. Its scientific process count is zero, so the five-method,
three-seed comparison remains the next model experiment.

## What the approved run established

| Item | Verified record |
| --- | --- |
| Run | `zero4-52-20260913T013725Z` |
| Instance | `i-0b1ac37bc23724f38`, one AWS `c6i.4xlarge` |
| Launch | September 13, 2026, 01:39:36 UTC |
| Approved ceiling | $12 before tax and 48,600 seconds |
| Disk | 160 GiB; 113,088,483,328 bytes free against a 39,795,556,352-byte reserve |
| Stop | Cloud adapter guard, with zero native processes |
| Failure saved | 94.92 seconds after the bound launch time |
| Archive | 30,720 bytes, complete and verified after download |
| Cleanup | Instance terminated; zero remaining volumes and interfaces |
| Actual billing | Awaiting provider billing evidence |

[LAUNCH.json](LAUNCH.json), [PREFLIGHT.json](PREFLIGHT.json), and
[STAGING.json](STAGING.json) bind the approved package and its immutable object
version. [HOST-TERMINAL.json](HOST-TERMINAL.json), [COLLECTION.json](COLLECTION.json),
and [CLEANUP.json](CLEANUP.json) preserve failure transport and provider cleanup.
[DISK.json](DISK.json), [RUNTIME.json](RUNTIME.json), and
[STUDY-RESULT.json](STUDY-RESULT.json) identify the reached stages and stop cause.

The earlier runtime check exercised opened mode. The host checks used a Docker
fixture. Both passed while leaving the real full-mode handoff untested. The new
test covers that handoff with zero model calls. [VALIDATION.json](VALIDATION.json)
preserves the failed regression before the repair, the passing host suite, and
the fixed Linux runtime check. The full local schema suite passes in
121.57 seconds.

## Replacement package

The repaired archive has SHA-256
`8ba320df1dc2a7015ac01eafb904585e499fa01f2b99672cdaace226eec123a8`
and contains 54,886,400 bytes. It binds source commit
`21a66780fee398a02257e7439f48ef8b05735f15`. The changed members are the cloud
adapter and the package manifest. The scientific controller archive, prepared
inputs, host plan, 160 GiB disk, outcome rules, $12 ceiling, and 13.5-hour limit
retain their exact previous bytes or values.

[PACKAGE.json](PACKAGE.json) records this comparison. Staging and another paid
run follow approval of this replacement package and its destination. The
completed attempt retains its own approval and failure history.

## Failure history and next work

The shared ledger now has 76 entries. All 75 earlier entries remain identical.
The new entry binds [FINDINGS.json](FINDINGS.json), including the successful disk
check and failed adapter handoff. [FAILURES.json](FAILURES.json) also preserves
the upload approval block, scheduling argument error, startup inspection after
shutdown, and local shell restriction encountered during verification.

| Project | Next tangible move |
| --- | --- |
| ZERO.4 | Obtain approval for the verified replacement package and run the fixed comparison. |
| FERAL | Add source-context links for fact selection and test separately written wording. |
| Reasoner | Prepare a different source of guidance after the fresh-family benefit failures. |
| Solomon | Audit document shift in the saved panel against smoothed suffix counts. |
| Weight multiplicity | Complete the fixed host wrapper and free preflight for the native pilot. |

The common practice is to count useful outcomes after all task checks, together
with the work spent on failed and incomplete attempts. This failure adds a
specific entry-point check before the next ZERO.4 launch.
