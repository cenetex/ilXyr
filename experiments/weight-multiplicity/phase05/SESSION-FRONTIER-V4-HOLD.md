# Bounded-session frontier Version 4 — Hold

Version 4 is the controlling bounded-session result for Zero commit
`5616b720f41927733010d5255fcea96d0eb77149`. It repeats the exact Version 3
roster, target sets, orders, limits, and Apple M4 Max reference machine after
the direct coefficient-space Weyl-fold optimization. Version 3 remains sealed
and is not rewritten.

The surface moved materially. Across the frozen 828-representation roster,
Version 4 records:

- 825 passes, up from 812;
- one `time_fail`, down from nine;
- one `order_sensitive`, down from four; and
- one `time_fail_memory_unknown`, down from three.

Thirteen representations moved from a non-pass classification to pass. Two
former hard-timeout cells now complete and expose measured time boundaries.
The one remaining hard-timeout cell still has unknown memory; no warm or
placeholder RSS value is presented as a measurement.

## Remaining boundary

E7 `[0,0,7,1,0,0,0]` is the sole `time_fail`. Every grouped order has one
query over one second. Its ascending, descending, and seeded p95 values are
464.443917 ms, 0.132875 ms, and 402.833750 ms; their maxima are 1,067.243541
ms, 1,903.678833 ms, and 1,086.238750 ms.

E8 `[0,0,2,1,2,0,0,3]` is the sole `order_sensitive` representation. Its
ascending, descending, and seeded p95 values are 2,653.858167 ms, 0.046709 ms,
and 2,831.839542 ms. All 32 requests completed in every order and exactness
passed, but every order still has at least one query over one second.

E8 `[0,0,8,0,0,0,0,0]` remains `time_fail_memory_unknown`. The cold run and
all three grouped orders completed zero requests before the ten-second hard
timeout. RSS sampling was unavailable, so incremental memory and exactness are
unknown. The record does not infer whether time or memory is the binding
resource.

The four Version 3 p95 order-sensitive cells all cleared. The Version 4 order
effect is newly measurable because a former timeout now completes.

Exactness was observed and passed for 827 representations, with no observed
disagreements and no replay failures. Exactness remains unknown for the single
hard-timeout representation.

Maximum known grouped incremental memory was 21,528,576 bytes, below the
2,147,483,648-byte limit. This is not evidence about memory for the timed-out
E8 cell. Parallelism candidates 1, 2, 4, and 8 met the p95 limit, but every
candidate contained at least one query over one second. Safe parallel workers
under the full contract therefore remains zero.

## Performance interpretation

The focused direct-fold benchmark improved from 14.98 seconds to 2.69 seconds,
or 5.57x. A sampled profile that assigns 77% of time to one hotspot implies a
4.35x fixed-work Amdahl ceiling if only that sampled hotspot changes. The
larger observed speedup is not an arithmetic conflict: that assumption did not
hold. Removing the determinant path also changed work outside the sampled
attribution and plausibly improved call overhead, register pressure, inlining,
and locality. Sampling error may contribute as well. No one secondary cause is
claimed without a new profile. The every-recursive-state differential and
identical recurrence, memo, fold, and maximum-level counters show that the
benchmark traversed the same dependency structure.

The full frontier capture fell from about 35 minutes 28 seconds in Version 3
to about 13 minutes 55 seconds in Version 4, a 2.55x wall-clock improvement.
Cheap cells and unchanged ten-second hard timeouts dilute the focused 5.57x
speedup.

A separate E8 probe that previously did not return now produced the exact
multiplicity `636782228236670659005329` in 32.72 seconds. The 24-digit value is
at least 2^79 and below 2^80, so the returned multiplicity itself requires 80
unsigned bits. This directly rules out a 64-bit exact representation and
supports Zero's wide exact arithmetic. It does not prove that every operation
needs 1,024 bits or rule out a smaller fast path with exact overflow handling.
The training-corpus label cap of 31 is therefore not a safe bound for the
oracle's arithmetic.

The gate remains a Hold. The optimization moved the measured surface, but the
one-second contract and the zero-safe-workers condition are not cleared.

## Evidence categories

The current optimized executable was validated internally by a differential
canonicalizer on every recursive state, with identical recurrence counters.
That is strong implementation evidence, but it is not independent.

LiE Version 4 remains a separate independent predecessor correctness witness:
496 agreements and zero disagreements. It covers the predecessor
canonicalization executable, not this optimized binary. The link between the
two is the current internal every-recursive-state differential. LiE is not
part of this resource measurement and is not described as an independent
audit of ilXyr or Zero.

## Evidence identities

- plan SHA-256:
  `3124323d7f5d7b236adeeef6d529fb2a9a1b6f36fffaa911df07d126145bd71a`;
- representation manifest SHA-256:
  `50d0bd848f145edc08e963bb173fff6e055218fc04569f5f257a70bc568cacdb`;
- measurement capture SHA-256:
  `04d2b0d96776412da7f689b92481d98e4ccc048bd0167b1c0e85d025bf2e6f5e`;
- finalized uncompressed result SHA-256:
  `d2f91c4d898b5c48929ace5d5cc00858a1950d2346b5f216f7900ed28c33563d`;
- finalized compressed result SHA-256:
  `1dc6fd54cf8236f8ef78ec4776ec769e4ef8da52f02efd352ce6d8b2d2e44db9`;
- compact summary SHA-256:
  `b98a27f96092d85b484525a3e188299df2fe603ca6c20ad5ff2df3623946afd8`;
- Zero executable SHA-256:
  `7483043242d6fabf2fcaa72fc4746e7a13a858a4a3bcb6efefa37a5079d937ab`;
- measurement controller revision:
  `b220efee5294c42e6529a99068138ad4164f4532`; and
- evidence finalizer revision:
  `9bf7088d93a06321f01d863fac6af3a67f9e10b1`.

No corpus generation or training is authorized.
