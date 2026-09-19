# FERAL-7B v3: XBRL and Regulatory Compliance Tagging

## 1. Executive recommendation

Build FERAL-7B v3 as a financial analysis model with a structured evidence system. The model should learn how to select concepts, match reporting contexts, connect disclosures to requirements, and explain findings. A separate engine should preserve exact amounts, perform calculations, and run formal checks. The model should normally receive financial signals and evidence references, with exact values available through controlled requests.

The proposed first product is a review workspace for US public-company reporting. It has three connected jobs: explain financial changes, suggest or review XBRL tags, and assemble evidence against selected disclosure requirements. Start with annual Forms 10-K, US GAAP financial statements, cover-page information, and annual cybersecurity disclosures. Use a separate release path for European Single Electronic Format (ESEF) reporting and, later, bank regulatory reporting.

This is an architecture proposal and research plan. The evidence cutoff is September 12, 2026. Repository observations use main commit `6172f0329ab33b58c3ade6043daea9879eed0de1`, refreshed on that date. Dataset sizes, thresholds, schedules, and model settings below are proposed experiment choices. Performance claims are limited to the cited studies and recorded FERAL experiments.

The core hypothesis is that **concepts plus calculated signals provide enough information for many useful analysis tasks, while a precise engine owns numerical correctness**. A second hypothesis is that explicit links among requirements, disclosures, and checks improve review quality. Both hypotheses require comparisons on fresh filings with measured cost.

## 2. FERAL's starting point

The existing FERAL experiment identifies Qwen2.5-7B-Instruct as its base and defines SEC analysis training through Braid and the Runner Watch trainer. Its registered corpus has 228,110 training/validation examples, 44,704 future-evaluation examples, and 30,668 unseen-issuer examples. These counts describe registered releases. The v3 intake should separately measure how many examples retain filing identities, taxonomy references, usable source spans, and reliable task labels.[^1]

The recorded calculator work provides a useful design lesson. Calculator v1 selects dated values from supplied text and keeps source spans, units, and an arithmetic trace. On the opened five-case development set it matched four targets. On the full 1,147-case revised FinQA roster, it scored 24 correct: 21 numerical answers and three required abstentions. It answered 91 cases and abstained on 1,056. Calculator v2 later matched all five development cases through broader selection and operation rules.[^2][^3]

The larger result makes evidence selection and coverage central v3 research questions. A precise calculator becomes useful when the system selects the right series, period, unit, and operation. XBRL offers a stronger structure for these choices. The historical roster also gives an opportunity to measure whether structured evidence improves coverage on questions whose source filings can be recovered.

The recorded Qwen comparison reached runtime and capacity problems. Step 28 records GPU model loading followed by a Triton cache failure. Step 30 records a closed capacity window with twelve unsuccessful launch attempts. The inspected records therefore support conclusions about the controls and execution environment; comparative model quality remains an open measurement.[^4]

| Area | Existing FERAL record | Proposed v3 change |
| --- | --- | --- |
| Input | SEC text and question/evidence pairs | Filing package, taxonomy, selected text, rule package |
| Fact selection | Text-based series and dated quantity selection | Concept and context retrieval with explicit candidate ranking |
| Numerical work | Evidence calculator controls | Exact fact engine, derived signals, and rule checks |
| Learned task | Financial answer generation | Tag selection, evidence selection, tool requests, explanation |
| Evaluation | FinQA diagnostics and development cases | Fresh issuer, time, taxonomy, and requirement tests |
| Output | Prediction and calculation trace | Finding, evidence links, scope, rule version, and calculation trace |

Use `FERAL-7B v3` as the proposed system version. Record the base model, adapter, fact representation, and rule package as separate versioned components. This keeps a taxonomy update independent of a model training run.

## 3. Three meanings of tagging

**Financial fact tagging** connects a reported value or text block to an XBRL concept and its context. For a numeric fact, that context includes the company, reporting period, unit, and applicable dimensions. A revenue fact for a product segment and a revenue fact for the whole company represent different observations. XBRL's Open Information Model provides a common data model across supported serializations.[^5]

**Requirement tagging** connects a source passage to a specific regulatory provision. Each requirement needs an authority, jurisdiction, document location, effective period, applicability conditions, and evidence expectations. These are proposed FERAL records in an internal namespace. The application should clearly label the official XBRL identifier and the internal requirement identifier.

**Finding tagging** connects an observation to the evidence and procedure that support it. Useful finding classes include a technical validation issue, an unusual financial pattern, a likely concept mismatch, a disclosure coverage question, and a reviewer-confirmed conclusion. Every class has its own evidence standard.

