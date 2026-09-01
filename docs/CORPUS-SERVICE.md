# Corpus as a Service

## Purpose

The corpus service exposes governed Braid-style corpus releases to model-training systems without
giving a cloud provider authority over the research contract. It is a small authenticated HTTP
boundary over the existing content-addressed ilxyr workspace.

The service records metadata and verified delivery receipts. It does not upload data, hold cloud
credentials, submit training jobs, or authorize training. A materializer copies the files, reads
them back, checks their sizes and SHA-256 digests, and submits the resulting receipt.

```text
Braid release manifest
        |
        v
Corpus service ----> immutable corpus artifact
        |
        v
Verified S3 or Azure Blob receipt
        |
        +----> SageMaker InputDataConfig handoff
        |
        `----> Azure ML data-asset and job-input handoff
```

## Contracts

`ilxyr.corpus_release.v1` records:

- a stable `dataset://` or `representation://` ID;
- its release version and immutable source revision;
- rights and use constraints;
- every relative file path, byte size, media type, and SHA-256 digest; and
- optional plain-string metadata such as the Braid split policy.

Registration is idempotent. Repeating the same release returns the same artifact reference.
Changing any field under an existing ID is rejected.

`ilxyr.corpus_materialization.v1` binds that artifact reference to one S3 or Azure Blob prefix. It
must contain exactly the same file paths, sizes, and hashes as the corpus. Each object also names
the provider's version identifier and the service identity that verified the copied bytes.

The JSON Schemas are:

- `schemas/braid-corpus-import.schema.json`
- `schemas/corpus-release.schema.json`
- `schemas/corpus-materialization.schema.json`
- `schemas/sagemaker-corpus-handoff.schema.json`
- `schemas/azure-ml-corpus-handoff.schema.json`

## Import a Braid release

ilXyr can register a verified Braid `braid.release/v2` directory without rebuilding or copying the
corpus. Start from `examples/corpus/feral-7b-braid-import.json` and replace the release ID, raw
`release.json` SHA-256, reviewed rights, and exact Braid source revision. Then run:

```bash
ilxyr braid-corpus-register \
  /path/to/ilxyr-workspace \
  /path/to/braid-release/release.json \
  /path/to/feral-7b-braid-import.json
```

The importer requires `RELEASED` status, verifies the out-of-band release ID and manifest hash,
checks that the release ID is bound to its release digest, rejects unsafe or duplicate artifact
paths, and requires every named training file. It records the raw `release.json` as part of the
ilXyr corpus file inventory. The resulting `artifact://sha256/...` is the exact value used in the
experiment's `dataset_bindings` map.

FERAL-7B uses the same importer for three separate Braid releases. The training contract requires
`data/train.jsonl` and `data/validation.jsonl`; the future and unseen-issuer contracts each require
their own `data/test.jsonl`. Keeping two evaluation releases prevents their preregistered scores
from being silently combined.

Registration does not authorize training and does not upload data. The later materialization
receipt must cover the imported Braid artifacts and `release.json` exactly.

## Start the service

Create or select an ilxyr workspace, provide a bearer token of at least 32 bytes, and start the
service:

```bash
cargo run -p ilxyr-cli -- init /path/to/corpus-workspace
export ILXYR_CORPUS_TOKEN='replace-with-a-random-secret-of-at-least-32-bytes'
cargo run -p ilxyr-corpus-service -- /path/to/corpus-workspace
```

The default address is `127.0.0.1:8787`. A non-loopback address is rejected unless
`ILXYR_CORPUS_ALLOW_REMOTE=true` is set. Remote use must put TLS, identity-aware access, request
limits, and audit controls in front of the service. The bearer token is read from the environment
and is never written to an ilxyr object or event.

The health endpoint is public:

```bash
curl http://127.0.0.1:8787/healthz
```

All `/v1` routes require `Authorization: Bearer $ILXYR_CORPUS_TOKEN`.

## Register and inspect a corpus

```bash
curl -sS http://127.0.0.1:8787/v1/corpora \
  -H "Authorization: Bearer $ILXYR_CORPUS_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @examples/corpus/braid-corpus-five.json
```

The response includes `artifact_ref`. Its final 64 hexadecimal characters are the corpus digest.
Inspect it through:

```text
GET /v1/corpora/{corpus-digest}
```

Use that full artifact reference in the materialization receipt's `corpus_ref` field. The checked-in
release, S3, and Azure documents are non-production examples with placeholder hashes, sizes,
rights, revisions, and provider versions. Replace all of them from a real Braid release and the
materializer's read-back verification.

## Record a verified materialization

```bash
curl -sS http://127.0.0.1:8787/v1/materializations \
  -H "Authorization: Bearer $ILXYR_CORPUS_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @path/to/completed-s3-materialization.json
```

The service rejects missing files, extra files, duplicate paths, digest or size drift, a provider
URI outside the declared base prefix, empty provider versions, and non-service verifiers. The
materialization can be inspected through:

```text
GET /v1/materializations/{materialization-digest}
```

## SageMaker handoff

Submit the materialization artifact reference, not its mutable S3 location alone:

```bash
curl -sS http://127.0.0.1:8787/v1/handoffs/sagemaker \
  -H "Authorization: Bearer $ILXYR_CORPUS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "materialization_ref":"artifact://sha256/REPLACE_ME",
    "channel_name":"training",
    "content_type":"application/x-jsonlines",
    "input_mode":"File"
  }'
```

The response contains one SageMaker `InputDataConfig` channel, tags carrying both ilxyr digests,
the complete expected file inventory, and the verified S3 object versions. An authenticated
executor adapter can place the provider fields into `CreateTrainingJob`, then hash the mounted
files before training. The service does not choose an image, role, instance type, output bucket,
or training hyperparameters.

## Azure ML handoff

```bash
curl -sS http://127.0.0.1:8787/v1/handoffs/azure-ml \
  -H "Authorization: Bearer $ILXYR_CORPUS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "materialization_ref":"artifact://sha256/REPLACE_ME",
    "asset_name":"braid-corpus-five",
    "input_name":"training_data",
    "mode":"ro_mount"
  }'
```

The response contains an Azure ML `uri_folder` data-asset description, a named job input, the
complete expected file inventory, and verified Blob versions. The corpus SHA-256 becomes the data
asset version. An authenticated Azure adapter creates that asset, attaches the returned input to a
command job, and hashes the mounted or downloaded files before training.

## Security boundary

This first service slice remains single-writer. An in-process lock prevents concurrent requests
from interleaving workspace writes, but it is not a multi-tenant authorization system. Do not put
sensitive corpus paths, provider credentials, or private access tokens in release or receipt
objects. Production multi-tenant use still requires the controls listed in `docs/SECURITY.md`.
