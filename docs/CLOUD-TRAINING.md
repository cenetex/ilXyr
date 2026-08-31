# Cloud training jobs

ilXyr has a small provider-neutral contract for reproducible training. It records a cloud job; it
does not hold AWS, Azure, or Kubernetes credentials.

## Frozen inputs

An `oci-job` experiment must use a digest-pinned image:

```text
oci://ghcr.io/example/sec-qwen@sha256:<64 lowercase hex characters>
```

Add each `dataset://` handle to `datasets`, then bind it to the exact corpus release artifact in
`dataset_bindings`. Compilation resolves the registry and rejects a different artifact under the
same handle. The compiled experiment copies these refs into `resolved_datasets` and its evidence
provenance.

Before submission, copy the corpus to S3 or Azure Blob, read it back, and record an
`ilxyr.corpus_materialization.v1` receipt. See [CORPUS-SERVICE.md](CORPUS-SERVICE.md).

## Job lifecycle

After normal compile, forecast, fund, and admit steps:

```bash
ilxyr oci-dispatch-record WORKSPACE dispatch.json
ilxyr oci-complete-record WORKSPACE completion.json
ilxyr attest WORKSPACE RUN_REF dsse-envelope.json
ilxyr oci-settle WORKSPACE EXPERIMENT_ID
```

The dispatch contains the compiled ref, provider job ref, executor identity, idempotency key, and
one verified materialization ref per frozen dataset. An exact retry returns the existing ref. A
changed retry is rejected.

The completion contains the exit result, all declared metrics, and all declared `artifacts.*`
outputs. Each artifact records its URI, SHA-256, byte size, media type, and immutable provider
version. Failed jobs must not claim metrics or output artifacts.

Completion alone is not evidence. `oci-settle` requires a DSSE/in-toto attestation whose run digest
and executor identity match the ledger and a trusted executor key. This split lets an operator
recover from a crash at every boundary without trusting an unsigned provider response.

Examples are in `examples/cloud/oci-dispatch.json` and `examples/cloud/oci-completion.json`.

## Provider adapter responsibilities

The adapter must:

1. use the exact image digest, arguments, timeout, and network policy;
2. use only the materialized objects and versions named by the dispatch;
3. hash mounted data before training;
4. write content-addressed or versioned outputs;
5. reconcile provider status into the completion object; and
6. sign the final run digest with the executor's trusted key.

The adapter may translate this contract to SageMaker, Azure ML, Kubernetes Jobs, or another OCI
runner. Provider-specific instance types and IAM roles stay in deployment configuration, outside
the frozen research result.
