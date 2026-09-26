# FERAL v3 Stage A source screen

Date: September 26, 2026. Scope: issue #218 and the Stage A contract in
`docs/FERAL-7B-V3-XBRL-REGULATORY-PROPOSAL.md`.

## Observed real-source inventory

`REAL-SOURCE-AUDIT.json` is a reproducible audit of the existing step 47
source package. That package used fixed public FY2025 reports from Microsoft,
Apple, and Costco. Its earlier preparation tests and independent arithmetic
checker verified the selected tables and numeric targets. This audit checks
each selected fact against the saved source and table digests, table row and
column, reporting year, unit, and value declaration. It checks that every
opened evidence mapping resolves to a selected fact.

| Measure | Observed |
| --- | ---: |
| Real report families | 3 |
| Reviewed tables | 8 |
| Selected fact occurrences | 81 |
| Distinct normalized label and unit pairs | 13 |
| Source-linked row and column locations | 81 |
| Typed XBRL concept and context links | 0 |
| Verified fact byte spans | 0 |
| Opened question families and visible forms | 114 and 228 |
| Numeric and abstention targets | 164 and 64 |
| New independent wording pairs | 0 |
| Recorded Stage A reviewer minutes | unavailable |
| Learned selector runs on this source view | 0 |

The three reports are real sources. The 228 questions are prior development
material. They include authored paired wording and designed evidence faults.
They do not form a fresh Stage A test. The fact locations bind a report digest,
a table digest, a row, and a column. The saved record does not bind an XBRL
concept/context identity or a byte span for each occurrence. The source
package also contains 13 label and unit pairs. A frozen 60-concept taxonomy
catalogue, concept definitions, and reviewed extension coverage remain needed.

The existing synthetic BRAID fixture remains a separate development control.
It scored 11/11 source choices, with eight correct answers and three correct
abstentions. Its authored questions share the source format. That score
measures fixture handling.

## Stage A decision

The real-source inventory supports intake and audit development. It provides
three company families and 81 checked fact locations. The planned 60-concept
XBRL link screen and matched deterministic-versus-4B comparison await a frozen
BRAID XBRL release, occurrence links, and independent labels. Source-link
precision, recall, and the 100% accepted-finding resolution gate have no
Stage A denominator yet. The four-hour reviewer ceiling has no observed
review-time sample. A backbone recommendation stays pending.

The next source package should retain the exact BRAID release ID, manifest
digest, taxonomy release, filing source hashes, concept definitions, typed
facts and contexts, and occurrence byte links. Freeze the 60 concepts before
question work. Prepare 12 answerable and six abstention question families,
with one independently authored paraphrase per family. Keep answer labels with
the evaluator. Log active minutes for source selection, first labels, wording,
second review, and adjudication. Stop at 240 aggregate minutes and publish any
partial yield. Run a lexical top-5 and top-20 retrieval screen before selector
and model scoring. Score source/entity/period/unit/operation selection, link
precision and recall, complete link sets, answer coverage, abstention,
arithmetic, runtime, and cost separately.

## Candidate and spend envelope

The published prompting control is
`Qwen/Qwen3.5-4B@851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a`.
The Base adaptation candidate is
`Qwen/Qwen3.5-4B-Base@1001bb4d826a52d1f399e183466143f4da7b741b`.
The existing 7B control stays a separate comparison arm. A model worker needs
a verified Qwen3.5 text loader, rendered prompt, output parser, token allowance,
kernel path, model-file hashes, and immutable runtime image before a paid run.

The completed step 58 host preflight recorded $2.24208 per compute hour and
a $0.75 infrastructure reserve. At that historical rate, a 30-minute pilot
would have a $1.87104 before-tax envelope; a 60-minute ceiling would have a
$2.99208 envelope. These are planning calculations from the prior host,
not a current price or a FERAL v3 preflight. A fresh package and provider
price check must fix the actual ceiling before launch. No paid FERAL v3 run
occurred in this work.

## Reproduce

```sh
python3 -B scripts/test_feral_stage_a_audit.py
python3 scripts/feral_stage_a_audit.py --output /tmp/feral-stage-a-audit.json
cmp experiments/feral-source-selector/REAL-SOURCE-AUDIT.json /tmp/feral-stage-a-audit.json
```