These three layers answer different questions: what was reported, what applies, and what the evidence supports. Their links are many-to-many. One text block may address several requirements; one requirement may require facts from several documents.

## 4. Standards and regulatory scope

### SEC first release

Use complete filing packages as the primary source. The SEC Company Facts APIs provide convenient access to standard-taxonomy facts for the whole reporting entity. Custom concepts and detailed dimensional reporting need the underlying filings and taxonomy files. The SEC also warns that its calendar frames align facts approximately with calendar periods; company fiscal dates belong in the comparison logic.[^6]

Use the taxonomy versions declared by each filing. The SEC's March 2026 release added 2026 taxonomies, including Cybersecurity Disclosure (CYD), and described compatibility constraints among annual releases. A filing's reporting period, accepted taxonomy package, and accounting basis should all be recorded. Historical ingestion should resolve the release used at filing time.[^7]

Build the formal authority chain from the applicable regulations, form instructions, and incorporated filing requirements. Use the EDGAR XBRL Guide as staff implementation guidance. Its August 2026 edition explicitly directs filers to the EDGAR Filer Manual and identifies the guide's staff status. Store that distinction with every imported rule.[^8]

For the first narrative task, use annual cybersecurity disclosure. Item 106 covers risk management, strategy, board oversight, and management's role; paragraph (d) requires structured reporting. A useful pilot maps those separate obligations to short passages and relevant CYD facts. Keep the annual disclosure workflow distinct from incident reporting, which has separate triggers and timing.[^9]

### European expansion

ESEF is the closest next scope because it also uses Inline XBRL and financial taxonomies. The October 2025 reporting manual provides extension and anchoring guidance. Preserve wider/narrower relationships as such; an anchor expresses a relationship between concepts and requires its direction and scope.[^10]

ESMA published the 2025 ESEF taxonomy files and conformance suite in April 2026 for use in preparing 2026 reports. Its announcement describes entry points for IAS 1 and IFRS 18, with IFRS 18 effective from January 2027 and early application permitted. This is a concrete reason to select a package by accounting basis and reporting period.[^11]

EBA reporting is a later, separate domain. Its Data Point Model (DPM) organizes regulatory data and validation requirements; framework 4.2 completed the move to DPM 2.0 and the enhanced glossary. Module-specific dates and receiving-authority rules belong in their own package. The 4.3 page also distinguishes preparatory AMLA material from the later package intended for submissions.[^12][^13]

| Release | Included scope | Additional evidence needed |
| --- | --- | --- |
| v3 research pilot | US GAAP 10-K facts, selected DEI and CYD tags, Item 106 coverage | Filing bytes, reviewed mappings, dated rule sources |
| v3 review pilot | More industries, amendments, selected 10-Q comparisons | Fiscal-period alignment and broader reviewer labels |
| ESEF extension | IFRS reports, extension anchors, block tagging | ESEF package, national filing settings, multilingual tests |
| EBA extension | One selected reporting module | DPM release, legal basis, reference date, authorized reports |
| Broader compliance | A separately chosen business process | Operational records and process-specific ground truth |

A public filing supports analysis of disclosed information. Assessing how a company actually operates a control requires operational evidence, such as process records and audit work. The interface should name that evidence scope in every finding.

## 5. Related research and the contribution to test

FinTagging separates numerical entity extraction from concept linking over the full US GAAP taxonomy. Its reported difficulty in fine-grained linking supports a candidate-retrieval and ranking design. Public benchmark performance is useful for comparison; an independent filing set should support promotion decisions.[^14]

FinAuditing contains 1,102 annotated instances and evaluates semantic matching, relationship extraction, and mathematical reasoning across structured financial evidence. Its instances average more than 33,000 tokens. This supports testing whether retrieval can supply a compact, sufficient evidence set for a 7B model.[^15]

AuditFlow is especially close to this proposal. It connects taxonomy and filing graphs through typed tools, with language models directing search and deterministic tools performing verification. The authors report 55/67 joint-correct cases, or 82.09%, with GPT-5.5, versus 67.16% for the single-agent baseline. Their test covers 67 cases and three DQC rule families. Its narrow size, larger backbones, and multi-agent design make direct transfer to a 7B deployment an open question.[^16]

The proposed research contribution is therefore specific: measure how well a 7B model can perform financial and requirement analysis with exact values abstracted into task-relevant signals. Add dated requirement applicability and track the cost of every component. Compare one analyst model against optional escalation to a larger reviewer only after the single-model baseline is measured.

