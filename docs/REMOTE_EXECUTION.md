# Remote execution protocol

ilXyr runs a sealed job package on a named executor. The package fixes the code, data, machine,
budget, output, and report rules before launch.

## Roles

- The ilXyr ledger records the experiment, forecasts, funding, budget, and launch approval.
- The AWS adapter can stage, check, launch, observe, and collect one sealed package.
- The execution node checks each input digest. It then runs the frozen harness.
- The host reporter creates a signed execution report.
- The report intake verifies that report against the ledger.
- `ilxyr.cenetex.com` shows the public protocol and published results.

## Control flow

1. Compile a `remote-v1` experiment.
2. Admit the experiment through the normal gates.
3. Build an `ilxyr.executor_job_package.v1` file.
4. Verify the package against the workspace.
5. Stage the canonical package JSON in its digest-named S3 object.
6. Run AWS preflight. This checks the account, machine, network, IAM role, S3 objects, price
   binding, cost ceiling, and EC2 permissions.
7. Record one short-lived launch approval.
8. Launch one EC2 instance. ilXyr records a reservation before the AWS call. Retries use the same
   AWS client token and reserved launcher config.
9. Observe the instance through its S3 status record. EC2 state provides the early status.
10. Collect the signed execution report after the status reaches `succeeded`.
11. Accept the report into the ledger. The verifier checks every frozen binding.

## Commands

```text
ilxyr remote-package-verify <workspace> <environment.json> <job-package.json>
ilxyr remote-authorize <workspace> <environment.json> <job-package.json> <budget-id> <authorization-id> <expires-at-ms>
ilxyr remote-aws-stage <environment.json> <job-package.json> <aws-config.json>
ilxyr remote-aws-preflight <environment.json> <job-package.json> <aws-config.json>
ilxyr remote-aws-launch <workspace> <aws-config.json> <authorization-id>
ilxyr remote-aws-observe <workspace> <aws-config.json> <authorization-id>
ilxyr remote-aws-collect <workspace> <aws-config.json> <authorization-id>
ilxyr remote-report-accept <workspace> <execution-report.json>
```

`remote-aws-stage` writes canonical package JSON to S3. The object key ends with the package
SHA-256 digest.

`remote-aws-preflight` uses AWS `DryRun`. It creates a check receipt after every binding passes.

`remote-aws-launch` creates one paid EC2 instance. It requires a current ledger approval. The
instance gets a private network interface, encrypted storage, IMDSv2, a fixed IAM profile, and an
EC2 termination-on-shutdown setting. The frozen bootstrap script arms the watchdog.

`remote-aws-observe` reads state. `remote-aws-collect` reads the final report. These commands use
the launch receipt that ilXyr stored in the workspace.

The launcher config uses `ilxyr.aws_launcher.v1`. The shape example is
`examples/schema/aws-launcher-config.json`. Replace its sample values with the settings for the
approved run. The config names the AWS account and the frozen price file.

The price file uses `ilxyr.aws_price_evidence.v1`. It records the hourly rate, minimum billing
period, and a fixed allowance for storage and data transfer. Its digest and size must match the
package. The cost check includes the watchdog grace period.

The bootstrap script must match the package harness digest and size. The launcher passes those
verified bytes directly to AWS. The worker writes `ilxyr.aws_execution_status.v1` under this key:

```text
<result_prefix>/<instance_id>/status.json
```

It writes the signed report beside that record:

```text
<result_prefix>/<instance_id>/execution-report.json
```

Collection applies the package report-size limit. The AWS client also has a 16 MiB response cap.

## Worker contract

The bootstrap runs on the EC2 host. It follows this order:

1. Arm the watchdog before setup work. Use the deadline from `LaunchReservedAtMs`,
   `MaxRuntimeSeconds`, and `WatchdogGraceSeconds`.
2. Read the instance tags through IMDSv2.
3. Download the package from `PackageBucket` and `PackageKey`.
4. Check its bytes against `PackageSha256`.
5. Wait for `<ResultPrefix>/<instance_id>/launch-receipt.json` in `ResultBucket`.
6. Check the receipt against `AuthorizationRef`, `ReservationRef`, `JobPackageRef`, and
   `EnvironmentRef`. Its canonical JSON digest supplies the report's `launch_ref`.
7. Run the sealed job in the declared execution environment.
8. Publish the signed report under the instance result path.
9. Write a terminal status record.
10. Shut down the instance.

The launcher publishes the receipt after the ledger records the launch. A failed receipt upload
can use the same launch command again. The recorded instance stays the same.

The host tags also include `ExpectedExecutor`, `ReportEndpoint`, `MaxRuntimeSeconds`, and
`WatchdogGraceSeconds`. The worker keeps signing and cloud credentials on the host side of the
declared guest boundary. Its environment build and conformance report establish that boundary.

## Authenticated report intake

`ilxyr-intake` is the HTTP service for the same ledger verifier. It has two commands:

```text
ilxyr-intake issue <workspace> <authorization-id> [ttl-seconds] [max-rejected-attempts]
ilxyr-intake serve <workspace> [--bind <ip:port>] [--max-body-bytes <bytes>] [--requests-per-minute <count>] [--allow-public-bind]
```

`issue` creates one short-lived report credential. The credential is bound to one authorization,
one launch, one report size, and one expiry time.

The service accepts `GET /healthz` and `POST /v1/reports`. The report route checks the bearer
credential, content type, body size, peer rate, and rejection count. It records an accepted report
through the single ledger writer.

Production setup places this service behind TLS. The service account receives access to the ilXyr
workspace. It has a focused role for report intake. Its Rust dependency is the narrow
`ilxyr-intake-boundary` API. The CI dependency allowlist limits the package to this API and its
HTTP and serialization libraries. See `crates/ilxyr-intake/README.md`.

## Operations status

The AWS launcher is implemented and covered by a fake AWS command client. A live diagnostic needs
an AWS account, a prepared private subnet, two S3 buckets, an instance profile, a digest-tagged AMI,
and a frozen job package. The first paid diagnostic also needs its own approval and budget.

The report intake source is complete. Its production setup includes TLS, trust roots, monitoring,
backups, and recovery. Discovery can publish its endpoint after that setup passes review.
