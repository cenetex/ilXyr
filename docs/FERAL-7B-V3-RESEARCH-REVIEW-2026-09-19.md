# FERAL v3 review: BRAID as the XBRL evidence layer

September 19, 2026. Recommendation and research design.

## Recommendation

**Yes. BRAID should compile and serve XBRL evidence.** Its reusable product is a
versioned filing package with typed facts, contexts, taxonomy relationships,
source locations, and clear coverage. FERAL supplies the question interpretation,
fact selection, tool requests, and explanation. ilXyr measures whether the learned
part earns its cost.

The first useful FERAL task is ordinary-language fact selection with an exact
calculation and a source passage. Numerical abstraction follows that comparison.
Tag review and regulatory disclosure coverage have their own tasks and labels.

The [revised proposal](FERAL-7B-V3-XBRL-REGULATORY-PROPOSAL.md) carries these
changes into its architecture, experiment order, and first package.

## Review scope

The workspace pass inspected recent local commit summaries across the immediate
repositories in `~/develop`, starting September 12. The detailed review followed
the relevant work in ilXyr, BRAID, Zero, and Runner Watch. Other active projects,
including Crownless, Signal, and the research substrates, helped locate related
work. This was a targeted research and design review.

The ilXyr and BRAID main references were refreshed from GitHub. The proposal uses
ilXyr `68861d4e` and BRAID `4b8c3db8`. A local ilXyr research branch had a different
program page and chronology, so current main supplied the FERAL record. The Zero
and Runner Watch observations below describe inspected local commits. Their
results are upstream records; this review performed source inspection rather
than rerunning the experiments.

The online pass followed primary papers and official standards. Each entry below
states its use and scope. Academic results motivate experiments; FERAL's own
held-out results determine its decisions.

## What recent work changes