| Design | Strength | Main research question | Recommended role |
| --- | --- | --- | --- |
| Text retrieval plus 7B model | Simple continuity with FERAL | Evidence coverage and context selection | Baseline |
| Rules plus lexical retrieval | Cheap, traceable selection | Coverage of varied wording | Strong baseline |
| Structured retrieval, tools, and 7B model | Clear evidence and calculation boundaries | Added learned value per task | First v3 candidate |
| Custom graph neural network | Can learn relational ranking | Benefit beyond explicit graph traversal | Later ablation |
| New transformer trained from scratch | Full architectural control | Data, quality, and compute burden | Later research branch |

## 6. Recommended architecture

The first implementation should have six components: ingestion, a fact store, taxonomy retrieval, a requirement registry, a calculation/check engine, and a 7B analyst. Use ordinary database tables for durable records and edge tables for relationships. A graph database is an implementation option once query measurements justify it.

```text
Filing packages              Official rules and guidance
       |                                |
Parser and validation          Versioned requirement registry
       |                                |
Facts + text + taxonomy links -----------+
       |                                |
Exact calculations             Applicability and formal checks
       |                                |
Signals + source references + evidence coverage
                       |
                 FERAL-7B analyst
                       |
        Evidence requests and draft findings
                       |
        Trace checks and reviewer workspace
```

### Ingestion and validation

Use Arelle as the first parser and validation candidate. Pin its version, enabled plugins, disclosure system, taxonomy packages, and configuration. Its documentation describes both EFM and ESEF plugins and identifies additional EDGAR Renderer coverage for EFM validation. Record the exact checks enabled and their results.[^17]

Keep the original Inline XBRL document, extension schemas, linkbases, and any referenced report documents. Preserve the location of each fact in the human-readable report. Keep continuation chains, text-block content, transformations, sign, scale, decimals, nil values, and duplicate occurrences. Allow a source package to yield a partial ingestion record with explicit coverage fields.

Run ingestion with fixed network and file access, archive-size limits, and safe XML settings. Resolve public taxonomy dependencies through a controlled cache. Treat text in filings as evidence throughout retrieval and model use. These are proposed engineering controls for a service that processes outside documents.

### Fact identity and time

Use the namespace URI and local concept name for identity. Prefixes are display choices. Add taxonomy release, entity, period, unit, explicit or typed dimensions, filing accession, and fact occurrence. Preserve both the reported lexical value and a normalized decimal representation.

Maintain two time axes: the period described by the fact and the time the filing became available. A historical question uses an explicit availability cutoff. An amendment adds another source version. Cross-filing reconciliation records which version a query selected and why.

Group duplicate facts using their complete aspects. Preserve occurrence references and classify value consistency. Compare cumulative periods only through a declared derivation, such as a standalone fourth quarter derived from annual and nine-month values with matching accounting scope. Nil, missing, reported zero, and ingestion failure should have distinct states.

### Taxonomy retrieval and concept selection

Create a candidate index from concept labels, definitions, data types, period types, references, and local relationships. Retrieve candidates using words and embeddings. Filter on hard context constraints. Then let the model rank a small candidate set, cite the relevant definition, and state unresolved choices.

Preserve presentation, calculation, and dimensional relationships as separate edge types. Calculation edges carry weights and applicable contexts. Presentation edges carry ordering. Requirement links carry authority and version. Each edge type should have explicit permitted uses in retrieval and checking.

For an existing tag, the system performs review against surrounding evidence. For an untagged passage, it proposes a tag and context. Train and evaluate these as separate tasks. Keep issuer-provided tags as observed labels and expert-reviewed labels as adjudicated targets. SEC staff's 2026 observations of noninterest-income tagging and misuse of the Consolidated Entities axis supply concrete families for review tests.[^18][^19]

## 7. Numerical abstraction

The model's default input should preserve meaning at a controlled level of detail. A useful signal record contains the metric definition, matched context, direction, change size, historical position, uncertainty, and a pointer to its derivation. Industry comparisons require an explicit peer set and observation date.

Start with signed growth, margin changes, working-capital movements, cash conversion, and threshold distance. Define any words such as "moderate" or "large" in a versioned feature policy fitted using training data. Where numerical detail matters to interpretation, expose a normalized ratio or exact threshold result. Attach units to every numerical feature.

An illustrative input for revenue-quality analysis is:

```text
Scope: consolidated; comparable annual periods
Revenue: rising; training-defined moderate growth band
Receivables: rising faster than revenue
Operating cash flow: falling
Period match: verified
Evidence: fact references and relevant policy passages
Next available checks: acquisitions, payment terms, seasonality
```

The model should identify cash collection as a review topic and request evidence about plausible causes. A stronger causal statement requires supporting disclosure or other evidence. Every analytical claim retains its classification as observation, hypothesis, or supported explanation.

