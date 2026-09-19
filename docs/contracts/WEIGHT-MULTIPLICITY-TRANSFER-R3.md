# Statement of Work — Verified-Oracle Weight-Multiplicity Transfer

**Revision 3 — Final execution copy**

## 1. Research outcome

The primary deliverable is a trained, verified-oracle research model and a reproducible answer to this question:

> Can a small model trained on exact weight-multiplicity examples transfer to unseen ranks and to non-dominant weights at those ranks?

A conjecture or theorem may emerge as a byproduct, but neither is a project target or acceptance condition.

A clean negative result is a completed and accepted deliverable. Scientific success is not required for commercial acceptance.

## 2. Initial task and exact-output range

Given:

- a finite crystallographic root system;
- an irreducible representation with dominant highest weight \(\lambda\); and
- a target weight \(\mu\);

predict the exact integer weight multiplicity \(m(\lambda,\mu)\).

The contractual exact-match range is:

\[
0 \leq m(\lambda,\mu) \leq 31.
\]

The gated strata are:

- multiplicity 0;
- multiplicity 1;
- multiplicity 2–7; and
- multiplicity 8–31.

Each stratum contributes 25% of every stratified decision partition.

Cases with multiplicity greater than 31 are excluded from training and decision gates. They remain in unstratified evaluation samples and are reported separately as out-of-range cases. The natural-distribution report will state:

- the fraction of examples within the 0–31 range;
- exact match conditional on being within range; and
- end-to-end exact match, counting out-of-range cases as incorrect.

Weight multiplicity is the only learning task in this SOW. Tensor products, branching rules, and conjecture generation are excluded.

## 3. System responsibilities

- **ilXyr:** experiment control, frozen specifications, evidence custody, evaluation, decision enforcement, and reproducibility.
- **Zero:** exact symbolic oracle interface and structural verification.
- **Research models:** three independently seeded full-input models trained against the frozen oracle corpus.
- **Shortcut baseline:** one restricted-input null model.
- **NSRL:** integer-model feasibility assessment only. An integer implementation is not part of Phase 0/1.

Zero’s existing Cartan work is a symbolic C11 verifier, not a learned model. It validates finite crystallographic Cartan matrices and related classifications. It is evidence that the oracle side is technically grounded; it is not prior evidence of learned weight-multiplicity transfer.

## 4. Phase 0 — oracle frontier and frozen protocol

Phase 0 determines whether the experiment fits the measured CPU, memory, label-yield, and wall-clock envelope before corpus generation or training begins.

### 4.1 Oracle frontier

The oracle will be measured by:

- Lie family and rank \(r\);
- highest-weight height \(h\), defined as the sum of Dynkin labels;
- target-weight depth;
- multiplicity stratum;
- dominant or non-dominant target status;
- oracle implementation;
- reference hardware; and
- safe parallel worker count.

Each frontier cell receives 100 stratified, uncached queries.

A cell passes only if:

- every query returns an exact integer without error;
- repeated executions are byte-identical;
- p95 latency is at most 1.0 second per query;
- peak incremental memory is at most 2 GiB per worker; and
- no query crashes or times out.

The frontier deliverable will include:

1. \(h_{\max}\) for every measured family-and-rank pair;
2. one conservative common boundary \((r^\*,h^\*)\);
3. measured mean, p50, and p95 latency;
4. safe parallelism;
5. observed acceptance rates for each gated multiplicity stratum;
6. the projected number of oracle calls needed to obtain the required accepted records;
7. projected oracle CPU-core-hours;
8. projected oracle wall-clock time; and
9. the exact boundary beyond which the per-query budget is exceeded.

The frontier will be measured through rank 8 and heights 1–8 where feasible.

If the planned Phase 1 partitions do not fit inside the measured frontier, Phase 1 will not begin without a signed scope revision.

### 4.2 Oracle-generation budget

The corpus plan contains **458,750 accepted labeled records**, not 458,750 guaranteed oracle calls. Candidate rejection, including rejection of multiplicities above 31, may require additional calls.

