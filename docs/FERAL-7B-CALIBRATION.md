# FERAL-7B calibration preparation

The next compute decision is one bounded profiling and calibration attempt. Its proposed budget is
USD 7. The plan binds the receipt-enabled Runner Watch revision and its published image digest in
[`feral-7b-calibration-plan.json`](../examples/feral-7b/feral-7b-calibration-plan.json).

## Prepared inputs

| Item | Value |
| --- | --- |
| Plan | `feral-7b.sec-calibration.v1` |
| Trainer source | `974bb2d39d07c05cfe7fdf03e8d0b2e1552ae7c8` |
| Trainer image | `ghcr.io/atimics/feral-7b-sec-qwen@sha256:c7df646b246f9c853946201aa7ad5c06ea711c34633594943365153342df346b` |
| Qwen revision | `a09a35458c702b33eeacc393d103063234e8bc28` |
| Corpus | The nine exact S3 versions in the training materialization receipt |
| Sample | 1,978 of 197,738 training examples; lowest SHA-256 example IDs |
| Sample ID hash | `7ce052095f2504979df8830436cb8fe0579fa3bfd51099f1539c32bf122da13b` |
| Settings | Two epochs, seed 17, sequence length 8,192, LoRA rank 32 |
| Host | One AWS `g6e.2xlarge`, us-east-1, one NVIDIA L40S |
| Machine image | `ami-0d3378afe7683c867`, AWS owner `898082745236` |
| Storage | 150 GiB encrypted gp3; private versioned result storage |
| Time limit | Three hours from the launch request; workload deadline at 160 minutes |
| Budget | USD 7 for one attempt |

The [image build](https://github.com/atimics/runner-watch/actions/runs/33848581774) succeeded.
An anonymous registry read verified the published image index and its Linux AMD64 manifest.
AWS lists G6e support and the NVIDIA container toolkit in the
[machine-image release notes](https://docs.aws.amazon.com/dlami/latest/devguide/aws-deep-learning-ami-gpubaseoss-al2023-2026-08-26.html).

The AWS price quote records USD 2.24208 per instance-hour. Three hours cost USD 6.72624.
The USD 7 cap includes room for the temporary disk, public IPv4 address, and small result objects.
Refresh the quote during preflight. A changed price or package requires a fresh approval.

## Scope and outputs

The worker first checks all nine corpus files against their exact S3 versions, sizes, and hashes.
It then profiles the full train and validation splits with the frozen tokenizer. A base-model check
uses the deterministic 1% validation view to measure quality, generation time, and memory. The 1%
LoRA calibration follows and measures training speed and trainer-process and GPU memory use.
The final estimate projects the full-training compute cost with a 25% margin.

The worker exports private corpus, base-model, calibration, host, cost-estimate, checksum, and status
records.
If a phase fails, it exports a fixed allowlist of host metadata, phase stderr, and partial structured
results before shutdown. Corpus files stay outside the diagnostics prefix.
The result uses `artifact: null`. Full training and model release each use a later approval.
The future and unseen-issuer evaluation sets stay sealed during this operational measurement.
Their base-model results remain gates for the full training experiment and release decision.

## Approval path

1. Use the published receipt-enabled Runner Watch image from revision
   `974bb2d39d07c05cfe7fdf03e8d0b2e1552ae7c8`.
2. Verify the plan and profile bindings to that image and revision.
3. Merge the refreshed package code after its checks pass.
4. Deploy `scripts/aws/feral-7b-calibration.yaml` with the existing VPC ID.
5. Build the archive with `bash scripts/aws/feral-7b-calibration-package.sh OUTPUT_PACKAGE`.
6. Store it at `packages/SHA256.tar.gz` with AES256 encryption. Record its S3 version and read-back hash.
7. Verify the AWS account, machine image, instance shape, quota, subnet selection mode, security group, role, and price.
8. Run `feral-7b-calibration-run-instance.sh dry-run` with the exact package fields.
9. Present the package SHA-256 and USD 7 cap for human approval.
10. Record the approval ID, approved package hash, and approved USD limit. Launch the single attempt.
11. Collect the terminal record and verify instance termination. Import the small result records through a PR.

The launch command requires `FERAL_APPROVAL_ID`, `FERAL_APPROVED_PACKAGE_SHA256`, and
`FERAL_APPROVED_MAX_USD=7`. The bootstrap script checks its own hash against the package.
Set `FERAL_SUBNET_ID` to a verified subnet ID for a fixed zone. Set it to `auto` only with the
default VPC security group so EC2 can choose an available default subnet in the approved region.
The host arms its shutdown timer before setup. The container has private mounts and isolated networking.
The AWS role has read access to the exact training prefix and write access to the calibration result prefix.
SSM supplies the host management channel.
