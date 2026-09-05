# Research step 8: FERAL evidence-only calculator

The control now selects dated quantities from supplied evidence and shows
the arithmetic. Its predictor takes only the question and evidence. The input
adapter attaches the outer question ID after prediction. Each operand records
its source text, character span, year, series label, exact value, and unit.

The five-case smoke check uses cases already opened during the target review.
Both arms use the same selection. The calculator performs arithmetic; the
operand-only arm returns the final selected operand. The scorer opens the
target file after both arms have finished prediction.

| Opened case | Calculator | Operand only | Revised target |
| --- | --- | --- | --- |
| PNC: combined claims | 184 | 74 | 184 |
| CE: R&D growth | 38.37% | 119 | 38.37% |
| AES: repeated year | Abstain | Abstain | Abstain |
| HIG: missing dated evidence | Abstain | Abstain | Abstain |
| MAS: two return series | Abstain | Abstain | 111.97 percentage points |

The calculator matches four cases and uses four arithmetic operations. The
operand-only arm matches two cases. Each emits two numeric answers and three
abstentions. These cases shaped development. A fresh comparison must measure
coverage and correctness across its entire frozen roster.

## Failures retained

MAS remains a coverage failure. Version 1 aligns years within a single series;
the question compares two series at one date with a shared initial investment.
A later version needs a declared rule for that relationship and tests on fresh
examples. The failure enters the shared ledger as a limit of this control.

The first development smoke also missed CE's sentence. The amount parser
consumed a space before its optional unit, so it left “million” outside each
amount. The parser now captures that unit and the regression test checks the
full year-value pairing. This repair belongs to development; the saved result
binds the final code.

Lexical overlap chooses the series. The arithmetic trace makes that choice
reviewable, while target correctness still depends on choosing the right
meaning. The full comparison should separate wrong selection, unsupported
question form, missing evidence, wrong arithmetic, and rendering errors.

## Reproduce

The [plan](PLAN.md) freezes five operations and the selection rules.
The [result](RESULT.json) contains the five model inputs, grader targets,
both output traces, and source digests. Its checker replays the predictor and
scorer, verifies the reviewed context hashes, and checks the target revision.

```bash
python3 scripts/test_feral_evidence_calculator.py
python3 scripts/research_feral_calculator_smoke.py \
  --check-result experiments/research-step-8/RESULT.json
```

To predict a small input prefix with the standalone control:

```bash
python3 scripts/feral_evidence_calculator.py \
  --inputs /tmp/feral-targets-v2/model-inputs.jsonl \
  --output /tmp/feral-calculator-smoke.jsonl \
  --arm calculator --limit 5
```

The output contains `id` and `prediction` fields accepted by the step 7 scorer.
A full scoring run requires the complete ordered roster. The full benchmark
belongs in a frozen cloud package with the model comparison and both target
score versions. Local checks cover synthetic behavior and these five opened
examples; operation counts describe arithmetic work rather than elapsed time.

This adds an executable baseline to the shared research question: when does
learned state reduce the work needed for a correct answer on unfamiliar inputs?
The next program step is to complete the matching baseline and candidate
packages for the other lines, then freeze a bounded cloud comparison.
