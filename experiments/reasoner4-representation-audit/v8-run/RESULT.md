# Reasoner 4 typed-role audit result

The full frozen audit ran on the v8 package. The collector verified the exact
versioned result and the source replay receipt. EC2 instance
`i-0d171596bb30c68d7` terminated with zero tagged EBS volumes and attached
network interfaces. The [collection record](COLLECTION.json) gives the S3
version and SHA-256 of the 823,560-byte raw result. That private object holds
all 180 row predictions, 60 shuffle records, fitted weights, fit-only
selection, and capture hashes. The [execution receipt](EXECUTION-RECEIPT.json)
binds its hash to package
`636b86acbe232ac66b94117ff0213fcf448c1ca3efa26e0e869c6cc65ad51a84`.

The [capture receipt](CAPTURE-VERIFICATION.json) confirms 2,880 evaluator
calls across 180 rows from Zero source revision
`3b917b6f54d151a43dd65e45f094606272d166c5`. All fit and held outputs
matched the pinned C evaluator; 712 scrambled outputs differed. Captured
states matched their demonstrations.

| Required metric | Measured ppm | Frozen gate | Result |
| --- | ---: | ---: | --- |
| Held role accuracy | 433,333 | at least 950,000 | fail |
| Worst seed and role | 0 | at least 900,000 | fail |
| Surface and role swap consistency | 433,333 | at least 950,000 | fail |
| Joint cross-seed agreement | 1,000,000 | at least 980,000 | pass |
| Scrambled-example accuracy | 166,667 | at most 300,000 | pass |
| Shuffle 95th percentile | 366,667 | at most 300,000 | fail |
| Margin over header-only | 166,667 | at least 500,000 | fail |

Each seed made 26 correct role predictions across 60 held rows. Each
header-only probe made 16 correct predictions, and each scrambled probe made
10. The three seeds agreed on every held prediction. The worst role accuracy
was zero for candidate, goal, and subtract; absolute and nonzero reached
1,000,000 ppm, and multiply reached 600,000 ppm. The 60 shuffle controls had
a 366,667 ppm 95th percentile. Independent recounts of the raw predictions
and shuffle records match these measurements.

The [frozen checker](DECISION.json) returned `invalid_controls` because five
required gates failed, including the shuffle control. Its next allowed step
is `data_review`. This is a diagnostic result for six fixed point roles from
normalized numeric demonstrations. The supplied parser handles both surface
grammars. The future sealed law-composition panels stayed closed. The probe
and thresholds remain fixed.

All three cloud attempts are closed. The [final cost bound](FINAL-COST-BOUND.json)
uses their verified closure times and totals $0.128845 before tax against the
original $0.15 ceiling. The provider's actual billed cost remains unknown.
