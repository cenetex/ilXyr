# Weight pilot: bounded host package ready

The fixed host wrapper carries the step 56 pilot source archive without changing its scientific rules. It schedules sixteen jobs: four seeds across uncached and cached selection, each with fixed and rotating range order. Each job has a 180-second cap. The controller reserves time for verification and collection, and the host has a 5,400-second shutdown deadline. Its maximum cost is $2.00 before tax.

The pilot source archive SHA-256 is `adea1791925e3336d28e4a26ccc80c5c20baa7892fc84675b422e325295569c7`, from source commit `57db690ec7c03dd19d6358bb52d173111a4bcd07`. The host archive SHA-256 is `a7338eb950e21bdbeba6df73f484fc9a4bd365e0eb3fecf4c9407f0f63a17f45`, 16,609,280 bytes, from source commit `d19347842a4c7d2553a89ba159ce5a6d930b7357`. [READINESS.json](READINESS.json) records its immutable S3 version, plan, provider checks, prices, and limits.

The existing c6i.4xlarge machine and pinned Node image remain fixed. The host package uses a new package and result prefix with 30-day current-object expiry and one-day noncurrent expiry. A local package unpack and sixteen-command preparation passed with zero oracle starts. A full readback of the versioned S3 object matched its SHA-256. The free provider preflight passed machine, image, root volume, network, role, bucket, live prices, and EC2 dry run with zero instances. This preflight establishes readiness for its recorded run ID. A launch needs a fresh timed binding, empty output prefix, and fresh preflight for that same ID.

The pilot comparison measures new accepted rows after query, orbit, range, and quota rules. Its complete scientific outcome remains pending. The step 51 full corpus hold stays the existing corpus result. Pilot capacity claims use the recorded sampled-support limit.

## Launch and collection

Use `scripts/weight_pilot_cloud_launch.py` with the exact archive, plan hash, object version, and an approval record binding the $2.00 ceiling and 5,400 seconds. The launcher accepts only a fresh matching preflight receipt. It creates one instance with a shutdown watchdog. Keep the launch receipt before observing the instance.

After termination, run `scripts/weight_cloud_collect.py receive` with `experiments/research-step-59-weight-pilot/EXECUTION-PLAN.json`, the launch receipt, and a fresh output directory. The collector checks termination, volume and interface cleanup, versioned objects, checksums, and archive paths. Run the pilot's independent checker and replay on every complete job. Preserve partial jobs, holds, failed calls, and actual billed cost status in a follow-up report.

Local package, staging, and preflight records are under `/private/tmp/zero4-retention-preflight-20260926/`. Raw provider responses remain outside Git.

## September 26 launch

[LAUNCH.json](LAUNCH.json) records run `weight-pilot-56-20260926T230650Z`,
instance `i-02da7bfd691f11c5f`. A fresh preflight passed for this exact run,
package, and object version. AWS then confirmed the instance running with
the expected package and deadline tags. The watchdog deadline is
September 27, 2026 at 00:36:50 UTC. Scientific results, collection, cleanup,
and actual billing await the host's terminal record.

The launch receipt is
`/private/tmp/weight-pilot-live-20260926/launch/receipt.json`.
After termination, collect into a fresh directory:

```sh
python3 -B scripts/weight_cloud_collect.py receive \
  --plan experiments/research-step-59-weight-pilot/EXECUTION-PLAN.json \
  --identity /private/tmp/weight-pilot-live-20260926/launch/receipt.json \
  --output /private/tmp/weight-pilot-collected-20260927
```
