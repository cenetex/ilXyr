# FERAL-7B training lab

FERAL-7B is owned by ilXyr as a training experiment. The surrounding systems have narrower roles:

- Braid builds and releases `dataset://braid/feral-7b-sec/v1`.
- Runner Watch supplies the SEC Qwen trainer and the digest-pinned OCI image.
- A credential-isolated provider adapter supplies the GPU job.
- ilXyr freezes the experiment, admits spend, records dispatch and completion, runs the release
  gates, and settles signed evidence.
- OpenFace publishes the season and model-lineage record.

The legacy `dataset://runner-watch/feral-7b-sec/dev-403` export is smoke-test evidence only. It is
not a Season 00 training input.

## Prepared identities

| Item | Identity |
| --- | --- |
| ilXyr project | `project://ilxyr/feral-7b` |
| Experiment draft | `feral-7b.sec-analysis.v2` |
| Braid training dataset | `dataset://braid/feral-7b-sec/v1` |
| Braid future evaluation | `dataset://braid/feral-7b-sec-future-eval/v1` |
| Braid unseen-issuer evaluation | `dataset://braid/feral-7b-sec-unseen-eval/v1` |
| Base weights | `weight://huggingface/Qwen/Qwen2.5-7B-Instruct@a09a35458c702b33eeacc393d103063234e8bc28` |
| OCI repository | `ghcr.io/atimics/feral-7b-sec-qwen` |

## Setup sequence

1. Braid produces three `RELEASED` v2 releases: train/validation, sealed future evaluation, and
   sealed unseen-issuer evaluation. Their United States project rights are reviewed and recorded;
   every use must keep the recorded controls.
2. Use the three exact `examples/corpus/feral-7b-*-braid-import.json` contracts and run
   `ilxyr braid-corpus-register` once for each matching local release manifest.
3. **Complete:** every imported file plus each `release.json` is in private, versioned,
   access-logged S3 storage and has a read-back verified receipt. See
   [`FERAL-7B-MATERIALIZATION.md`](FERAL-7B-MATERIALIZATION.md).
4. Run Runner Watch's manual FERAL image workflow with a digest-pinned GPU base image. Publishing
   must be explicitly selected. Record the resulting complete OCI digest.
5. Replace only the corpus artifact and OCI placeholders in the v2 experiment draft. Submit the
   four named research contributions, compile the experiment, and run its remaining base-model
   evaluations.
6. Select one provider adapter, collect a live quote, and record the 1% calibration as a separate
   no-adapter attempt. Full training requires a later explicit authorization.

No setup step above grants training authority. ilXyr must continue to report zero spend and no
dispatch until the corpus, image, evaluation, provider, quote, and approval gates all resolve.

## Registered Season 00 release metadata

The three local Braid releases were registered idempotently on 2026-09-02 UTC. Registration only
records their manifests; it does not copy or publish their files.

| Corpus | Examples | Braid release digest | ilXyr corpus artifact |
| --- | ---: | --- | --- |
| Training and validation | 228,110 | `8d33bb95710fc4d5eb2fe9677fe8268682249551cfaef0c6f473642f7a048162` | `artifact://sha256/ee1d545f60fa6f0cb824a1b37e81ff51a1ed88322079be89adcf148169e6c58c` |
| Sealed future evaluation | 44,704 | `63a772a749f1f57d8de29aa902047de6ac17bed72b800b95251554fabdc88d9c` | `artifact://sha256/5cb93c0d38000f0ca42e75b009df025e0557a448ea66865fb3c8c3b1d6f259f6` |
| Sealed unseen-issuer evaluation | 30,668 | `1769782e3ced8e14a945c55cecb21cc0518ebb03da970622125d2af4b870daf4` | `artifact://sha256/cea478e253a9d81f82e83f43309fec4289428673eec260adfa77896a33854748` |

## Verified cloud materializations

The 25 release files, totaling 4,582,297,688 bytes, were materialized and read back from immutable
S3 versions on 2026-09-02 UTC.

| Corpus | ilXyr materialization artifact |
| --- | --- |
| Training and validation | `artifact://sha256/b43f6b676af3e0e1ce1a4cd400cd3e7004c6fc6d048fe405b9742d326cde3732` |
| Sealed future evaluation | `artifact://sha256/5085d3443f6cd56753e4c42a0f9a616e4425401d29812ac575f2d21394483949` |
| Sealed unseen-issuer evaluation | `artifact://sha256/4abc64fe2ebc474a853b4e446fc1ff7c6c74603a84963d5248e9498d44e1252b` |

Materialization did not authorize profiling, evaluation, training, dispatch, or public release.

The source releases retain their immutable `NOASSERTION` field because Braid made no license
decision while building them. ilXyr's separate
[`FERAL-7B SEC Season 00 rights review`](FERAL-7B-RIGHTS-REVIEW.md) conditionally clears the exact
releases for private United States project materialization, training, and evaluation. The reviewed
import contracts record the SEC public-filing reuse policy and the required controls. Raw corpus
redistribution remains prohibited. Training, evaluation, paid compute, and public model release
still require their own later decisions.
