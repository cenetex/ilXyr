#!/bin/bash
set -Eeuo pipefail

test "$#" = 1 || { echo "usage: $0 OUTPUT_PACKAGE" >&2; exit 1; }
output=$1
test ! -e "$output" || { echo "choose a fresh output path" >&2; exit 1; }
plan=examples/feral-7b/feral-7b-calibration-plan.json
config=examples/feral-7b/feral-7b-calibration-config.toml
receipt=examples/corpus/feral-7b-s3-materialization.json
user_data=scripts/aws/feral-7b-calibration-user-data.sh

git diff --quiet
git diff --cached --quiet
npm run test:feral-calibration
test "$(shasum -a 256 "$config" | awk '{print $1}')" = "$(jq -r .inputs.config_sha256 "$plan")"
test "$(shasum -a 256 "$receipt" | awk '{print $1}')" = "$(jq -r .inputs.receipt_sha256 "$plan")"

package_dir=$(mktemp -d)
checksum_file=$(mktemp)
trap 'rm -rf "$package_dir" "$checksum_file"' EXIT
cp "$plan" "$package_dir/plan.json"
cp "$config" "$package_dir/config.toml"
cp "$receipt" "$package_dir/receipt.json"
cp "$user_data" "$package_dir/user-data.sh"
jq -n \
  --arg commit "$(git rev-parse HEAD)" \
  --arg plan_sha256 "$(shasum -a 256 "$plan" | awk '{print $1}')" \
  --arg config_sha256 "$(shasum -a 256 "$config" | awk '{print $1}')" \
  --arg user_data_sha256 "$(shasum -a 256 "$user_data" | awk '{print $1}')" \
  '{schema:"ilxyr.feral_calibration_package.v1",ilxyr_commit:$commit,
    plan_sha256:$plan_sha256,config_sha256:$config_sha256,
    user_data_sha256:$user_data_sha256,approval_state:"awaiting_human"}' \
  > "$package_dir/execution-record.json"
(
  cd "$package_dir"
  find . -type f ! -name PACKAGE-SHA256SUMS -print0 | sort -z |
    xargs -0 shasum -a 256 > "$checksum_file"
  mv "$checksum_file" PACKAGE-SHA256SUMS
  find . -exec touch -t 197001010000 {} +
  COPYFILE_DISABLE=1 tar -cf package.tar \
    PACKAGE-SHA256SUMS config.toml execution-record.json plan.json receipt.json user-data.sh
  gzip -n package.tar
)
mkdir -p "$(dirname "$output")"
mv "$package_dir/package.tar.gz" "$output"
shasum -a 256 "$output"
