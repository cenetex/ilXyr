#!/bin/bash

set -Eeuo pipefail

for name in WM06P_AMI WM06P_SECURITY_GROUP_ID WM06P_SUBNET_ID WM06P_BUCKET \
  WM06P_REGION WM06P_RUN_ID WM06P_PACKAGE_KEY WM06P_PACKAGE_SHA256 \
  WM06P_ILXYR_COMMIT WM06P_PLAN_SHA256 WM06P_MANIFEST_SHA256 WM06P_LAUNCH_EPOCH; do
  test -n "${!name:-}" || { echo "$name is required" >&2; exit 1; }
done

mode=${1:-}
test "$mode" = dry-run || test "$mode" = launch
test "$WM06P_REGION" = us-east-1
[[ "$WM06P_AMI" =~ ^ami-[0-9a-f]+$ ]]
[[ "$WM06P_SECURITY_GROUP_ID" =~ ^sg-[0-9a-f]+$ ]]
[[ "$WM06P_SUBNET_ID" =~ ^subnet-[0-9a-f]+$ ]]
[[ "$WM06P_RUN_ID" =~ ^[0-9]+$ ]]
[[ "$WM06P_PACKAGE_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$WM06P_ILXYR_COMMIT" =~ ^[0-9a-f]{40}$ ]]
[[ "$WM06P_PLAN_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$WM06P_MANIFEST_SHA256" =~ ^[0-9a-f]{64}$ ]]

tags="ResourceType=instance,Tags=[{Key=Project,Value=ilxyr},{Key=Name,Value=weight-multiplicity-phase06-preflight},{Key=Experiment,Value=weight-multiplicity-phase06-lie-preflight-v1},{Key=RunId,Value=${WM06P_RUN_ID}},{Key=PackageKey,Value=${WM06P_PACKAGE_KEY}},{Key=PackageSha256,Value=${WM06P_PACKAGE_SHA256}},{Key=Bucket,Value=${WM06P_BUCKET}},{Key=Region,Value=${WM06P_REGION}},{Key=IlxyrCommit,Value=${WM06P_ILXYR_COMMIT}},{Key=PlanSha256,Value=${WM06P_PLAN_SHA256}},{Key=ManifestSha256,Value=${WM06P_MANIFEST_SHA256}},{Key=ApprovalId,Value=weight-multiplicity-phase06-lie-preflight-2026-08-31-v1},{Key=LaunchEpoch,Value=${WM06P_LAUNCH_EPOCH}},{Key=MaxInstanceSeconds,Value=1800},{Key=WorkloadTimeoutSeconds,Value=1200},{Key=MaxComputeUsd,Value=1.00},{Key=HourlyPrice,Value=0.68}]"
volume_tags="ResourceType=volume,Tags=[{Key=Project,Value=ilxyr},{Key=Experiment,Value=weight-multiplicity-phase06-lie-preflight-v1},{Key=RunId,Value=${WM06P_RUN_ID}}]"

arguments=(
  --image-id "$WM06P_AMI"
  --instance-type c6i.4xlarge
  --iam-instance-profile Name=zero-training-ec2
  --network-interfaces "DeviceIndex=0,SubnetId=${WM06P_SUBNET_ID},Groups=${WM06P_SECURITY_GROUP_ID},AssociatePublicIpAddress=true,DeleteOnTermination=true"
  --instance-initiated-shutdown-behavior terminate
  --metadata-options "HttpTokens=required,HttpEndpoint=enabled,InstanceMetadataTags=enabled"
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=20,VolumeType=gp3,DeleteOnTermination=true,Encrypted=true}'
  --user-data file://scripts/aws/weight-multiplicity-phase06-preflight-user-data.sh
  --tag-specifications "$tags" "$volume_tags"
  --region "$WM06P_REGION"
  --no-cli-pager
)

if [ "$mode" = dry-run ]; then
  set +e
  output=$(aws ec2 run-instances "${arguments[@]}" --dry-run 2>&1)
  status=$?
  set -e
  test "$status" -ne 0
  printf '%s\n' "$output" | grep -q DryRunOperation
  echo "Phase 0.6 LiE preflight AWS dry-run passed"
  exit 0
fi

aws ec2 run-instances "${arguments[@]}" \
  --query 'Instances[0].InstanceId' --output text
