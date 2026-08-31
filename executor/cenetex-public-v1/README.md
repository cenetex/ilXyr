# Cenetex public executor v1

Status: **reference candidate — not yet compatible or verified**

This directory defines the first well-known ilXyr execution environment. It is public-weight only
and must be reproducible from open source. It does not contain an accepted environment manifest
yet because the runner, kernel, root filesystem, SBOM, provenance, and conformance artifacts have
not been built and assigned final SHA-256 digests.

## Acceptance boundary

The first accepted release must publish one `ilxyr.executor_environment.v1` manifest that pins:

- this repository and one exact commit;
- a content-addressed source archive and build recipe;
- the executor runner, Linux kernel, and read-only root filesystem;
- an SPDX or CycloneDX SBOM and signed build provenance; and
- the exact conformance suite used for acceptance.

The manifest is verified with:

```text
ilxyr executor-environment-verify environment.json
```

A job package for that environment is verified with:

```text
ilxyr executor-package-verify environment.json job-package.json
```

Materialized files are checked without launching anything with:

```text
ilxyr executor-preflight-verify environment.json job-package.json materialization.json /absolute/artifact/root
```

The receipt always says `launch_authorized: false`. It proves only that the supplied files match
the frozen environment and package. Paths must stay below the artifact root and may not cross a
symlink. The materialization format has no field for guest credentials.

The exact conformance suite and a signed report from a separately trusted runner are checked with:

```text
ilxyr executor-conformance-suite-verify environment.json suite.json
ilxyr executor-conformance-report-verify environment.json suite.json trusted-keys.json report.json
```

A result is verified before ledger ingestion with:

```text
ilxyr execution-report-verify environment.json job-package.json trusted-keys.json execution-report.json
```

These commands do not launch compute or write to an ilXyr workspace.

## Runtime profile

- Firecracker microVM boundary on a dedicated, supported Linux host.
- One microVM and one job per launch.
- Read-only root filesystem plus a fresh bounded scratch disk.
- No host filesystem mounts.
- No interactive login path while a job is active.
- No cloud instance-metadata service inside the guest.
- Network denied for the first profile.
- Public weights only and metrics-only export.
- The guest receives no cloud credential, report-intake credential, or signing key.
- The host supervisor re-hashes the package, executable, oracle, harness, and inputs before launch
  and checks the executable and oracle again after collection.
- The host supervisor applies the frozen runtime and cost watchdog and destroys the microVM after
  collection.
- A separate reporter, outside the guest, creates and signs the DSSE/SLSA execution report.

## Reproducible build plan

`build-contract.json` freezes the acceptance rules. The build will be expressed as a locked Nix
flake on Linux and produce the supervisor, kernel, and rootfs as fixed outputs. CI will publish the
source archive, lock file, SBOM, and SLSA provenance beside the artifacts. At least one independent
builder must build the same source commit and compare output digests before the registry may say
`reproduced_build`.

`conformance-suite.draft.json` makes every required test explicit. Offline verification is now
implemented, but the Linux microVM tests have not run. The draft is not the accepted suite until a
release manifest binds its canonical digest and byte size.

The build recipe alone is not proof of reproducibility. Until matching independent outputs exist,
the public site says `reference_candidate` and `not_yet_verified`.

## Required conformance checks

The frozen suite must test at least:

- every package and environment digest is checked before execution;
- changed executable, oracle, target order, image, or package bytes fail closed;
- the guest cannot reach host mounts, instance metadata, report credentials, or signing keys;
- denied networking is actually denied;
- wall-clock and output limits stop the job;
- exact report retry is idempotent and launch reuse with different bytes is rejected;
- the signed provenance binds the run, package, environment, authorization, launch, and executor;
  and
- collection cannot launch, restart, or extend compute.

Conformance is necessary for compatibility. The report must carry a trusted DSSE signature from a
runner other than the environment operator. It is not a scientific result and does not make the
operator its own verifier. A valid signature on a failed report preserves the failure; only a
verified receipt with `passed: true` can satisfy the compatibility gate.