The exact engine should use decimal or rational arithmetic, explicit formula definitions, and unit checks. Adopt rounding-aware consistency logic where applicable. XBRL Calculations 1.1 improves rounded and duplicate fact handling, while its stated scope leaves incomplete fact sets and wider calculations as separate concerns. Record the check method and factual coverage with each result.[^20]

The decisive tests change values while holding tags fixed. A scale change should preserve conclusions only for tasks whose definitions are scale-invariant. A threshold crossing, sign reversal, or material ratio change should update the result. For legal thresholds and filing deadlines, the rule engine receives exact inputs and returns the comparison, applicable date, and remaining uncertainties.

A value-abstraction experiment also needs a leakage audit. Numbers can remain in text blocks, tables, tool results, titles, and question wording. Define which of those channels each experimental arm receives and inspect their serialized inputs before evaluation.

## 8. Regulatory requirement records

Create an internal requirement registry with one record per reviewable obligation. Each record should contain an official citation and a short paraphrase, plus structured fields for applicability. Preserve source text in a separately controlled reference store and keep an exact source location and hash.

| Field group | Proposed contents |
| --- | --- |
| Identity | Internal requirement ID, version, official citation |
| Authority | Binding rule, form instruction, staff guidance, industry check, or internal policy |
| Time | Publication date, effective date, compliance date, validity interval, supersession |
| Applicability | Jurisdiction, issuer class, form, period, event conditions, exemptions |
| Evidence | Required topics, permitted sources, linked concepts, coverage expectations |
| Procedure | Formal predicate or reviewer rubric, dependencies, engine version |
| Result | Applicability status, evidence status, check result, finding references |

Keep applicability separate from evidence sufficiency. A requirement can apply while the supplied evidence remains incomplete. Recommended applicability states are `applies`, `out_of_scope`, and `undetermined`. Evidence states are `sufficient`, `partial`, `missing`, and `conflicting`. Formal checks can return `pass`, `fail`, or `indeterminate`, each limited to the named test.

An LLM may propose a mapping from a rule to evidence. A reviewed rule package determines the formal predicate and its scope. Qualitative requirements use an explicit reviewer rubric with claim-level evidence. Keep model confidence separate from calibrated correctness estimates and evidence coverage.

The following is an internal design example, with illustrative evidence IDs:

```text
Requirement: feral:sec.item106.board_oversight
Authority: 17 CFR 229.106(c)(1)
Task: identify disclosure about board oversight
Applicability: selected domestic issuer's annual 10-K
Evidence: filing passage p17; associated CYD fact candidate
Evidence status: partial
Finding: reviewer should assess the described oversight process
Open question: how the board receives information
```

The mapping should preserve the provision's conditional wording and distinguish board oversight from committee-specific requirements. The record above illustrates a review task; implementing it requires a dated rule snapshot, a confirmed issuer/form profile, and reviewed CYD concept IDs.[^9]

For deadlines, make the triggering event an explicit input. For materiality, preserve the applicable standard and the evidence supporting a judgment. A sector percentile or an internal alert threshold should retain its own policy classification.

## 9. Tools and output contract

Give the model a compact set of typed tools. Each request should select permitted identifiers and operations. The service validates the request, runs the operation, and returns evidence references plus a structured status.

| Tool | Inputs | Result |
| --- | --- | --- |
| `find_concepts` | Description, taxonomy release, type constraints | Ranked concept candidates |
| `get_facts` | Concept IDs, company, period, dimensions, cutoff | Matching fact references and coverage |
| `get_passages` | Filing IDs, topic or requirement IDs | Source spans with document locations |
| `calculate` | Formula ID and fact references | Exact result, units, rounding, trace |
| `get_requirements` | Jurisdiction, form, issuer profile, date | Applicable candidates and source versions |
| `check_requirement` | Rule version, evidence IDs, context | Scoped result and unmet dependencies |
| `compare_filings` | Source versions and comparison policy | Changes with matching evidence |

The analyst produces a finding object before rendering prose. Require a claim, finding class, evidence IDs, context, calculation IDs where relevant, requirement IDs where relevant, and unresolved questions. The renderer resolves numerical references into exact values for a report. A trace check verifies that identifiers exist and that the cited calculation or rule result supports the rendered statement.

Start with at most six tool rounds and an 8,000-token evidence budget per question as experiment settings. Record truncation and retrieval coverage. Tune those settings on development cases, then freeze them before final testing. A larger evidence budget is a separate comparison arm.

## 10. Training plan

Use the existing Qwen2.5-7B-Instruct revision for the first matched comparison. The official model card identifies Apache 2.0 licensing. Choose a newer base in a separate backbone experiment once the representation effect is measured.[^21]

