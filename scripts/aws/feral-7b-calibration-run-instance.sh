#!/bin/bash
set -Eeuo pipefail

mode=${1:-}
test "$mode" = dry-run || test "$mode" = launch
for name in FERAL_SUBNET_ID FERAL_SECURITY_GROUP_ID FERAL_PACKAGE_KEY \
  FERAL_PACKAGE_SHA256 FERAL_PACKAGE_VERSION FERAL_ILXYR_COMMIT \
  FERAL_PLAN_SHA256 FERAL_CONFIG_SHA256 FERAL_USER_DATA_SHA256 FERAL_RUN_ID FERAL_LAUNCH_EPOCH; do
  test -n "${!name:-}" || { echo "$name is required" >&2; exit 1; }
done
[[ "$FERAL_SUBNET_ID" =~ ^subnet-[0-9a-f]+$ ]]
[[ "$FERAL_SECURITY_GROUP_ID" =~ ^sg-[0-9a-f]+$ ]]
[[ "$FERAL_RUN_ID" =~ ^[0-9]{8}T[0-9]{6}Z$ ]]
[[ "$FERAL_ILXYR_COMMIT" =~ ^[0-9a-f]{40}$ ]]
[[ "$FERAL_LAUNCH_EPOCH" =~ ^[0-9]+$ ]]
for name in FERAL_PACKAGE_SHA256 FERAL_PLAN_SHA256 FERAL_CONFIG_SHA256 FERAL_USER_DATA_SHA256; do
  [[ "${!name}" =~ ^[0-9a-f]{64}$ ]]
done
test "$(shasum -a 256 scripts/aws/feral-7b-calibration-user-data.sh | awk '{print $1}')" = "$FERAL_USER_DATA_SHA256"
test "$FERAL_PACKAGE_KEY" = "packages/${FERAL_PACKAGE_SHA256}.tar.gz"
[[ "$FERAL_PACKAGE_VERSION" =~ ^[A-Za-z0-9._-]+$ ]]
approval_id=awaiting-human
if [ "$mode" = launch ]; then
  test -n "${FERAL_APPROVAL_ID:-}" || { echo "FERAL_APPROVAL_ID is required for launch" >&2; exit 1; }
  [[ "$FERAL_APPROVAL_ID" =~ ^feral-7b-calibration-[A-Za-z0-9._-]+$ ]]
  test "${FERAL_APPROVED_PACKAGE_SHA256:-}" = "$FERAL_PACKAGE_SHA256"
  test "${FERAL_APPROVED_MAX_USD:-}" = 7
  approval_id=$FERAL_APPROVAL_ID
fi

tags="ResourceType=instance,Tags=[{Key=Project,Value=feral-7b},{Key=Name,Value=feral-7b-calibration},{Key=RunId,Value=${FERAL_RUN_ID}},{Key=PackageKey,Value=${FERAL_PACKAGE_KEY}},{Key=PackageSha256,Value=${FERAL_PACKAGE_SHA256}},{Key=PackageVersion,Value=${FERAL_PACKAGE_VERSION}},{Key=IlxyrCommit,Value=${FERAL_ILXYR_COMMIT}},{Key=PlanSha256,Value=${FERAL_PLAN_SHA256}},{Key=ConfigSha256,Value=${FERAL_CONFIG_SHA256}},{Key=UserDataSha256,Value=${FERAL_USER_DATA_SHA256}},{Key=ApprovalId,Value=${approval_id}},{Key=LaunchEpoch,Value=${FERAL_LAUNCH_EPOCH}}]"
arguments=(
  --image-id ami-0d3378afe7683c867
  --instance-type g6e.2xlarge
  --count 1
  --iam-instance-profile Name=ilxyr-feral-7b-calibration-ec2
  --network-interfaces "DeviceIndex=0,SubnetId=${FERAL_SUBNET_ID},Groups=${FERAL_SECURITY_GROUP_ID},AssociatePublicIpAddress=true,DeleteOnTermination=true"
  --instance-initiated-shutdown-behavior terminate
  --metadata-options "HttpTokens=required,HttpEndpoint=enabled,InstanceMetadataTags=enabled"
  --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=150,VolumeType=gp3,DeleteOnTermination=true,Encrypted=true}'
  --user-data file://scripts/aws/feral-7b-calibration-user-data.sh
  --tag-specifications "$tags" "ResourceType=volume,Tags=[{Key=Project,Value=feral-7b},{Key=RunId,Value=${FERAL_RUN_ID}}]"
  --region us-east-1
  --no-cli-pager
)
if [ "$mode" = dry-run ]; then
  set +e
  result=$(aws ec2 run-instances "${arguments[@]}" --dry-run 2>&1)
  status=$?
  set -e
  test "$status" -ne 0
  printf '%s\n' "$result" | grep -q DryRunOperation
  echo "FERAL calibration AWS dry-run passed"
  exit 0
fi
aws ec2 run-instances "${arguments[@]}" \
  --query 'Instances[0].InstanceId' --output text
