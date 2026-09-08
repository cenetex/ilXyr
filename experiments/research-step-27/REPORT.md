# Research step 27: approved FERAL run launched

The user approved the published step 25 package for one hour and $3 before
tax, with the proposed five-minute follow-up through cleanup and publication.
AWS launched one `g6e.2xlarge` instance in `us-east-1d` at 08:09:20 UTC on
September 8, 2026. The fixed deadline is **09:09:16 UTC**, or **02:09:16 in
Vancouver**. The full comparison is running.

[AUTHORIZATION.json](AUTHORIZATION.json) preserves the approval.
[LAUNCH.json](LAUNCH.json) binds instance `i-05210fe6cd2d5817c`, root volume
`vol-0160c364f54a638d2`, package version, request, and actual startup script.
The provider returned the exact rendered script bytes. The host console
confirms its shutdown timer, exact package version, and fixed runtime image
pull. [STARTUP.json](STARTUP.json) records those observations. The model's
GPU generation check will be verified from the collected worker output.

## Three capacity failures before launch

The first three zones returned `InsufficientInstanceCapacity`: `us-east-1b`,
`us-east-1a`, and `us-east-1c`. After each error, a provider query found zero
instances for its client token. Each next zone passed fresh provider checks
and the free launch dry run. The fourth zone supplied the approved instance.
[CAPACITY-FAILURES.json](CAPACITY-FAILURES.json) preserves every error and
its zero-instance confirmation. The package, machine type, image, full
comparison, and budget stayed fixed throughout.

## Comparison and follow-up

The run first checks CUDA placement, model loading, and synthetic generation
in the same model process used for the 1,147 scored inputs. It retains both
original calculator controls. Calculator v2 remains a separate development
result in [step 25](../research-step-25/REPORT.md).

The active follow-up checks this exact run every five minutes. It preserves
the original deadline, verifies instance and volume cleanup, collects exact
output versions, grades the complete and partial evidence, and publishes the
results. It records startup failures, raw responses, parser failures,
coverage, accuracy, and costs. [FOLLOW-UP.json](FOLLOW-UP.json) records its
scope. The next model decision follows the observed error pattern.

Reasoner's [completed no-go](../research-step-26/REPORT.md) is now published.
The public archive bytes, main CI, Pages deployment, and live program document
all verify. [REASONER-PUBLICATION.json](REASONER-PUBLICATION.json) retains
that evidence. Its follow-up is paused after collection and cleanup.
