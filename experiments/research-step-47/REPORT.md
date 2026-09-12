# FERAL: fresh calculator coverage from fixed report tables

The next calculator test is prepared: 228 questions from 81 figures in eight
table families across three fiscal 2025 reports. There are 164 numeric targets
and 64 required abstentions. Each case has a paired question in plain English,
giving 114 pairs with identical evidence and targets. Fresh predictor calls
are zero. This step establishes the test inputs and scoring rules; measured
calculator coverage follows in a separate cloud comparison.

The nine preparation tests pass. CI downloaded the three fixed report copies
and reproduced every prepared file byte for byte. A separate JavaScript
checker verified the targets with exact rational arithmetic. The full local
schema suite and the first PR checks passed. [RESULT.json](RESULT.json) binds
these records. [KIT.json](KIT.json) identifies a portable source archive whose
unpacked contents passed the same preparation and arithmetic checks.

## Source selection and freshness

| Company | Fixed public report copy | Selected table families |
| --- | --- | --- |
| Microsoft | [2025 annual report](https://www.microsoft.com/investor/reports/ar25/) | Income, balance sheet, shareholder return |
| Apple | [2025 annual report](https://d18rn0p25nwr6d.cloudfront.net/CIK-0000320193/c636d8a7-8025-47d2-9b13-bcf5465343b3.html) | Income, balance sheet, shareholder return |
| Costco | [2025 company-hosted XBRL presentation](https://d18rn0p25nwr6d.cloudfront.net/CIK-0000909832/43af4132-72c7-4bb8-803f-06b8f0e13093.html) | Income, balance sheet |

[SOURCES.json](SOURCES.json) binds the complete report bytes, selected table
hashes, table and cell positions, year headers, and currency/scale passages.
Table spans use Unicode character positions after universal-newline decoding.
Every normalized evidence sentence maps back to its original cell. Monetary
tables use USD millions. Shareholder tables use dollar wealth from a shared
$100 base with dividends reinvested; return differences use percentage points.

The opened 1,147-case input contains 278 company/year document keys, ending in
2019. The new reports have zero document-key overlap and zero complete
question/evidence overlap with that input. Apple is present in both company
sets. [OPENED-AUDIT.json](OPENED-AUDIT.json) retains the earlier document keys
and normalized input fingerprints. The source kit independently rebuilds that
audit from the fixed earlier input.

Freshness therefore means fresh documents and complete inputs relative to the
opened comparison. The selection is a constructed coverage test with three
companies. Wider claims about companies, natural questions, and model training
exposure require separate evidence.

## Questions, exact targets, and fault cases

Codex authored fixed question templates and their plain-English variants
before any fresh predictor calls. Each family covers ten numeric forms:
lookup, ratio, percentage, signed excess, sum, and five two-year operations.
The two shareholder families also cover a cumulative-return difference.
All 228 cases belong to evaluation. Development uses invented tables and the
five previously opened cases.

Examples below are prepared gold targets, awaiting predictor results:

| Source and question | Exact result | Rounded target |
| --- | --- | --- |
| Microsoft: 2025 net income as a percentage of operating income | 636450/8033 | 79.23% |
| Apple: 2025 current assets minus current liabilities | -17674 | -17,674 USD million |
| Costco: operating income percentage change, 2024 to 2025 | 7320/619 | 11.83% |
| Microsoft versus S&P 500: cumulative-return difference, 2020 to 2025 | 981/25 | 39.24 percentage points |

Python computes targets as exact fractions. JavaScript recomputes them with
integer rational arithmetic. The scoring rule rounds half away from zero to
two decimals and checks the unit. A printed numeric answer must agree with its
reported exact result. Signed differences may be negative.

Each family has four evidence fault forms in both question styles: a missing
requested year, a missing requested series, an ambiguous label, and conflicting
values for one series/year. For the conflict case, the prior-year amount is
also presented under the requested year. Its mapping retains the original
fact and the explicit year-change operation. These are designed evaluation
challenges. Their future outcomes will record correct abstentions, incorrect
abstentions, and wrong numeric answers.

Predictor inputs contain only a schema, an opaque case ID, a question, and
supplied evidence. Targets, family labels, answerability, and fault labels
reside in separate grader records. Both question styles share the same
evidence and target within each pair.

## Failures and verification

The first Apple and Costco SEC downloads returned HTTP 403. Intake then used
the companies' public copies and fixed their exact bytes. Costco's investor
filing page links the selected XBRL presentation. Its two selected statement
families account for the eight-family roster. [FAILURES.json](FAILURES.json)
preserves the failed source requests and the chosen recovery.

The tests check source hashes, headers, transcribed values, source precision,
retrieval-fault mappings, earlier-input overlap, and target separation. One
probe changes a numeric target and rewrites its file inventory; the independent
arithmetic checker still rejects the altered target. Preparation also runs
with both calculator modules unavailable. These checks establish source and
target integrity before execution.

## Fixed comparison and shared method

[PLAN.json](PLAN.json) freezes calculator v1, calculator v2, and v2 operand-only
at their published source hashes. The full comparison uses 12 passes, one
worker, sorted case IDs, and rotating arm order. Each arm receives the same
cases in the same order. The controller has a 300-second limit, each child has
a 15-second limit, and logs and outputs have fixed byte ceilings.

For each question style, v2 must improve company-macro correct numeric coverage
by at least 10 percentage points over both references. Its wrong numeric
answer count must be at most each reference's count. All 64 required
abstentions must be correct, with complete outputs and valid source spans.
Results will include company, family, question-form, style, and fault breakdowns.
Preparation, worker, checking, and collection costs will be reported separately.
Analysis uses exact counts and paired changes within this fixed roster.

The immediate next step is the bounded three-control controller, tested on
invented fixtures. A fixed cloud host package and its cost follow. The
[FERAL v3 proposal](../../docs/FERAL-7B-V3-XBRL-REGULATORY-PROPOSAL.md) can use
this source-linked arithmetic baseline when it adds concept and context
selection. Its broader tagging tasks will need their own fresh examples and
grading rules.

The shared research question is becoming concrete: where does a learned
component improve a verified procedure at an acceptable total cost? Reasoner
tests proposal selection, Solomon tests compact learning, ZERO.4 tests retained
capability, weight multiplicity tests exact model structure, and FERAL tests
evidence selection. Each line benefits from a fixed simple reference, a fresh
test, independent checking, and a preserved account of failures.

## Reproduce preparation

From the source kit, run these commands in a fresh output directory:

```sh
python3 scripts/test_feral_fresh.py
python3 scripts/prepare_feral_fresh.py --source-dir raw --output rebuilt
node scripts/check_feral_fresh.mjs rebuilt EXPECTED_PREPARE_SHA256
```

Use `prepare_sha256` from [KIT.json](KIT.json) for the last argument. Compare
every file in `rebuilt` with the published `data` directory. The archive keeps
the raw reports and earlier input in local custody; Git contains the selected
facts, source locations, questions, targets, and compact verification records.
