# Weight pilot retry result

Run `weight-pilot-56-20260926T233104Z` completed on instance `i-09b9ada38cd4afe2b`. The frozen host package is `fe7e6f2cbec425df875f905c0d5681d5cefacf844a035450c83b68ad509186e9`; the unchanged pilot source package is `adea1791925e3336d28e4a26ccc80c5c20baa7892fc84675b422e325295569c7`. The host exited with code 0 after 348.03 seconds. The collector verified EC2 termination, zero tagged volumes, zero tagged interfaces, exact S3 object versions and hashes, and safe archive extraction. All sixteen jobs completed their native checks and generator replays. [RETRY-RESULT.json](RETRY-RESULT.json) holds per-job totals, slice yields, and matched-bound checkpoints. Provider billing remains pending.

The versioned result archive has SHA-256 `c773875e9beb36634919575c46e96600c7e22e73c939da1e3c0935bfe1067ed9`, size 667,781,120 bytes, and S3 version `24.8hxWdVwsqQlbBYy.ik4HtR5DnNb4U`. The host terminal object has SHA-256 `238c3d57378114f4e52722dde4ca22718ae9fcb99d3c550cb7ac076c28a3ae1a` and S3 version `g8BL_T0ANOhpZzytJJx2aqtg9li4V9OH`. The raw collector and offline verification receipts remain at `/private/tmp/weight-pilot-retry-collected-20260927/`. The first attempt's separate failure and cleanup remain in [ATTEMPT-1.md](ATTEMPT-1.md). Both attempts followed the original $2.00 before-tax planning ceiling: $0.15 reserved for the first and $1.85 capped for this retry.

## Frozen endpoint

Each control used seeds 0–3. The pilot allowed up to 50,000 candidate draws and 20,000 new oracle calls per job. Cached jobs reached the draw limit; uncached jobs reached the new-call limit. These endpoint totals therefore show each arm under the *same two ceilings* with different consumed draws and calls. They are separate from the matched-bound comparisons below.

| Control, four seeds | Accepted rows | Candidate draws | Evaluations | Cache hits | New oracle calls | Query exclusions | Orbit exclusions | Construction failures | Oracle failures | Hold |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Uncached, fixed | 9,920 | 133,825 | 80,000 | 0 | 80,000 | 17,344 | 35,676 | 677 | 0 | New-call limit |
| Cached, fixed | 10,921 | 200,000 | 114,368 | 41,127 | 73,241 | 30,025 | 54,619 | 853 | 0 | Draw limit |
| Uncached, rotated | 9,861 | 133,607 | 80,000 | 0 | 80,000 | 17,999 | 34,840 | 640 | 0 | New-call limit |
| Cached, rotated | 10,828 | 200,000 | 113,856 | 40,348 | 73,508 | 30,950 | 54,211 | 808 | 0 | Draw limit |

At these ceilings, fixed caching produced 1,001 more accepted rows with 6,759 fewer new calls; rotated caching produced 967 more rows with 6,492 fewer new calls. The cached arms also processed about 66,000 more draws each. Fixed order produced 59 more rows than rotation without caching and 93 more with caching. The four-seed aggregate supports a cache benefit under these ceilings. Rotation has slice tradeoffs and no aggregate lift here.

## Paired bounds

Recorded checkpoints cover complete batches. For each job, the result includes the last complete checkpoint block at or below 32,000 candidate draws and, separately, at or below 17,000 new oracle calls. Thus each observed bound is within one checkpoint block of its target. The exact per-job consumed bounds are in [RETRY-RESULT.json](RETRY-RESULT.json). Checkpoint blocks sum to each frozen job result, and the independent native checks and generator replays passed.

At the matched draw bound, cache and no-cache jobs made the **same accepted row counts in every seed and slice**. Caching saved new oracle calls by reusing duplicate queries:

| Order, four seeds at up to 32,000 draws/job | Accepted rows, uncached = cached | Uncached new calls | Cached new calls | Cached hits | Draws in each paired arm |
|---|---:|---:|---:|---:|---:|
| Fixed | 9,800 | 76,992 | 55,988 | 21,004 | 127,701 |
| Rotated | 9,772 | 77,120 | 56,085 | 21,035 | 127,757 |

At the matched new-call bound, caching evaluated more candidates within approximately 17,000 new calls per job. Fixed caching yielded 10,565 rows versus 9,452 uncached; rotated caching yielded 10,462 versus 9,450. Fixed caching drew 175,600 candidates versus 110,186 uncached; rotated caching drew 173,715 versus 110,280 uncached. These are selection yield observations at a call budget, with draw work included in the record.

| Seed | Fixed: rows at ≤32k draws, uncached = cached | Fixed: rows at ≤17k calls, uncached / cached | Rotated: rows at ≤32k draws, uncached = cached | Rotated: rows at ≤17k calls, uncached / cached |
|---|---:|---:|---:|---:|
| 0 | 2,452 | 2,351 / 2,630 | 2,404 | 2,335 / 2,570 |
| 1 | 2,454 | 2,370 / 2,655 | 2,412 | 2,326 / 2,566 |
| 2 | 2,467 | 2,391 / 2,650 | 2,460 | 2,368 / 2,612 |
| 3 | 2,427 | 2,340 / 2,630 | 2,496 | 2,421 / 2,714 |

The eight slice yields below show the matched 17,000-call comparison across four seeds. Each number counts newly accepted rows. Per-seed slice counts and the 32,000-draw slice counts are in the JSON record.

| Slice | Uncached fixed | Cached fixed | Uncached rotated | Cached rotated |
|---|---:|---:|---:|---:|
| 0 dominant | 3,072 | 3,072 | 3,072 | 3,072 |
| 0 non-dominant | 1,024 | 1,024 | 1,024 | 1,024 |
| 1 dominant | 997 | 1,178 | 1,068 | 1,223 |
| 1 non-dominant | 954 | 1,024 | 915 | 1,004 |
| 2–7 dominant | 988 | 1,361 | 936 | 1,246 |
| 2–7 non-dominant | 966 | 1,024 | 982 | 1,024 |
| 8–31 dominant | 759 | 1,001 | 727 | 930 |
| 8–31 non-dominant | 692 | 881 | 726 | 939 |

Sampled candidate support remains unknown. Full-corpus acceptance still uses its separate partition, exact-label, global query, orbit, differential, latency, and resource gates. The host controller already completed the native checks and generator replays; this report uses their verified receipts and the saved checkpoint trace.
