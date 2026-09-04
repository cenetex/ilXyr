#!/bin/bash
set -Eeuo pipefail

BOOT_LOG=/var/log/feral-calibration.log
exec > >(tee -a "$BOOT_LOG" >/dev/console) 2>&1
systemd-run --unit=feral-emergency-shutdown --on-active=10500 /usr/sbin/shutdown -h now
trap '/usr/sbin/shutdown -h now' EXIT

IMDS=http://169.254.169.254/latest
TOKEN=$(curl --fail --silent --show-error --request PUT \
  --header 'X-aws-ec2-metadata-token-ttl-seconds: 21600' "$IMDS/api/token")
metadata() {
  curl --fail --silent --show-error \
    --header "X-aws-ec2-metadata-token: $TOKEN" "$IMDS/meta-data/$1"
}
tag() {
  for _attempt in $(seq 1 30); do
    if value=$(metadata "tags/instance/$1" 2>/dev/null); then
      printf '%s\n' "$value"
      return 0
    fi
    sleep 1
  done
  return 1
}

RUN_ID=$(tag RunId)
PACKAGE_KEY=$(tag PackageKey)
PACKAGE_SHA256=$(tag PackageSha256)
PACKAGE_VERSION=$(tag PackageVersion)
ILXYR_COMMIT=$(tag IlxyrCommit)
PLAN_SHA256=$(tag PlanSha256)
CONFIG_SHA256=$(tag ConfigSha256)
USER_DATA_SHA256=$(tag UserDataSha256)
APPROVAL_ID=$(tag ApprovalId)
LAUNCH_EPOCH=$(tag LaunchEpoch)
INSTANCE_ID=$(metadata instance-id)
test "$(metadata instance-type)" = g6e.2xlarge
test "$(metadata ami-id)" = ami-0d3378afe7683c867
[[ "$RUN_ID" =~ ^[0-9]{8}T[0-9]{6}Z$ ]]
[[ "$APPROVAL_ID" =~ ^feral-7b-calibration-[A-Za-z0-9._-]+$ ]]
[[ "$PACKAGE_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$PLAN_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$CONFIG_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$USER_DATA_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$ILXYR_COMMIT" =~ ^[0-9a-f]{40}$ ]]
[[ "$LAUNCH_EPOCH" =~ ^[0-9]+$ ]]
test "$PACKAGE_KEY" = "packages/${PACKAGE_SHA256}.tar.gz"
remaining=$((LAUNCH_EPOCH + 10800 - $(date +%s)))
test "$remaining" -gt 0
systemd-run --unit=feral-deadline-shutdown --on-active="$remaining" /usr/sbin/shutdown -h now

export AWS_DEFAULT_REGION=us-east-1
BUCKET=ilxyr-feral-7b-calibration-022118847419-us-east-1
PREFIX="runs/${RUN_ID}"
PACKAGE=/opt/feral/package
CORPUS=/opt/feral/corpus
OUT=/opt/feral/out
STATUS=/opt/feral/terminal-status.json
PHASE=bootstrap
TERMINAL_WRITTEN=0
install -d -m 0755 "$PACKAGE" "$CORPUS" "$OUT"
command -v aws
command -v docker
command -v nvidia-smi
command -v jq || dnf install -y jq
systemctl enable --now docker

