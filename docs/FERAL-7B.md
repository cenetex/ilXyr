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
   sealed unseen-issuer evaluation. Each carries the reviewed rights statement.
2. Copy the three `examples/corpus/feral-7b-*-braid-import.json` contracts, replace their release
   IDs, raw manifest hashes, exact Braid revision, and rights, then run
   `ilxyr braid-corpus-register` once for each release.
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
