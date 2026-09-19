# Research step 8: evidence-only arithmetic control

Build a small deterministic control for FERAL's FinQA questions. The predictor
receives only a question and its supplied evidence. It selects a series by word
overlap, aligns quantities to the years in the question, and performs a fixed
operation. Every operand carries a source span, label, year, and unit.

Version 1 reads FinQA's serialized table cells and single sentences that align
amounts with years using “respectively.” Its operation list is signed change,
percentage change, ratio, sum, and average. Change questions must name a
direction with “from YEAR to YEAR.” Ratio uses the question's year order.
Sum and average use all distinct years named in the question. A shared unit
is required. Ambiguous series, conflicting values, missing years, zero
denominators, and other question forms produce an explicit abstention.

Select the series before checking year coverage. Rank series by the number of
distinct question words they share, then by the fraction of series words
matched. Ties call for abstention. This is a lexical control; its traces expose
the chosen meaning for later error review.

Run two arms on identical inputs. `calculator` executes the chosen operation.
`operand_only` returns the final selected operand. Both use the same parser
and selection. Keep answer coverage, selection work, and arithmetic work in
the output. Render numeric answers at two decimal places, with ties away from
zero, and retain a percent marker for percentage change.

First run a five-case smoke check drawn from the already opened target review:
MAS/2017/page_27.pdf-2, AES/2002/page_128.pdf-2,
PNC/2012/page_100.pdf-3, CE/2016/page_19.pdf-4, and
HIG/2011/page_53.pdf-4. Use the frozen step 7 model input bytes. Read targets
only after predictions are complete. Preserve failures by case and arm.
These cases shaped development, so this check establishes behavior on known
examples. It supplies no estimate of performance on fresh questions.

Use synthetic tests for changed operands, evidence order, tied series,
conflicting years, unit mismatches, signed values, and source-span replay.
A full comparison belongs in a frozen cloud package. Later comparisons must
freeze this control alongside the model, input order, target version, and
machine. Keep the original and revised target scores separate.
