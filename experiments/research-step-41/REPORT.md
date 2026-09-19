# ZERO.4: fresh tests and a retention coverage limit

The new task and language inputs are prepared and verified. The retention audit
found two sources that need a new evaluation design. The foundation file has
one eligible validation window, which is already exposed. Every eligible Blake
window shares tokens with the Q2.6 default evaluation. A complete five-method
comparison still needs fresh retention inputs and a fixed execution package.

| Prepared input | Cases | Selection checks |
| --- | ---: | --- |
| Quantity training | 4,750 | 950 per operation |
| Quantity public validation | 250 | 50 per operation |
| Quantity promotion | 500 | 100 per operation |
| BLiMP grammar | 1,005 | 15 per paradigm |
| TinyStories language | 1,000 | Separate stories and checked window overlap |

All 5,500 quantity answers pass the pinned native parser and exact arithmetic
kernel. The full selection replay matches every row, rank, rejection and token.
Six controlled changes to saved data are rejected, even when their file hashes
are updated. The eleven focused tests pass locally. Linux and Mac CI also pass
the eleven tests, including 201 opened native arithmetic cases and three altered
answer or request cases. The full schema suite and Pages checks pass.
New model calls and new paid instances are both zero.

## Repeated problems in the earlier splits

The reconstructed Q2.6 input matches all five published corpus hashes. Its
10,500 rows contain 9,690 distinct problem keys. There are 810 repeated rows
and 120 keys that occur across split names. Training and validation share 62
keys; training and promotion share 57; validation and promotion share three.
Some keys occur in all three splits, so those pair counts overlap.

For example, `quantity.convert 596 kg-to-g` occurs at training rows 13, 3543
and 8903, and at promotion row 333. The old split labels and file hashes remain
preserved. These findings narrow the earlier claim that promotion problems
were disjoint from training problems.

The new key treats swapped addition or multiplication operands as the same
problem. It reduces rational operands and sorts them. It divides a linear
equation's coefficient, offset and right side by their common divisor. It
keeps the conversion value and units. Equal answers alone remain distinct
problems. [PLAN.json](PLAN.json) fixes these rules and the seed before fresh
selection, in commit `51228755626a6db12bf22a44b74950acfa32cc05`.

The exclusion set includes the old Q2.6 corpus and the 120 opened retention
smoke rows. Together they contain 9,796 keys across 10,620 rows. Fresh selection
retains 8,603 candidate decisions: 5,500 accepted, 2,149 rejected for an earlier
key, and 954 rejected for a key already accepted in the new set. The accepted
set has zero shared keys across its splits or with these earlier corpora.

The training token file contains training followed by public validation. Its
5,000 records retain the native 95 percent split, so 4,750 records train and
250 records validate. Promotion has a separate file. The model chooses an
operation from a canonical command. The controller binds its arguments and
the exact kernel commits its answer. This test measures that specific routing
and final-answer behavior.

## Fresh language cases

The preparation reuses the pinned upstream normalization code. It reproduces
the earlier full BLiMP, TinyStories and BLiMP screen file hashes before selecting
fresh rows. [INPUTS.json](INPUTS.json) binds the source downloads and all
reconstructed historical data files.

