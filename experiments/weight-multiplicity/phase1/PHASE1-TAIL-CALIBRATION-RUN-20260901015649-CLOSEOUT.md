# Phase 1 tail calibration run 20260901015649: measurement complete

## Outcome

The approved telemetry-only calibration completed all **26,624** frozen
queries. No query reached the 30-second hard abort. No corpus record was
written and no model was trained.

The exact nearest-rank p99 was **39.603 ms**. The frozen rule multiplies that
value by 1.25 and rounds up to a whole millisecond, producing a proposed
generation p99 limit of **50 ms**. This number was derived without a floor or
manual adjustment.

This report returns the measurement and proposed clause for review. It does
not authorize corpus generation.

## Overall latency

| Measure | Result |
| --- | ---: |
| Calls | 26,624 |
| Mean | 2.478 ms |
| Median | 0.165 ms |
| p95 | 3.081 ms |
| p99 | 39.603 ms |
| p99.9 | 442.404 ms |
| Maximum | 884.604 ms |
| Proposed generation p99 limit | 50 ms |
| Independent per-query abort | 30,000 ms |

The stopped pilot contained 19,105 calls. This calibration contains 7,519
more calls, an increase of 39.36%. Projected corpus generation is much larger:
1,861,415 expected calls, 2,113,380 at the upper-95 estimate, and a binding
limit of 2,430,387. Those are about 69.91, 79.38, and 91.29 times the
calibration size.

The gap between p99, p99.9, and the maximum shows a heavy tail. A 50 ms p99
limit may therefore be tight at corpus scale even without an oracle change.
That is a known property of the frozen rule, not grounds for changing the
number after seeing the data.

## Tail by type

| Type | Calls | p95 | p99 | p99.9 | Maximum |
| --- | ---: | ---: | ---: | ---: | ---: |
| E7 | 2,048 | 37.008 | 738.134 | 834.497 | 884.604 |
| B8 | 680 | 36.118 | 363.264 | 404.045 | 404.045 |
| E8 | 2,048 | 13.260 | 177.493 | 200.572 | 213.143 |
| D8 | 680 | 14.128 | 166.910 | 205.719 | 205.719 |
| C8 | 680 | 15.621 | 130.155 | 155.011 | 155.011 |
| B7 | 681 | 11.545 | 90.751 | 146.808 | 146.808 |
| E6 | 2,048 | 6.642 | 41.993 | 66.222 | 75.827 |
| D7 | 680 | 8.075 | 23.164 | 70.163 | 70.163 |
| C7 | 680 | 4.593 | 22.541 | 54.599 | 54.599 |
| B6 | 687 | 3.294 | 27.414 | 38.613 | 38.613 |
| F4 | 2,048 | 2.766 | 14.149 | 18.747 | 20.208 |
| C6 | 680 | 4.013 | 13.153 | 16.616 | 16.616 |
| D6 | 680 | 3.721 | 13.282 | 14.057 | 14.057 |
| B5 | 599 | 1.494 | 5.829 | 13.643 | 13.643 |
| A8 | 688 | 1.181 | 5.023 | 5.576 | 5.576 |
| C5 | 597 | 1.696 | 3.546 | 4.427 | 4.427 |
| D5 | 596 | 1.447 | 3.179 | 4.217 | 4.217 |
| A7 | 688 | 1.055 | 2.366 | 3.418 | 3.418 |
| A6 | 688 | 0.716 | 0.993 | 2.160 | 2.160 |
| B4 | 599 | 1.076 | 1.416 | 2.039 | 2.039 |
| B3 | 598 | 0.323 | 0.631 | 1.888 | 1.888 |
| B2 | 589 | 0.289 | 0.488 | 1.867 | 1.867 |
| A5 | 600 | 0.434 | 0.597 | 1.809 | 1.809 |
| A4 | 600 | 0.345 | 0.552 | 1.736 | 1.736 |
| A3 | 599 | 0.322 | 0.615 | 1.587 | 1.587 |
| C4 | 599 | 0.639 | 1.213 | 1.431 | 1.431 |
| A2 | 600 | 0.326 | 0.529 | 1.414 | 1.414 |
| A1 | 421 | 0.339 | 0.844 | 1.386 | 1.386 |
| D4 | 597 | 0.415 | 0.597 | 1.323 | 1.323 |
| C3 | 598 | 0.349 | 0.483 | 1.059 | 1.059 |
| G2 | 2,048 | 0.290 | 0.435 | 0.940 | 1.036 |

