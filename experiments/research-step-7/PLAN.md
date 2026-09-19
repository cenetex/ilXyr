# Research step 7: FERAL target version 2

Keep the 1,147 input IDs, their order, and every model message from the
published FERAL FinQA run. Keep the original target file and the original
168/1,147 result. This is a diagnostic version of opened data.

Review the fourteen empty targets against the question and the evidence
actually supplied to the model. Eleven have numeric targets. Three call
for abstention because the supplied evidence leaves the question unresolved.
Store the review, source-program result, unit, and target calculation on the
grader side. The model input file contains only IDs, task, schema, and messages.

The other 1,133 targets retain the published exact-answer rule. Report their
score separately from the fourteen reviewed cases. The full denominator
stays at 1,147. Every prediction file must have that exact ordered roster.

For reviewed numeric targets, compare values rounded to two decimal places
in the requested unit, with ties away from zero. Bare numbers use the
question's requested unit. A percent marker declares percent units. An
explicit value/unit object permits the declared unit conversions. A numeric
answer must contain one finite value. Percentage changes retain their sign,
including negative values for declines. Abstention is JSON null or a short
explicit response: `insufficient_evidence`, `insufficient evidence`,
`insufficient information`, `unknown`, `cannot determine`,
`unable to determine`, or `cannot be determined`. Case, whitespace, and final
sentence punctuation are normalized.

Report the original score, retained-target score, numeric-repair score,
abstention score, answer coverage, and issuer counts. An audit of old outputs
measures the effect of the target revision. Fresh model comparisons use a
frozen cloud package with the same source, input order, and run conditions.

This version records three evidence gaps rather than filling them with an
unsupported number. It corrects the CE percentage-change formula. The RSG
percentage decline retains the source program's negative change. These unit
and parsing choices were reviewed on opened records and outputs.