Begin with prompting and tools. Then train a LoRA adapter, meaning a small set of trainable additions to the base model. Proposed development settings are ranks 16 and 32, short context first, and one to two epochs. Select settings using development results and measured memory. Test a quantized deployment against the chosen full-precision reference on the same cases.

Create supervised examples for six tasks: selecting concepts, matching context, linking evidence to requirements, requesting calculations, deciding whether more evidence is needed, and writing short supported findings. The output target should include the tool action or final structured claim. Keep original amounts in the tool-side fact store for the abstraction arm.

The target model should learn the sequence "select evidence, check context, request a calculation, interpret the result." Training examples should also show how to stop with a specific evidence request when ambiguity remains. Use concise action traces that can be checked against the tools.

### Proposed pilot data

Collect up to 1,000 annual filings from roughly 200 domestic issuers across five industries. A smaller feasibility intake of 50 filings should establish actual parsing coverage and annotation effort first. Target 60 common financial concepts and about 20 reviewed requirement/check records in the pilot. The full taxonomy remains available during concept retrieval.

Plan for 20,000-60,000 training examples after extraction and review. Allocate an initial 30% to concept/context selection, 25% to requirement/evidence linking, 20% to tool use, 15% to supported explanations, and 10% to ambiguous or incomplete evidence. These are planning proportions; report the realized distribution and task overlap.

Use issuer tags and deterministic checks to propose labels. Have qualified reviewers adjudicate concept ambiguity and qualitative compliance cases. Audit a stratified sample across common concepts, extensions, industries, and error types. Double-review the primary test set and preserve disagreements with an explicit resolution rubric.

Synthetic mutations can test a wrong period, altered dimension, conflicting duplicate, changed scale, missing source passage, or crossed threshold. Keep each mutation's source family together during splitting. Record whether it tests arithmetic, retrieval, or regulatory interpretation. Evaluate natural and synthetic cases separately.

### Data custody and rights

Reuse FERAL's existing manifest and hash conventions. Preserve accession, retrieval time, source URL, taxonomy package, derivation, reviewer provenance, and split assignment. The existing Season 00 rights decision covers named releases and requires reconsideration for changed corpus or public use. Apply that existing project policy to the v3 intake and record source-specific terms for taxonomies and external benchmarks.[^22]

Keep raw filing text, derived examples, and released model artifacts as distinct distribution decisions. Use public benchmark code and data under their own terms. The research report and short source-linked examples can form the public proposal while corpus intake remains a separate implementation step.

## 11. Evaluation design

Run two experiments. The first measures representation with a fixed base model, retriever policy, tool budget, and underlying evidence. The second measures adaptation with the selected representation held constant. This separates the effect of structured input from the effect of training.

| Arm | Model input | Purpose |
| --- | --- | --- |
| R0 | Rules, lexical retrieval, and tools | Measure simple-system coverage and cost |
| R1 | Report text and calculator access | FERAL-style reference |
| R2 | Tags, context, relationships, and text with amounts masked | Measure concept-only information |
| R3 | R2 plus calculated financial signals | Primary abstraction hypothesis |
| R4 | R3 plus exact values | Measure the benefit of value access |
| T1 | Selected representation plus trained adapter | Measure training benefit |

R2 can use schema and context checks; its numerical tool responses should follow the defined amount-masking policy. R3 can access numerical derivations through approved signals. R4 receives the exact values. Each arm's policy must cover every input and tool channel. Record any other differences as explicit interventions.

Use fresh issuer and time splits with family-level deduplication. Keep all amendments, repeated facts, near-duplicate passages, and generated variants within their assigned source family. Hold out a later reporting window and a set of issuers. Add a separate test for new taxonomy concepts and changed rule applicability. Pretraining exposure remains a possible influence on public filings, so include post-cutoff sources and controlled counterfactuals where feasible.

A proposed final set has 1,200 cases: 300 concept/context cases, 300 numerical/relationship cases, 300 requirement/evidence cases, and 300 ambiguity or counterfactual cases. Freeze case identities, task labels, scoring rubrics, and operating thresholds before final evaluation. Increase the set if a critical slice has too few independent filings.

### Metrics and proposed gates

Report retrieval recall before model selection accuracy. For tagging, report top-1 accuracy, candidate recall, and full fact-context match, with separate extension and standard-tag slices. For compliance review, score applicability, evidence coverage, and each substantive claim. For calculations, score fact selection, operation, unit, value, and rendering separately.

