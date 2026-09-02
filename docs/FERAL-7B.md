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
   sealed unseen-issuer evaluation. Review and record their rights before any corpus use.
2. Use the three exact `examples/corpus/feral-7b-*-braid-import.json` contracts and run
   `ilxyr braid-corpus-register` once for each matching local release manifest.
3. Materialize every imported file plus each `release.json` into versioned cloud storage and record
   read-back verified receipts.
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
| Training and validation | 228,110 | `8d33bb95710fc4d5eb2fe9677fe8268682249551cfaef0c6f473642f7a048162` | `artifact://sha256/a4ae2cbece507b641558a85aab68bd477ee0a154c8f5c61f40856ead710605ab` |
| Sealed future evaluation | 44,704 | `63a772a749f1f57d8de29aa902047de6ac17bed72b800b95251554fabdc88d9c` | `artifact://sha256/4390fe6354c8c6b161c9d801d598383e2da6a7732c1bef5c36c19388e98ee8b4` |
| Sealed unseen-issuer evaluation | 30,668 | `1769782e3ced8e14a945c55cecb21cc0518ebb03da970622125d2af4b870daf4` | `artifact://sha256/3b0d4b9d2b18df7b500ac189eaa6c911abe78e0e4a5943b5c3d0acdaf9d5d1cf` |

The source releases declare `NOASSERTION` and contain no structured rights evidence. The import
contracts therefore keep training, evaluation, and redistribution blocked until the rights review
and the relevant explicit authorization are complete.
