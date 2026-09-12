# Reasoner: the fixed four-method cloud package

Reasoner's next comparison uses the source kit and study plan sealed in
[step 40](../research-step-40/REPORT.md). This step prepares its cloud host,
complete inputs, runtime tools, shutdown path and result collection. It keeps
all preparation failures in [FAILURES.json](FAILURES.json).

## The comparison

The four methods are semantic frequency, the full task guide, raw lexical
guidance and the guide with its prior feature removed. Each method sees the
same 128 families and four views per family. Twelve passes rotate method
order. Each of the 48 separate workers completes one warm-up pass and one
measured pass. That is 49,152 episode visits and 2,048 distinct measured results.
The controller and the separate checker each replay those measured results.

The full guide must beat both lexical guidance and semantic frequency. Its
whole-worker CPU point ratio must be at most 0.95, with a one-sided 98.75%
upper bound below 1. Its verifier-work upper bound must also be below 1.
Every answer, work count and repeated stable row must verify. The original
20,000 bootstrap draws, seed, fixed cases and decision rules remain sealed.

This is the next test of the mechanism that reduced prior-score calls in
[step 36](../research-step-36/REPORT.md). The opened cases still required more
verifier work than the two simple references. The earlier full comparison in
[step 26](../research-step-26/REPORT.md) also missed its benefit gates. These
failures set the question for this run: can the revised guide earn its full
processing cost against both references on the fixed fresh families?

## Host and cost

The [execution plan](EXECUTION-PLAN.json) fixes one `c6i.large` in `us-east-1`,
with two CPUs, 4 GiB host memory and an encrypted 80 GiB root volume. The
worker container uses one fixed CPU, 3 GiB memory, 256 process slots and a
512 MiB temporary filesystem. It runs offline from a read-only package.
The compiler flags and one-worker study shape remain those of step 40.

The host arms its shutdown timer first. Setup has ten minutes. The study
controller has fifty minutes and the separate checker has ten minutes.
Collection and shutdown fit inside the **90-minute instance limit**. The
host keeps failed stages and partial results. The receiver checks provider
termination, root-volume deletion and interface cleanup before collection.

The **$0.30 ceiling before tax** covers the full time allowance, storage and
one download. Free preflight must verify current prices at or below the fixed
rates. Each fractional cost is rounded up to six decimal places.

| Cost item | Ceiling in USD |
| --- | ---: |
| Instance compute | 0.127500 |
| Root volume | 0.013334 |
| Public IPv4 | 0.007500 |
| Retained objects | 0.024534 |
| One bounded download | 0.090000 |
| Requests | 0.010000 |
| Calculated total | 0.272868 |
| Remaining margin | 0.027132 |

Collection permits a 576 MiB archive in one immutable object. The host
checks disk space for study output, the archive, its upload copy and a GiB
reserve. The collector saves the expected object size and hash before upload.
Its receipt binds the object version, archive hash and complete file coverage.

## Failures and checks

The first fixed-image check passed the tool identities, then GCC stopped at
`-Werror=maybe-uninitialized` in `r55sg_loss_gradient`. All worker counts were
zero. That failure remains bound to its compiler output and CI run. The
source kit and scientific plan stay fixed while the host changes to Clang,
which already passed the study checks on Mac and Linux.

The next image failed at startup because the requested Python executable was
missing. Its Docker error is retained. The final runtime uses a C++ development
image and the official Node 22.22.0 release. Each image, Node archive and Node
binary has a fixed hash. Node extraction checks the exact regular-file member
and its size before writing executable bytes.

The host tests cover shutdown order, memory and CPU limits, storage failure,
changed package bytes, safe launch arguments, exact preflight run binding,
partial output and collection. Controlled upload failures preserve earlier
receipts and the expected bytes of the uncertain upload. The receiver rejects
changed stored bytes before extraction. The runtime retains whole-container
CPU, memory peak and memory-exhaustion events; the study and checker keep
separate process costs.

## Shared research method and next move

Reasoner, Solomon and ZERO.4 now use the same core test: fix the task and
simple reference first, charge the complete process, and preserve failed
attempts beside completed scores. Their scientific measures stay specific
to their questions: verified work, confidence error and retained capability.
A correct answer and a useful cost improvement remain separate findings.

After publication, this package proceeds to staging and free provider checks
when AWS sign-in is ready. The launch step binds the exact package and the
$0.30 ceiling. Solomon's step 38, weight multiplicity's step 35 and ZERO.4's
step 45 keep their own packages and run approvals. FERAL's next local move is
a fresh calculator-coverage roster; its closed GPU-capacity window stays in
the failure record.
