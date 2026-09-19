# Pinned LiE 2.2.2 build

This build record applies only to the unmodified LiE 2.2.2 source archive
accepted for the weight-multiplicity oracle.

## Supported target

- Ubuntu 24.04 LTS, x86-64
- GCC 13.3.0
- GNU make and bison from Ubuntu 24.04
- no readline dependency

## Source identity

Source URL:
`https://mirror.metanet.ch/sage/spkg/upstream/lie/lie-2.2.2.tar.gz`

Required SHA-256:
`c4d6f67fa17d2bc77c875a5b2ad2b42ffc5cadf30e7d1c64c097648ccb918b1e`

Verify the archive before extraction. A mismatched archive must not be built.

## Build

Install Ubuntu's `build-essential`, `bison`, and `ca-certificates` packages.
Extract the verified archive into an empty directory and run:

```text
make noreadline CFLAGS='-O -D_POSIX_C_SOURCE=200809L'
```

The accepted build produced `Lie.exe` with SHA-256:
`d2478e3cf9abed5cc0105da52fb6580a8c85b66ec74b7cfd3192d3eb6953f391`.

Use the executable only as a separate process. Do not link it into the IlXYr
program. Do not patch the source. Any source change ends the current counsel
acceptance and requires a fresh review.

## Delivery bundle

Every delivery must include:

1. the exact verified `lie-2.2.2.tar.gz` archive;
2. this build record; and
3. the intact LGPL notice accepted by counsel, using the reviewed [Debian
   LiE 2.2.2 copyright
   record](https://sources.debian.org/copyright/license/lie/2.2.2%2Bdfsg-2/).

The source archive is not replaced by a download link. The archive itself
must travel with the delivery.
