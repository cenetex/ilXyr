# Prior art — EXP-004 global replay-tangent projection

- Experiment: [EXP-004](../experiments/EXP-004.md) (Q2.6, settled `go`, seed-2 diagnostic)
- Report date: 2026-07-19
- Authority: `review` (advisory; never ledger truth)

## Claim under review

> "A global replay-tangent projection of AdamW updates preserves the frozen
> cumulative replay ceiling while reopening the quantity-learning path in a
> deterministic, fully replayable micromodel training run."

Mechanism checked, separately from the claim: at each pre-attempt state, compute
the arithmetic mean gradient `r` of six frozen replay-validation windows; for
each candidate AdamW weight displacement `d`, apply
`d' = d - max(0, dot(r,d)/dot(r,r)) r` as one global projection over all
trainable weights, so no committed update moves along the direction that
increases replay loss. Purpose: learn a new capability without catastrophic
forgetting of the foundation corpus.

## Search queries used

1. `Orthogonal Gradient Descent continual learning Farajtabar arXiv`
2. `A-GEM efficient lifelong learning gradient episodic memory projection arXiv`
3. `PCGrad gradient surgery multi-task learning conflicting gradients arXiv`
4. `orthogonal weights modification continual learning Zeng Nature Machine Intelligence`
5. `experience replay continual learning catastrophic forgetting rehearsal arXiv Rolnick`
6. `catastrophic forgetting large language models fine-tuning empirical study arXiv`
7. `Adam-NSCL null space continual learning CVPR gradient projection memory Saha ICLR`
8. `projecting fine-tuning gradient orthogonal to pretraining replay gradient language model mitigate forgetting arXiv`

## Verified entries

Every row was verified by fetching the linked page (arXiv abstract, PMLR, or
publisher listing) confirming title, authors, year, venue.

