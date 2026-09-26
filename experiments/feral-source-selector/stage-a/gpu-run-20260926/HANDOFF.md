# Stage A GPU run handoff

Run `feral-stage-a-20260926T233819Z` started on EC2 instance
`i-06dd8a22487bef678` at 2026-09-26 23:38:31 UTC. Its shutdown watchdog
deadline is 2026-09-27 00:38:01 UTC. The instance limit ends at 00:38:31 UTC.
The cap is one `g6e.2xlarge` host, 3,600 seconds, and $3.00 before tax.

The source-only package SHA-256 is
`cb5aeb940b38e27e4bd88de91996b88e23f5508eeb44ca404d8eb5d8d256dd28`,
S3 version `zKNe1KPIYDk76zcIyAPTlmoF2WbjXxnN`. The launch receipt binds
the request, authorization, source, image, and user-data digests. The host
downloads public model files at the pinned revision and verifies every file
size and SHA-256 before loading the model. It runs a one-form loader smoke,
then the 36-form comparison if the smoke succeeds.

## Read-only observation and collection

Run from the ilXyr repository with the configured AWS `default` profile:

```sh
python3 scripts/feral_stage_a_gpu.py observe \
  --launch experiments/feral-source-selector/stage-a/gpu-run-20260926/LAUNCH.json \
  --out /tmp/feral-stage-a-observe-final
python3 scripts/feral_stage_a_gpu.py collect \
  --launch experiments/feral-source-selector/stage-a/gpu-run-20260926/LAUNCH.json \
  --out /tmp/feral-stage-a-collected
```

Collection starts after EC2 reports `terminated`. It retrieves each exact S3
object version and checks its SHA-256. `COLLECTION.json` records every object
path, version, byte count, and hash, plus run, instance, source, and user-data
identity. Keep all `RAW.jsonl`, output, log, and failure files in the collected
directory and versioned S3 objects. A failed terminal state is useful
evidence for the next diagnosis.

Check the instance and attached resources after termination:

```sh
aws ec2 describe-instances --instance-ids i-06dd8a22487bef678 \
  --profile default --region us-east-1 \
  --query 'Reservations[*].Instances[*].[InstanceId,State.Name]' --output json
aws ec2 describe-volumes \
  --filters Name=tag:RunId,Values=feral-stage-a-20260926T233819Z \
  --profile default --region us-east-1 \
  --query 'Volumes[*].[VolumeId,State,Attachments]' --output json
aws ec2 describe-network-interfaces \
  --filters Name=attachment.instance-id,Values=i-06dd8a22487bef678 \
  --profile default --region us-east-1 \
  --query 'NetworkInterfaces[*].[NetworkInterfaceId,Status]' --output json
```

The expected final state is `terminated` with empty volume and interface
results. The volume query uses the run tag and catches a detached root volume.

## Score a complete run

```sh
python3 scripts/feral_stage_a_gpu_score.py \
  --launch experiments/feral-source-selector/stage-a/gpu-run-20260926/LAUNCH.json \
  --results /tmp/feral-stage-a-collected \
  --out /tmp/feral-stage-a-scored
```

The scorer checks the collection manifest and terminal identity, smoke and
full-run receipts, raw-output digests, all 36 input IDs, exact prediction
replay, and frozen label hashes. It emits `LEARNED-SCORE.json` and
`SCORE-REVIEW.json`. Commit compact score and collection receipts in a result
PR after resource cleanup checks. Keep the raw row files in S3 and the
collected directory. This is a development screen on fixed questions; a
held-out gain needs a separate frozen evaluation.