Phase 0 will estimate generation cost from:

- measured mean latency by frontier cell;
- observed stratum acceptance rates;
- the planned mixture of cells;
- safe parallel throughput; and
- corpus validation and retry overhead.

The cost report will provide an expected value and a 95% confidence interval for:

- total oracle calls;
- total CPU-core-hours; and
- elapsed wall-clock time.

The binding Phase 1 oracle budget will be the upper 95% estimate plus a 15% operational margin. That measured budget will be frozen and approved at the end of Week 2.

Corpus generation will stop and report if it reaches the frozen limit. It will not silently continue beyond the approved CPU or wall-clock budget.

A p95 per-query latency is a frontier constraint, not an estimate of total expected cost.

### 4.3 Frozen protocol

Before data generation, ilXyr will freeze and hash:

- coordinate conventions;
- generator versions and seeds;
- family and rank splits;
- height and depth limits;
- the exact label range of 0–31;
- dominant and non-dominant sampling proportions;
- target-coordinate coverage rules;
- orbit de-duplication rules;
- full-model and shortcut-baseline configurations;
- evaluation programs;
- ACR-1 and ACR-2 manifests; and
- all decision thresholds in this SOW.

## 5. Corpus and evaluation distributions

Training families and ranks:

- \(A_1\)–\(A_5\)
- \(B_2\)–\(B_5\)
- \(C_3\)–\(C_5\)
- \(D_4\)–\(D_5\)

Held-out classical ranks:

- \(A_6\)–\(A_8\)
- \(B_6\)–\(B_8\)
- \(C_6\)–\(C_8\)
- \(D_6\)–\(D_8\)

Held-out exceptional types:

- \(G_2\)
- \(F_4\)
- \(E_6\)
- \(E_7\)
- \(E_8\)

### 5.1 Dominant and non-dominant training inputs

Within each training and development multiplicity stratum:

- 75% of target weights will be dominant; and
- 25% will be non-dominant weights at the training ranks.

Non-dominant examples will be sampled across:

- number of negative coordinates;
- coordinate-magnitude bands; and
- classical families and training ranks.

The non-dominant examples establish familiarity with negative target coordinates. They do not directly teach orbit equality:

- no orbit annotations are supplied;
- no Weyl words or dominant representatives are supplied; and
- at most one target from any \((\text{type},r,\lambda,W\mu)\) orbit may appear across training, development, and model-selection data.

Non-dominant inputs at unseen classical ranks remain blind and are used by ACR-2.

ACR-2 transformed coordinates must fall within the scalar coordinate-magnitude envelope established by the training-rank non-dominant corpus. A case outside that frozen envelope is rejected from ACR-2 rather than counted as a model error.

### 5.2 Planned accepted records

- Training: 300,000 stratified records
- Development: 30,000 stratified records
- Blind in-range: 30,000 stratified records
- Blind in-range, unstratified: 30,000 records
- Cross-rank: 24,000 stratified records
- Cross-rank, unstratified: 24,000 records
- Exceptional: 2,500 stratified records, 500 per type
- Exceptional, unstratified: 2,500 records, 500 per type
- ACR-1: 3,750 records
- ACR-2: 12,000 additional transformed records

Total: **458,750 accepted records**.

ACR-2’s dominant base cases are drawn from the existing cross-rank partition and are not counted twice.

### 5.3 Stratified distribution

The decision distribution is balanced equally across:

- multiplicity 0;
- multiplicity 1;
- multiplicity 2–7; and
- multiplicity 8–31.

This stratification applies to training and every stratified evaluation partition.

### 5.4 Unstratified distribution

Each main evaluation partition has a companion sample drawn from the same frozen generator without label balancing or rejection based on multiplicity.

Decision gates use the stratified, in-range results. Unstratified results are reported separately and prominently for the record.

## 6. ACR-1 — adjoint integrity procedure