| Title | Authors | Year | Venue | Relation | Note | URL |
| --- | --- | ---: | --- | --- | --- | --- |
| Gradient Episodic Memory for Continual Learning (GEM) | Lopez-Paz, Ranzato | 2017 | NIPS 2017 | `anticipates` | Constrains updates so episodic-memory (replay) loss does not increase; projection of the proposed gradient under inequality constraints, for anti-forgetting. | https://arxiv.org/abs/1706.08840 |
| Efficient Lifelong Learning with A-GEM | Chaudhry, Ranzato, Rohrbach, Elhoseiny | 2019 | ICLR 2019 | `anticipates` | Single-constraint form of GEM: when the update conflicts with the *average* episodic-memory gradient, project it out — the exact `d - max(0, r·d/r·r) r` operator EXP-004 applies, same anti-forgetting purpose. | https://arxiv.org/abs/1812.00420 |
| Orthogonal Gradient Descent for Continual Learning (OGD) | Farajtabar, Azizan, Mott, Li | 2020 | AISTATS 2020 (PMLR v108) | `method_overlap` | Projects new-task gradients onto the orthogonal complement of stored previous-task output gradients; unconditional projection, stored per-sample gradients rather than a live replay-loss gradient. | https://proceedings.mlr.press/v108/farajtabar20a.html |
| Gradient Surgery for Multi-Task Learning (PCGrad) | Yu, Kumar, Gupta, Levine, Hausman, Finn | 2020 | NeurIPS 2020 | `method_overlap` | Same conditional normal-plane projection between conflicting gradients; multi-task purpose, symmetric between tasks, not a frozen replay reference. | https://arxiv.org/abs/2001.06782 |
| Continual Learning of Context-dependent Processing in Neural Networks (OWM) | Zeng, Chen, Cui, Yu | 2019 | Nature Machine Intelligence | `method_overlap` | Modifies weights only orthogonal to the subspace spanned by previous inputs — projection applied to weight modifications, input-subspace reference rather than replay-gradient reference. | https://arxiv.org/abs/1810.01256 |
| Gradient Projection Memory for Continual Learning (GPM) | Saha, Garg, Roy | 2021 | ICLR 2021 | `method_overlap` | Gradient steps orthogonal to SVD-derived gradient subspaces of prior tasks; subspace memory instead of a live mean replay gradient. | https://arxiv.org/abs/2103.09762 |
| Training Networks in Null Space of Feature Covariance for Continual Learning (Adam-NSCL) | Wang, Li, Sun, Xu | 2021 | CVPR 2021 (oral) | `method_overlap` | Projects the *Adam candidate parameter update* (not the raw gradient) into the approximate null space of previous-task features — prior art for projecting the optimizer displacement rather than the gradient. | https://arxiv.org/abs/2103.07113 |
| Hidden Failure Modes of Gradient Modification under Adam in Continual Learning, and Adaptive Decoupled Moment Routing as a Repair | Hu, Yu, Cheng, Liu, Song | 2026 | arXiv preprint | `method_overlap` | Analyzes projection-style gradient modification interacting with Adam moment state (effective-LR inflation of the protected direction); directly adjacent to EXP-004's joint weight+moment commit/restore discipline. | https://arxiv.org/abs/2604.22407 |
| Mitigating Forgetting in Continual Learning with Selective Gradient Projection | Singh, Dhaulakhandi, Chopade, Malipati, Martinez, Zhu | 2026 | IJCNLP-AACL 2025 SRW | `method_overlap` | Conditional (cosine-gated, per-layer) gradient projection against forgetting; gated variant of the same conditional-projection idea. | https://arxiv.org/abs/2603.26671 |
| Experience Replay for Continual Learning (CLEAR) | Rolnick, Ahuja, Schwarz, Lillicrap, Wayne | 2019 | NeurIPS 2019 | `domain_overlap` | Replay buffers against forgetting; loss-mixing rather than update projection. | https://arxiv.org/abs/1811.11682 |
| Overcoming Catastrophic Forgetting in Neural Networks (EWC) | Kirkpatrick, Pascanu, Rabinowitz, et al. | 2016 | arXiv preprint (journal version PNAS 2017, not fetched) | `domain_overlap` | Same problem; quadratic importance penalty instead of projection. | https://arxiv.org/abs/1612.00796 |
| An Empirical Study of Catastrophic Forgetting in Large Language Models During Continual Fine-tuning | Luo, Yang, Meng, Li, Zhou, Zhang | 2023 | arXiv preprint | `domain_overlap` | Documents the forgetting phenomenon EXP-004 guards against, in 1b–7b LMs; no projection mechanism. | https://arxiv.org/abs/2308.08747 |
| Orthogonal Subspace Learning for Language Model Continual Learning (O-LoRA) | Wang, Chen, Ge, Xia, Bao, Zheng, Zhang, Gui, Huang | 2023 | EMNLP 2023 Findings | `domain_overlap` | Continual learning in LMs via orthogonal low-rank adapter subspaces; parameter-subspace constraint, not replay-gradient projection of full-model updates. | https://arxiv.org/abs/2310.14152 |
| Revisiting Replay and Gradient Alignment for Continual Pre-Training of Large Language Models | Abbes, Subbaraj, Riemer, Islah, Therien, Tabaru, Kingetsu, Chandar, Rish | 2025 | arXiv preprint | `domain_overlap` | Nearest LM-scale neighbor: combines experience replay with gradient alignment (meta-experience-replay style) for continual pre-training; alignment via meta-learning, not hard tangent projection under a frozen ceiling. | https://arxiv.org/abs/2508.01908 |

## Unverified leads

None. Every entry surfaced in search that entered this report was fetch-verified.
Candidates seen only in search snippets and not pursued (GNSP arXiv:2507.19839,
FedProTIP arXiv:2509.21606, GORP arXiv:2405.13383, soft-constraint GEM
arXiv:2011.07801) are further from the mechanism than the verified rows and were
not needed to set the boundary.

## Novelty boundary

