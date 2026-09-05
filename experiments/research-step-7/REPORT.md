# Research step 7: FERAL targets tied to the supplied evidence

The new target version keeps all 1,147 IDs and every model message. It
repairs fourteen empty targets: eleven numeric answers with declared units,
and three cases that call for abstention. The other 1,133 targets retain
the published exact-answer rule. The original score remains 168/1,147.

## What failed in the source review

The previous audit established that all fourteen source programs reproduce
their stored execution values. That proves arithmetic agreement. The next
review checked the question and the evidence supplied to the model.

| Case | Finding | Version 2 treatment |
| --- | --- | --- |
| CE 2016, page 19 | The question asks for R&D cost growth from 86 to 119. Its program returns half of 119, or 59.5. | Use `(119 - 86) / 86 * 100`, about 38.37%. |
| AES 2002, page 128 | The question repeats 2003. The supplied amounts mix rental expense and lease commitments, with a further continuing-operations distinction. | Abstain. |
| HIG 2011, page 53 | The supplied rows give reserve totals. The requested years and the program's asbestos-reserve increases occur outside those rows. | Abstain. |
| ETR 2016, page 23 | The supplied gain and net-revenue amounts have an unresolved inclusion and tax basis. | Abstain. |

The [target patch](TARGET-PATCH.json) records every reviewed question, evidence
ID, context digest, source-program value, calculation, unit, and reason.
These labels reflect a model review of opened data. The retained 1,133
published labels have their earlier review scope.

## Scoring and the old-output audit

Reviewed numeric answers are rounded to two decimal places in the requested
unit, with ties away from zero. Percent markers and explicit unit objects
carry defined conversions. Bare values use the requested unit. Percentage
changes keep their sign, including negative declines. Explicit abstention
phrases and JSON null are recognized. Empty text remains an invalid answer.

Applied to the existing frozen predictions, version 2 scores **172/1,147**:

- 168 correct on the 1,133 retained targets;
- 3 correct on the 11 numeric repairs; and
- 1 correct abstention among the 3 evidence gaps.

The four additional matches come from target and parsing changes. The model
outputs are the original frozen bytes. This audit includes the full row
count, the reviewed subset, answer coverage, and all 100 issuer groups.
The [manifest](MANIFEST.json) binds the output files and every input source.

## Use the version

```bash
python3 scripts/feral_targets_v2.py \
  --feral-repo /path/to/runner-watch \
  --finqa-source /path/to/frozen-finqa-test.json \
  --out-dir /tmp/feral-finqa-targets-v2

python3 scripts/feral_targets_v2.py \
  --score-dir /tmp/feral-finqa-targets-v2 \
  --predictions /path/to/predictions.jsonl
```

The output directory contains a model input file, a separate grader target
file, and a manifest. The model file holds only the original messages and
row metadata. Calculations, review notes, and expected answers stay in the
grader files. Scoring verifies both file hashes against the frozen manifest
and requires the exact ordered prediction roster.

Tests cover unit factors, finite numbers, rounding boundaries, abstentions,
source changes, evidence selection, preserved messages, full denominators,
spoofed prediction-side gold answers, and a coupled target/manifest change.
The next FERAL step is an evidence-only retrieval-and-calculator control,
followed by a frozen comparison in the approved cloud environment.