| Gate | Proposed pilot threshold | Interpretation |
| --- | --- | --- |
| Trace integrity | 100% of accepted findings resolve to valid source IDs | Mechanical release check |
| Exact engine | 100% pass on fixed unit, period, rounding, and mutation tests | Tested-domain correctness |
| Concept retrieval | At least 98% recall at 20 candidates | Candidate coverage before ranking |
| Automatic tag suggestions | At least 95% precision at at least 50% coverage | Review workload tradeoff |
| Requirement findings | At least 95% supported-claim precision at at least 50% answerable-case coverage | Scoped review usefulness |
| R3 versus R4 | Accuracy loss at most 2 percentage points, with at least 20% fewer input tokens | Value of abstraction |
| T1 versus fixed-base R3 | At least 5 percentage points higher joint correctness, or at least 20% lower total cost at matched quality | Value of adaptation |

These thresholds are proposed decisions, not measured results. Set operating points on development data. Use paired confidence intervals with resampling by issuer or filing family. For the R3/R4 gate, require the lower confidence bound on their accuracy difference to exceed minus two percentage points. Report whether sample size gives enough precision for that decision.

A high precision score needs its coverage denominator. Report all cases, answerable cases, answered cases, and accepted findings. Include false acceptance of an unsupported conclusion, useful abstention, and cost per correct supported answer. Evaluate each critical rule family separately.

Have reviewers compare financial explanations blindly for evidence quality, useful prioritization, and appropriate treatment of causes. Measure review time and correction effort. Use machine scoring for replayable fields and a published rubric for judgment-based claims. A strong aggregate score should be accompanied by the weakest material slices.

## 12. Worked pilot cases

**Revenue quality.** Select comparable annual revenue, receivables, and operating cash-flow facts. The engine produces growth and conversion signals. The model explains the relationship, then requests acquisition and credit-policy passages. The scored answer distinguishes the observed pattern from a supported cause.

**Concept review.** Take a noninterest-income disclosure within the pilot's reviewed accounting scope. Present the original tag, relevant note passage, and candidate standard concepts with dimensions. The expected output identifies the suitable combination and explains its scope. The SEC's May 2026 observation provides the issue family; each benchmark answer needs its own filing-level review.[^18]

**Cybersecurity disclosure coverage.** Select a 10-K and the dated Item 106 requirement package. Retrieve evidence separately for board oversight, management roles, and information flow. Return a per-requirement evidence matrix with source passages and open questions. The rubric should preserve conditional clauses and allow partial coverage.[^9]

**Version change.** Present the same filing under two requested availability cutoffs or two expressly selected rule snapshots. The system should choose the corresponding facts and applicability state. Every output should identify the date used.

**Scale and threshold.** Multiply a financial statement's compatible monetary values by a common factor. Relative-margin analysis should stay stable. A separately defined absolute threshold test should change when the scaled amount crosses its boundary. This distinguishes useful abstraction from loss of necessary information.

## 13. Delivery plan and cost model

The proposed schedule is ten to twelve weeks for two engineers with part-time accounting and regulatory review. It is a planning estimate. The first two weeks should measure intake coverage, reviewer effort, and tool reliability, then revise the later estimates.

| Stage | Indicative timing | Deliverable and exit decision |
| --- | --- | --- |
| Source and task definition | Weeks 1-2 | 50-filing intake, authority matrix, reviewed examples, fixed pilot questions |
| Fact and rule engine | Weeks 3-4 | Replayable facts, retrieval, calculations, and scoped rule checks |
| Fixed-base comparison | Weeks 5-6 | R0-R4 development results and measured input savings |
| Adapter training | Weeks 7-8 | Frozen training set, selected adapter, task and retention results |
| Final evaluation | Weeks 9-10 | Sealed comparison, confidence intervals, error analysis, cost report |
| Review pilot | Weeks 11-12 | Reviewer workflow, correction study, release decision |

Start with the parser, retrieval, and exact engine because they establish what every model sees. Use one model worker before testing model teams. Separate startup checks from scored work and preserve failed processes in cost accounting. Existing FERAL execution and source-binding utilities are reusable foundations.[^1][^4]

Estimate training cost from measured tokens and throughput:

```text
training tokens = examples x mean tokens per example x epochs
GPU hours = training tokens / measured tokens per second / 3600
compute cost = GPU hours x current quoted hourly rate
total cost = compute + evaluation + storage + transfer + annotation
```

For illustration, 40,000 examples at 1,500 tokens for two epochs produce 120 million training tokens. At an assumed 1,000 training tokens per second, that is 33.3 GPU hours; at 2,000, it is 16.7 hours. These are arithmetic scenarios. A bounded calibration must establish actual throughput, memory, startup cost, and checkpoint overhead before pricing a run.

