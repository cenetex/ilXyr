# Phase 0.6 LiE governance acceptance

Date: 2026-08-31

Status: accepted with conditions

Scope: manifest preparation only

The client accepts LiE 2.2.2 under the stated LGPL 2.1-or-later position when
it is used as an unmodified, separately invoked executable. It is not linked
into an IlXYr delivery and it is not modified.

Every delivery that contains or depends on this pinned executable must also
contain the exact source archive, reproducible build instructions, and the
intact LGPL notice. The accepted source archive has SHA-256
`c4d6f67fa17d2bc77c875a5b2ad2b42ffc5cadf30e7d1c64c097648ccb918b1e`.
The reviewed license record is the [Debian LiE 2.2.2 copyright
record](https://sources.debian.org/copyright/license/lie/2.2.2%2Bdfsg-2/).

Any patch or other source modification ends this acceptance. The changed
arrangement must return to client counsel before it is used or delivered.

## Accountable owner

**Codex, IlXYr Research Operations** owns custody and reproducibility of this
pinned oracle build. Escalations go to the `cenetex/ilXyr` GitHub issue
tracker and must be addressed to Codex / IlXYr Research Operations.

The supported build target is Ubuntu 24.04 LTS on x86-64 with GCC 13.3.0.
The recorded command is:

```text
make noreadline CFLAGS='-O -D_POSIX_C_SOURCE=200809L'
```

The expected executable SHA-256 is
`d2478e3cf9abed5cc0105da52fb6580a8c85b66ec74b7cfd3192d3eb6953f391`.

There is no active upstream that this engagement relies on. There is no
security patching service. The owner promises pinned-artifact custody and
reproducible builds only, not general maintenance or security support.

## Authority boundary

This acceptance closes the governance part of the Phase 0.6 Hold and permits
preparation of a re-scoped manifest. It does not authorize corpus generation,
model training, or oracle promotion. This record is not legal advice.
