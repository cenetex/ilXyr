# FERAL-7B Season 00 corpus materialization

**State:** complete and verified on 2026-09-02 UTC.

The three reviewed Braid releases are materialized in private Amazon S3 storage in `us-east-1`.
This closes the corpus-materialization gate only. It does not authorize profiling, evaluation,
training, model publication, or additional spend.

## Recorded materializations

| Corpus | Files | Bytes | ilXyr materialization artifact |
| --- | ---: | ---: | --- |
| Training and validation | 9 | 3,336,332,515 | `artifact://sha256/b43f6b676af3e0e1ce1a4cd400cd3e7004c6fc6d048fe405b9742d326cde3732` |
| Sealed future evaluation | 8 | 776,439,596 | `artifact://sha256/5085d3443f6cd56753e4c42a0f9a616e4425401d29812ac575f2d21394483949` |
| Sealed unseen-issuer evaluation | 8 | 469,525,577 | `artifact://sha256/4abc64fe2ebc474a853b4e446fc1ff7c6c74603a84963d5248e9498d44e1252b` |

The total is 25 objects and 4,582,297,688 bytes. The complete receipts are:

- [`feral-7b-s3-materialization.json`](../examples/corpus/feral-7b-s3-materialization.json)
- [`feral-7b-future-eval-s3-materialization.json`](../examples/corpus/feral-7b-future-eval-s3-materialization.json)
- [`feral-7b-unseen-eval-s3-materialization.json`](../examples/corpus/feral-7b-unseen-eval-s3-materialization.json)

## Verification

Before upload, every local file matched the Braid release size and SHA-256. The materializer then:

1. uploaded each file with its expected SHA-256 as an S3 checksum and object metadata;
2. captured the immutable S3 version ID;
3. fetched that exact version back through a streaming reader;
4. recomputed SHA-256 over the returned bytes; and
5. registered the complete receipt against the exact ilXyr corpus artifact.

The ilXyr service validated the complete receipts before recording the three artifact references
above. Its fail-closed checks reject a missing, extra, size-drifted, digest-drifted, or
out-of-prefix object.

## Storage controls

CloudFormation stack `IlxyrFeral7BCorpusMaterialization` owns two retained buckets:

- `ilxyr-feral-7b-corpus-022118847419-us-east-1` stores the corpus; and
- `ilxyr-feral-7b-access-logs-022118847419-us-east-1` stores access logs.

Both buckets block public access, require TLS, use S3-managed AES-256 encryption, enforce bucket
ownership, and keep versioning enabled. The corpus bucket sends server-access logs to the separate
log bucket. Access logs are retained for seven years. No credentials or raw corpus bytes are
committed to Git.

At the current corpus size, the expected S3 Standard storage charge is about USD 0.11 per month,
plus negligible request and log-storage charges. This operation started no GPU, training job, or
provider compute instance.
