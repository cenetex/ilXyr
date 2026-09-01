#!/bin/bash

set -Eeuo pipefail

BOOT_LOG=/var/log/weight-multiplicity-phase1-tail-calibration.log
exec > >(tee -a "$BOOT_LOG" >/dev/console) 2>&1
set -x

systemd-run --unit=phase1-tail-calibration-emergency-shutdown --on-active=560 \
  /usr/sbin/shutdown -h now

IMDS=http://169.254.169.254/latest
TOKEN=$(curl --fail --silent --show-error --request PUT \
  --header 'X-aws-ec2-metadata-token-ttl-seconds: 21600' "$IMDS/api/token")
metadata() {
  curl --fail --silent --show-error \
    --header "X-aws-ec2-metadata-token: $TOKEN" "$IMDS/meta-data/$1"
}
tag() {
  name=$1
  for _attempt in $(seq 1 30); do
    if value=$(metadata "tags/instance/$name" 2>/dev/null); then
      printf '%s\n' "$value"
      return 0
    fi
    sleep 1
  done
  echo "instance metadata tag did not become available: $name" >&2
  return 1
}

RUN_ID=$(tag RunId)
PACKAGE_KEY=$(tag PackageKey)
PACKAGE_SHA256=$(tag PackageSha256)
BUCKET=$(tag Bucket)
AWS_DEFAULT_REGION=$(tag Region)
ILXYR_COMMIT=$(tag IlxyrCommit)
CALIBRATION_PLAN_SHA256=$(tag CalibrationPlanSha256)
MANIFEST_SHA256=$(tag ManifestSha256)
APPROVAL_ID=$(tag ApprovalId)
LAUNCH_EPOCH=$(tag LaunchEpoch)
MAX_INSTANCE_SECONDS=$(tag MaxInstanceSeconds)
WORKLOAD_TIMEOUT_SECONDS=$(tag WorkloadTimeoutSeconds)
MAX_COMPUTE_USD=$(tag MaxComputeUsd)
HOURLY_PRICE=$(tag HourlyPrice)
INSTANCE_ID=$(metadata instance-id)
INSTANCE_TYPE=$(metadata instance-type)
PREFIX="experiments/weight-multiplicity-phase1-tail-calibration-v1/runs/${RUN_ID}"
STATUS=/tmp/weight-multiplicity-phase1-tail-calibration-status.json
OUT=/opt/ilxyr/out
PHASE=bootstrap
TERMINAL_WRITTEN=0
SYNC_PID=

export AWS_DEFAULT_REGION
test "$AWS_DEFAULT_REGION" = us-east-1
test "$INSTANCE_TYPE" = c6i.4xlarge
test "$MAX_INSTANCE_SECONDS" = 600
test "$WORKLOAD_TIMEOUT_SECONDS" = 480
test "$MAX_COMPUTE_USD" = 0.12
test "$HOURLY_PRICE" = 0.68
test "$APPROVAL_ID" = weight-multiplicity-phase1-tail-calibration-2026-09-01-v1
[[ "$RUN_ID" =~ ^[0-9]+$ ]]
[[ "$PACKAGE_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$ILXYR_COMMIT" =~ ^[0-9a-f]{40}$ ]]
[[ "$CALIBRATION_PLAN_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$MANIFEST_SHA256" =~ ^[0-9a-f]{64}$ ]]
awk -v seconds="$MAX_INSTANCE_SECONDS" -v price="$HOURLY_PRICE" \
  -v ceiling="$MAX_COMPUTE_USD" \
  'BEGIN { exit !(seconds * price / 3600 <= ceiling) }'

remaining=$((LAUNCH_EPOCH + MAX_INSTANCE_SECONDS - $(date +%s)))
test "$remaining" -gt 0
( sleep "$remaining"; shutdown -h now ) &

