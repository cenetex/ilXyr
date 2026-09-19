#!/bin/bash

set -Eeuo pipefail

test "$#" = 3 || {
  echo "usage: $0 LIE_SOURCE_ARCHIVE ZERO_SOURCE_ARCHIVE OUTPUT_PACKAGE" >&2
  exit 1
}

lie_source=$1
zero_source=$2
output=$3
calibration=examples/weight-multiplicity/phase1-tail-calibration-plan-v1.json
plan=examples/weight-multiplicity/phase1-corpus-plan-v1.json
manifest=examples/weight-multiplicity/phase06-reduced-corpus-manifest-v1.json
systems=examples/weight-multiplicity/phase1-root-systems-v1.json
contract=examples/weight-multiplicity/rev3-contract.json
governance=examples/weight-multiplicity/phase06-lie-governance-v1.json
preflight=experiments/weight-multiplicity/phase05/phase06-lie-preflight-closeout-v1.json
authorization=experiments/weight-multiplicity/phase1/PHASE1-TAIL-CALIBRATION-AUTHORIZATION-V1.md
runner=scripts/run-weight-multiplicity-phase1-corpus.mjs

test "$(shasum -a 256 "$lie_source" | awk '{print $1}')" = \
  "$(jq -r .source_bindings.lie_source_sha256 "$calibration")"
test "$(shasum -a 256 "$zero_source" | awk '{print $1}')" = \
  "$(jq -r .source_bindings.zero_source_archive_sha256 "$calibration")"
test "$(shasum -a 256 "$plan" | awk '{print $1}')" = \
  "$(jq -r .source_bindings.phase1_corpus_plan_sha256 "$calibration")"
test "$(shasum -a 256 "$manifest" | awk '{print $1}')" = \
  "$(jq -r .source_bindings.reduced_manifest_sha256 "$calibration")"
test "$(shasum -a 256 "$systems" | awk '{print $1}')" = \
  "$(jq -r .source_bindings.root_systems_sha256 "$calibration")"
test "$(jq -r .threshold_policy.multiplier "$calibration")" = 1.25
test "$(jq -r .threshold_policy.hard_abort_ms "$calibration")" = 30000
test "$(jq -r .closures.corpus_generation_authorized "$calibration")" = false
test "$(jq -r .closures.model_training_authorized "$calibration")" = false

npm run test:weight-multiplicity-phase1-corpus

package_dir=$(mktemp -d)
trap 'rm -rf "$package_dir"' EXIT
mkdir -p "$package_dir/examples/weight-multiplicity" \
  "$package_dir/experiments/weight-multiplicity/phase05" \
  "$package_dir/experiments/weight-multiplicity/phase1" \
  "$package_dir/scripts/lib"
cp "$calibration" "$plan" "$manifest" "$systems" "$contract" "$governance" \
  "$package_dir/examples/weight-multiplicity/"
cp "$preflight" "$package_dir/experiments/weight-multiplicity/phase05/"
cp "$authorization" "$package_dir/experiments/weight-multiplicity/phase1/"
cp "$runner" "$package_dir/scripts/"
cp scripts/lib/oracle-resource-accounting.mjs scripts/lib/oracle-query-batch.mjs \
  scripts/lib/oracle-attempt-trace.mjs "$package_dir/scripts/lib/"
node "$package_dir/scripts/run-weight-multiplicity-phase1-corpus.mjs" --self-test
cp "$lie_source" "$package_dir/lie-2.2.2.tar.gz"
cp "$zero_source" "$package_dir/zero-source.tar.gz"

jq -n \
  --arg ilxyr_commit "$(git rev-parse HEAD)" \
  --arg calibration_plan_sha256 "$(shasum -a 256 "$calibration" | awk '{print $1}')" \
  --arg phase1_plan_sha256 "$(shasum -a 256 "$plan" | awk '{print $1}')" \
  --arg manifest_sha256 "$(shasum -a 256 "$manifest" | awk '{print $1}')" \
  --arg systems_sha256 "$(shasum -a 256 "$systems" | awk '{print $1}')" \
  --arg lie_source_sha256 "$(shasum -a 256 "$lie_source" | awk '{print $1}')" \
  --arg zero_source_sha256 "$(shasum -a 256 "$zero_source" | awk '{print $1}')" \
  --arg zero_commit "$(jq -r .source_bindings.zero_source_commit "$calibration")" \
  --argjson expected_queries "$(jq -r .replay.expected_pilot_queries "$calibration")" \
  '{schema:"ilxyr.weight_multiplicity_phase1_tail_calibration_execution.v1",
    ilxyr_commit:$ilxyr_commit,calibration_plan_sha256:$calibration_plan_sha256,
    phase1_plan_sha256:$phase1_plan_sha256,manifest_sha256:$manifest_sha256,
    root_systems_sha256:$systems_sha256,lie_source_sha256:$lie_source_sha256,
    zero_source_sha256:$zero_source_sha256,zero_commit:$zero_commit,
    expected_queries:$expected_queries,
    build_reproducibility_gate:"two_independent_lie_builds_must_match",
    tail_calibration_authorized:true,corpus_generation_authorized:false,
    model_training_authorized:false,model_evaluation_authorized:false,
    oracle_promotion_authorized:false}' > "$package_dir/execution-record.json"

(
  cd "$package_dir"
  find . -type f ! -name PACKAGE-SHA256SUMS -print0 | sort -z |
    xargs -0 shasum -a 256 > PACKAGE-SHA256SUMS
)
mkdir -p "$(dirname "$output")"
COPYFILE_DISABLE=1 tar -czf "$output" -C "$package_dir" .
shasum -a 256 "$output"