| Evidence inspected | Finding | Consequence for v3 |
| --- | --- | --- |
| [FERAL step 51](../experiments/research-step-51/REPORT.md) | V2 answered 77/82 canonical numeric questions and 0/82 paraphrases; required abstentions were correct in 63/64 cases | Measure wording robustness and mistaken answers separately |
| [FERAL step 53](../experiments/research-step-53/REPORT.md) | Strict identity checks solved 22 invented wording cases but lost all three older numeric answers | Add source-supported aliases, table context, and prose baselines |
| [Q3.5](experiments/Q35-RESULT.md) and [Q3.6](experiments/Q36-RESULT.md) | Expanded heads stayed at 20%; the raw linear reference scored 41.6%; a later sparse centroid diagnostic scored 42% | Compare simple fitted readouts before attributing failure to a representation |
| [BRAID architecture](https://github.com/cenetex/braid/blob/4b8c3db8e0b04c3e4aba97027b3e976a4e63ee48/ARCHITECTURE.md) | Canonical releases, representation views, source bindings, and training exposure already have contracts | Extend these contracts for XBRL |
| [BRAID SEC worker](https://github.com/cenetex/braid/blob/4b8c3db8e0b04c3e4aba97027b3e976a4e63ee48/src/sec/service.ts) | Selected filings resolve to their primary document URLs; Company Facts is archived separately | Add complete package dependency collection and per-feature coverage |
| [BRAID holdout analysis](https://github.com/cenetex/braid/blob/4b8c3db8e0b04c3e4aba97027b3e976a4e63ee48/scripts/holdout-gates.ts) | Sealed joins validate IDs and hashes; pass, fail, and abstain have explicit denominators | Apply the same discipline to FERAL views and selective accuracy |
| [Zero B4](https://github.com/atimics/zero/commit/2fbe91a54398e5f28268b5e3cb70ff3d96ebf9ba) | The copy path was aligned with the actual memory source and target span | Check whether each supervised action can see and name its source |
| [Runner Watch](https://github.com/atimics/runner-watch/commit/29bbfd14c9eaa1e09ea5e8b3f47a70c1a3298ed1) and its recent filing changes | Filing navigation and cached financial screens are active consumers | Use a second reader client as a reuse check; measure cache identity and query cost |

The transfer from Zero is a design inference. Game dialogue and financial
reporting have different labels, risks, and data. Its useful lesson is the
alignment between visible evidence, target supervision, and the action that
copies or selects that evidence. Q3.6 likewise supports a diagnostic method;
its centroid result describes one sample and readout.

BRAID's [Crownless audit record](https://github.com/cenetex/braid/blob/4b8c3db8e0b04c3e4aba97027b3e976a4e63ee48/artifacts/crownless-audit-v2/README.md)
also distinguishes reconstructed context from historical model input. FERAL
should save actual predictor-visible bytes at execution time. A later rebuild
can then be compared with the original receipt.

## Academic research and its implications

| Primary source | Evidence and scope | Design use |
| --- | --- | --- |
| [FiNER, ACL 2022](https://aclanthology.org/2022.acl-long.303/) | Studies numeric tagging with 139 labels; context and number tokenization affect performance | Test small context-aware tagging references and value representations |
| [FNXL, Findings ACL 2023](https://aclanthology.org/2023.findings-acl.219/) | Extends numeric labeling to 2,794 labels | Report rare-concept performance and candidate recall |
| [Parameter-efficient instruction tuning, NAACL 2024](https://aclanthology.org/2024.naacl-long.410/) | Uses metric metadata and LoRA for financial numeral labels | Treat lightweight adaptation as an empirical reference |
| [FinTagging v5, May 2026](https://arxiv.org/html/2505.20650v5) | Separates numeric extraction and full-taxonomy concept linking; uses retrieval followed by reranking | Score extraction, retrieval, and selection individually |
| [XBRLTagRec v1, March 2026](https://arxiv.org/abs/2603.25263v1) | Combines tag-document generation, semantic retrieval, and reranking on FNXL; arXiv lists IJCNN 2026 | Compare a small ranker with the fixed 7B selector |
| [FinAuditing v3, May 2026](https://arxiv.org/html/2510.08886v3) | Contains 1,102 cases over semantic, relational, and mathematical tasks; targets derive from DQC messages | Separate rule discovery from guided replay and protect target-bearing messages |
| [AuditFlow v1, June 2026](https://arxiv.org/html/2606.03031v1) | Uses taxonomy and filing graphs, typed tools, and deterministic checks; evaluates 67 cases from three DQC families | Reuse the tool-environment idea and measure each component's added value |
| [Program of Thoughts v4, TMLR 2023](https://arxiv.org/abs/2211.12588v4) | Separates generated reasoning steps from executed numerical computation | Treat executable arithmetic as established prior art |
| [FinBalance v1, June 2026 preprint](https://arxiv.org/abs/2606.15949v1) | Generated document bundles support a replayable ledger; source linkage and final balances receive separate checks | Score source binding and calculation replay separately; keep synthetic results in their own cohort |

AuditFlow reports 55/67 joint-correct cases with GPT-5.5. Its deterministic-check
ablation is especially relevant, but the sample size, rule coverage, and model
setup bound the claim. FERAL needs its own comparison against a deterministic
selector and a small learned ranker. Multi-agent orchestration becomes a later
costed intervention.

FiNER's context result is relevant to tagging. Amount abstraction for financial
analysis is a separate claim: an absolute threshold, a small denominator, and a
currency change can each alter the answer. Keep exact values in the first
selection study. Later tests can identify which signals preserve which tasks.

The research contribution should be stated as a measurable question: can a
reusable evidence service and a compact selector improve supported answers on
fresh wording and context at a useful cost? Tool use, taxonomy graphs, LoRA,
and numerical execution each have substantial prior art.

## Standards and source fidelity

The [SEC API documentation](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
describes aggregate standard-taxonomy facts for the whole reporting entity.
Company Facts is useful for discovery and cross-checks. The complete filing
package supplies extension concepts, dimensions, and local report context.
The SEC's calendar frames use approximate calendar alignment, so fiscal dates
must remain explicit.

Use [OIM and xBRL-JSON](https://specifications.xbrl.org/work-product-index-open-information-model-open-information-model.html)
for the supported fact representation. Keep original files, source occurrence
maps, taxonomy edges, and diagnostics alongside that view. Pin a supported
feature profile and record incomplete dependencies. Taxonomy export and report
fact export have separate version identities.

Use [Arelle](https://arelle.readthedocs.io/en/latest/plugins/popular/validation.html)
as the first parser candidate with fixed plugins and configuration. Preserve
the enabled check set in each release. [Calculations 1.1](https://www.xbrl.org/guidance/adopting-calc1-1/)
provides rounding-aware consistency behavior. Wider formulas and missing-fact
coverage need named procedures and explicit inputs.

The earlier regulatory sections remain a roadmap with dated sources. The first
package tests financial evidence selection. A later requirement package must
bind the relevant legal text, dates, applicability, and reviewer rubric.

## Critique of the original proposal

### 1. Put context selection first

The original first decision compared abstracted signals with exact values.
The latest FERAL error happens earlier: selecting a different index can produce
valid arithmetic over the wrong facts. The revised first decision compares
selectors on the same candidates and evidence, then measures retrieval across
the full pipeline.

### 2. Give BRAID a reusable contract

The original architecture grouped ingestion and the fact store inside the
application. BRAID already owns source releases and representations. Extend it
with `XbrlEvidenceRelease` and `XbrlEvidenceView`. FERAL can then change its model
or retrieval policy while retaining the same source evidence.

The first reader should support local replay. A hosted endpoint follows a
measured workload. Each response must identify its fixed source release and
coverage. Training packs and application queries use separate views with shared
provenance.

### 3. Make the XBRL package complete

Primary filing HTML is only one dependency. Collect the document set, extension
schemas, linkbases, and pinned taxonomy packages. Retain context, unit,
dimensions, lexical values, scale, sign, decimals, nil, duplicates, and
continuations. Report source coverage before claiming a complete fact view.

### 4. Make evidence visibility part of each task

A filed tag helps answer a fact-lookup question. The same tag reveals the target
in a new-tag prediction test. A validator message can similarly expose the
expected answer in an error-discovery task. Store the full source package in
BRAID, then compile task-specific predictor and evaluator views. Inspect all
channels, including identifiers, tool errors, caches, and metadata.

### 5. Strengthen supported-answer scoring

A trace can point to real numbers from the wrong index. Require the requested
entity, concept, period, unit, dimensions, operation, and supporting context to
match. Source-ID checks, semantic support, arithmetic, and final rendering have
their own outcomes. Independent expected facts check the meaning; replay checks
the implementation and saved bytes.

### 6. Use fresh families and confidence bounds

The opened three-company test supplies regression cases. Fresh evaluation needs
new source families and independent wording. Keep variants together in both
splits and uncertainty estimates. Count source families as independent samples;
repeated passes estimate runtime variation.

Report wrong numeric answers among required-abstention cases, answerable-case
coverage, and joint correctness. A small feasibility set establishes mechanics.
Final sample size follows the chosen error bound and paired effect. A narrow
non-inferiority margin needs enough independent issuers to resolve it.

### 7. Separate the product stages

The first package serves financial facts and source context. Tag review follows
reviewed concept labels. Requirement coverage follows reviewed applicability
rules. The longer pilot can then address cybersecurity, ESEF, and other regimes
with a clear cost and evidence basis for each step.

## The first package to build

1. **BRAID source adapter:** ten fresh filing families, complete dependency
   manifests, a fixed Arelle setup, source-linked facts, and explicit coverage.
2. **Shared evidence reader:** exact fact and context lookup, typed relationship
   queries, bounded concept search, and deterministic replay. A second client
   reconstructs the same bundle.
3. **FERAL selector comparison:** strict v3, lexical/context rules, a small
   learned ranker, and fixed 7B. Use the same fact candidates and exact engine.
4. **Fresh feasibility roster:** 50 reviewed source questions and independently
   written paired wording. Split source families before label work. Keep old
   FERAL questions in a separate regression set.
5. **Decision report:** joint correctness, retrieval recall, coverage, mistaken
   answers, uncertainty, and full query cost. Size the later acceptance study
   from the observed family structure and the frozen decision margin.

These are proposed deliverables. This revision changes the research plan.
Acquisition, model execution, and hosting each follow their implementation
package and measured cost.
