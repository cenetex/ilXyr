#!/bin/bash

set -Eeuo pipefail

for name in WMCAL_AMI WMCAL_SECURITY_GROUP_ID WMCAL_SUBNET_ID WMCAL_BUCKET \
  WMCAL_REGION WMCAL_RUN_ID WMCAL_PACKAGE_KEY WMCAL_PACKAGE_SHA256 \
  WMCAL_ILXYR_COMMIT WMCAL_PLAN_SHA256 WMCAL_MANIFEST_SHA256 WMCAL_LAUNCH_EPOCH; do
  test -n "${!name:-}" || { echo "$name is required" >&2; exit 1; }
done

mode=${1:-}
test "$mode" = dry-run || test "$mode" = launch
test "$WMCAL_REGION" = us-east-1
[[ "$WMCAL_AMI" =~ ^ami-[0-9a-f]+$ ]]
[[ "$WMCAL_SECURITY_GROUP_ID" =~ ^sg-[0-9a-f]+$ ]]
[[ "$WMCAL_SUBNET_ID" =~ ^subnet-[0-9a-f]+$ ]]
[[ "$WMCAL_RUN_ID" =~ ^[0-9]+$ ]]
[[ "$WMCAL_PACKAGE_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$WMCAL_ILXYR_COMMIT" =~ ^[0-9a-f]{40}$ ]]
[[ "$WMCAL_PLAN_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$WMCAL_MANIFEST_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$WMCAL_LAUNCH_EPOCH" =~ ^[0-9]+$ ]]

if [ "$mode" = launch ]; then
  launch_now=$(date +%s)
  launch_age=$((launch_now - WMCAL_LAUNCH_EPOCH))
  test "$launch_age" -ge 0
  test "$launch_age" -le 60
fi

tags="ResourceType=instance,Tags=[{Key=Project,Value=ilxyr},{Key=Name,Value=weight-multiplicity-phase1-tail-calibration},{Key=Experiment,Value=weight-multiplicity-phase1-tail-calibration-v1},{Key=RunId,Value=${WMCAL_RUN_ID}},{Key=PackageKey,Value=${WMCAL_PACKAGE_KEY}},{Key=PackageSha256,Value=${WMCAL_PACKAGE_SHA256}},{Key=Bucket,Value=${WMCAL_BUCKET}},{Key=Region,Value=${WMCAL_REGION}},{Key=IlxyrCommit,Value=${WMCAL_ILXYR_COMMIT}},{Key=CalibrationPlanSha256,Value=${WMCAL_PLAN_SHA256}},{Key=ManifestSha256,Value=${WMCAL_MANIFEST_SHA256}},{Key=ApprovalId,Value=weight-multiplicity-phase1-tail-calibration-2026-09-01-v1},{Key=LaunchEpoch,Value=${WMCAL_LAUNCH_EPOCH}},{Key=MaxInstanceSeconds,Value=600},{Key=WorkloadTimeoutSeconds,Value=480},{Key=MaxComputeUsd,Value=0.12},{Key=HourlyPrice,Value=0.68}]"
volume_tags="ResourceType=volume,Tags=[{Key=Project,Value=ilxyr},{Key=Experiment,Value=weight-multiplicity-phase1-tail-calibration-v1},{Key=RunId,Value=${WMCAL_RUN_ID}}]"

arguments=(
  --image-id "$WMCAL_AMI"
  --instance-type c6i.4xlarge
  --iam-instance-profile Name=zero-training-ec2
  --network-interfaces "DeviceIndex=0,SubnetId=${WMCAL_SUBNET_ID},Groups=${WMCAL_SECURITY_GROUP_ID},AssociatePublicIpAddress=true,DeleteOnTermination=true"
  --instance-initiated-shutdown-behavior terminate
  --metadata-options "HttpTokens=required,HttpEndpoint=enabled,InstanceMetadataTags=enabled"
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=30,VolumeType=gp3,DeleteOnTermination=true,Encrypted=true}'
  --user-data file://scripts/aws/weight-multiplicity-phase1-tail-calibration-user-data.sh
  --tag-specifications "$tags" "$volume_tags"
  --region "$WMCAL_REGION"
  --no-cli-pager
)

if [ "$mode" = dry-run ]; then
  set +e
  output=$(aws ec2 run-instances "${arguments[@]}" --dry-run 2>&1)
  status=$?
  set -e
  test "$status" -ne 0
  printf '%s\n' "$output" | grep -q DryRunOperation
  echo "Phase 1 tail calibration AWS dry-run passed"
  exit 0
fi

aws ec2 run-instances "${arguments[@]}" \
  --query 'Instances[0].InstanceId' --output text