The grammar screen draws 15 cases from each of the 67
[BLiMP paradigms](https://github.com/alexwarstadt/blimp/tree/3e56b06fcabca9b30822fc66435fca6b1aa40bb1).
It excludes the 1,000 earlier screen cases and the 64 calibration cases: 1,062
distinct IDs in their union. It also excludes shared sentences after case and
spacing normalization. Selection rejects 15 earlier IDs and one shared
sentence before reaching 1,005 cases. Each accepted pair retains two distinct
sentences after normalization.

The story screen uses the pinned
[TinyStories validation source](https://huggingface.co/datasets/roneneldan/TinyStories/tree/f54c09fd23315a6f9c86f9dc80f725de7d8f9c64).
It excludes all 1,000 earlier story IDs and duplicate full-story text. It also
checks exact 64-character overlaps between normalized windows. The same checks
apply within the new set. Selection rejects 54 earlier stories and 14 windows
that share such text with the earlier screen. The 1,000 accepted windows range
from 312 to 512 characters; 50 are shorter than 512, as allowed by the fixed
preparation rule.

These freshness claims cover the declared screen and calibration history.
Prior teacher training and semantic similarity remain separate coverage
questions. The next comparison needs a new frozen-teacher baseline on these
exact cases, with outcome and uncertainty rules fixed before model evaluation.
The earlier absolute language thresholds belong to their earlier cases.

## What the retention audit found

All six original replay token files match their historical hashes after
reconstruction with the pinned native encoder and dialogue builder. The
following counts use the union of Q2.6's default sampled start positions.
The sentinel uses two windows per source and full evaluation uses eight.
The first window is included in that union.

| Source | Eligible validation starts | Starts outside that union | Windows sharing zero tokens with that union |
| --- | ---: | ---: | ---: |
| Foundation | 1 | 0 | 0 |
| Shakespeare | 267,107 | 267,099 | 259,931 |
| Blake | 2,778 | 2,770 | 0 |
| Crowley | 12,026 | 12,018 | 4,850 |
| KJV | 207,994 | 207,986 | 200,818 |
| Literary dialogue | 4,857 | 4,849 | 4,818 |

Foundation contains 1,406 tokens. Its native validation suffix has 513 tokens,
which supplies one 512-token context and its next-token targets. The native
sampler requires at least 1,026 tokens in each plain-text input file. Two
separate files of that size would require more text than this source contains.

Blake shows a second failure of file-level or start-position checks: thousands
of unused starts still yield windows that share evaluated tokens. The other
four rows show positional capacity for further work. Their counts are upper
bounds for fresh content, since identical text elsewhere still needs checking.
Dialogue is built from Shakespeare, Crowley and Blake, so its content also
shares those sources' history.

[RETENTION.json](RETENTION.json) preserves both the initial four-window
diagnostic and the Q2.6 default union. The plan's initial four-window field was
an audit count; inspection later established the actual Q2.6 defaults. Other
historical schedules and teacher-training exposure require a further audit.
This step produces a retention coverage report.

## Failures and next decision

The first preparation wrote integer-valued rational answers with a denominator
of one. The native check rejected that spelling. The repair uses the kernel's
integer form. The failed source, prepared answers and process receipts remain
in private custody. All selected task keys and language rows stayed fixed.

A manual byte-to-token reconstruction also disagreed with three historical
source hashes. The pinned native encoder's UTF-8 normalization recovered the
exact original files. [FAILURES.json](FAILURES.json) preserves these failures,
the earlier split overlap and both retention coverage limits.

Q2.9's later language failure remains central: its replay training proxy passed,
while TinyStories measured 2.5797352564366838 bits against its declared
2.553139779957201 limit. The next five-method design must measure task skill,
retained source capability and language separately.

The next ZERO.4 move is to define a fresh retention source or an explicit
window rule for foundation and Blake, then check content overlap across all
six sources. That design must preserve the older source scores. After it is
fixed, the full controller can bind the five methods, teacher lineage, source
limits, final-answer rules, language baseline, total work and cloud budget.

The shared program now treats input selection as evidence. Reasoner keeps
family exclusions and work-count checks. Solomon keeps document exclusions
and whole-process costs. ZERO.4 adds equivalent-problem checks and token-overlap
limits. FERAL retains setup and capacity failures while its calculator can
advance on fresh cases. Weight multiplicity retains its first resource-limit
failure and its prepared cloud package. Each line needs a clear answer to the
same question: what useful result transfers to unfamiliar inputs, and what
work does the complete system spend to obtain it?

## Reproduce

[KIT.json](KIT.json) identifies the source archive. The three raw downloads use
the URLs and hashes in `INPUTS.json` and the names in `scripts/zero4_fresh_data.py`.
With those files in `raw`, unpack the kit and run:

```sh
python3 scripts/zero4_fresh_data.py prepare --source source --raw raw --out prepared
python3 scripts/zero4_fresh_data.py check --out prepared
python3 scripts/check_zero4_data_attacks.py --prepared prepared --out failure-checks
```

Use a fresh output directory for each attempt. The preparation saves child
process receipts, source hashes, complete candidate decisions and native answer
checks. Public records contain compact results and hashes. Prepared data and
failed attempts stay in private custody.
