# Research step 23: Reasoner cloud comparison ready

The frozen Reasoner comparison now has a tested Linux package, versioned cloud
copy, verified read-back, and successful free EC2 dry run. The full comparison
is ready for a **one-hour run capped at $0.50 before tax**, with a frozen-price
estimate of $0.42 including a $0.25 infrastructure reserve.

[PACKAGE.json](PACKAGE.json) identifies the exact 7,782,400-byte archive:
`e7da18889a91796c2c42f49832b2e89dcb565dd4eefeec9b8b9307e72b26ec4d`.
Its execution plan is
`70eee53ef3ada5353d48fcb5323a45db7d4e3536241937e0a492516d38f93f6a`.
The [public research archive](https://github.com/cenetex/ilXyr/releases/tag/research-step-23)
contains the staged source package and the Linux smoke artifacts.

## Question and fixed comparison

The study asks whether the learned task guide reduces both CPU cost and
verifier work against matched raw lexical guidance on fresh families. It uses
128 families across four strata, four views per family, six arms, and twelve
passes with fixed rotated and reversed arm order. Warm-up and measured passes
produce 73,728 native episode visits. Independent replay checks 3,072 measured
rows from one pass across all six arms.

The six arms are target-only, local guidance, semantic frequency, task guide,
raw lexical task guidance, and task guidance with its prior removed. They
share one optimized executable and the same machine, compiler, ordered inputs,
worker count, and limits. The primary result uses family-weighted geometric
ratios for CPU cost and verifier checks plus one. Both one-sided 95% bootstrap
upper bounds must fall below one, with every answer verified exactly. The
frozen runner uses 5,000 stratified bootstrap draws.

The scientific source remains commit
`24fae8ea8aa42212c7058b084b66dfa725672dfd`, including its 1,863-byte guide,
fixed model, seeds, and grading rules. [EXECUTION-PLAN.json](EXECUTION-PLAN.json)
records all source and runtime bindings. The earlier matched-control result
remains part of the [program decision record](../research-step-18/REPORT.md).

## Verified preparation

Ten local test groups cover archive bindings, safe extraction, host setup
failure, collection failure, partial-result retention, deadlines, plain script
transport, and uncertain launch responses. The controlled host tests passed
with local process redirection available. The initial restricted run reached
a workstation permission error at process redirection; the same tests passed
in the permitted environment and on Linux CI.

The fixed Linux image built both executables and reproduced the frozen smoke:
384 native episodes and 96 independent replays. The smoke bytes match their
existing SHA-256 exactly. Both executable hashes and every executable package
payload byte match the inspected CI output. [RUNTIME-CHECK.json](RUNTIME-CHECK.json)
retains those checks and the source-commit metadata difference between the CI
merge checkout and the staged branch package. This establishes runtime and
replay readiness; the full study will provide the comparison result.

The AWS checks verify the AMI, `c6i.xlarge` shape, existing network and role,
versioned encrypted storage, and $0.17 hourly compute price. The host uses one
pinned CPU and 6 GiB of memory. It arms its shutdown timer before setup, gives
the study 45 minutes, reserves five minutes for collection, and terminates on
shutdown. Raw study outputs and compiled executables use conditional writes
with SHA-256 checks. The launch helper retains a submitted request if AWS's
response is uncertain. [PREFLIGHT.json](PREFLIGHT.json) and
[DRY-RUN.json](DRY-RUN.json) preserve the provider observations.

The user approved publication of all research artifacts after automatic
approval review questioned the source and smoke upload. The upload then
completed. [PUBLICATION.json](PUBLICATION.json) records that approval. The
paid-run decision binds separately to the package above and its $0.50 ceiling.

## Shared next decision

Reasoner now tests whether learned guidance earns its full cost against a
matched simple control. FERAL's [full-roster control result](../research-step-22/REPORT.md)
shows why coverage and failures must accompany a small smoke. Solomon's next
fresh-document test must retain suffix-memory controls. ZERO.4 needs joint
retention and final-artifact gates. Weight multiplicity needs a cloud corpus
package that retains each query cost and the resource stop rule. Each project
therefore keeps the same core test: a fixed learned contribution, a strong
simple control, unfamiliar inputs, complete costs, and preserved failures.
