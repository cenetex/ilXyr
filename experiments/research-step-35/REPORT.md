# Research step 35: fixed weight corpus cloud launch

The weight study now has a fixed cloud launch package. Its live AWS preflight
passed, including exact package readback and the free EC2 launch check.
The proposed run uses one 16-vCPU machine for at most 90 minutes, with a
$2 ceiling before tax. The full corpus run awaits approval for this package.

The package keeps the step 34 controller and step 33 scientific source kit.
All 14 resource-policy files remain fixed. New paid instances, full corpus
runs and corpus rows in this preparation step are each zero.

## Fixed package and machine

| Item | Value |
| --- | --- |
| Package SHA-256 | `baca1320cc10071513a47bfd3d853ecf67a48f0aaf3c16429f2398cb7feaa29e` |
| Package size | 16,568,320 bytes |
| Host source commit | `f5d29f66151c5f5b27cfc2c3067f7e0260c30bad` |
| Controller package | Step 34, `13ac113cff5db7a22b66fdd9f1176746fb7d9a79e0a1ef0b1c8af6adde218712` |
| CPU | AWS c6i.4xlarge, 16 vCPUs, 32 GiB memory, x86-64 |
| Boot image | `ami-0d3378afe7683c867`, fixed root snapshot |
| Disk | 80 GiB encrypted gp3, deleted with the instance |
| Worker | Fixed Node OCI image; 24 GiB memory, 16 CPU slots, 1 GiB temporary space |
| Original launch deadline | 5,400 seconds |
| Shutdown timer | Original launch time plus 5,370 seconds |
| Result archive ceiling | 4 GiB, with a bounded file inventory |

Two builds of the host package produced identical bytes. Preparation from
its unpacked controller passed and started zero oracle processes. AWS stored
the package as an encrypted object with a fixed version and checksum. Reading
that exact version back produced identical bytes.

The host arms shutdown before setup. It checks its machine identity, package
files and the actual startup script. The worker builds and checks the native
oracles, then executes the full fixed resource-policy command. Its output
folder holds process receipts, executable files, partial rows and result checks.

The workload retains the earlier 2,119-second resource rule, eight LiE workers,
two Zero workers and final 50 ms p99 gate. The 90-minute instance window also
covers setup, builds, independent verification and result collection. Historical
calibration remains a separate measurement series with its own machine record.

## Full cost ceiling

The live preflight checked all seven AWS price entries against the frozen
ceilings. The calculation charges for a full 90-minute run and one result
download. It uses a conservative 4.5 GB allowance for stored and downloaded
bytes, and 32 days for storage expiry rounding.

| Cost component | Ceiling before tax |
| --- | ---: |
| CPU instance | $1.020000 |
| Encrypted disk | $0.013334 |
| Public address | $0.007500 |
| Result and package storage | $0.110400 |
| One download | $0.405000 |
| Storage requests | $0.010000 |
| Calculated total | $1.566234 |
| Margin | $0.433766 |
| Requested maximum | **$2.000000** |

The calculation uses paid rates for each component. Actual billed cost will
be recorded when it becomes available. This preparation records the budget
and current price evidence.

The shared bucket initially had no expiry rule. After checking that this
study's two new folders were empty, four scoped rules were added. Current
objects expire after 30 days, old versions after one day, and expired delete
markers are removed. The live preflight confirmed those exact rules. Collected
research evidence stays in local custody and compact results enter the public
report before cloud expiry. AWS describes the
[day rounding](https://docs.aws.amazon.com/AmazonS3/latest/userguide/intro-lifecycle-rules.html)
and [billing at expiry eligibility](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html).

## Collection and failures

The host reserves five minutes for collection. It stops the worker before
archiving its files. Each upload uses an exact checksum and creates one new
object. The final host record links exact object versions. Setup logs have a
separate upload path so early failures retain their cause.

An archive that reaches its size or file limit keeps the available prefix and
records incomplete collection. After termination, the collector checks the
instance tags, disk deletion and network-interface cleanup. It verifies the
object versions and checksums before unpacking. Scientific acceptance then
uses the step 34 independent checker against the collected executable bytes,
command, process record, corpus files and trace.

Ten local tests and ten tests in the fixed Linux image passed. They cover
metadata, package and image failures; interrupted work; failed uploads;
expired deadlines; changed package and result bytes; archive limits; and
approval checks. A changed result archive failed its checksum check before
its download. The native oracle build check also passed.

The first local test attempt failed at a shell output pipe with
`Operation not permitted`. The same mocked lifecycle passed outside that
restricted shell, followed by the fixed Linux checks.

Automatic approval review initially rejected staging because it could not
confirm permission to export private research material. The follow-up checks
verified public source provenance, numerical calibration fields, ownership of
the destination by the signed-in AWS account, and the bucket's privacy settings.
The upload with an explicit owner check then passed review and readback.
These operational events and the injected test failures remain separate in
[FAILURES.json](FAILURES.json).

## Next decision and shared program

The next action is approval for this exact package and the $2 ceiling. Fresh
preflight precedes one launch. Observation keeps the original deadline.
Collection proves termination and cleanup before the independent result check
and public report.

The shared research question remains when a learned component reduces the
work needed for a correct answer on unfamiliar inputs. This step prepares the
exact-oracle data that the weight transfer comparison needs. Its failure
records separate a resource Hold, incomplete evidence and a startup error,
so each outcome leads to a concrete next action.

Reasoner next tests reduced scoring cost against the same controls. Solomon
next completes its fresh-document cloud controller. ZERO.4 next freezes fresh
retention and language checks. FERAL's earlier capacity window remains closed;
its approved package and recorded failures remain available for a new bounded
capacity decision.

## Evidence

- [Execution plan](EXECUTION-PLAN.json), [package](PACKAGE.json), and [file bindings](PACKAGE-FILES.json)
- [Unpacked preparation](PREPARE.json), [live preflight](PREFLIGHT.json), and [price evidence](PRICE-EVIDENCE.json)
- [Linux validation](LINUX-VALIDATION.json), [failures](FAILURES.json), and [result](RESULT.json)
- [Fixed Linux tests](https://github.com/cenetex/ilXyr/actions/runs/34280342165)
- [Pull request 192](https://github.com/cenetex/ilXyr/pull/192)
