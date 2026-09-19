# FERAL v3 model selection

Decision date: September 19, 2026.

## Decision

Select **Qwen/Qwen3.5-4B-Base** as the training backbone for FERAL v3.
Its status is **selected for development; task quality and speed await measurement**.
Use **FERAL v3** as the system name and record model size separately.

FERAL selects evidence, matches reporting context, requests exact calculations,
and writes short supported answers. BRAID supplies source facts and passages.
The exact engine executes arithmetic. This bounded role makes a compact model
worth testing. Smaller weights offer a plausible memory benefit; measured
latency and cost determine the deployment choice.

The existing Qwen2.5-7B-Instruct stays the historical comparison model. The
published Qwen3.5-4B post-trained checkpoint supplies an immediate prompting
control. A fresh LoRA adapter on 4B-Base is the proposed training arm.
Qwen3.5-9B-Base is the larger fallback if 4B falls short on held-out selection.

## Fixed model identities

Public Hugging Face metadata was checked on the decision date. Weight and
tokenizer downloads must use these revisions together.

| Role | Repository | Revision |
| --- | --- | --- |
| Selected training backbone | `Qwen/Qwen3.5-4B-Base` | `1001bb4d826a52d1f399e183466143f4da7b741b` |
| Immediate prompting control | `Qwen/Qwen3.5-4B` | `851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a` |
| Larger training fallback | `Qwen/Qwen3.5-9B-Base` | `68c46c4b3498877f3ef123c856ecfde50c39f404` |
| Historical prompting control | `Qwen/Qwen2.5-7B-Instruct` | `a09a35458c702b33eeacc393d103063234e8bc28` |

The three Qwen3.5 checkpoints carry Apache 2.0 licenses. Their official cards
identify the Base checkpoints as pretrained models for further training. Treat
prompting comparisons and trained comparisons as separate results: the existing
7B model and published 4B model have already received instruction training.

The Hub inventory reports 4,659,865,088 parameters for the complete 4B checkpoint,
including its vision components. At two bytes per parameter, weights alone take
about 9.32 GB (8.68 GiB). Actual memory also includes state, activations, runtime
buffers, and training allocations. Record the text-only loaded parameter count
and peak memory during calibration.

## First comparison

Use the ten-filing-family feasibility package from the
[v3 proposal](FERAL-7B-V3-XBRL-REGULATORY-PROPOSAL.md). Start with 50 reviewed
questions and one independent paraphrase each. Include ambiguous and missing
facts, wrong periods, different dimensions, index identities, and prose baselines.
Keep the earlier FERAL cases as a separate regression cohort.

Freeze source families and development/held-out assignments before label work.
Use the same evidence candidates, source passages, exact values, tools, output
schema, and visible information for every selector. Preserve the rules and small
ranker controls. Compare the published 4B checkpoint with the historical 7B on
that same view. Count unsupported answers and abstentions in the denominator.

Use the 4B checkpoint's documented non-thinking mode for the short-action pilot;
verify rendered prompts and returned tokens. Freeze each model's template,
output allowance, retry policy, and tool budget. Record token counts per model
because their tokenizers differ. Measure time to first token, whole-answer p50
and p95 latency, peak GPU memory, and cost per supported correct answer on the
same GPU, runtime, precision, and batch schedule. Report cold startup separately.

After the prompting comparison, fit a fresh rank-16 LoRA on 4B-Base with reviewed
training families. Use a 4,096-token sequence limit for the initial smoke and
calibration package; report evidence that exceeds the limit. Start with one epoch
and select further settings on development data. Record all trainable module
names, seed, loss masking, data digest, and optimizer settings. Include the
unadapted Base reference when measuring adaptation benefit. Equal training data
and tuning budgets apply if the 9B fallback receives a later comparison.

## Decision rules

These are proposed qualification rules, frozen before held-out execution:

- Preserve the proposal's source integrity, exact-engine, useful coverage, and
  required-abstention gates. Joint correctness includes entity, concept, period,
  dimensions, units, operation, value, and source support.
- For deployment, allow at most a two percentage point drop in joint correctness
  against the strongest eligible model reference. Require the one-sided 95%
  upper confidence bound on that drop to stay within two points. Resample by
  source family, with paraphrases and mutations kept together.
- Require at least 20% lower whole-pipeline cost per supported correct answer
  at the accepted quality level. Include retrieval, tools, retries, and serving.
  Report training cost and expected query count separately for amortization.
- Apply the proposal's added-value comparison against rules and the small ranker.
  A model must earn its role against those cheaper selectors too.
- Use the ten-family pilot to check feasibility and estimate paired disagreement.
  Size a fresh qualification set for the confidence bounds. If the pilot is too
  small to resolve a rule, record the decision as pending and expand that set.
- If 4B misses quality, inspect retrieval and context errors first. Test 9B on
  the same evidence and scoring after those checks. Select the smallest model
  that meets the quality and cost rules.

## Runtime work before calibration

The current comparison worker loads a Qwen2.5 causal model with SDPA, uses its
chat template, and caps answers at 32 new tokens. The v3 worker needs a separate
model profile and a verified loader for Qwen3.5's text backbone. Transformers
documents `Qwen3_5ForCausalLM` and `Qwen3_5TextConfig` for text-only use. Validate
checkpoint key mapping, tied embeddings, tokenizer, stopping, cache behaviour,
and adapter save/reload on the pinned runtime.

Qwen3.5 uses three linear-attention layers per full-attention layer. Its fast
DeltaNet path depends on compatible kernels. Verify the actual kernel path on
the selected GPU before timing it. The runtime package must pin library and
kernel versions, model files, loader code, and the image digest. Save a short
load/generate/backward/save/reload receipt before larger training.

The next execution package needs the reviewed evidence roster, v3 worker,
runtime image, selected GPU, maximum duration, and expected cost. Price a bounded
calibration before paid execution, as required by [AGENTS.md](../AGENTS.md).
This document records the model choice and qualification plan. Current evidence
is source inspection and metadata verification; measured FERAL 4B results remain
pending.

## Sources

- [Pinned 4B Base model card](https://huggingface.co/Qwen/Qwen3.5-4B-Base/blob/1001bb4d826a52d1f399e183466143f4da7b741b/README.md)
- [Pinned 4B prompting model card](https://huggingface.co/Qwen/Qwen3.5-4B/blob/851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a/README.md)
- [Pinned 9B Base model card](https://huggingface.co/Qwen/Qwen3.5-9B-Base/blob/68c46c4b3498877f3ef123c856ecfde50c39f404/README.md)
- [Transformers Qwen3.5 loader and kernel guidance](https://huggingface.co/docs/transformers/model_doc/qwen3_5)
- [Historical model profile](../examples/feral-7b/transformers-base-profile.json)
- [Existing comparison worker](../scripts/feral_comparison_worker.py)
