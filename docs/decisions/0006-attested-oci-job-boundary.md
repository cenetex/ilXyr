# ADR 0006: Attested OCI job boundary

## Status

Accepted.

## Context

ilXyr can freeze a corpus and describe its verified S3 or Azure copy, but a long-running training
job cannot safely use the synchronous local executor. Cloud training also has failure points
between submission, provider completion, artifact upload, attestation, and evidence settlement.

## Decision

Add a provider-neutral `oci-job` executor contract.

- The experiment freezes an `oci://...@sha256:<digest>` image.
- `dataset_bindings` map every dataset handle to an exact registered corpus artifact.
- The dispatch maps every frozen corpus to an exact verified materialization artifact.
- `ExecutionStarted` stores the immutable dispatch and its provider job reference.
- `ExperimentCompleted` stores the reconciled run, exact metric set, and versioned output artifacts.
- Completion does not promote evidence.
- Settlement requires a verified DSSE signature from a trusted key bound to the dispatched executor.

Submission stays outside the core. An AWS, Azure, Kubernetes, or other adapter may call its provider
API, but it only records facts through the same contract. Provider credentials never enter the
ledger.

## Consequences

Retries are safe when they submit the same dispatch or completion object. A changed retry fails.
Jobs can be resumed after a client crash because provider references and completion state are
durable. The core does not poll providers or claim that an output is trusted before attestation.

The first profile accepts public weights, denied network access, approved images, and artifact
export. More sensitive weight classes need a separate policy decision and stronger isolation.