Measure end-to-end inference cost with parsing amortized separately, retrieval time, tool time, model input/output tokens, retries, and reviewer time. Give both a first-filing cost and a repeated-query cost. Annotation may dominate the pilot budget, so the feasibility intake should measure minutes per accepted label.

## 14. Failure handling and operating choices

| Risk | Design response | Required evidence |
| --- | --- | --- |
| Wrong concept with a plausible label | Candidate definitions, type filters, expert-reviewed difficult cases | Per-concept and extension accuracy |
| Mixed periods or dimensions | Complete aspect matching and declared derivations | Context mutation tests |
| Incomplete retrieval | Coverage records and targeted evidence requests | Recall and answerability results |
| Rounded values or duplicates | Method-specific checks and retained occurrences | Rounding and consistency suite |
| Stale requirement version | Dated source registry and supersession links | Effective-date boundary tests |
| Overstated compliance finding | Scoped finding classes and claim-level source checks | Supported-claim precision |
| Amounts leak into abstraction arms | Input serialization audit across all channels | Saved arm inputs |
| Synthetic examples are too easy | Separate natural-case testing and family splits | Natural/synthetic result tables |
| Learned layer adds cost | Matched rules and fixed-base controls | Cost per supported correct answer |

Keep the human workflow simple. Show the finding, the relevant source passage, the proposed concept or requirement, and the reason for review. Let a reviewer accept, correct, or request evidence. Save corrections as candidate training data with provenance and versioned review status.

An accepted filing, a technical validation result, and a compliance judgment are separate evidence records. The application should name which one it has. For formal calculations, the engine owns the result; for semantic adequacy, the reviewer rubric defines the acceptance standard.

## 15. Proposed first implementation package

The first engineering package should deliver an ingestion adapter, an internal fact schema, a concept index, a small dated requirement registry, the calculator interface, and 50 reviewed examples. It should include one replay command and a report of parsing coverage. The main acceptance question is whether each example can be reconstructed from the original filing and the selected source packages.

Proposed repository additions are an experiment directory for v3, schemas for facts/signals/requirements/findings, adapters around the current FERAL calculator and worker, and a dedicated evaluator. Keep existing experiment records intact. A v3 training package should identify its own dataset, tokenizer, base revision, adapter settings, runtime image, and evaluation roster.

The first research decision should be whether R3 retains enough quality relative to R4 while reducing evidence size. The second should be whether adaptation improves the selected baseline at an acceptable total cost. Expand regulatory scope after the first pilot has measured tag quality, requirement coverage, and reviewer value.

## Sources

All web sources were consulted on September 12, 2026. Regulatory sources support the stated pilot scope; implementation should bind the exact source edition and applicable date. Repository links below use the inspected commit. External URLs with changing content require a saved version at intake.

