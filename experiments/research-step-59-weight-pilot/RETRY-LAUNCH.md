# Weight pilot retry launch

The repaired package passed a new free provider preflight and launched once on September 26, 2026. [RETRY-LAUNCH.json](RETRY-LAUNCH.json) binds its immutable package, plan, S3 version, instance, approval, request, $1.85 before-tax ceiling, and 5,400-second watchdog deadline. The first attempt's $0.15 reserve keeps the two attempts within the original $2.00 planning ceiling. Actual provider billing remains unknown.

Run `weight-pilot-56-20260926T233104Z` uses instance `i-09b9ada38cd4afe2b`. A read-only provider check found it running with the expected package and run tags. Its deadline is September 27, 2026, 01:01:04 UTC. The host result is settled in [RETRY-RESULT.md](RETRY-RESULT.md).

After termination, collect with `scripts/weight_cloud_collect.py receive`, `experiments/research-step-59-weight-pilot/RETRY-PLAN.json`, and the launch receipt at `/private/tmp/weight-pilot-retry-live-20260926/launch/receipt.json`. Use a fresh output directory. Verify termination, volume and interface cleanup, immutable S3 objects, result archive paths, all complete job checks, and generator replay. Preserve partial and failed jobs. The scientific outcome and collection receipts are in [RETRY-RESULT.md](RETRY-RESULT.md). Provider billing remains pending.

The private raw preflight and launch records remain under `/private/tmp/weight-pilot-retry-live-20260926/`.
