# Reasoner 4 opened-data review

This review follows the frozen v8 audit's `invalid_controls` decision. It reads
the audit's opened fit and held examples. It leaves the frozen package, probe,
thresholds, and decision intact. [DATA-REVIEW.json](DATA-REVIEW.json) binds the
two exact input files by SHA-256.

| Check | Fit | Opened held |
| --- | ---: | ---: |
| Rows | 60 | 60 |
| Rows with one exact declared operation | 60 | 60 |
| Rows with a label mismatch | 0 | 0 |
| Smallest number of examples that separate the declared role from its nearest rival | 5 | 4 |
| Surface pair count or capture mismatch | 0 | 0 |

Each split has ten rows per role. The held rows form 30 pairs across the two
surface grammars. Each pair gives the same 64 captured numbers after parsing.
An explicit checker compared all 16 observed outputs in each row with the six
declared point operations. Every row has exactly one matching operation. This
checker uses the named operations directly; it is a data check rather than a
learned Reasoner result. The pinned C evaluator replay already verified all
2,880 original outputs in the [v8 result](v8-run/RESULT.md).

The v8 learned probe reached 433,333 ppm held role accuracy. Its shuffled-label
95th percentile reached 366,667 ppm and crossed the frozen 300,000 ppm control
ceiling. The examples therefore carry enough observations to distinguish these
six declared operations, while this capture and probe combination failed its
frozen gates. This review alone cannot assign the failure to capture features,
probe fit, or their interaction.

The next small development check should use fit families only. It can compare
the existing raw-value capture with features that describe output changes
relative to both inputs. Keep the explicit operation checker as a reference
for example identifiability. Recheck grouped fit selection and shuffled labels
before freezing any successor. A later scientific comparison needs fresh
held-out families and its own frozen acceptance rule. The old held split is
now opened diagnostic material.

Reproduce the compact review from the repository root:

```sh
python3 -B scripts/test_reasoner4_data_review.py
python3 -B scripts/reasoner4_data_review.py \
  --output /tmp/reasoner4-data-review.json
cmp experiments/reasoner4-representation-audit/DATA-REVIEW.json \
  /tmp/reasoner4-data-review.json
```
