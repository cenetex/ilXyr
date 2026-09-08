# Solomon: prepare the full confidence comparison for cloud execution

Step 37 fixed the comparison controller. Step 38 binds its Linux environment,
locked build dependencies, host limits, result collection and proposed cost.
The scientific source kit, 12-document roster, 384 windows and five methods
remain fixed. The full comparison has 300 worker processes, 9,600 probability
rows and 1,920 native forward calls. These calls await the paid execution.

## Fixed execution

The proposed host is one AWS c6i.large in us-east-1: two vCPUs and 4 GiB RAM.
All builds and workers use one CPU and a 2 GiB container memory limit. The
container uses the pinned Rust image, the installed Rust 1.98.0 compiler,
a fixed environment, one Cargo build worker and offline dependencies.
The worker build and output directories are separate. Its root is read-only.

The full controller has 1,800 seconds, with 300 seconds for its build and
30 seconds for any worker. The instance shutdown timer is armed before setup.
Setup ends within 900 seconds; worker execution ends by second 3,000; result
collection ends by second 3,540; shutdown starts at second 3,570. The proposed
instance allowance is 3,600 seconds. A follow-up must verify termination and
root disk deletion before results can be accepted.

The package includes the step 37 source kit and 53 Cargo dependency packages.
Each dependency's registry checksum comes from the fixed Cargo.lock. Its
source file checksums are verified before packing. The cloud build reads
these packaged dependencies with network access disabled.

## Validation

All 12 focused host and dependency checks passed. The pinned image built
offline and completed 160 probability rows on the 16 opened windows. The
independent checker reproduced every published score, mistake count and
zero-probability count. The complete dependency archive matched on Mac and
Linux. Full-panel fresh calls remain at zero. Linux CI run 34291658164 and
LINUX-VALIDATION.json bind the receipts.

## Failures retained

The Rust 1.98.1 Bookworm image tag was unavailable. The available Linux image
was resolved to its immutable digest and tested on opened examples.

The first fixed-image check then failed before compilation. The upstream
source selects the stable toolchain. Rustup tried to update that channel in
the read-only image. Setting the installed toolchain explicitly keeps the
source bytes fixed and makes the compiler selection exact. The attempt had
zero native calls, and its process receipts and error log are retained.

The first Mac and Linux dependency archives differed. All dependency source
bytes and checksums matched. The newer Cargo version added a comment field
to each checksum record. The packer now writes the verified package and file
checksum fields in a fixed JSON form. CI checks the complete archive hash.

Staging review first treated the source payload as private. The source
repositories are public; the document receipts bind public Gutenberg files;
and the expected bucket owner verified. The same scoped staging action then
passed review. Its expiry rules cover the two new Solomon folders.

## Cost and collection

The current AWS compute rate is $0.085 per hour. The conservative total is
$0.166156 before tax, including the 80 GiB encrypted root disk, one public IP,
requests, 32 days of bounded object storage and one result download. The
proposed approval ceiling is $0.25 before tax. Price sources and exact rates
are in PRICE-EVIDENCE.json. Each paid launch requires fresh preflight against
these ceilings. The stored package passed exact version readback and the free
EC2 DryRun. Identity, image, storage, network, role, price and retention checks
passed. Package `52dfcf2f63668d02765a6b591f5b39a0b445a1b475c32ce4e2ba27fdc37e9f86`
is ready for one paid-run approval. The preparation created zero instances.

Results have a 256 MiB archive ceiling and a 4,096-file ceiling. The collector
keeps a bounded prefix after an output failure and identifies omitted files.
Package and result objects use exact version IDs and SHA-256 checksums. The
collector checks termination, disk and network cleanup, instance identity,
package identity and transport hashes. The independent step 37 checker then
checks the complete scientific collection.

## Place in the research program

This step uses the same separation as Reasoner and weight multiplicity:
freeze the comparison, keep setup and controller costs, run each method in
its own measured process, and check the collected evidence independently.
The Rust update failure and FERAL's earlier Triton cache failure share an
operational lesson: check the exact read-only runtime before paying for a
fresh comparison. Both failures belong in the record before any model claim.

The opened native confidence result remains worse than the four controls.
The full frozen panel will test whether that finding extends across the
selected documents. Its fixed-panel diagnostic scope remains unchanged.