ACR-1 is an integrity test, not evidence of structural transfer.

For the adjoint representation of each included simple type, it verifies that:

- every root has multiplicity 1;
- every doubled root has multiplicity 0; and
- the zero weight has multiplicity equal to the rank.

The set contains:

- 1,860 root queries;
- 1,860 doubled-root queries; and
- 30 zero-weight queries.

The expected score is **3,750/3,750** for each full model.

### 6.1 Failure procedure

ACR-1 runs before ACR-2 and the other blind decision evaluations.

An ACR-1 error immediately pauses evaluation for root-cause analysis. It does not automatically terminate the engagement.

If the cause is a reproducible integrity defect—including a coordinate conversion, serialization, evaluator, data-generation, checkpoint, or experiment-assembly defect—the following procedure applies:

1. record the failed version and evidence without alteration;
2. document the defect and proposed correction;
3. issue a new hashed experiment version;
4. repair and rerun all affected work within the approved resource limits; and
5. rerun ACR-1 before reopening blind evaluation.

No ACR-2, cross-rank, or exceptional labels may be inspected or used for tuning during the repair.

If the pipeline and checkpoint are clean and the model is genuinely wrong on the adjoint cases, the result is a Stop.

If a required repair cannot be completed within the approved schedule or resource envelope, the outcome is Rescope rather than an automatic scientific Stop.

## 7. ACR-2 — unseen-rank Weyl-invariance gate

For a finite-dimensional irreducible representation and any Weyl-group element \(w\),

\[
m(\lambda,\mu)=m(\lambda,w\mu).
\]

