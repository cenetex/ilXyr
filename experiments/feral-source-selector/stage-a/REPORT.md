# FERAL v3 Stage A: real iXBRL development screen

Date: September 26, 2026. Issue: [#218](https://github.com/cenetex/ilXyr/issues/218).
This is a development screen of evidence selection. An independent agent review checked the source/value labels and abstention
reasons. Independent paraphrase authorship remains pending.

## Frozen sources and view

The [source manifest](SOURCE-MANIFEST.json) names three public 10-K filing
families from Caterpillar, IBM, and Walmart. IBM's incorporated financial
statements are a second document in the same accession. Every raw file has a
fixed URL, byte count, and SHA-256. The raw filing bytes stay outside Git.
The manifest also fixes the official 2025 US GAAP schema and standard-label
linkbase. Rebuilding requires exact bytes at those hashes.

The study intake resolves the issuer CIK, period, dimensions, unit definition,
scaled numeric value, and exact iXBRL element byte span. It records excluded
occurrences. The 60-concept catalogue consists of 20 named common concepts
and 40 concepts in lexical order from the common undimensioned current-period
set. It is fixed in [EVIDENCE.json](EVIDENCE.json). Each catalogue item has the
official standard label and the schema's type, period, and balance fields.
These are structural fields and labels. A separately reviewed semantic
definition is still needed for a concept-link claim.

| Source family | US GAAP numeric occurrences | Parsed numeric | Selected in catalogue | Excluded |
| --- | ---: | ---: | ---: | ---: |
| Caterpillar | 3,216 | 2,712 | 488 | 504 |
| IBM | 2,976 | 2,721 | 431 | 255 |
| Walmart | 1,148 | 1,117 | 279 | 31 |
| **Total** | **7,340** | **6,550** | **1,198** | **790** |

The excluded counts include 34 unresolved occurrence tags and 756 unsupported
values or transforms. The saved evidence view has 1,198 selected numeric
occurrences, including distinct reporting contexts and source byte spans.
A source span points to the exact tagged occurrence. It does not certify a
semantic link from a statement label to the taxonomy concept. That link type
has a separate pending review and denominator.

## Questions, labels, and control

[QUESTIONS.json](QUESTIONS.json) has 18 question families and 36 visible
forms: 12 answerable families and six required-abstention families. Each
family has two authored wordings. A second agent reviewed the wording. The second wording was authored
by the study author. The questions include wrong period, missing concept, wrong index
identity, missing dimension, missing daily cash series, and a prose-reason
request. [DRAFT-LABELS.json](DRAFT-LABELS.json) is separate from the
predictor-visible evidence and questions. It names exact values and occurrence
IDs. An independent agent checked these labels against the raw source bytes.

The lexical candidate screen found the required concept in the top five for
20/24 answerable forms and in the top 20 for 20/24. This result uses the
60-concept development catalogue. It is a retrieval diagnostic. Full-taxonomy
98% recall at 20 has its own later roster.

The context-aware deterministic selector got 36/36 complete answer or
abstention outcomes on these opened development forms. It answered 24 forms,
abstained on 12, and made zero incorrect assertions. It matched all 30 required answer-form support links and used exact decimal arithmetic for the three change families.
The link record has 30/30 true positives, zero false positives, zero
false negatives, and 24/24 complete answer link sets. These source links
use exact tagged-occurrence byte spans. The control was repaired after the questions were opened, so the score shows
development fit. It is not a held-out result or an added-value finding. Its
selection, source links, operation, answer, and abstention fields are saved
separately in [CONTROL-PREDICTIONS.json](CONTROL-PREDICTIONS.json) and
[CONTROL-SCORE.json](CONTROL-SCORE.json). Model runs on this view: zero.

## Next measurement

The same evidence and question bytes can feed a pinned 4B prompting worker.
Its outputs must use the selector prediction schema. The evaluator can load
candidate predictions after generation and keep draft labels out of the
predictor package. Preserve raw model tokens, invalid outputs, retries,
time to first token, whole-answer latency, peak memory, and total cost.
Freeze the runtime image, model files, loader, non-thinking prompt, output
allowance, worker limits, and maximum spend before a paid GPU run.

An independent agent review checked all 12 answerable families against
the raw filing bytes, occurrence IDs, concepts, issuers, periods, units,
scales, and arithmetic. It corrected the IBM cost-of-revenue wording and
the daily-cash abstention question. The agent also checked all six abstention causes against the visible view
and the underlying filing, including the rebased S&P 500 total-return chart
in Walmart's filing. This is an agent review of a development screen. Review time for this work should be recorded under the
four-hour aggregate ceiling. A fresh held-out filing/wording set is required
for a comparative claim.

## Replay

Place the raw files named in the manifest in a private source directory using
the manifest IDs as filenames. The file extensions are `.htm` for filings and
`.xml` for taxonomy files.

```sh
python3 scripts/feral_stage_a_build.py --source-dir /private/stage-a-source \
  --output /tmp/stage-a-evidence.json
cmp experiments/feral-source-selector/stage-a/EVIDENCE.json /tmp/stage-a-evidence.json
python3 -B scripts/test_feral_stage_a_study.py
```

The source builder verifies raw file hashes before parsing and checks every
selected occurrence's ID, concept, context, and unit against its exact
source tag. CI replays the compact evidence, labels, control, and score.

## Pinned 4B prompting package

[MODEL-INPUTS.json](MODEL-INPUTS.json) contains 36 label-free prompts.
Each exposes the same 60 concept names, official labels, period types, issuer
names, fiscal ends, and question text. The model selects issuer, concept,
fiscal year, and operation, or abstains. The shared resolver picks the
occurrence and computes the answer. This comparison measures
concept/entity/period/operation choice. The resolver owns occurrence choice.

[MODEL-PROFILE.json](MODEL-PROFILE.json) pins the published Qwen3.5-4B
checkpoint and the SHA-256 of every required file. The two weight shards
total 9,319,828,096 bytes. [MODEL-PACKAGE.json](MODEL-PACKAGE.json) binds the
label-free worker code and data. Its deterministic source archive has SHA-256
`0bf05aff266d1c9d303038f5a1e2e70ef942a92333d3d9d431451c206ff224bd`
and size 1,454,080 bytes. The archive stays in temporary local storage.
[MODEL-PREFLIGHT.json](MODEL-PREFLIGHT.json) lists the remaining GPU and
provider checks.

The previous FERAL host preflight priced compute at $2.24208 per hour.
A fresh public AWS catalogue fetch on September 26 confirmed that rate for
g6e.2xlarge in us-east-1. A one-hour ceiling plus $0.75 reserve reaches
$2.99208 before tax. The proposed bound is $3.00 before tax for one instance.
Model-file staging, GPU smoke, runtime image digest,
watchdog, and immutable output destination are still needed before launch.
The published 4B model has zero scored calls on this view.
