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