[^1]: ilXyr. [FERAL-7B training lab](https://github.com/cenetex/ilXyr/blob/6172f0329ab33b58c3ade6043daea9879eed0de1/docs/FERAL-7B.md). Repository snapshot, September 12, 2026. Base model, corpus counts, and experiment structure.
[^2]: ilXyr. [Research step 22: FERAL control results and model startup failure](https://github.com/cenetex/ilXyr/blob/6172f0329ab33b58c3ade6043daea9879eed0de1/experiments/research-step-22/REPORT.md). September 8, 2026. Full-roster calculator results and numerical-answer breakdown.
[^3]: ilXyr. [Research step 25: FERAL startup check and calculator v2](https://github.com/cenetex/ilXyr/blob/6172f0329ab33b58c3ade6043daea9879eed0de1/experiments/research-step-25/REPORT.md). September 8, 2026. Opened development results and next coverage test.
[^4]: ilXyr. [Research step 28](https://github.com/cenetex/ilXyr/blob/6172f0329ab33b58c3ade6043daea9879eed0de1/experiments/research-step-28/REPORT.md) and [Research step 30](https://github.com/cenetex/ilXyr/blob/6172f0329ab33b58c3ade6043daea9879eed0de1/experiments/research-step-30/REPORT.md). September 2026. Runtime failure and closed capacity window.
[^5]: XBRL International. [Open Information Model 1.0](https://specifications.xbrl.org/work-product-index-open-information-model-open-information-model.html), recommendation index, April 19, 2023; [XBRL essentials](https://specifications.xbrl.org/xbrl-essentials.html). Facts, concepts, dimensions, and common data model.
[^6]: US SEC. [EDGAR Application Programming Interfaces](https://www.sec.gov/search-filings/edgar-application-programming-interfaces). June 6, 2024. API coverage and frame alignment.
[^7]: US SEC. [2026 XBRL Taxonomies Update](https://www.sec.gov/newsroom/whats-new/2603-2026-xbrl-taxonomies-update). March 17, 2026. Taxonomy release, compatibility, and CYD availability.
[^8]: US SEC staff. [EDGAR XBRL Guide](https://www.sec.gov/files/edgar/filer-information/specifications/xbrl-guide-2026-08-14.pdf). August 2026, disclaimer and sections 1-3. Staff guidance status and filing context checks.
[^9]: Office of the Federal Register / eCFR. [17 CFR 229.106, Item 106: Cybersecurity](https://www.ecfr.gov/current/title-17/chapter-II/part-229/subpart-229.100/section-229.106). Page displayed Title 17 through September 10, 2026. Paragraphs (b), (c), and (d); US SEC staff, [Cybersecurity Risk Management, Strategy, Governance, and Incident Disclosure](https://www.sec.gov/resources-small-businesses/small-business-compliance-guides/cybersecurity-risk-management-strategy-governance-incident-disclosure), August 30, 2023. Annual and incident disclosure context.
[^10]: ESMA. [ESEF Reporting Manual](https://www.esma.europa.eu/sites/default/files/library/esma32-60-254_esef_reporting_manual.pdf). October 2025 update, sections 1.4 and 3.3. Extension and anchoring guidance.
[^11]: ESMA. [ESMA support ESEF implementation with updated taxonomy](https://www.esma.europa.eu/press-news/esma-news/esma-support-esef-implementation-updated-taxonomy). April 21, 2026. ESEF taxonomy, reporting period, and IAS 1 / IFRS 18 entry points.
[^12]: European Banking Authority. [FAQ for Reporting Innovations, release 4.0 and beyond](https://eba.europa.eu/sites/default/files/2025-11/f54ced05-870e-4dd0-a591-ecbcac2e32d4/faq_for_reporting_innovations_and_upcoming_releases_v2.pdf). November 25, 2025. DPM 2.0 transition and framework 4.2.
[^13]: European Banking Authority. [Reporting framework 4.3](https://eba.europa.eu/risk-and-data-analysis/reporting/reporting-frameworks/reporting-framework-43). Current framework page at access. Module dates and preparatory AMLA scope.
[^14]: Wang and colleagues. [FinTagging: Benchmarking LLMs for Extracting and Structuring Financial Information](https://arxiv.org/html/2505.20650v5). May 17, 2026 revision. Extraction and full-taxonomy concept linking.
[^15]: Wang and colleagues. [FinAuditing: A Financial Taxonomy-Structured Multi-Document Benchmark for Evaluating LLMs](https://arxiv.org/abs/2510.08886v3). May 17, 2026 revision. Dataset scope, task classes, and context length.
[^16]: Wang and colleagues. [AuditFlow: Executable Symbolic Environments for Structured Financial Reporting Verification](https://arxiv.org/html/2606.03031v1). June 2, 2026. Sections 3-4 and limitations: tool architecture, 67-case evaluation, and three DQC families.
[^17]: Arelle project. [Validation Plugins](https://arelle.readthedocs.io/en/latest/plugins/popular/validation.html). Current documentation at access. EFM, EDGAR Renderer, ESEF, and configuration coverage.
[^18]: US SEC staff. [Common Noninterest Income Tagging Errors](https://www.sec.gov/data-research/structured-data/common-noninterest-income-tagging-errors). May 14, 2026. Standard concept plus dimension selection and cross-statement consistency.
[^19]: US SEC staff. [Inappropriate Use of Consolidated Entities Axis](https://www.sec.gov/data-research/structured-data/inappropriate-use-consolidated-entities-axis). March 19, 2026. Context and entity-scope tagging errors.
[^20]: XBRL International. [Adopting Calculations 1.1](https://www.xbrl.org/guidance/adopting-calc1-1/); [Calculations 1.1 specification index](https://specifications.xbrl.org/work-product-index-calculations-2-calculations-1-1.html), recommendation February 14, 2024. Rounded values, duplicate facts, and scope limits.
[^21]: Qwen team. [Qwen2.5-7B-Instruct model card](https://huggingface.co/Qwen/Qwen2.5-7B-Instruct). Current model card at access. Model identity and Apache 2.0 license.
[^22]: ilXyr. [FERAL-7B SEC Season 00 rights review](https://github.com/cenetex/ilXyr/blob/6172f0329ab33b58c3ade6043daea9879eed0de1/docs/FERAL-7B-RIGHTS-REVIEW.md). Repository snapshot, September 12, 2026. Existing project scope and corpus-change requirements.