write_status() {
  elapsed=$(($(date +%s) - LAUNCH_EPOCH))
  jq -n --arg status "$1" --arg phase "$PHASE" \
    --arg run_id "$RUN_ID" --arg instance_id "$INSTANCE_ID" \
    --arg package_sha256 "$PACKAGE_SHA256" --arg approval_id "$APPROVAL_ID" \
    --argjson exit_code "$2" --argjson elapsed "$elapsed" \
    '{schema:"ilxyr.feral_calibration_status.v1",status:$status,phase:$phase,
      run_id:$run_id,instance_id:$instance_id,package_sha256:$package_sha256,
      approval_id:$approval_id,exit_code:$exit_code,elapsed_instance_seconds:$elapsed,
      estimated_ec2_usd:($elapsed * 2.24208 / 3600),max_infrastructure_usd:7,
      full_training_authorized:false,adapter_export_authorized:false}' > "$STATUS"
  aws s3 cp "$STATUS" "s3://${BUCKET}/${PREFIX}/terminal-status.json" --sse AES256 --only-show-errors
}
# shellcheck disable=SC2329
finish() {
  exit_code=$?
  trap - EXIT
  set +e
  docker rm -f feral-profile feral-calibrate >/dev/null 2>&1
  aws s3 cp "$BOOT_LOG" "s3://${BUCKET}/${PREFIX}/bootstrap.log" --sse AES256 --only-show-errors
  if [ "$exit_code" -ne 0 ]; then
    diagnostic_files=(host.json profile-stderr.log profile.json
      calibration-stderr.log calibration/calibration.json)
    for relative in "${diagnostic_files[@]}"; do
      if [ -f "$OUT/$relative" ]; then
        aws s3 cp "$OUT/$relative" "s3://${BUCKET}/${PREFIX}/diagnostics/${relative}" \
          --sse AES256 --only-show-errors
      fi
    done
  fi
  if [ "$TERMINAL_WRITTEN" -eq 0 ]; then
    write_status failed "$exit_code"
  fi
  shutdown -h now
  exit "$exit_code"
}
trap finish EXIT
write_status running 0

PHASE=package
aws s3api get-object --bucket "$BUCKET" --key "$PACKAGE_KEY" \
  --version-id "$PACKAGE_VERSION" /opt/feral/package.tar.gz
test "$(sha256sum /opt/feral/package.tar.gz | awk '{print $1}')" = "$PACKAGE_SHA256"
tar -xzf /opt/feral/package.tar.gz -C "$PACKAGE"
cd "$PACKAGE"
sha256sum --check PACKAGE-SHA256SUMS
test "$(sha256sum plan.json | awk '{print $1}')" = "$PLAN_SHA256"
test "$(sha256sum config.toml | awk '{print $1}')" = "$CONFIG_SHA256"
test "$(jq -r .ilxyr_commit execution-record.json)" = "$ILXYR_COMMIT"
test "$(jq -r .plan_sha256 execution-record.json)" = "$PLAN_SHA256"
test "$(jq -r .config_sha256 execution-record.json)" = "$CONFIG_SHA256"
test "$(jq -r .user_data_sha256 execution-record.json)" = "$USER_DATA_SHA256"
test "$(sha256sum /var/lib/cloud/instance/user-data.txt | awk '{print $1}')" = "$USER_DATA_SHA256"
test "$(jq -r .inputs.config_sha256 plan.json)" = "$CONFIG_SHA256"
test "$(sha256sum receipt.json | awk '{print $1}')" = "$(jq -r .inputs.receipt_sha256 plan.json)"
test "$(jq -r .budget.max_instance_seconds plan.json)" = 10800
test "$(jq -r .budget.max_infrastructure_usd plan.json)" = 7
test "$(jq -r .approval.full_training_authorized plan.json)" = false
test "$(jq -r .approval.adapter_export_authorized plan.json)" = false
IMAGE=$(jq -r .inputs.image plan.json)
[[ "$IMAGE" =~ ^ghcr.io/atimics/feral-7b-sec-qwen@sha256:[0-9a-f]{64}$ ]]

