# Stage A GPU cache repair and bounded retry

The first host `i-06dd8a22487bef678` stopped during the one-form loader
smoke. It verified the pinned public model files and loaded all 426 model
weights. The first `generate()` call raised `OSError: [Errno 30] Read-only
file system: '/root/.triton'`. The immutable smoke stderr is object version
`JK0p46bF.JsmKDi1R2WgSLWaU1hiTuFE` in the first run prefix. No full 36-form
generation began. `PRIOR-TERMINAL.json`, `PRIOR-COLLECTION.json`, and
`PRIOR-CLEANUP.json` bind the failed phase, six exact S3 objects, completed
instance termination, zero tagged volumes, and zero attached interfaces.

The repair points Triton, Torch Inductor, Torch extensions, Torch model files,
Hugging Face, and XDG caches at writable subdirectories under the container's
1 GB `/tmp` mount. The same six environment flags appear in the AWS launcher
and the frozen-image CI runtime test. The host runs the packaged native
Triton cache check in a read-only container before downloading model files.
That check compiles and loads a native module, then confirms cache reuse. The
one-form model loader smoke remains the gate before the full 36 forms.

The scientific inputs, question roster, model revision, model file hashes,
generation settings, selector parser, and scoring rules match the first run.
The retry package adds `scripts/check_feral_runtime_cache.py` as a runtime
precheck; it keeps the pinned model and study bytes unchanged.

## Combined cost bound

The first instance launched at 23:38:32 UTC and had completed cleanup by
23:54:07 UTC: a 935-second upper bound. Reserve 1,200 seconds for its compute
cost. The retry host has a 2,400-second hard limit. Both attempts therefore
reserve at most 3,600 instance seconds. At the current public us-east-1 Linux
`g6e.2xlarge` price of $2.24208 per hour, combined compute is $2.24208.
The original $0.75 reserve covers both attempts' gp3 storage, IPv4, S3
storage and requests, transfer, and contingency. The combined ceiling is
**$2.99208 before tax**, inside the disclosed $3.00 cap. Actual billed cost
remains unknown until provider billing is available.

The retry watchdog is armed before setup and shuts down at launch plus 2,370
seconds. Each command reserves collection time; model generation stops with
at least 120 seconds left. A source package, AWS price and capacity check,
first-run cleanup check, fixed one-run authorization, CI runtime-cache pass,
and parent review are gates before paid launch.

## Retry command sequence

After the repair PR is merged and the parent clears launch, stage the new
committed archive and run a fresh free preflight. The authorization JSON must
bind the new package SHA-256 and S3 version, a fixed run ID, one run, 2,400
seconds, a 1,200-second first-run reserve, the $3.00 combined ceiling, and
reference `user-four-priorities-bounded-retry-2026-09-26`.

```sh
python3 scripts/feral_stage_a_gpu.py stage --out /tmp/feral-stage-a-retry-stage
python3 scripts/feral_stage_a_gpu.py preflight \
  --binding /tmp/feral-stage-a-retry-stage/BINDING.json \
  --network /tmp/feral-stage-a-network.json \
  --out /tmp/feral-stage-a-retry-preflight
python3 scripts/feral_stage_a_gpu.py launch \
  --binding /tmp/feral-stage-a-retry-stage/BINDING.json \
  --network /tmp/feral-stage-a-network.json \
  --preflight /tmp/feral-stage-a-retry-preflight/PREFLIGHT.json \
  --authorization /tmp/feral-stage-a-retry-authorization.json \
  --out /tmp/feral-stage-a-retry-launch
```

The existing read-only `observe` and exact-version `collect` commands apply
to the new `LAUNCH.json`. The standalone scorer requires a complete terminal
state and all model output files before producing a development result.