elapsed_seconds() { printf '%s\n' "$(($(date +%s) - LAUNCH_EPOCH))"; }
estimated_cost() {
  awk -v seconds="$1" -v price="$HOURLY_PRICE" \
    'BEGIN { printf "%.12f", seconds * price / 3600 }'
}
write_status() {
  status=$1
  exit_code=$2
  elapsed=$(elapsed_seconds)
  cost=$(estimated_cost "$elapsed")
  jq -n --arg status "$status" --arg phase "$PHASE" \
    --arg run_id "$RUN_ID" --arg instance_id "$INSTANCE_ID" \
    --arg package_sha256 "$PACKAGE_SHA256" \
    --arg ilxyr_commit "$ILXYR_COMMIT" \
    --arg calibration_plan_sha256 "$CALIBRATION_PLAN_SHA256" \
    --arg manifest_sha256 "$MANIFEST_SHA256" \
    --argjson exit_code "$exit_code" --argjson elapsed "$elapsed" \
    --argjson cost "$cost" \
    '{schema:"ilxyr.weight_multiplicity_phase1_tail_calibration_cloud_status.v1",
      status:$status,phase:$phase,run_id:$run_id,instance_id:$instance_id,
      package_sha256:$package_sha256,ilxyr_commit:$ilxyr_commit,
      calibration_plan_sha256:$calibration_plan_sha256,
      manifest_sha256:$manifest_sha256,exit_code:$exit_code,
      elapsed_instance_seconds:$elapsed,estimated_ec2_usd:$cost}' > "$STATUS"
}
upload_status() {
  aws s3 cp "$STATUS" "s3://${BUCKET}/${PREFIX}/terminal-status.json" \
    --only-show-errors
}
sync_outputs() {
  test -d "$OUT" || return 0
  aws s3 sync "$OUT/" "s3://${BUCKET}/${PREFIX}/state/" --only-show-errors
}
finish() {
  exit_code=$?
  trap - EXIT
  set +e
  test -z "$SYNC_PID" || kill "$SYNC_PID" 2>/dev/null
  sync_outputs
  aws s3 cp "$BOOT_LOG" "s3://${BUCKET}/${PREFIX}/bootstrap.log" \
    --only-show-errors
  if [ "$TERMINAL_WRITTEN" -eq 0 ]; then
    write_status failed "$exit_code"
    upload_status
  fi
  shutdown -h now
  exit "$exit_code"
}
trap finish EXIT

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq bison build-essential ca-certificates curl jq nodejs unzip
if ! command -v aws >/dev/null 2>&1; then
  AWS_CLI_VERSION=2.34.7
  AWS_CLI_SHA256=d6b6e2291456704a441e970bbdb69466629510dd0b578e8812f7856ac64abba1
  curl --fail --silent --show-error --location \
    "https://awscli.amazonaws.com/awscli-exe-linux-x86_64-${AWS_CLI_VERSION}.zip" \
    --output /tmp/awscliv2.zip
  echo "${AWS_CLI_SHA256}  /tmp/awscliv2.zip" | sha256sum --check
  unzip -q /tmp/awscliv2.zip -d /tmp/awscliv2
  /tmp/awscliv2/aws/install --bin-dir /usr/local/bin \
    --install-dir /usr/local/aws-cli
fi

PHASE=package
write_status running 0
upload_status
aws s3 cp "s3://${BUCKET}/${PACKAGE_KEY}" /tmp/package.tar.gz --only-show-errors
test "$(sha256sum /tmp/package.tar.gz | awk '{print $1}')" = "$PACKAGE_SHA256"
install -d -m 0755 /opt/ilxyr/package "$OUT"
tar -xzf /tmp/package.tar.gz -C /opt/ilxyr/package
cd /opt/ilxyr/package
sha256sum --check PACKAGE-SHA256SUMS
test "$(jq -r .ilxyr_commit execution-record.json)" = "$ILXYR_COMMIT"
test "$(jq -r .calibration_plan_sha256 execution-record.json)" = \
  "$CALIBRATION_PLAN_SHA256"
test "$(jq -r .manifest_sha256 execution-record.json)" = "$MANIFEST_SHA256"
test "$(jq -r .expected_queries execution-record.json)" = 26624
test "$(jq -r .tail_calibration_authorized execution-record.json)" = true
test "$(jq -r .corpus_generation_authorized execution-record.json)" = false
test "$(jq -r .model_training_authorized execution-record.json)" = false
test "$(jq -r .model_evaluation_authorized execution-record.json)" = false
test "$(jq -r .oracle_promotion_authorized execution-record.json)" = false
test "$(sha256sum lie-2.2.2.tar.gz | awk '{print $1}')" = \
  "$(jq -r .lie_source_sha256 execution-record.json)"
test "$(sha256sum zero-source.tar.gz | awk '{print $1}')" = \
  "$(jq -r .zero_source_sha256 execution-record.json)"

PHASE=build
write_status running 0
upload_status
SOURCE_DATE_EPOCH=$(jq -r .oracle.primary.source_date_epoch \
  examples/weight-multiplicity/phase1-corpus-plan-v1.json)
export SOURCE_DATE_EPOCH
build_lie() {
  build_dir=$1
  mkdir "$build_dir"
  tar -xzf /opt/ilxyr/package/lie-2.2.2.tar.gz \
    -C "$build_dir" --strip-components=1
  cd "$build_dir"
  make noreadline CFLAGS='-O -D_POSIX_C_SOURCE=200809L'
  test -x "$build_dir/Lie.exe"
}
build_lie /opt/ilxyr/lie-build-a
build_lie /opt/ilxyr/lie-build-b
first_lie_sha256=$(sha256sum /opt/ilxyr/lie-build-a/Lie.exe | awk '{print $1}')
second_lie_sha256=$(sha256sum /opt/ilxyr/lie-build-b/Lie.exe | awk '{print $1}')
test "$first_lie_sha256" = "$second_lie_sha256"
LIE_EXECUTABLE=/opt/ilxyr/lie-build-b/Lie.exe

