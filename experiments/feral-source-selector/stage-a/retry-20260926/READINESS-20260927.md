# FERAL Stage A retry readiness, September 27

This is a prelaunch check for the repaired 4B development run. The first
host's loader failure, exact collection, and resource cleanup remain in the
[retry plan](RETRY-PLAN.md). This check created a local source archive and
queried the public price catalogue. It stopped at AWS identity before S3
staging or EC2 preflight.

| Item | September 27 check |
| --- | --- |
| Source archive | 1,454,080 bytes, SHA-256 `e571b2cacf67bdbe151300b9e3614c0a4a41389075626feee5db5a425e2c36e7` |
| Local checks | All 16 Stage A tests and package manifest check passed |
| Public EC2 rate | `g6e.2xlarge` in `us-east-1`: $2.24208 per hour; catalogue publication September 25, 17:45:21 UTC |
| Combined bound | First-host reserve 1,200 seconds plus retry limit 2,400 seconds; $2.24208 compute plus $0.75 reserve = $2.99208 before tax |
| AWS identity check | `get-caller-identity` stopped with `Token has expired and refresh failed` for profile `default` |
| This attempt | Local package verification completed; S3 staging and EC2 preflight await a refreshed AWS SSO session |

[PR #258](https://github.com/cenetex/ilXyr/pull/258) recorded an earlier stage
of this archive at S3 version `xbQ.WLtf.c6xCohjbJdXoAL5btZ8In33`. The
September 27 check reproduced the archive hash. AWS access is needed to
verify that exact object version and the current provider state. The free
preflight will check the prior host's cleanup, account, source version, image,
machine, network, launch permission, and price.

After the SSO session is refreshed, run staging and a fresh free preflight
from committed source. Present that receipt with the fixed run ID, one-host
limit, 2,400-second retry limit, and $3.00 combined ceiling for the paid-run
decision. Keep the one-form loader smoke as the gate before the 36 forms.
Observe termination and collect every exact result version after any approved
launch. The [scorer](../../../../scripts/feral_stage_a_gpu_score.py) can then
check the complete development result.