The projection operator has substantial prior art and is not claimable. A-GEM
(2019) is the same conditional single-direction projection against the average
replay-memory gradient, for the same anti-forgetting purpose, and GEM (2017)
established the replay-gradient constraint it relaxes; Adam-NSCL (2021)
already projects the Adam candidate parameter update rather than the raw
gradient. The lab's claim survives only as the stricter conjunction: one global
projection over *all* trainable weights of the *AdamW displacement* against the
mean gradient of six *frozen* replay-validation windows, where the projection
constructs candidates but never supplies authority — every commit still passes
direct functional evaluation against an immutable baseline under a frozen,
prospectively registered 2% cumulative replay ceiling — executed as a
deterministic, fully replayable, hash-pinned 4.85M-parameter C11 micromodel run,
with weights and both AdamW moment arrays committed and restored jointly; plus
the specific empirical finding that this direction change reopened the
quantity-learning path that scalar continuation (EXP-003/Q2.5) provably could
not, with 700/700 full-scale commits. Any statement implying the projection
mechanism itself is new must be struck; the EXP doc should cite GEM, A-GEM, and
Adam-NSCL explicitly and note the Adam-moment interaction literature
(Hu et al. 2026) when discussing the joint weight+moment commit discipline.

## Recommended citations for EXP-004

Required (`anticipates`): GEM (arXiv:1706.08840), A-GEM (arXiv:1812.00420).

Recommended (`method_overlap`): OGD (PMLR v108), PCGrad (arXiv:2001.06782),
OWM (arXiv:1810.01256), GPM (arXiv:2103.09762), Adam-NSCL (arXiv:2103.07113),
Hu et al. 2026 (arXiv:2604.22407), Singh et al. 2026 (arXiv:2603.26671).

