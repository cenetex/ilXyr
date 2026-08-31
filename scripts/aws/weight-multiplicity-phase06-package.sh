#!/bin/bash

set -Eeuo pipefail

test "$#" = 2 || {
  echo "usage: $0 LIE_SOURCE_ARCHIVE OUTPUT_PACKAGE" >&2
  exit 1
}

lie_source=$1
output=$2
plan=examples/weight-multiplicity/phase06-persistent-lie-plan-v1.json
manifest=examples/weight-multiplicity/phase06-persistent-lie-manifest-v1.json
runner=scripts/run-weight-multiplicity-phase06-persistent-lie.mjs
expected_lie_sha=$(jq -r .lie.source_sha256 "$plan")
actual_lie_sha=$(shasum -a 256 "$lie_source" | awk '{print $1}')
test "$actual_lie_sha" = "$expected_lie_sha"
test -f "$manifest"
test -f "$runner"

npm run test:weight-multiplicity-phase06

package_dir=$(mktemp -d)
trap 'rm -rf "$package_dir"' EXIT
mkdir -p "$package_dir/examples/weight-multiplicity" "$package_dir/scripts"
cp "$plan" "$manifest" "$package_dir/examples/weight-multiplicity/"
cp "$runner" "$package_dir/scripts/"
cp "$lie_source" "$package_dir/lie-2.2.2.tar.gz"

jq -n \
  --arg ilxyr_commit "$(git rev-parse HEAD)" \
  --arg plan_sha256 "$(shasum -a 256 "$plan" | awk '{print $1}')" \
  --arg manifest_sha256 "$(shasum -a 256 "$manifest" | awk '{print $1}')" \
  --arg lie_source_sha256 "$actual_lie_sha" \
  --arg zero_repair_commit "$(jq -r .canonical_names.zero_repair_commit "$plan")" \
  --arg zero_repair_merge_commit "$(jq -r .canonical_names.zero_repair_merge_commit "$plan")" \
  '{schema:"ilxyr.weight_multiplicity_phase06_execution.v1",
    ilxyr_commit:$ilxyr_commit,phase06_plan_sha256:$plan_sha256,
    manifest_sha256:$manifest_sha256,lie_source_sha256:$lie_source_sha256,
    zero_repair_commit:$zero_repair_commit,
    zero_repair_merge_commit:$zero_repair_merge_commit,
    corpus_generation_authorized:false,model_training_authorized:false}' \
  > "$package_dir/execution-record.json"

(
  cd "$package_dir"
  find . -type f ! -name PACKAGE-SHA256SUMS -print0 | sort -z |
    xargs -0 shasum -a 256 > PACKAGE-SHA256SUMS
)
mkdir -p "$(dirname "$output")"
tar -czf "$output" -C "$package_dir" .
shasum -a 256 "$output"
