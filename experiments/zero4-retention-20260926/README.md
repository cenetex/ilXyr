# ZERO.4 retention comparison: replacement run

The repaired replacement package passed a fresh provider preflight on September 26, 2026. The bound launch created one `c6i.4xlarge` instance with a 160 GiB encrypted root disk and a shutdown deadline of 48,600 seconds. The maximum cost is $12.00 before tax. The live scientific outcome, collection, cleanup, and actual billed cost remain pending.

[LAUNCH.json](LAUNCH.json) binds the exact package, S3 object version, prepared inputs, plan, request, and instance. The earlier step 51 disk-reserve stop and step 57 adapter stop each recorded zero scientific calls. This new run has its own identity; its scientific process count awaits the host record.

## Observe and collect

Run ID: `zero4-52-20260926T224941Z`. Instance: `i-094e2cb818b8977c7`. Results use the private bucket prefix `runs/zero4-52-20260926T224941Z/`.

Use read-only EC2 `describe-instances` to check state. The host's watchdog is armed in the sealed user data. Observe storage with read-only S3 listing. A running instance is an operational state; scientific progress needs its host record.

After the instance reaches `terminated`, use `scripts/zero4_cloud_collect.py receive` with `experiments/research-step-52/EXECUTION-PLAN.json`, the launch receipt at `/private/tmp/zero4-retention-preflight-20260926/launch/receipt.json`, and a fresh output directory. The collector verifies instance identity, termination, volume and interface cleanup, versioned S3 objects, checksums, and archive paths. Check the downloaded controller result with the frozen ZERO.4 result checks. Preserve partial records and errors. Then append a separate result report and actual billing status.

The local source archive and launch receipts are under `/private/tmp/ilxyr-cloud-20260924.eKfDc4/zero4-replacement.tar` and `/private/tmp/zero4-retention-preflight-20260926/`. The private raw provider records stay out of Git.
