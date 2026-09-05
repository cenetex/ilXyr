# Research step 13: runnable FERAL comparison package

The next FERAL comparison now has a frozen source/input archive for the base
model, calculator, and operand-only control. The package preserves all 1,147
inputs and the exact step 7 target bytes. The extracted package reproduced the
earlier five-case control results with its grading files removed during
prediction.

| Opened case | Calculator | Operand only | Version-two target |
| --- | --- | --- | --- |
| MAS: two return series | Abstain | Abstain | 111.97 percentage points |
| AES: repeated year | Abstain | Abstain | Abstain |
| PNC: combined claims | 184 | 74 | 184 |
| CE: R&D growth | 38.37% | 119 | 38.37% |
| HIG: missing dated evidence | Abstain | Abstain | Abstain |

The calculator matches 4/5 and the operand-only control matches 2/5. Both
produce two numeric answers and three abstentions. These five cases shaped
development. Model inference and the complete benchmark remain cloud work.

## Failure preserved

MAS remains a coverage failure. The fixed selector aligns years within one
series; this question compares two series. The raw control trace retains the
abstention. Keep it in the denominator of the full comparison.

A new synthetic probe also exposes an answer-extraction failure. At runner-watch
commit `4f2a40d3ad7372e2a5620cf3657959d4b1cac4cf`, the legacy FinQA parser
turns `Evidence is missing for 2020.` into the answer `2020`. It does the same
for an unfinished JSON object whose last number is that year. The new parser
records both as invalid and keeps the complete response.

The probe also retains duplicate-answer and extra-field cases, a valid decimal,
and an explicit abstention. Its results describe six synthetic fixtures. The
historical prediction artifact contains extracted answers, so the historical
frequency of these parser failures remains unknown. The historical 168/1,147
score and 172/1,147 target rescore retain their original interpretation.

## What the package fixes

Every arm emits raw answers through the same strict JSON boundary. FinQA prose
and yes/no answers remain supported. The grader reparses raw responses and
checks complete input order, file digests, arm identity, and package identity.
An incomplete arm retains its full expected count, completed prefix, error,
and observed cost. Primary accuracy requires the full ordered roster.

The [plan](PLAN.md) fixes the model revision, input view, generation settings,
scoring rules, and remaining cloud preparation. [MODEL-FILES.json](MODEL-FILES.json)
pins the 14 files of Qwen2.5-7B-Instruct revision
`a09a35458c702b33eeacc393d103063234e8bc28` using the publisher's file inventory.
Their total size is 15,242,807,270 bytes. Local preparation verified the small
files; full weight verification belongs to model staging in the cloud.

The worker records model verification and loading, per-question prediction,
process CPU, and invocation time including package verification. The outer
cloud controller still needs to capture environment setup, process startup,
peak memory, hard termination, grading, storage, and billed cost. The saved
local timing fields have engineering scope.

## Reproduce

The archive source is ilXyr commit
`2740590921ac1124b3a407116bb57ffdd76ed043`. The full archive contains
1,566,720 bytes with SHA-256
`27a64e6f0b60691d3f9d4c40fdaec19cc9ae6934d8293df23b3886379aaa5202`.
Its package manifest SHA-256 is
`486afd3e27d8d6856283c27f695d513be72edb0f3fd780a5c3844bba73554b0b`.

```bash
python3 scripts/package_feral_comparison.py \
  --repo /path/to/ilxyr \
  --revision 2740590921ac1124b3a407116bb57ffdd76ed043 \
  --feral-repo /path/to/runner-watch \
  --inputs /path/to/materialized-feral-targets-v2 \
  --out /tmp/feral-comparison-v1.tar
python3 scripts/test_feral_comparison.py
npm run test:schemas
```

Adding `--smoke` builds the five-case archive. [RESULT.json](RESULT.json)
records both archive identities, the six parser probes, 13 source bindings,
and the control results. The full archive reproduced byte for byte after an
uncommitted worker edit. Existing archives and run outputs survived overwrite
attempts unchanged. All ten new checks and the schema suite passed locally.
The model API and GPU execution await validation in the frozen cloud runtime.

## Next moves across the program

| Line | Prepared move | Next question |
| --- | --- | --- |
| Reasoner | Six matched arms and a reproducible source archive | Does semantic guidance beat the lexical control on fresh families? |
| Solomon | Fixed-answer confidence controls and exact Brier scoring | Which component improves answers on a fresh corpus? |
| ZERO.4 | Five retention arms and complete-answer scoring, in review | How much does projection help at equal measured work? |
| FERAL | This three-arm source/input package | Where does the base model beat fixed evidence selection and arithmetic? |
| Weight multiplicity | Revised resource policy and final p99 gate, prepared locally | Does the full corpus fit the measured tail and total-work bounds? |

All five lines now ask where learned state improves correct final answers
relative to a strong simple method. Keep probability quality and complete
cost as separate measurements. The next FERAL step is a cloud execution
wrapper with fixed machine, image, watchdog, storage, duration, and cost,
followed by a bounded run request.
