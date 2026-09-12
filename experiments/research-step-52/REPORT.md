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

The earlier package still verifies with the current inspector. Its plan and
bootstrap remain under their original paths. The replacement uses its own
step-52 plan, bootstrap and storage prefixes.

## Scientific identity and cost

[SCIENTIFIC-PARITY.json](SCIENTIFIC-PARITY.json) compares every changed plan
field. The controller archive, prepared archive, scientific implementation,
study plan, study limits, runtime image, compiler, Python and environment are
identical to the earlier package. The new package reuses both archive files
byte for byte. Its scientific calls during preparation are zero.

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

[PACKAGE.json](PACKAGE.json) binds the replacement archive to its source
commit. The fixed-image check, private staging and free provider preflight
are the remaining readiness steps. A launch approval follows the completed
package and budget record.

The [shared failure report](DESIGN.json) links this repair to the same ledger
used by Reasoner, FERAL, Solomon and weight multiplicity. The disk failure
remains a host result beside the pending scientific retention comparison.