PHASE=corpus
write_status running 0
corpus_bucket=ilxyr-feral-7b-corpus-022118847419-us-east-1
corpus_prefix=corpora/ee1d545f60fa6f0cb824a1b37e81ff51a1ed88322079be89adcf148169e6c58c
test "$(jq -r .corpus_ref receipt.json)" = "$(jq -r .inputs.corpus_ref plan.json)"
while IFS= read -r object; do
  path=$(jq -r .path <<< "$object")
  uri=$(jq -r .uri <<< "$object")
  version=$(jq -r .provider_version <<< "$object")
  digest=$(jq -r .sha256 <<< "$object")
  size=$(jq -r .size_bytes <<< "$object")
  [[ "$path" != /* && "$path" != *..* ]]
  test "$uri" = "s3://${corpus_bucket}/${corpus_prefix}/${path}"
  mkdir -p "$(dirname "$CORPUS/$path")"
  aws s3api get-object --bucket "$corpus_bucket" --key "$corpus_prefix/$path" \
    --version-id "$version" "$CORPUS/$path"
  test "$(sha256sum "$CORPUS/$path" | awk '{print $1}')" = "$digest"
  test "$(stat -c %s "$CORPUS/$path")" = "$size"
done < <(jq -c '.objects[]' receipt.json)

PHASE=image
write_status running 0
docker pull "$IMAGE"
docker image inspect "$IMAGE" > "$OUT/image-inspect.json"
jq -n --arg instance_id "$INSTANCE_ID" --arg image "$IMAGE" \
  --arg kernel "$(uname -r)" --arg docker "$(docker --version)" \
  --arg gpu "$(nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader)" \
  --arg package_sha256 "$PACKAGE_SHA256" --arg plan_sha256 "$PLAN_SHA256" \
  '{schema:"ilxyr.feral_calibration_host.v1",instance_id:$instance_id,
    instance_type:"g6e.2xlarge",ami_id:"ami-0d3378afe7683c867",image:$image,
    kernel:$kernel,docker:$docker,gpu:$gpu,package_sha256:$package_sha256,
    plan_sha256:$plan_sha256}' > "$OUT/host.json"
docker_arguments=(--rm --gpus all --network none --memory 56g --cpus 8 --shm-size 16g
  --mount "type=bind,src=$PACKAGE,dst=/work/package,readonly"
  --mount "type=bind,src=$CORPUS,dst=/work/corpus,readonly"
  --mount "type=bind,src=$OUT,dst=/work/out")
run_bounded() {
  remaining=$((LAUNCH_EPOCH + 9600 - $(date +%s)))
  test "$remaining" -gt 0
  timeout --signal=TERM --kill-after=30s "${remaining}s" "$@"
}

PHASE=profile
write_status running 0
run_bounded docker run --name feral-profile "${docker_arguments[@]}" "$IMAGE" \
  profile /work/package/config.toml --output /work/out/profile.json \
  > "$OUT/profile-stdout.json" 2> "$OUT/profile-stderr.log"
test "$(jq '[.splits[].unusable_examples] | add' "$OUT/profile.json")" = 0

PHASE=calibration
write_status running 0
run_bounded docker run --name feral-calibrate "${docker_arguments[@]}" "$IMAGE" \
  calibrate /work/package/config.toml --sample-fraction 0.01 --output /work/out/calibration \
  > "$OUT/calibration-stdout.json" 2> "$OUT/calibration-stderr.log"
calibration="$OUT/calibration/calibration.json"
test "$(jq -r .sample.ids_sha256 "$calibration")" = "$(jq -r .sample.ids_sha256 plan.json)"
test "$(jq -r .sample.selected_examples "$calibration")" = 1978
test "$(jq -r .config_sha256 "$calibration")" = "$CONFIG_SHA256"
test "$(jq -r .training_authorized "$calibration")" = false
test "$(jq -r .artifact "$calibration")" = null
jq -e '.measurement.tokens_per_device_hour > 0 and .measurement.peak_device_memory_reserved_bytes > 0' "$calibration"
jq -n --slurpfile profile "$OUT/profile.json" --slurpfile calibration "$calibration" \
  --arg profile_sha256 "$(sha256sum "$OUT/profile.json" | awk '{print $1}')" \
  --arg calibration_sha256 "$(sha256sum "$calibration" | awk '{print $1}')" \
  '($profile[0].training.estimated_training_token_passes / $calibration[0].measurement.tokens_per_device_hour) as $hours |
    {schema:"ilxyr.feral_training_estimate.v1",kind:"estimate",
      source_profile_sha256:$profile_sha256,source_calibration_sha256:$calibration_sha256,
      instance_type:"g6e.2xlarge",hourly_compute_usd:2.24208,
      estimated_gpu_hours:$hours,estimated_compute_usd:($hours * 2.24208),
      suggested_compute_ceiling_usd:($hours * 2.24208 * 1.25),
      overhead_fraction:0.25,full_training_authorized:false}' > "$OUT/training-estimate.json"

PHASE=collect
cd "$OUT"
result_files=(profile.json calibration/calibration.json training-estimate.json host.json
  image-inspect.json profile-stdout.json profile-stderr.log
  calibration-stdout.json calibration-stderr.log)
sha256sum "${result_files[@]}" > SHA256SUMS
for file in "${result_files[@]}" SHA256SUMS; do
  aws s3 cp "$file" "s3://${BUCKET}/${PREFIX}/results/$file" --sse AES256 --only-show-errors
done
PHASE=complete
write_status complete 0
TERMINAL_WRITTEN=1
exit 0
