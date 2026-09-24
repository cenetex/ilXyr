# FERAL source selection: public development fixture

This is a small development check for [#218](https://github.com/cenetex/ilXyr/issues/218).
The fixture comes from BRAID main commit
`ecd3d52d5343cac2abc86f23abfdef743fd0c987` (BRAID PR #41). Its four
filings and eleven questions are synthetic. The source file has SHA-256
`6099210bfaaa89fe41480fcc88a52716b8a055244f752050191d362621a4efe2`.
The separate label file has SHA-256
`d89e56cf137d314f17d58b6f4b984e062dc4d29d5afd5e7bab972a1e22d2b54c`.
BRAID verifies every source hash, quoted byte span, label, and visible-source
set. This copy retains those exact bytes so the ilXyr control is replayable.

`scripts/feral_source_selector.py` is a context-aware deterministic control for
this small source format. It extracts source facts, checks issuer, year, filing
version, metric and unit, and abstains on unresolved conflicts. It reads only
`visible.json` to make predictions. The evaluator then reads `labels.json` and
scores source choice, operation, answer, coverage and incorrect assertions
separately. A candidate method can supply the same prediction schema through
`--candidate`; its score uses the same labels and visible-file hash.

```sh
python3 scripts/feral_source_selector.py \
  --visible experiments/feral-source-selector/fixture/visible.json \
  --predictions experiments/feral-source-selector/CONTROL-PREDICTIONS.json \
  --labels experiments/feral-source-selector/fixture/labels.json \
  --score experiments/feral-source-selector/CONTROL-SCORE.json
python3 -m unittest scripts/test_feral_source_selector.py
```

The deterministic control selects the labeled source and answer on 11/11
opened development requests. It correctly answers eight, abstains on three,
and makes zero incorrect assertions. These questions were authored with the
source format and are public development material. This result measures
fixture handling, not transfer to unfamiliar filings or wording.

The learned comparison remains a separate experiment. Use the same visible
bytes, source span requirements and exact calculator for both methods. Freeze
the model bytes, prompt, runtime, output schema, family split and spending
limit before a fresh comparison. Keep raw outputs, failures and costs.
The proposed real filing pilot in `docs/FERAL-7B-V3-XBRL-REGULATORY-PROPOSAL.md`
also requires the BRAID XBRL reader and reviewed filing labels.