mkdir /opt/ilxyr/zero-source
tar -xzf /opt/ilxyr/package/zero-source.tar.gz -C /opt/ilxyr/zero-source
cd /opt/ilxyr/zero-source
make weight_multiplicity CFLAGS='-O2 -std=c11 -Wall -Wextra -Wpedantic'
./weight_multiplicity --self-test
ZERO_EXECUTABLE=/opt/ilxyr/zero-source/weight_multiplicity

jq -n \
  --arg lie_source_sha256 "$(sha256sum /opt/ilxyr/package/lie-2.2.2.tar.gz | awk '{print $1}')" \
  --arg first_lie_executable_sha256 "$first_lie_sha256" \
  --arg second_lie_executable_sha256 "$second_lie_sha256" \
  --arg zero_source_sha256 "$(sha256sum /opt/ilxyr/package/zero-source.tar.gz | awk '{print $1}')" \
  --arg zero_source_commit "$(jq -r .zero_commit /opt/ilxyr/package/execution-record.json)" \
  --arg zero_executable_sha256 "$(sha256sum "$ZERO_EXECUTABLE" | awk '{print $1}')" \
  --arg compiler "$(cc --version | head -n 1)" \
  --argjson source_date_epoch "$SOURCE_DATE_EPOCH" \
  '{schema:"ilxyr.weight_multiplicity_phase1_tail_calibration_oracle_builds.v1",
    lie_source_sha256:$lie_source_sha256,
    lie_executable_sha256s:[$first_lie_executable_sha256,$second_lie_executable_sha256],
    lie_executable_hashes_match:($first_lie_executable_sha256==$second_lie_executable_sha256),
    zero_source_sha256:$zero_source_sha256,zero_source_commit:$zero_source_commit,
    zero_executable_sha256:$zero_executable_sha256,
    source_date_epoch:$source_date_epoch,compiler:$compiler,
    lie_source_modified:false,zero_source_modified:false}' > "$OUT/oracle-builds.json"

( while true; do sync_outputs || true; sleep 15; done ) &
SYNC_PID=$!

PHASE=calibration
write_status running 0
upload_status
cd /opt/ilxyr/package
remaining=$((LAUNCH_EPOCH + WORKLOAD_TIMEOUT_SECONDS - $(date +%s)))
test "$remaining" -gt 0
set +e
timeout --signal=TERM --kill-after=30s "${remaining}s" \
  node scripts/run-weight-multiplicity-phase1-corpus.mjs \
    --pilot-only \
    --calibration-plan examples/weight-multiplicity/phase1-tail-calibration-plan-v1.json \
    --plan examples/weight-multiplicity/phase1-corpus-plan-v1.json \
    --manifest examples/weight-multiplicity/phase06-reduced-corpus-manifest-v1.json \
    --systems examples/weight-multiplicity/phase1-root-systems-v1.json \
    --lie "$LIE_EXECUTABLE" \
    --lie-source lie-2.2.2.tar.gz \
    --stdbuf /usr/bin/stdbuf \
    --zero "$ZERO_EXECUTABLE" \
    --zero-commit "$(jq -r .zero_commit execution-record.json)" \
    --out "$OUT/calibration" \
    > "$OUT/runner-stdout.log" 2> "$OUT/runner-stderr.log"
runner_status=$?
set -e
test "$runner_status" = 0 || test "$runner_status" = 2
result_status=$(jq -r .status "$OUT/calibration/runner-summary.json")
test "$result_status" = calibration_complete || test "$result_status" = hold
if [ "$result_status" = calibration_complete ]; then
  test "$(jq -r .trace_records "$OUT/calibration/runner-summary.json")" = 26624
  test "$(jq -r .hard_abort_ms "$OUT/calibration/runner-summary.json")" = 30000
  test "$(jq -r .closures.corpus_generation_authorized "$OUT/calibration/runner-summary.json")" = false
  test "$(jq -r .closures.model_training_authorized "$OUT/calibration/runner-summary.json")" = false
  test "$(jq -r .total_queries "$OUT/calibration/tail-top-50.json")" = 26624
  test "$(jq -r '.top | length' "$OUT/calibration/tail-top-50.json")" = 50
  test ! -e "$OUT/calibration/corpus"
  cd "$OUT/calibration"
  sha256sum --check sha256sums.txt
fi

cd "$OUT"
sha256sum oracle-builds.json runner-stdout.log runner-stderr.log \
  calibration/runner-summary.json > outer-sha256sums.txt
aws s3 sync "$OUT/" "s3://${BUCKET}/${PREFIX}/results/" --only-show-errors

if [ "$result_status" = hold ]; then
  PHASE=calibration
  write_status hold "$runner_status"
else
  PHASE=complete
  write_status complete "$runner_status"
fi
awk -v cost="$(jq -r .estimated_ec2_usd "$STATUS")" \
  -v ceiling="$MAX_COMPUTE_USD" 'BEGIN { exit !(cost <= ceiling) }'
upload_status
TERMINAL_WRITTEN=1
exit 0
