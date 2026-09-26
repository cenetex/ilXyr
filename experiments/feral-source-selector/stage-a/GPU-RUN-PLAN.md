# Stage A 4B cloud comparison plan

The source study uses three real SEC filing families, 60 frozen concepts, and
36 question forms. The deterministic selector has 36 complete outcomes on the
development forms. The 4B result is pending. The learned worker receives the
same questions, issuer list, concept list, exact fact resolver, and operation
rules. Answer labels and support IDs stay outside its source archive.

## Frozen candidate

- Public checkpoint: `Qwen/Qwen3.5-4B` at revision
  `851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a`.
- Runtime image: `ghcr.io/atimics/feral-7b-sec-qwen@sha256:c7df646b246f9c853946201aa7ad5c06ea711c34633594943365153342df346b`.
- The host fetches all nine pinned files, including 9,319,828,096 weight
  bytes, from the revision URL and checks every size and SHA-256.
- Source archive: `MODEL-PACKAGE.json` and `scripts/feral_stage_a_package.py`.
  It is about 1.45 MB and contains the 36 model inputs and the source view.
  Runtime model files sit on the encrypted 150 GB root volume. The volume
  has delete-on-termination enabled.
- Generation: one response per form, seed 17, 160 output tokens maximum,
  temperature 0.7, top-p 0.8, top-k 20. A one-form loader smoke precedes the
  36-form run on the same host and runtime.

## Local smoke

On Transformers 5.16.1, the pinned tokenizer and chat template rendered all
36 prompts with `enable_thinking=False`. They span 2,210–2,225 tokens under
the 4,096-token input cap. First rendered prompt SHA-256:
`4f550bc573b0d49dc1a12d3bbd528db02bdd5f5440a2272e258a50fae72ab836`.
Last: `eda3c076511dbba4322ff622c86b5aa998ddffe62292dd9e17b485250f601bbd`.
This local smoke loaded tokenizer files. The GPU host records the actual
model load, generated text, elapsed time, and peak allocated GPU memory.

## Cost and controls

The public AWS EC2 map published 2026-09-25 at 17:45:21 UTC quotes
`g6e.2xlarge` Linux in us-east-1 at $2.24208/hour, rate code
`HK3A8PU2TSC6EKP6.JRTCKXETXF.6YS6EN2CT7`. The preflight refreshes the
map and enforces the $3.00 before-tax ceiling. One hour of compute plus a
$0.75 reserve totals $2.99208 before tax. The reserve allocation is:

| Item | Reserved USD | Basis |
| --- | ---: | --- |
| Encrypted 150 GB gp3 root volume | 0.03 | 150 GB at $0.08/GB-month is about $0.0167/hour; the 9.3 GB model cache is inside this volume. |
| Public IPv4 | 0.01 | One address at $0.005/hour. |
| S3 storage and requests | 0.05 | About 1.45 MB package plus compact logs/results; versioned retention is included. |
| Internet and other transfer | 0.10 | Public model download is inbound; this covers small result transfer and variance. |
| Contingency | 0.56 | Covers rate and billing variance within the ceiling. |

The host uses the existing us-east-1 AMI `ami-0d3378afe7683c867`, 150 GB
encrypted gp3 root volume, IMDSv2, and the FERAL instance profile. Its user
data arms a shutdown watchdog before source, image, or model setup. It runs
Docker with no network for inference. It writes exact raw rows, receipts,
logs, and a terminal record to versioned S3 objects. The instance terminates
on shutdown. Observation must confirm termination and collect the exact
object versions before the learned result is scored or reported.

## Command sequence

The launcher uses a committed source archive. Stage and preflight are control
operations. `launch` creates one paid instance. The operator supplies the
configured `default` AWS profile and a network JSON with `subnet_id` and
`security_group_id` from the recorded provider setup.

```text
python3 scripts/feral_stage_a_gpu.py stage --out /private/feral-stage-a-stage
python3 scripts/feral_stage_a_gpu.py preflight --binding /private/feral-stage-a-stage/BINDING.json --network /private/feral-network.json --out /private/feral-stage-a-preflight
python3 scripts/feral_stage_a_gpu.py launch --binding /private/feral-stage-a-stage/BINDING.json --network /private/feral-network.json --preflight /private/feral-stage-a-preflight/PREFLIGHT.json --authorization /private/feral-stage-a-authorization.json --out /private/feral-stage-a-launch
python3 scripts/feral_stage_a_gpu.py observe --launch /private/feral-stage-a-launch/LAUNCH.json --out /private/feral-stage-a-observation
python3 scripts/feral_stage_a_gpu.py collect --launch /private/feral-stage-a-launch/LAUNCH.json --out /private/feral-stage-a-results
```

The launch receipt gives the run ID and instance ID for read-only observation.
The authorization JSON binds the exact staged source SHA-256 and version,
a single fixed `run_id`, one run, 3,600 seconds, the $3.00 before-tax ceiling, and reference
`user-four-priorities-2026-09-26` using schema
`ilxyr.feral_stage_a_gpu_authorization.v1`.
Collection checks termination, each exact S3 version and SHA-256, and the
terminal source identity. A failed run still keeps its output and failure
receipt for diagnosis.
The run is a development comparison. The fixed questions and deterministic
control were tuned on these forms, so this run alone cannot establish a
held-out gain.
