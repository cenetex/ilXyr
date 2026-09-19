# Research step 52: ZERO.4 storage sized from the failed host

The replacement host uses a 160 GiB root disk. Its package check reserves the
complete 75 GiB source snapshot, 16 GiB for setup, 1 GiB for filesystem overhead,
and 37.0625 GiB for study output and collection. This requires 129.0625 GiB and
leaves 30.9375 GiB of planned headroom.

The previous [approved attempt](../research-step-51/REPORT.md) stopped at its
disk check. It had 27,919,421,440 free bytes and required 39,795,556,352 bytes.
[OBSERVED-DISK.json](OBSERVED-DISK.json) preserves the actual filesystem row
and its bound failure receipt. Scientific calls in that attempt were zero.

## The repair and its checks

The launch request now takes disk size from the frozen provider plan. Free
preflight checks the source snapshot capacity against the sizing basis. The
host then checks both the expanded filesystem size and actual free space
before entering the scientific controller. It saves the byte counts and the
result of that check.

All 18 local host tests pass. They include the observed free-space failure,
a filesystem that stays at its old size, a planned disk too small for the
snapshot and reserves, changed snapshot capacity, and the exact free-space
boundary. The successful fixture reaches the controller and preserves its
output. Every host failure retains the available evidence and reaches shutdown.
The shared seven-method launch suite passes all fifty controlled cases too.
The fixed Linux image check also passes on the corrected source commit.
Its five small endpoint models retain identical scores and decisions after
their folders move. These are engineering fixtures. [RUNTIME-CHECK.json](RUNTIME-CHECK.json)
binds the image, compiler, source files and downloaded receipts.
The local schema checks also finish successfully across the preserved first
segment and six groups rerun with fresh receipt paths. The complete suite
passes in CI on the corrected source commit.

The earlier package still verifies with the current inspector. Its plan and
bootstrap remain under their original paths. The replacement uses its own
step-52 plan, bootstrap and storage prefixes.

## Scientific identity and cost

[SCIENTIFIC-PARITY.json](SCIENTIFIC-PARITY.json) compares every changed plan
field. The controller archive, prepared archive, scientific implementation,
study plan, study limits, runtime image, compiler, Python and environment are
identical to the earlier package. The new package reuses both archive files
byte for byte. Fresh study calls during preparation are zero.

| Item | Earlier host | Replacement |
| --- | ---: | ---: |
| Root disk | 80 GiB | 160 GiB |
| Disk cost ceiling | $0.12 | $0.24 |
| Calculated total ceiling | $11.4391 | $11.5591 |
| Maximum before tax | $12.00 | $12.00 |
| Maximum instance time | 13.5 hours | 13.5 hours |

The workload remains five training methods and three seeds, with the full
quantity, retention, BLiMP and TinyStories endpoints. Each candidate must gain
25 exact task artifacts against both frozen and plain replay in every seed.
Every source and both language screens retain their fixed limits.

[PACKAGE.json](PACKAGE.json) binds the corrected archive to source commit
`4569cd01c82a58b9c32bba117623d86b79f82d0e`. Its SHA-256 is
`b9cd62c7577536bc284e53cc066d789eb0e65890ccff7668529bb6a33262aa02`.

The first preflight caught a second setup error: the sizing basis used the
old host's 80 GiB disk as the snapshot capacity. The provider reports 75 GiB.
[SNAPSHOT.json](SNAPSHOT.json) preserves that observation. The corrected plan
and its test use the observed source identity and capacity.

Automatic approval review requires explicit permission to upload the corrected
package into the same private bucket. Read-only checks confirm the account,
bucket owner, public-access blocks, earlier staged object, identical scientific
archives, and exact public source bytes. The upload remains pending after two
rejections. [PREFLIGHT.json](PREFLIGHT.json) records the remaining version readback
and complete provider check. [FAILURES.json](FAILURES.json) preserves both
setup errors, the staging review events, and a resolved local permission error and a reused test-output folder.

The next approval can name this exact package and private destination. Paid
execution also requires the fixed $12 budget and 13.5-hour limit. The launcher
requires the completed free preflight before dispatch.

The [shared failure report](DESIGN.json) links this repair to the same ledger
used by Reasoner, FERAL, Solomon and weight multiplicity. The disk failure
remains a host result beside the pending scientific retention comparison.
