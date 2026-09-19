# FERAL-7B SEC Season 00 rights review

**Decision:** approved with conditions for United States project use.

The exact three frozen Season 00 releases may be copied into private, access-controlled project
storage and used for private FERAL-7B training and evaluation. A training or evaluation run still
needs its own ilXyr authorization. This review does not approve paid compute, a public corpus,
public model weights, or a public API.

This is an operational project review, not an opinion from outside legal counsel. It is complete
for the current private research scope. The project must reopen it before a public or materially
different use.

The machine-readable decision is
[`examples/corpus/feral-7b-rights-review.json`](../examples/corpus/feral-7b-rights-review.json).

## Exact scope

| Corpus | Examples | Braid release digest | Release manifest SHA-256 |
| --- | ---: | --- | --- |
| Training and validation | 228,110 | `8d33bb95710fc4d5eb2fe9677fe8268682249551cfaef0c6f473642f7a048162` | `ebada7a16eae7c836e3ece19d1154c2956367aac0c182e87898bd6f929b56103` |
| Sealed future evaluation | 44,704 | `63a772a749f1f57d8de29aa902047de6ac17bed72b800b95251554fabdc88d9c` | `acda2f96a372c30ccf1804719ecf58b6266026a565ddde1178e42a9a6af5d6ab` |
| Sealed unseen-issuer evaluation | 30,668 | `1769782e3ced8e14a945c55cecb21cc0518ebb03da970622125d2af4b870daf4` | `f64d147d2259b073dd327e1e10b73de9d5d92d40e6a38bbe403dc63e849f604b` |

The source releases keep their original `NOASSERTION` field. That field is an honest statement that
Braid did not make a license decision while building them. This ilXyr review is the separate
project decision and does not rewrite the immutable source releases.

## What the corpus contains

The 303,482 examples contain long excerpts from filings, not only facts and numbers. A complete,
case-insensitive scan found the following screening signals:

| Signal | Examples containing a match |
| --- | ---: |
| Any reviewed restrictive-language pattern | 7,223 (2.3800%) |
| `confidential` | 1,061 (0.3496%) |
| Reproduction, distribution, or all-rights-reserved language | 41 (0.0135%) |
| Copyright or third-party language | 4,212 (1.3879%) |

The counts overlap. A match is not proof that a notice controls reuse; many notices describe
third-party material, historical agreements, safe-harbor language, or the filing itself. The scan
does prove that raw redistribution and source reconstruction need tighter controls than factual
analysis.

## Basis for the decision

The main basis is the SEC's own policy. Its
[`Webmaster Frequently Asked Questions`](https://www.sec.gov/about/webmaster-frequently-asked-questions)
says that public EDGAR filing content is free to access and reuse. Its
[`Privacy Information`](https://www.sec.gov/about/privacy-information) page says information on
sec.gov may be copied and further distributed without SEC permission, asks for appropriate
citation, and limits use of SEC seals, logos, artwork, and marks.

That permission is not the same as calling private filer text public domain. Under
[`17 U.S.C. section 105`](https://www.govinfo.gov/content/pkg/USCODE-2022-title17/pdf/USCODE-2022-title17-chap1.pdf),
only a United States Government work receives the section's no-copyright treatment. Private-party
filings do not become Government works merely because the SEC receives and publishes them.

Fair use is a supplemental basis, not the only basis. Section 107 requires a fact-specific review.
The project use is analytical, uses lawfully accessed public sources, keeps the corpus private,
preserves citations, and forbids long source-like output. Those facts are more favorable than a
public text archive or a product that substitutes for filings.

The Copyright Office's
[`Generative AI Training report`](https://www.copyright.gov/ai/Copyright-and-Artificial-Intelligence-Part-3-Generative-AI-Training-Report-Pre-Publication-Version.pdf)
also treats training as fact-specific. It distinguishes research and analysis with output controls
from uses that create substitutes or start with pirated copies. The report is guidance, not a
court judgment.

Recent district-court decisions point in the same fact-specific direction. The Copyright Office
records [`Kadrey v. Meta`](https://copyright.gov/fair-use/summaries/Kadrey-v-Meta-Platforms-Inc-788-F-Supp-3d-1028-ND-Cal-2025.pdf)
as fair use on the record before that court, with market substitution and meaningful source output
important to the analysis. Its
[`Fair Use Index`](https://copyright.gov/fair-use/fair-index.html) records a mixed result in
`Bartz v. Anthropic`: training and keeping a library made from unlawfully acquired copies were
treated differently. These district-court decisions are supplemental and do not create a blanket
rule for AI training.

## Required controls

The clearance applies only while all of these controls remain true:

1. Use only the exact public SEC archive objects bound by the three frozen manifests.
2. Keep accession numbers, SEC URLs, dates, issuer identifiers, and hashes with each example.
3. Keep raw data private, access-controlled, and logged.
4. Do not publish or redistribute raw filings, JSONL, release archives, or an equivalent text set.
5. Block or truncate long source-like model output. Prefer factual answers, short attributed
   quotations, and links to the SEC filing.
6. Do not use SEC seals, logos, artwork, or marks to imply sponsorship or affiliation.
7. Maintain an exclusion and takedown path for a valid rights, privacy, correction, withdrawal, or
   non-public-filing complaint.
8. Run targeted memorization and verbatim-output tests and complete a new rights review before any
   public weights, model, or API release.

## Reopen the review when

Reopen this decision if the corpus changes, a source is not a public SEC EDGAR object, use moves
outside the United States, output controls weaken, a public release is proposed, or SEC policy or
governing law materially changes.
