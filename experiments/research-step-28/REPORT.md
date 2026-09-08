# Research step 28: FERAL model loading passed; generation hit the cache boundary

The approved run initialized CUDA and loaded the fixed Qwen model onto the
L40S. It allocated 15,232,282,624 bytes for the loaded model. The first
synthetic generation then failed when Triton tried to create `/root/.triton`
in the read-only container. The worker produced zero scored model answers.
The full model comparison remains incomplete.

[STARTUP-FAILURE.json](STARTUP-FAILURE.json) preserves the exact failure stage,
CUDA placement, allocated memory, and input. The earlier CUDA initialization
error is resolved in this run. The new record identifies cache storage as the
next execution barrier. The separate `nvidia-gridd` console warning remains
in local host evidence; the actual CUDA and model-loading records establish
what succeeded in the experiment process.

## Controls and verification

Both original controls completed all 1,147 inputs. The v1 calculator scored
24/1,147 against revised targets and 19/1,147 against original targets. The
operand-only control scored 3/1,147 revised and 0/1,147 original. Each control
abstained on 1,056 cases. These repeat the earlier full-roster results.
[SCORES.json](SCORES.json) preserves both target policies.

All 41 collected object versions passed size and checksum checks. The frozen
source package, model-file inventory, execution plan, raw response parsing,
ordered rows, and all saved grades verified. Every control answer and evidence
trace matches step 22. Each run retains its own timing observations.
[VERIFICATION.json](VERIFICATION.json) records the checks. The initial audit
attempt compared entire prediction files; per-row wall times caused that
assertion to fail. [VERIFICATION-ATTEMPTS.json](VERIFICATION-ATTEMPTS.json)
records the correction and passing content comparison.

The host finished after about 9.9 minutes. Provider observation confirms
instance termination and root-volume deletion. The host-time estimate,
including the full reserve, is $1.1194 before tax. The more conservative
provider-observation upper estimate is $2.3544. Actual invoice cost remains
unknown. [CLEANUP.json](CLEANUP.json) binds the cleanup evidence and exact
cost arithmetic.

The public research archive contains 31 files: prediction rows, calculator
traces, model and runtime records, process measurements, and the generation
failure. [RESEARCH-ARCHIVE.json](RESEARCH-ARCHIVE.json) binds these files.
Raw account, authorization, console, and provider receipts remain in local
custody after the separate operational upload was rejected by approval review.

## Repair verified in the actual runtime

The host now routes `TRITON_CACHE_DIR` to `/tmp/feral-triton` and permits
native module loading in the bounded temporary filesystem. The container
keeps its read-only root, isolated network, and original resource limits.
The fixed image and original scientific execution archive remain unchanged.

The [frozen-runtime CI check](https://github.com/cenetex/ilXyr/actions/runs/34207485437)
reproduced the original cache error. With the corrected path, Triton 3.7.1
compiled, loaded, and reused a small native module successfully. This checks
the actual cache and native loader inside the same 25 GB image. It uses zero
scored inputs. GPU generation remains the first check in the next approved
run. [CACHE-CHECK.json](CACHE-CHECK.json) preserves that scope and source hashes.
The local host lifecycle suite also passes all 12 groups.

## Replacement ready for an execution decision

The replacement host package is
`25c350b4819e499bcf1adabe56d5d05cb8ef7c07daccb13d7a221545cd74d821`.
It is frozen and staged with exact versioned read-back. Current provider and
price checks passed; the free launch dry run created zero instances. The
proposal remains one hour and **$3 before tax**, with a maximum estimate of
$2.99208. [REPLACEMENT-HOST.json](REPLACEMENT-HOST.json) and
[REPLACEMENT-PREFLIGHT.json](REPLACEMENT-PREFLIGHT.json) bind the preparation.
A new package-and-budget approval is required before paid execution.

The shared research lesson is to test each added dependency in its real
execution setting. The new startup record separated CUDA initialization,
model placement, and native compilation. Reasoner's matched no-go likewise
separates verified execution from added scientific value. FERAL still needs
the fixed model result before selecting a learned component. Calculator v2
continues as separate development work with fresh coverage testing next.