All latency values in the type table are milliseconds. The top 50 calls were
29 E7, 14 B8, four E8, and three D8.

## Tail by target depth

| Depth | Calls | p95 | p99 | p99.9 | Maximum |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0–7 | 18,703 | 0.786 | 8.479 | 54.054 | 87.483 |
| 8–15 | 2,535 | 0.463 | 1.213 | 6.704 | 7.246 |
| 16–31 | 2,499 | 1.402 | 4.198 | 18.434 | 40.870 |
| 32–63 | 1,671 | 6.715 | 25.012 | 169.155 | 241.510 |
| 64+ | 1,216 | 177.869 | 753.469 | 881.105 | 884.604 |

Forty-nine of the top 50 calls had depth 64 or greater. The remaining call
was in the 32–63 band.

## Tail by returned multiplicity bit length

| Bits | Calls | p95 | p99 | p99.9 | Maximum |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0 | 14,715 | 0.919 | 10.758 | 54.182 | 87.483 |
| 1–5 | 6,531 | 0.400 | 1.548 | 23.628 | 55.298 |
| 6–15 | 3,467 | 1.355 | 3.325 | 9.393 | 16.851 |
| 16–31 | 1,469 | 18.561 | 41.993 | 169.155 | 241.510 |
| 32–63 | 390 | 747.027 | 772.183 | 884.604 | 884.604 |
| 64+ | 52 | 200.572 | 213.143 | 213.143 | 213.143 |

The tail correlates strongly with both target depth and result size, but not
monotonically at every bit band. Of the top 50 calls, 45 returned 32–63-bit
values, four returned values of at least 64 bits, and one returned a 16–31-bit
value.

## Corpus-range finding

All 50 slowest calls returned multiplicities above the accepted 0–31 corpus
range. Across all calls:

| Returned value | Calls | p95 | p99 | p99.9 | Maximum |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0–31 | 21,246 | 0.705 | 6.481 | 53.799 | 87.483 |
| Above 31 | 5,378 | 31.698 | 178.737 | 763.029 | 884.604 |

This shows that the expensive tail is concentrated in records that the
current corpus rejects. It does not by itself authorize a generator scope
change: the multiplicity is known only after the oracle call, and changing the
candidate distribution to satisfy a timing rule would change the experiment.

## The stopped pilot query is now identified

The deterministic query at sequence 19,105 returned the same multiplicity as
the stopped pilot:

- type: E7;
- representation: `E7:1,1,5,1,0,0,0`;
- target: `[0,-1,2,0,1,0,-1]`;
- target depth: 263;
- returned multiplicity: 2,633,282,666,151,119,789 (62 bits);
- calibration latency: 754.776 ms; and
- corpus disposition: rejected because the value is above 31.

The old latency was 1,019.389 ms. The different latency for the same frozen
query is direct evidence that a single-call maximum is sensitive to ordinary
run variation.

## Memory, cost, and shutdown

- Largest incremental RSS for any LiE worker: 4,050,944 bytes.
- Peak aggregate oracle RSS: 64,389,120 bytes.
- Generator wall time: 12.056 seconds.
- Instance elapsed time: 76 seconds.
- Estimated EC2 cost: USD 0.014355555556.
- Instance state: terminated by its own shutdown path.

The run remained below the approved ten minutes and USD 0.12 ceilings.

## Post-measurement wrapper erratum

The runner completed successfully and wrote the trace, tail report, evidence,
budget, progress record, and checksums. The cloud wrapper then used an
unquoted jq filter while checking that the tail report contained 50 entries.
The shell tried to run `length` as a command, so the outer receipt says
`failed` and the normal `results/` copy was not created.

The failure happened after measurement. The trap copied the complete output
tree to the immutable `state/` prefix. Every internal checksum passes, and the
runner summary says `calibration_complete`. The `state/` artifacts are the
authoritative result. The run was not retried. The quoting defect is fixed in
the launcher for future use.

## Evidence and authority

The compact machine-readable closeout is
`phase1-tail-calibration-run-20260901015649-closeout-v1.json`. The full trace
and tail report remain under the immutable S3 prefix recorded there.

Corpus generation, model training, model evaluation, and oracle promotion
remain unauthorized. The proposed numeric resource clause is returned in
`PHASE1-ORACLE-RESOURCE-CLAUSE-V2.md` for a separate decision.
