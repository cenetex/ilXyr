# Research step 14: FERAL execution controller

The FERAL comparison now has a controller for the frozen cloud runtime. It
checks the runtime, stages and verifies model files, runs the three arms in
order, and grades their completed output. Every stage shares the original
launch deadline. Setup failures end the run. An arm failure preserves its
output while later controls run within the remaining time.

The execution archive reproduced byte for byte. A fresh extraction verified
the complete 1,147-row source package, runtime lock, controller source, and
budget. Seventeen focused checks and the schema suite passed locally.

## Failures retained

An injected process printed one complete prediction and six bytes of a second
line, then ignored TERM. The controller sent KILL and reaped it. The saved
record preserves the complete row, partial tail, raw-output hashes, signals,
wall time, and observed resource usage. Its primary score remains unavailable.
The grader test preserves that failed arm while scoring the completed
calculator and operand-only controls.

Other checks cover a child left behind after its parent exits, exhausted
deadlines, cancellation, oversized logs, changed runtime/model bytes, archive
path escapes, and a missing executable. Review found that a process-start
exception could leave its receipt outside the stage index. The controller now
adds that failed launch to the index before applying the failure policy.

The runtime check also records the version or digest it actually observed
before a mismatch. Model staging preserves each completed file and identifies
the failed file. These are engineering fixtures. The earlier MAS selection
failure and strict-parser findings remain in steps 8 and 13.

## Frozen runtime and budget draft

The existing FERAL image is available at
`ghcr.io/atimics/feral-7b-sec-qwen@sha256:c7df646b246f9c853946201aa7ad5c06ea711c34633594943365153342df346b`.
The [completed image build](https://github.com/atimics/runner-watch/actions/runs/33848581774)
and a fresh registry manifest read confirm that identity and its Linux/amd64
manifest. Its Dockerfile, `pyproject.toml`, and `uv.lock` are byte-identical to
the comparison's pinned runner-watch revision. [RUNTIME-SOURCES.json](RUNTIME-SOURCES.json)
records those checks. The worker still verifies installed versions, CUDA,
GPU identity, and all model bytes before inference.

The draft uses one `g6e.2xlarge` for at most 3,600 seconds. The current
[AWS Linux price feed](https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/US%20East%20%28N.%20Virginia%29/Linux/index.json)
lists $2.24208 per hour. [PRICE.json](PRICE.json) preserves the selected record,
fetch time, and source digest. The draft adds a $0.75 infrastructure reserve
under a $3.00 ceiling before tax. The first metadata request used an extra path
segment; the next required gzip decoding. Both failures and their resolutions
are recorded in the result.

The latest TERM time is second 3,270 after launch. The latest KILL time is
second 3,300. This leaves 300 seconds for collection and shutdown. Individual
stage limits can end a stage earlier. The controller accounts for time spent
before it starts and keeps later stages inside the original deadline.

Worker receipts retain direct process CPU and peak resident memory. GPU
receipts report the PyTorch allocator's peak; whole-device peak remains
unknown. Unwaited descendants have an explicit measurement limit in the
process scope. Instance cost remains an estimate through controller exit.
The final report needs collection, storage, termination, and billing evidence
from the outer launcher.

## Reproduce

[ARCHIVE.json](ARCHIVE.json) binds source commit
`4f514de73638c57b401c2aec1a4aaf61c961aa1a`. The 1,617,920-byte archive has
SHA-256 `1d0239b993353a4e67b1ed56718fdd433ea0b7e10646e2280295b25a2918516c`.
It contains the controller, the step 13 source archive, the price and runtime
records, and [EXECUTION-PLAN.json](EXECUTION-PLAN.json).

```bash
python3 scripts/package_feral_execution.py \
  --repo /path/to/ilxyr \
  --revision 4f514de73638c57b401c2aec1a4aaf61c961aa1a \
  --source-archive /path/to/step-13-full.tar \
  --out /tmp/feral-execution-v1.tar
```

From a fresh extraction:

```bash
python3 scripts/run_feral_comparison.py \
  --plan EXECUTION-PLAN.json \
  --plan-sha256 e98d0a4fbdc438126686a27803d528406183d99d157171a6b66a497bd5c9cb9d \
  --source-archive comparison-source.tar --check-plan
```

This checks the package locally and starts zero cloud processes.
[RESULT.json](RESULT.json) records nine source bindings and the retained
failure probes. The proposed AMI and launch settings still need live AWS
preflight. Instance bootstrap, the outer shutdown watchdog, immutable output
storage, and independent termination verification are the next implementation
step. A paid run follows the frozen package and bounded approval.

The shared research rule stays concrete: report correct final answers, keep
the full expected row count, and preserve the work used by failed attempts.
Reasoner, Solomon, ZERO.4, FERAL, and weight multiplicity each need those
quantities beside their fixed simple controls.
