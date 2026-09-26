set -Eeuo pipefail

# Values in the rendered prefix are checked by the launcher.
deadline=$((FERAL_LAUNCH_EPOCH + 3570))
remaining=$((deadline - $(date +%s)))
test "$remaining" -gt 0
systemd-run --unit=feral-stage-a-deadline --on-active="${remaining}s" /usr/sbin/shutdown -h now
trap 'shutdown -h now' EXIT

root=/opt/feral-stage-a
mkdir -p "$root/source" "$root/model" "$root/output"
exec > >(tee -a "$root/bootstrap.log") 2>&1
phase=bootstrap
status=failed
export AWS_DEFAULT_REGION=us-east-1 AWS_MAX_ATTEMPTS=1

time_left() {
  local reserve=$1
  shift
  local seconds=$((FERAL_LAUNCH_EPOCH + 3600 - reserve - $(date +%s)))
  test "$seconds" -gt 0
  timeout --signal=TERM --kill-after=5s "${seconds}s" "$@"
}

put_once() {
  local path=$1 key=$2 checksum
  checksum=$(python3 - "$path" <<'PY'
import base64,hashlib,sys
h=hashlib.sha256()
with open(sys.argv[1],'rb') as f:
    for block in iter(lambda:f.read(1024*1024),b''): h.update(block)
print(base64.b64encode(h.digest()).decode())
PY
)
  time_left 35 aws s3api put-object --bucket "$FERAL_BUCKET" --key "$key" \
    --body "$path" --server-side-encryption AES256 --if-none-match '*' \
    --checksum-algorithm SHA256 --checksum-sha256 "$checksum" \
    --cli-connect-timeout 3 --cli-read-timeout 10 --no-cli-pager >/dev/null
}

finish() {
  local code=$?
  trap - EXIT
  set +e
  if [ "$code" -eq 0 ]; then status=complete; fi
  local collection_complete=1
  cp "$root/bootstrap.log" "$root/output/BOOTSTRAP.log"
  while IFS= read -r path; do
    rel=${path#"$root/output/"}
    put_once "$path" "runs/$FERAL_RUN_ID/$rel" || collection_complete=0
  done < <(find "$root/output" -type f ! -name TERMINAL.json -print | sort)
  if [ "$collection_complete" -ne 1 ]; then status=failed; code=1; fi
  python3 - "$root/output/TERMINAL.json" "$status" "$phase" "$code" "$FERAL_RUN_ID" "$FERAL_SOURCE_SHA256" "$FERAL_LAUNCH_EPOCH" "$collection_complete" <<'PY'
import json,sys,time
from pathlib import Path
path,status,phase,code,run,source,epoch,collected=sys.argv[1:]
Path(path).write_text(json.dumps({'schema':'ilxyr.feral_stage_a_gpu_terminal.v1',
 'status':status,'phase':phase,'exit_code':int(code),'run_id':run,
 'source_archive_sha256':source,'elapsed_seconds':time.time()-int(epoch),
 'collection_complete':collected=='1',
 'instance_termination_verified':False,'actual_billed_usd':None},sort_keys=True)+'\n')
PY
  put_once "$root/output/TERMINAL.json" "runs/$FERAL_RUN_ID/TERMINAL.json" || code=1
  shutdown -h now
  exit "$code"
}
trap finish EXIT

phase=identity
token=$(curl -fsS --connect-timeout 3 --max-time 5 -X PUT \
  -H 'X-aws-ec2-metadata-token-ttl-seconds: 3600' http://169.254.169.254/latest/api/token)
meta() { curl -fsS --connect-timeout 3 --max-time 5 -H "X-aws-ec2-metadata-token: $token" \
  "http://169.254.169.254/latest/meta-data/$1"; }
test "$(meta instance-type)" = g6e.2xlarge
test "$(meta ami-id)" = ami-0d3378afe7683c867
echo "instance_id=$(meta instance-id)"

phase=source
time_left 300 aws s3api get-object --bucket "$FERAL_BUCKET" --key "$FERAL_SOURCE_KEY" \
  --version-id "$FERAL_SOURCE_VERSION" "$root/source.tar" --no-cli-pager >/dev/null
echo "$FERAL_SOURCE_SHA256  $root/source.tar" | sha256sum -c -
python3 - "$root/source.tar" "$root/source" <<'PY'
import hashlib,json,sys,tarfile
from pathlib import Path,PurePosixPath
archive,dest=map(Path,sys.argv[1:]); names=set()
with tarfile.open(archive,'r:') as source:
    for item in source:
        name=PurePosixPath(item.name)
        assert item.isfile() and not name.is_absolute() and '..' not in name.parts and item.name not in names
        assert item.size<=8*1024*1024
        names.add(item.name); path=dest/item.name; path.parent.mkdir(parents=True,exist_ok=True)
        path.write_bytes(source.extractfile(item).read())
manifest=json.loads((dest/'PACKAGE.json').read_bytes())
assert set(manifest['files'])|{'PACKAGE.json'}==names
for name,binding in manifest['files'].items():
    raw=(dest/name).read_bytes()
    assert len(raw)==binding['bytes'] and hashlib.sha256(raw).hexdigest()==binding['sha256']
PY

phase=image
time_left 300 systemctl start docker
time_left 300 docker pull "$FERAL_IMAGE"
docker image inspect "$FERAL_IMAGE" > "$root/output/IMAGE.json"

phase=model_download
time_left 120 python3 - "$root/source/experiments/feral-source-selector/stage-a/MODEL-PROFILE.json" "$root/model" "$FERAL_MODEL_REVISION" <<'PY'
import hashlib,json,subprocess,sys
from pathlib import Path
profile= json.loads(Path(sys.argv[1]).read_bytes()); root=Path(sys.argv[2]); revision=sys.argv[3]
assert profile['revision']==revision and profile['repository']=='Qwen/Qwen3.5-4B'
for name,binding in profile['files'].items():
    assert '/' not in name and name not in ('.','..')
    path=root/name
    url=f'https://huggingface.co/Qwen/Qwen3.5-4B/resolve/{revision}/{name}'
    subprocess.run(['curl','--fail','--location','--silent','--show-error','--retry','2',
                    '--connect-timeout','10','--max-time','1800','--output',str(path),url],check=True)
    if path.stat().st_size!=binding['bytes']:
        raise ValueError('model file size differs: '+name)
    digest=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''): digest.update(block)
    if digest.hexdigest()!=binding['sha256']:
        raise ValueError('model file digest differs: '+name)
print('all pinned model files verified',flush=True)
PY

run_worker() {
  local scope=$1
  local extra=()
  if [ "$scope" = smoke ]; then extra+=(--smoke-only); fi
  time_left 120 docker run --rm --gpus all --network none --memory 56g --cpus 8 --shm-size 16g \
    --read-only --tmpfs /tmp:rw,exec,size=1g \
    --mount "type=bind,src=$root/source,dst=/work/source,readonly" \
    --mount "type=bind,src=$root/model,dst=/work/model,readonly" \
    --mount "type=bind,src=$root/output,dst=/work/output" \
    --entrypoint /opt/sec-qwen/.venv/bin/python "$FERAL_IMAGE" \
    /work/source/scripts/feral_stage_a_model.py \
    --base /work/source/experiments/feral-source-selector/stage-a \
    --model-dir /work/model --output "/work/output/$scope" "${extra[@]}" \
    >"$root/output/$scope.stdout.log" 2>"$root/output/$scope.stderr.log"
}

phase=loader_smoke
run_worker smoke
phase=full_36_forms
run_worker full
phase=complete
