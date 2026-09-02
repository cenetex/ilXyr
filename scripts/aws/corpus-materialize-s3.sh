#!/bin/bash

set -Eeuo pipefail

test "$#" = 7 || {
  echo "usage: $0 CORPUS_RELEASE_JSON RELEASE_DIR CORPUS_REF BUCKET PREFIX MATERIALIZATION_ID RECEIPT_JSON" >&2
  exit 1
}

corpus_release=$1
release_dir=$2
corpus_ref=$3
bucket=$4
prefix=${5%/}
materialization_id=$6
receipt=$7
region=${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}
project_tag=${ILXYR_PROJECT_TAG:-feral-7b}

command -v aws >/dev/null
command -v jq >/dev/null
command -v shasum >/dev/null
test -f "$corpus_release"
test -d "$release_dir"
test -n "$prefix"
[[ "$project_tag" =~ ^[A-Za-z0-9._-]+$ ]]
test "$(jq -r .schema "$corpus_release")" = ilxyr.corpus_release.v1
corpus_digest=${corpus_ref#artifact://sha256/}
test "$corpus_digest" != "$corpus_ref"
test "${#corpus_digest}" = 64
if [[ "$corpus_release" = */.ilxyr/objects/sha256/* ]]; then
  test "$(basename "$corpus_release")" = "$corpus_digest"
fi
test "${materialization_id#materialization://}" != "$materialization_id"

bucket_region=$(aws s3api get-bucket-location --bucket "$bucket" --query LocationConstraint --output text)
if test "$bucket_region" = None; then
  bucket_region=us-east-1
fi
test "$bucket_region" = "$region"

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
objects=$scratch/objects.json
echo '[]' > "$objects"

file_size() {
  stat -f %z "$1" 2>/dev/null || stat -c %s "$1"
}

while IFS=$'\t' read -r path expected_sha expected_size media_type; do
  source_file=$release_dir/$path
  test -f "$source_file"
  actual_size=$(file_size "$source_file")
  actual_sha=$(shasum -a 256 "$source_file" | awk '{print $1}')
  test "$actual_size" = "$expected_size"
  test "$actual_sha" = "$expected_sha"

  key=$prefix/$path
  checksum_sha256=$(printf '%s' "$expected_sha" | xxd -r -p | base64 | tr -d '\n')
  head_file=$scratch/head.json
  if aws s3api head-object \
      --bucket "$bucket" \
      --key "$key" \
      --checksum-mode ENABLED \
      > "$head_file" 2>/dev/null; then
    test "$(jq -r .ContentLength "$head_file")" = "$expected_size"
    test "$(jq -r .ChecksumSHA256 "$head_file")" = "$checksum_sha256"
    test "$(jq -r '.Metadata.sha256' "$head_file")" = "$expected_sha"
    version_id=$(jq -r .VersionId "$head_file")
  else
    put_file=$scratch/put.json
    aws s3api put-object \
      --cli-read-timeout 0 \
      --bucket "$bucket" \
      --key "$key" \
      --body "$source_file" \
      --content-type "$media_type" \
      --server-side-encryption AES256 \
      --checksum-algorithm SHA256 \
      --checksum-sha256 "$checksum_sha256" \
      --metadata "sha256=$expected_sha,ilxyr-corpus-ref=$corpus_digest" \
      --tagging "ilxyr-project=$project_tag&ilxyr-corpus-sha256=$corpus_digest" \
      --if-none-match '*' \
      > "$put_file"
    version_id=$(jq -r .VersionId "$put_file")
    test -n "$version_id"
    test "$version_id" != null
    test "$(jq -r .ChecksumSHA256 "$put_file")" = "$checksum_sha256"
  fi

  readback_pipe=$scratch/readback.pipe
  readback_sha_file=$scratch/readback.sha256
  get_file=$scratch/get.json
  rm -f "$readback_pipe" "$readback_sha_file" "$get_file"
  mkfifo "$readback_pipe"
  shasum -a 256 < "$readback_pipe" > "$readback_sha_file" &
  hash_pid=$!
  aws s3api get-object \
    --cli-read-timeout 0 \
    --bucket "$bucket" \
    --key "$key" \
    --version-id "$version_id" \
    --checksum-mode ENABLED \
    "$readback_pipe" \
    > "$get_file"
  wait "$hash_pid"
  readback_sha=$(awk '{print $1}' "$readback_sha_file")
  test "$readback_sha" = "$expected_sha"
  test "$(jq -r .VersionId "$get_file")" = "$version_id"
  test "$(jq -r .ChecksumSHA256 "$get_file")" = "$checksum_sha256"

  jq \
    --arg path "$path" \
    --arg uri "s3://$bucket/$key" \
    --arg sha256 "$expected_sha" \
    --argjson size_bytes "$expected_size" \
    --arg provider_version "$version_id" \
    '. + [{path:$path,uri:$uri,sha256:$sha256,size_bytes:$size_bytes,provider_version:$provider_version}]' \
    "$objects" > "$objects.next"
  mv "$objects.next" "$objects"
  echo "verified $path $version_id"
done < <(jq -r '.files[] | [.path,.sha256,.size_bytes,.media_type] | @tsv' "$corpus_release")

verified_at_ms=$(($(date +%s) * 1000))
jq -n \
  --arg id "$materialization_id" \
  --arg corpus_ref "$corpus_ref" \
  --arg region "$region" \
  --arg uri "s3://$bucket/$prefix" \
  --slurpfile objects "$objects" \
  --argjson verified_at_ms "$verified_at_ms" \
  '{schema:"ilxyr.corpus_materialization.v1",id:$id,corpus_ref:$corpus_ref,
    location:{kind:"amazon_s3",region:$region,uri:$uri},objects:$objects[0],
    verified_by:{id:"service://ilxyr/s3-readback-materializer-v1",kind:"service"},
    verified_at_ms:$verified_at_ms}' \
  > "$receipt"

echo "wrote $receipt"
