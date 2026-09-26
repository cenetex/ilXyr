# SPO source selection pilot

Status on 2026-09-26: **no go for an algorithm comparison**. FERAL Stage A
provides 36 opened development questions over three SEC filing families and
an exact resolver. The deterministic control scores 36/36 after development
rules. A learned selector result and a fresh held-out filing family are pending.
The current source selection reward can be binary when a resolver-verified
selection and answer match the sealed label. The exact reward rule must be
frozen before training. A deterministic control with full development accuracy
does not establish learned added value.

`python3 scripts/spo_pilot.py --readiness experiments/spo-pilot/READINESS-2026-09-26.json`
prints a machine-readable readiness receipt. It verifies exact SHA-256 hashes
for the FERAL Stage A source files. Supply `--source-root PATH` while PR #248
is in its separate worktree. Refresh the evidence flags after scored model and
held-out results arrive, and keep the hash roster pinned to the chosen study.

`--replay PATH` accepts a recorded
stream with `kl_half_life`, `prompts`, and `batches`. Each prompt has a stable
`id`, eight `warm_rewards`, and an ordered `initial_policy` probability vector.
Each batch has attempts with `prompt_id` and `status`. Accepted attempts also
carry a sampled policy vector, binary `reward`, and `resolver_verified: true`.
The runner keeps labels outside policy inputs. It records failed and rejected
attempts in cost and excludes them from the update. The replay reports a
pre-update baseline, KL, discount, raw and globally normalized advantage for
each accepted attempt. A single accepted sample gives a zero normalized
advantage; a real pilot needs a batch with outcome variation.

The `train_categorical` Python interface trains a shared linear softmax policy
over supplied feature vectors and an ordered action roster. Its evaluator
callback returns a status and resolver-verified binary reward for each sampled
action. Separate `supervised_label` access feeds the supervised reference.
The running-baseline and GRPO references use the same policy and an equal
attempted-rollout ceiling as SPO. SPO's warm-start attempts count inside that
ceiling. Supervised label calls have their own count and must be reported
separately. This interface is exercised with small synthetic unit fixtures;
it has no scored FERAL training or held-out result yet.

The code implements the paper's eight-sample Beta warm start, pre-update
baseline, KL discount clipped to 0.875–0.96, global normalization, 0.2/0.28
asymmetric PPO objective clip, and `sqrt(v*(1-v)) + 0.05` prompt weight. The
categorical policy and verified rollout interface is the intended scope.
The pilot sets KL half-life to 0.1 as an explicit, frozen choice because the
paper gives the formula without a numeric half-life setting. A later full
study must freeze this value with its full package before launch.
It is an adapter for a future source/concept/action selector. It is not a
pretrained LLM result or a measured throughput gain. The paper's 4.35x figure
comes from a scheduling simulation. Its reported five-benchmark averages are
56.0% versus 55.7% avg@32 and 63.8% versus 60.4% maj@32 for SPO and GRPO.

Before a comparison, freeze the learned candidate, reward contract, untouched
filing-family split, initial policy, action roster, rollout order, random seeds,
and equal total verified plus failed plus warm-start attempts. Compare the
supervised selector, simple running baseline, SPO, and GRPO on that same budget.
Keep source correctness, answer correctness, abstention errors, rollouts,
tokens, elapsed time, and cost separate. A full or timed run belongs in the
configured cloud venue after a package and cost review.

Paper: https://arxiv.org/html/2509.13232v2