Weight coefficients of a character are invariant under the Weyl-group action, as reflected in the [SageMath Weyl Character Ring documentation](https://doc.sagemath.org/html/en/thematic_tutorials/lie/weyl_character_ring.html).

### 7.1 Construction

ACR-2 contains 12,000 held-out orbit pairs selected from unseen classical ranks:

- 3,000 pairs from each gated multiplicity stratum;
- one dominant base weight \(\mu\);
- one non-dominant orbit member \(w\mu\);
- unseen highest weights and ranks; and
- nontrivial Weyl elements sampled across four Coxeter-length bands.

Cases are rejected if:

- \(w\mu=\mu\);
- \(w\mu\) remains dominant;
- its multiplicity is greater than 31;
- its coordinates fall outside the frozen training coordinate envelope;
- either member duplicates another evaluation query; or
- orbit information is directly recoverable from an annotation supplied to the model.

At inference time, the model does not receive:

- the dominant representative;
- the Weyl word or action matrix;
- an orbit identifier;
- the paired input;
- the multiplicity; or
- oracle access.

### 7.2 Metrics and thresholds

For seed \(s\), define:

- \(D_s\): exact match on dominant base cases;
- \(N_s\): exact match on non-dominant transformed cases; and
- \(C_s\): prediction agreement within orbit pairs.

ACR-2 passes only if:

- median \(N_s\) is at least 85%;
- every seed has \(N_s\) of at least 80%;
- \(N_s\) is no more than 3 percentage points below \(D_s\) for every seed; and
- \(C_s\) is no more than 3 percentage points below \(\min(D_s,N_s)\) for every seed.

ACR-2 is in the Rescope range only if:

- median \(N_s\) is at least 75%;
- every seed has \(N_s\) of at least 65%;
- \(N_s\) is no more than 10 percentage points below \(D_s\) for every seed; and
- \(C_s\) is no more than 10 percentage points below \(\min(D_s,N_s)\) for every seed.

Anything below this range is a Stop.

## 8. Full models and shortcut baseline

### 8.1 Three full-input seeds

The three full models use:

- the same frozen architecture;
- the same corpus;
- the same optimizer and training budget;
- no seed-specific tuning; and
- no access to blind results during training or selection.

Only initialization, shuffle order, and other declared random processes may differ.

Each full model is limited to five million trainable parameters.

### 8.2 Restricted-input shortcut baseline

A fourth, fixed-seed model will be trained on the same training labels and evaluated on the same blind partitions.

Its inputs are restricted to:

- family;
- rank;
- highest-weight height;
- target depth; and
- the frozen scalar target magnitude \(|\mu|\).

The definition and normalization of \(|\mu|\) will be frozen in Week 1.

The baseline receives no:

- Cartan matrix;
- root set or positive-root data;
- root coordinates;
- highest-weight coordinate vector;
- target-weight coordinate vector;
- Weyl data; or
- orbit annotation.

It uses the same 32-label output contract. Its restricted encoder, optimizer, stopping rule, seed, and maximum capacity will be frozen before training. It may use at most one million trainable parameters and 100 CPU-core-hours.

The shortcut model is a null control, not a fourth member of the research ensemble. It is excluded from the three-seed disagreement calculation.

### 8.3 Shortcut-clearance requirement

Let:

- \(B\) be shortcut-baseline exact match on the stratified cross-rank partition; and
- \(R_s\) be full-model exact match for seed \(s\) on the same records.

A structural-transfer Pass requires:

- median \(R_s-B\) of at least 10 percentage points;
- every \(R_s-B\) of at least 5 percentage points; and
- a paired, representation-clustered bootstrap 95% lower confidence bound of at least 7.5 percentage points for the median advantage.

The bootstrap uses 10,000 resamples grouped by highest-weight representation.

If the point-margin requirements fail, the outcome is a Stop classified as **shortcut-indistinguishable**.

If the point margins pass but the confidence-bound requirement does not, the outcome is Rescope because the evidence does not establish a wide structural advantage.

The shortcut baseline will also be reported on the unstratified cross-rank partition for the record.

## 9. Resource limits

Per full-model seed:

- peak training memory: at most 16 GiB;
- training: at most 500 CPU-core-hours;
- median single-query inference: at most 40 milliseconds on the reference CPU; and
- no GPU-specific operations.

The three full models have a combined allowance of 1,500 CPU-core-hours. The shortcut baseline has a separate allowance of 100 CPU-core-hours.

CPU viability remains subject to Phase 0 measurement. No GPU may be used without written client approval and a change order.

## 10. Main decision outcomes

Classical transfer is measured on the stratified cross-rank partition using multiplicities 0–31.

| Outcome | Required result | Authorization |
|---|---|---|
| **Pass** | ACR-1 resolves with clean integrity; ACR-2 passes; classical cross-rank median is at least 90% and every seed is at least 85%; shortcut-clearance requirements pass; every exceptional type passes | Eligible for a full Phase 2 proposal |
| **Classical Pass / Exceptional Hold** | Classical, ACR-2, integrity, and shortcut-clearance requirements pass; one or more exceptional types are Hold or Fail | Authorizes a classical-only Phase 2 proposal. Exceptional work remains closed |
| **Rescope** | No scientific Stop occurs, but a metric falls inside its Rescope range, an integrity repair exceeds the current envelope, or shortcut point margins pass without sufficient confidence | Analysis and a revised proposal only; no additional training under this SOW |
| **Stop** | Clean-integrity ACR-1 failure; ACR-2 below its Rescope range; classical median below 75%; any classical seed below 65%; shortcut point-margin failure; leakage; or failure of the oracle/resource frontier | Project concludes with the negative-result package |

A classical exact-match score of **60% is a Stop**.

### 10.1 Exceptional per-type decisions

Each of \(G_2,F_4,E_6,E_7,E_8\) is judged separately.

The original point thresholds remain:

- median exact match across seeds: 70%; and
- every individual seed: 60%.

Each type receives representation-clustered bootstrap 95% confidence intervals, using 10,000 resamples, for the median and individual-seed metrics.

A type is classified as:

- **Pass:** every relevant confidence interval lies entirely above its threshold;
- **Fail:** at least one relevant confidence interval lies entirely below its threshold; or
- **Hold:** no metric is a clear Fail, but at least one confidence interval contains or crosses its threshold.

A near-threshold type therefore becomes Hold rather than being classified by a sampling coin flip.

Aggregate exceptional accuracy will also be reported, but it cannot conceal a per-type Hold or Fail.

## 11. Disagreement and curiosity eligibility

The primary disagreement score is Jensen–Shannon divergence among the three full-model predictive distributions.

Error-detection AUROC will be reported with a representation-clustered bootstrap 95% confidence interval using 10,000 resamples.

A later curiosity-driven Phase 2 may be proposed only if:

- AUROC is at least 0.65;
- its 95% confidence lower bound is at least 0.60; and
- the highest disagreement decile has at least 1.5 times the error rate of the lowest decile and an absolute increase of at least five percentage points.

This authorizes a proposal only. It is not part of the transfer Pass decision.

## 12. Schedule

**Week 1 — specification**

- Freeze schemas, partitions, label ceiling, coordinate rules, model contracts, shortcut baseline, reference hardware, and evaluation rules.

**Week 2 — oracle frontier**

- Measure frontier, label yields, safe parallelism, expected calls, CPU cost, and wall-clock time.
- Freeze the binding Phase 1 oracle budget.
- Issue the go/no-go decision.

**Week 3 — corpus**

- Generate, validate, de-duplicate, seal, and hash all partitions.

**Weeks 4–5 — training**

- Train the three full models and the shortcut baseline.
- Record checkpoints, resource use, and traces.

**Week 6 — blind evaluation**

- Run ACR-1 first.
- After clean integrity, run in-range, cross-rank, shortcut, ACR-2, exceptional, unstratified, tail-coverage, and disagreement evaluations.

**Week 7 — decision and handoff**

- Reproduce results under ilXyr control.
- Issue Pass, Classical Pass / Exceptional Hold, Rescope, or Stop.
- Deliver code, models, evidence, data, and the final report.

## 13. Deliverables

The client receives:

- project-specific source code;
- oracle adapters and validation tests;
- frozen schemas and configurations;
- oracle frontier, label-yield, and cost report;
- generated corpora and manifests;
- all three final full-model checkpoints;
- the trained restricted-input shortcut-baseline checkpoint;
- shortcut-baseline cross-rank and unstratified results;
- paired shortcut-clearance analysis and confidence interval;
- training and evaluation traces;
- stratified and unstratified results;
- explicit out-of-range multiplicity coverage;
- per-type exceptional results and confidence intervals;
- ACR-1 integrity records, including superseded versions and repairs;
- ACR-2 manifests and results;
- uncertainty analysis with confidence intervals;
- ilXyr evidence records;
- final decision report;
- negative-result analysis where applicable; and
- an integer-model feasibility note.

## 14. Acceptance

Commercial acceptance is based on:

- delivery of the listed artifacts;
- successful integrity and replay checks;
- adherence to the frozen protocol and resource limits; and
- reproducibility of the reported decision.

A Pass is not required for acceptance. Rescope, Stop, and Classical Pass / Exceptional Hold are valid completed outcomes when supported by the required evidence.

## 15. Intellectual property

- Project-specific application code and trained model weights are assigned to the client.
- Generated corpora are delivered non-exclusively, subject to applicable upstream open-source licences.
- Cenetex retains its pre-existing ilXyr, Zero, and NSRL technology.
- Cenetex retains general methodology, schemas, evaluation patterns, and reusable harness designs.
- The client receives a perpetual licence to any retained component required to use the delivered project artifacts.
- Publication, patent filing, or public release requires a separate written agreement.

## 16. Exclusions

This SOW does not include:

- exact prediction for multiplicities above 31;
- tensor-product decomposition;
- branching rules;
- a multi-agent curiosity swarm;
- GPU training;
- an integer-model port;
- production deployment;
- theorem or conjecture guarantees;
- natural-language capability; or
- work beyond the seven-week Phase 0/1 engagement.

Any later phase requires a separate proposal and written authorization.
