# Phase 0.6 LiE build identity erratum

Date: 2026-08-31

Status: corrected before preflight queries

The first retained-surface preflight instance stopped during the build phase.
No preflight query ran. The instance terminated automatically after 73
seconds, with estimated EC2 compute of $0.013788888889.

The source archive, compiler target, build command, package, plan, manifest,
and governance record all matched. The executable hash did not. The accepted
record held one earlier executable SHA-256 as if it were a reproducible build
identity.

That gate was wrong. Unmodified LiE 2.2.2 contains:

```c
char date[] = __DATE__ " at " __TIME__;
```

Each ordinary build therefore embeds its compilation time and produces a
different executable hash. The earlier hash identified one valid build, but
it could not prove that a later build came from different source.

## Correction

The source remains unmodified. The build now fixes `SOURCE_DATE_EPOCH` to
`1112054400`, corresponding to `2005-03-29T00:00:00Z`, the source archive's
top-directory date. The cloud bootstrap performs two independent builds in
separate directories. Both executable hashes must be identical before any
query runs.

The preflight evidence records both hashes, the fixed epoch, the compiler,
the source hash, and `source_modified: false`. A mismatch is a build-phase
failure. This is a stronger executable-identity test than comparing against a
timestamped historical binary.

This correction does not change the accepted license arrangement: LiE remains
an unmodified, separately invoked executable built from the same pinned source
archive. It does not authorize corpus generation or training.
