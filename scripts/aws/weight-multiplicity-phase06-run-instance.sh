#!/bin/bash

set -Eeuo pipefail

for name in WM06_AMI WM06_SECURITY_GROUP_ID WM06_SUBNET_ID WM06_BUCKET \
  WM06_REGION WM06_RUN_ID WM06_PACKAGE_KEY WM06_PACKAGE_SHA256 \
  WM06_ILXYR_COMMIT WM06_PLAN_SHA256 WM06_MANIFEST_SHA256 WM06_LAUNCH_EPOCH; do
  test -n "${!name:-}" || { echo "$name is required" >&2; exit 1; }
done

mode=${1:-}
test "$mode" = dry-run || test "$mode" = launch
test "$WM06_REGION" = us-east-1
[[ "$WM06_AMI" =~ ^ami-[0-9a-f]+$ ]]
[[ "$WM06_SECURITY_GROUP_ID" =~ ^sg-[0-9a-f]+$ ]]
[[ "$WM06_SUBNET_ID" =~ ^subnet-[0-9a-f]+$ ]]
[[ "$WM06_RUN_ID" =~ ^[0-9]+$ ]]
[[ "$WM06_PACKAGE_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$WM06_ILXYR_COMMIT" =~ ^[0-9a-f]{40}$ ]]
[[ "$WM06_PLAN_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$WM06_MANIFEST_SHA256" =~ ^[0-9a-f]{64}$ ]]

tags="ResourceType=instance,Tags=[{Key=Project,Value=ilxyr},{Key=Name,Value=weight-multiplicity-phase06},{Key=Experiment,Value=weight-multiplicity-phase06-persistent-lie-v1},{Key=RunId,Value=${WM06_RUN_ID}},{Key=PackageKey,Value=${WM06_PACKAGE_KEY}},{Key=PackageSha256,Value=${WM06_PACKAGE_SHA256}},{Key=Bucket,Value=${WM06_BUCKET}},{Key=Region,Value=${WM06_REGION}},{Key=IlxyrCommit,Value=${WM06_ILXYR_COMMIT}},{Key=PlanSha256,Value=${WM06_PLAN_SHA256}},{Key=ManifestSha256,Value=${WM06_MANIFEST_SHA256}},{Key=ApprovalId,Value=weight-multiplicity-phase06-2026-08-31-v1},{Key=LaunchEpoch,Value=${WM06_LAUNCH_EPOCH}},{Key=MaxInstanceSeconds,Value=1800},{Key=WorkloadTimeoutSeconds,Value=1200},{Key=MaxComputeUsd,Value=1.00},{Key=HourlyPrice,Value=0.68}]"

arguments=(
  --image-id "$WM06_AMI"
  --instance-type c6i.4xlarge
  --iam-instance-profile Name=zero-training-ec2
  --network-interfaces "DeviceIndex=0,SubnetId=${WM06_SUBNET_ID},Groups=${WM06_SECURITY_GROUP_ID},AssociatePublicIpAddress=true,DeleteOnTermination=true"
  --instance-initiated-shutdown-behavior terminate
  --metadata-options "HttpTokens=required,HttpEndpoint=enabled,InstanceMetadataTags=enabled"
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=20,VolumeType=gp3,DeleteOnTermination=true,Encrypted=true}'
  --user-data file://scripts/aws/weight-multiplicity-phase06-user-data.sh
  --tag-specifications "$tags"
  --tag-specifications "ResourceType=volume,Tags=[{Key=Project,Value=ilxyr},{Key=Experiment,Value=weight-multiplicity-phase06-persistent-lie-v1},{Key=RunId,Value=${WM06_RUN_ID}}]"
  --region "$WM06_REGION"
  --no-cli-pager
)

if [ "$mode" = dry-run ]; then
  set +e
  output=$(aws ec2 run-instances "${arguments[@]}" --dry-run 2>&1)
  status=$?
  set -e
  test "$status" -ne 0
  printf '%s\n' "$output" | grep -q DryRunOperation
  echo "Phase 0.6 AWS dry-run passed"
  exit 0
fi

aws ec2 run-instances "${arguments[@]}" \
  --query 'Instances[0].InstanceId' --output text
