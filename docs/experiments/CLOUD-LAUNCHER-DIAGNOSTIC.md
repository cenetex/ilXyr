# Cloud launcher diagnostic

This diagnostic runs one fixed public test through the general AWS launcher.
The program returns a score of `0.82`. The program has a private network namespace.

The launch uses one `c6i.large` instance. The runtime limit is five minutes.
The watchdog adds one minute. The total AWS limit is `$1.00`.

The worker reads the sealed package and launch receipt from S3. It writes a signed report to S3.
The signing key exists for this diagnostic only. The ilXyr ledger trusts its public key for this
one workspace.

The closeout records the final machine, package, launch, report, cost, and cleanup facts. The
bootstrap template contains the worker logic. The launch copy gets a one-time signing key before
its digest is frozen.

## First live result

The first live run completed on September 3, 2026. The signed report passed the ilXyr verifier.
The result was `success`. The score was `0.82`. AWS returned the result in 115 seconds. The
instance then reached the `terminated` state.

The frozen cost bound was `$0.2085` within the approved `$1.00` limit. Compute through the result
time was about `$0.002715` at the recorded rate. AWS billing remains the final cost record.

The run found one report field with snake case. The controller changed that field to camel case.
The signed payload stayed the same. S3 versioning keeps both report objects. The worker template
now writes the accepted field name.

The files in `experiments/cloud-launcher/diagnostic-v1` hold the package, receipts, reports, cloud
state, object versions, and ledger check for this run.

The trial AMI and its copied snapshot were removed after the closeout. The S3 evidence remains.