```json
{
  "schema": "ilxyr.prior_art_report.v1",
  "claim": "A global replay-tangent projection of AdamW updates preserves the frozen cumulative replay ceiling while reopening the quantity-learning path in a deterministic, fully replayable micromodel training run.",
  "queries": [
    "Orthogonal Gradient Descent continual learning Farajtabar arXiv",
    "A-GEM efficient lifelong learning gradient episodic memory projection arXiv",
    "PCGrad gradient surgery multi-task learning conflicting gradients arXiv",
    "orthogonal weights modification continual learning Zeng Nature Machine Intelligence",
    "experience replay continual learning catastrophic forgetting rehearsal arXiv Rolnick",
    "catastrophic forgetting large language models fine-tuning empirical study arXiv",
    "Adam-NSCL null space continual learning CVPR gradient projection memory Saha ICLR",
    "projecting fine-tuning gradient orthogonal to pretraining replay gradient language model mitigate forgetting arXiv"
  ],
  "entries": [
    {"title": "Gradient Episodic Memory for Continual Learning", "authors": "Lopez-Paz, Ranzato", "year": 2017, "venue": "NIPS 2017", "relation": "anticipates", "url": "https://arxiv.org/abs/1706.08840"},
    {"title": "Efficient Lifelong Learning with A-GEM", "authors": "Chaudhry, Ranzato, Rohrbach, Elhoseiny", "year": 2019, "venue": "ICLR 2019", "relation": "anticipates", "url": "https://arxiv.org/abs/1812.00420"},
    {"title": "Orthogonal Gradient Descent for Continual Learning", "authors": "Farajtabar, Azizan, Mott, Li", "year": 2020, "venue": "AISTATS 2020 (PMLR v108)", "relation": "method_overlap", "url": "https://proceedings.mlr.press/v108/farajtabar20a.html"},
    {"title": "Gradient Surgery for Multi-Task Learning", "authors": "Yu, Kumar, Gupta, Levine, Hausman, Finn", "year": 2020, "venue": "NeurIPS 2020", "relation": "method_overlap", "url": "https://arxiv.org/abs/2001.06782"},
    {"title": "Continual Learning of Context-dependent Processing in Neural Networks", "authors": "Zeng, Chen, Cui, Yu", "year": 2019, "venue": "Nature Machine Intelligence", "relation": "method_overlap", "url": "https://arxiv.org/abs/1810.01256"},
    {"title": "Gradient Projection Memory for Continual Learning", "authors": "Saha, Garg, Roy", "year": 2021, "venue": "ICLR 2021", "relation": "method_overlap", "url": "https://arxiv.org/abs/2103.09762"},
    {"title": "Training Networks in Null Space of Feature Covariance for Continual Learning", "authors": "Wang, Li, Sun, Xu", "year": 2021, "venue": "CVPR 2021 (oral)", "relation": "method_overlap", "url": "https://arxiv.org/abs/2103.07113"},
    {"title": "Hidden Failure Modes of Gradient Modification under Adam in Continual Learning, and Adaptive Decoupled Moment Routing as a Repair", "authors": "Hu, Yu, Cheng, Liu, Song", "year": 2026, "venue": "arXiv preprint", "relation": "method_overlap", "url": "https://arxiv.org/abs/2604.22407"},
    {"title": "Mitigating Forgetting in Continual Learning with Selective Gradient Projection", "authors": "Singh, Dhaulakhandi, Chopade, Malipati, Martinez, Zhu", "year": 2026, "venue": "IJCNLP-AACL 2025 SRW", "relation": "method_overlap", "url": "https://arxiv.org/abs/2603.26671"},
    {"title": "Experience Replay for Continual Learning", "authors": "Rolnick, Ahuja, Schwarz, Lillicrap, Wayne", "year": 2019, "venue": "NeurIPS 2019", "relation": "domain_overlap", "url": "https://arxiv.org/abs/1811.11682"},
    {"title": "Overcoming Catastrophic Forgetting in Neural Networks", "authors": "Kirkpatrick, Pascanu, Rabinowitz, et al.", "year": 2016, "venue": "arXiv preprint (journal version PNAS 2017, not fetched)", "relation": "domain_overlap", "url": "https://arxiv.org/abs/1612.00796"},
    {"title": "An Empirical Study of Catastrophic Forgetting in Large Language Models During Continual Fine-tuning", "authors": "Luo, Yang, Meng, Li, Zhou, Zhang", "year": 2023, "venue": "arXiv preprint", "relation": "domain_overlap", "url": "https://arxiv.org/abs/2308.08747"},
    {"title": "Orthogonal Subspace Learning for Language Model Continual Learning", "authors": "Wang, Chen, Ge, Xia, Bao, Zheng, Zhang, Gui, Huang", "year": 2023, "venue": "EMNLP 2023 Findings", "relation": "domain_overlap", "url": "https://arxiv.org/abs/2310.14152"},
    {"title": "Revisiting Replay and Gradient Alignment for Continual Pre-Training of Large Language Models", "authors": "Abbes, Subbaraj, Riemer, Islah, Therien, Tabaru, Kingetsu, Chandar, Rish", "year": 2025, "venue": "arXiv preprint", "relation": "domain_overlap", "url": "https://arxiv.org/abs/2508.01908"}
  ],
  "novelty_boundary": "The projection operator is not claimable: A-GEM (2019) is the same conditional projection against the average replay-memory gradient for the same anti-forgetting purpose, GEM (2017) established the replay-gradient constraint, and Adam-NSCL (2021) already projects the Adam candidate update rather than the raw gradient. The lab's claim is the stricter conjunction of: one global projection of the AdamW displacement over all trainable weights against the mean gradient of six frozen replay-validation windows; projection as candidate construction only, with authority reserved to direct functional evaluation under a frozen prospectively registered 2% cumulative replay ceiling; a deterministic, fully replayable, hash-pinned 4.85M-parameter C11 micromodel run with joint weight and AdamW-moment commit/restore; and the empirical result that this direction change reopened the quantity-learning path that scalar continuation (EXP-003/Q2.5) could not, with 700/700 full-scale commits.",
  "authority": "review"
}
```
