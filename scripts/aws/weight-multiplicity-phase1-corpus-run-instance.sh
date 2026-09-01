#!/bin/bash

set -Eeuo pipefail

for name in WM1C_AMI WM1C_SECURITY_GROUP_ID WM1C_SUBNET_ID WM1C_BUCKET \
  WM1C_REGION WM1C_RUN_ID WM1C_PACKAGE_KEY WM1C_PACKAGE_SHA256 \
  WM1C_ILXYR_COMMIT WM1C_PLAN_SHA256 WM1C_MANIFEST_SHA256 WM1C_LAUNCH_EPOCH; do
  test -n "${!name:-}" || { echo "$name is required" >&2; exit 1; }
done

mode=${1:-}
test "$mode" = dry-run || test "$mode" = launch
test "$WM1C_REGION" = us-east-1
[[ "$WM1C_AMI" =~ ^ami-[0-9a-f]+$ ]]
[[ "$WM1C_SECURITY_GROUP_ID" =~ ^sg-[0-9a-f]+$ ]]
[[ "$WM1C_SUBNET_ID" =~ ^subnet-[0-9a-f]+$ ]]
[[ "$WM1C_RUN_ID" =~ ^[0-9]+$ ]]
[[ "$WM1C_PACKAGE_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$WM1C_ILXYR_COMMIT" =~ ^[0-9a-f]{40}$ ]]
[[ "$WM1C_PLAN_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$WM1C_MANIFEST_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$WM1C_LAUNCH_EPOCH" =~ ^[0-9]+$ ]]

if [ "$mode" = launch ]; then
  launch_now=$(date +%s)
  launch_age=$((launch_now - WM1C_LAUNCH_EPOCH))
  test "$launch_age" -ge 0
  test "$launch_age" -le 60
fi

tags="ResourceType=instance,Tags=[{Key=Project,Value=ilxyr},{Key=Name,Value=weight-multiplicity-phase1-corpus},{Key=Experiment,Value=weight-multiplicity-phase1-corpus-v1},{Key=RunId,Value=${WM1C_RUN_ID}},{Key=PackageKey,Value=${WM1C_PACKAGE_KEY}},{Key=PackageSha256,Value=${WM1C_PACKAGE_SHA256}},{Key=Bucket,Value=${WM1C_BUCKET}},{Key=Region,Value=${WM1C_REGION}},{Key=IlxyrCommit,Value=${WM1C_ILXYR_COMMIT}},{Key=PlanSha256,Value=${WM1C_PLAN_SHA256}},{Key=ManifestSha256,Value=${WM1C_MANIFEST_SHA256}},{Key=ApprovalId,Value=weight-multiplicity-phase1-corpus-2026-08-31-v1},{Key=LaunchEpoch,Value=${WM1C_LAUNCH_EPOCH}},{Key=MaxInstanceSeconds,Value=5400},{Key=WorkloadTimeoutSeconds,Value=4800},{Key=MaxComputeUsd,Value=1.02},{Key=HourlyPrice,Value=0.68}]"
volume_tags="ResourceType=volume,Tags=[{Key=Project,Value=ilxyr},{Key=Experiment,Value=weight-multiplicity-phase1-corpus-v1},{Key=RunId,Value=${WM1C_RUN_ID}}]"

arguments=(
  --image-id "$WM1C_AMI"
  --instance-type c6i.4xlarge
  --iam-instance-profile Name=zero-training-ec2
  --network-interfaces "DeviceIndex=0,SubnetId=${WM1C_SUBNET_ID},Groups=${WM1C_SECURITY_GROUP_ID},AssociatePublicIpAddress=true,DeleteOnTermination=true"
  --instance-initiated-shutdown-behavior terminate
  --metadata-options "HttpTokens=required,HttpEndpoint=enabled,InstanceMetadataTags=enabled"
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=30,VolumeType=gp3,DeleteOnTermination=true,Encrypted=true}'
  --user-data file://scripts/aws/weight-multiplicity-phase1-corpus-user-data.sh
  --tag-specifications "$tags" "$volume_tags"
  --region "$WM1C_REGION"
  --no-cli-pager
)

if [ "$mode" = dry-run ]; then
  set +e
  output=$(aws ec2 run-instances "${arguments[@]}" --dry-run 2>&1)
  status=$?
  set -e
  test "$status" -ne 0
  printf '%s\n' "$output" | grep -q DryRunOperation
  echo "Phase 1 corpus AWS dry-run passed"
  exit 0
fi

aws ec2 run-instances "${arguments[@]}" \
  --query 'Instances[0].InstanceId' --output text
