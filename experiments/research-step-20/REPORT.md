# Research step 20: live preflight and the recovered oracle trace

FERAL's live AWS preflight passed, including an EC2 permission dry run. The
frozen host package is staged in the existing private project bucket, and its
exact version passed read-back verification. The next decision is a single
comparison run capped at one hour and $3.00 before tax.

The original weight-multiplicity calibration trace is also recovered. Its
26,624 saved queries reproduce the published latency summary, every slowest-50
record, and the proposed 50 ms final-p99 limit. This verifies recorded cloud
measurements through the current exact-percentile code.

## FERAL: a concrete run request

[RUN-REQUEST.json](RUN-REQUEST.json) binds the package, execution plan, network,
machine, and budget for user review. [PREFLIGHT.json](PREFLIGHT.json) records the
live observations and source digests.

| Item | Verified binding |
| --- | --- |
| Machine | One `g6e.2xlarge`, eight vCPUs, 64 GiB RAM, one L40S GPU, `us-east-1` |
| Image | `ami-0d3378afe7683c867`, x86-64, available, root device `/dev/xvda` |
| Root storage | 150 GiB encrypted gp3; deletion on termination |
| Network | Existing FERAL security group; HTTPS and DNS egress; zero ingress rules; matching subnet and active routes |
| Instance role | Existing package-read and result-write permissions match the planned paths |
| Bucket | Versioning, AES256 encryption, four public-access block settings, and TLS policy verified |
| Host package | 1,638,400 bytes; SHA-256 `4ad780b4a09134255eea0d8a3cbb87727d9843de10f9cee7e110c91381ac2355` |
| Stored version | `LnSWe132MAfKJg_oTtMzaGXkwHgUMCHg`; conditional new-object write and exact read-back verified |
| Execution plan | SHA-256 `e98d0a4fbdc438126686a27803d528406183d99d157171a6b66a497bd5c9cb9d` |
| EC2 dry run | Passed; zero instances created |

The comparison uses the fixed Qwen model and both arithmetic controls on the
full 1,147-input revised FinQA roster. The [source package](../research-step-13/REPORT.md),
[controller](../research-step-14/REPORT.md), and [host checks](../research-step-15/REPORT.md)
retain their original identities. Raw answers, partial output, complete work,
collection records, and provider termination remain part of the result.

The refreshed [AWS price feed](https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/US%20East%20%28N.%20Virginia%29/Linux/index.json)
still gives $2.24208 per compute hour. Adding the fixed $0.75 infrastructure
reserve gives $2.99208 before tax, within the requested $3.00 ceiling.
The decoded feed matches the earlier frozen price-source digest.

User approval is the next execution step under
[CLOUD-EXECUTION.md](../../docs/CLOUD-EXECUTION.md). After approval, render a
fresh run identity and launch time, verify the same package version and network
binding, and dispatch through the existing helper. Observe the run, collect
its output, verify termination, and import its result and cost receipt.

## Weight multiplicity: the original bytes and decision

The trace has SHA-256
`191c82bb4ec80d5eb9779b6c9dd46ec2e9b582df87adb9e1d449a7317ddc219a`.
Its recorded S3 version is `rCLHHZLTQfaz_2dKrGtfj6fx75bKTG51`. The matching
tail report also passed its historical digest check. The recovered trace has
13,248,076 bytes and a complete sequence from 1 through 26,624.

[TRACE-VERIFICATION.json](TRACE-VERIFICATION.json) preserves the calculations:

| Saved-query measure | Reproduced value |
| --- | ---: |
| Mean | 2.477598 ms |
| p99 | 39.602666 ms |
| p99.9 | 442.404081 ms |
| Maximum | 884.603708 ms |
| Total query time | 65,963.579249 ms |
| Proposed final-p99 limit | `ceil(39.602666 * 1.25)` = 50 ms |

All 50 slowest queries produce multiplicities above the corpus's 0–31 label
range: 29 E7, 14 B8, four E8, and three D8 queries. The 21,246 in-range queries
have p99 6.481215 ms; the 5,378 out-of-range queries have p99 178.737144 ms.
Their cost stays in the full accounting even when their labels are discarded.

The saved-query p99, hard-timeout, call-count, and query-time checks pass the
proposed limits. Workload wall time is unavailable in this per-query trace.
The full corpus retains its separate package and run requirements. The
historical post-measurement wrapper failure keeps its original status.

```bash
node scripts/test-weight-calibration-trace.mjs
node scripts/verify-weight-multiplicity-calibration-trace.mjs \
  /path/to/pilot-trace.jsonl /path/to/tail-top-50.json \
  /tmp/weight-trace-verification.json
```

The checker validates original source digests, complete query order, exact
integer multiplicities, source-reported bit lengths, and finite latencies.
Streaming and sorted p99 agree. Tests cover percentile boundaries, tied slow
queries, values beyond JavaScript's exact-number range, and altered records.
The integrated research and schema suite passed.

## Failures retained

The first trace lookup returned 404 because it omitted the `calibration/`
directory. Listing the exact historical run prefix found the recorded version
at `state/calibration/pilot-trace.jsonl`. Its digest then matched the closeout.

The first price-reader attempt treated a gzip response as JSON and failed.
Decoding the gzip payload recovered the same 693,471-byte price document.
[DEVELOPMENT-FAILURES.json](DEVELOPMENT-FAILURES.json) keeps both failures and
their resolutions, separate from the scientific findings.

## Program position

The [five-project decision map](../research-step-18/REPORT.md) remains the
shared plan. Reasoner has its matched source package. Solomon now has its
[count-based confidence controls](../research-step-19/REPORT.md). ZERO.4 has
published retention controls and source losses. FERAL has a staged package
and passed live preflight. Weight multiplicity has its original trace and a
checked resource decision; its next deliverable is the cloud corpus package.

Each step connects a failure to a test that can change the next research
decision. [RESULT.json](RESULT.json) binds this step's implementation and
compact evidence records.
