# FERAL base model and fixed controls, version 1

The comparison asks where learned evidence use improves on a fixed arithmetic
method. All three arms answer the same 1,147 FinQA questions in the published
order. Inputs and version-two targets come from the frozen step 7 manifest.
This is a comparison on an existing public benchmark. The next transfer claim
needs a fresh source corpus with an issuer split fixed before inspection.

| Arm | Method | Input |
| --- | --- | --- |
| base | Qwen2.5-7B-Instruct, frozen revision | Complete system and user messages |
| calculator | Step 8 evidence selection and arithmetic | Same question and supplied evidence |
| operand_only | Same selection, return the final selected operand | Same question and supplied evidence |

The model revision is `a09a35458c702b33eeacc393d103063234e8bc28`.
[MODEL-FILES.json](MODEL-FILES.json) binds all 14 repository files by size and
SHA-256. Weight digests come from the public Hugging Face file inventory.
The small files were downloaded and checked against their Git blob identities.
The worker verifies the complete model directory before loading it. Stage a
plain snapshot containing those 14 files in the cloud image or mounted storage.

## Answer and scoring rules

The original prompt asks for one JSON object with exactly one `answer` field.
Each arm's raw response passes through that rule. The parser retains exact
decimal text, prose answers, yes/no answers, explicit abstentions, and the
version-two value/unit object. It records unfinished JSON, extra fields,
duplicate fields, and out-of-range numbers as invalid responses. Every input
retains its place in the score denominator.

The scorer uses the unchanged step 7 code and target bytes. It reports both
original and version-two accuracy, results by target kind and issuer, explicit
abstention, and invalid-response counts. It reparses each saved raw response,
checks its stored prediction, and verifies the ordered roster and package
bindings. Preserve all failed cases and both controls' outputs.

The historical 168/1,147 score and its 172/1,147 version-two rescore describe
the earlier saved predictions. This new comparison has a strict response
parser. Its report must name both parser versions when discussing those
historical scores. The old evaluator retained extracted answers; its raw
responses are unavailable in that artifact. Synthetic parser probes establish
the behavior of its fallback, with historical frequency left unknown.

The base arm uses the original system and user messages. Grading files have
a separate package phase and can be removed from the prediction mount. The
model's call receives only the messages. Open targets for scoring after all
prediction arms reach a terminal state.

## Frozen generation

Use batch size 1, seed 17, bfloat16 weights, SDPA attention, and one CUDA
device. Use greedy generation with one beam and at most 32 new tokens. Keep
the revision's chat template and generation defaults, then save the resolved
generation configuration with each response. Tokenization after the chat
template uses `add_special_tokens=False`, as described in the
[Transformers guide](https://huggingface.co/docs/transformers/main/en/chat_templating).
An input above 8,192 tokens ends the arm with an input-context failure. Keep
that failure for a separately declared context-limit revision.

The package includes the exact `pyproject.toml` and `uv.lock` from runner-watch
commit `4f2a40d3ad7372e2a5620cf3657959d4b1cac4cf`. These pin Transformers
5.16.1, Torch 2.13.0, and their companion packages. A cloud image must resolve
that lock, install dependencies only, and bind its resulting image digest,
Python version, CUDA runtime, driver, GPU, and installed package inventory.
The local checks use small synthetic generators and fixed arithmetic.
Actual model loading and generation remain a cloud validation step.

## Complete work and failure records

The worker flushes each completed response to a new output directory. A Python
exception records the failed input and completed prefix. Package verification
and setup failures retain an invocation receipt. A partial run reports its
completed count, full expected count, and observed cost. Primary accuracy is
available only after a full ordered run. A retry starts a new execution record.

Arm receipts record prediction time, model verification and loading time,
process CPU time, and invocation time including package verification.
These nested times describe different scopes; report each scope explicitly.
An outer cloud controller must also record environment setup, staging,
process startup, peak host/device memory, watchdog termination, grading,
storage, and billed cost. A hard kill may leave only the flushed prefix; the
controller must preserve that prefix and create the terminal failure receipt.
Local timing fields are engineering diagnostics.

Run all arms on the same frozen machine and image with the same ordered
roster. Preserve per-question outputs to report paired correct/wrong cases.
Separate cold start, steady prediction, and complete execution cost. Report
arithmetic operations and model token counts with their distinct units.

## Source packages and execution

Build from a full ilXyr commit with `scripts/package_feral_comparison.py`.
The builder reads committed source, verifies the frozen input and target
digests, and emits a deterministic source/input tar file. The package binds
the exact model inventory, lockfile, prediction code, grader, and this plan.
The full package retains 1,147 rows. `--smoke` selects only the five cases
already opened in step 8. Its scope is a development smoke check.

After extraction, invoke each arm with its package manifest SHA-256:

```bash
python3 scripts/feral_comparison_worker.py \
  --manifest-sha256 PACKAGE_SHA --arm base \
  --model-dir /model --out /results/base
python3 scripts/feral_comparison_worker.py \
  --manifest-sha256 PACKAGE_SHA --arm calculator --out /results/calculator
python3 scripts/feral_comparison_worker.py \
  --manifest-sha256 PACKAGE_SHA --arm operand_only --out /results/operand_only
python3 scripts/score_feral_comparison.py \
  --manifest-sha256 PACKAGE_SHA --runs /results --out /results/comparison.json
```

Cloud preparation still needs a resolved machine/image, an outer controller,
watchdog limits, immutable output location, price evidence, maximum duration,
and maximum cost. Freeze those fields around the tested source archive and
request the bounded paid run under `docs/CLOUD-EXECUTION.md`.

This contributes a shared program test: compare correct final answers and
their complete cost against a fixed simple method. The retained MAS
cross-series failure shows where the arithmetic control needs better evidence
selection. The new full comparison will show how often that gap matters.
