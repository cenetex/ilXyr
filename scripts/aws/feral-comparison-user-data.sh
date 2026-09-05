set -Eeuo pipefail
trap 'shutdown -h now' EXIT

# The launcher supplies these values in the rendered, recorded user data.
[[ "$FERAL_LAUNCH_EPOCH" =~ ^[0-9]+$ ]]
remaining=$((FERAL_LAUNCH_EPOCH + 3570 - $(date +%s)))
test "$remaining" -gt 0
systemd-run --unit=feral-finqa-deadline --on-active="$remaining" /usr/sbin/shutdown -h now

install -d -m 0755 "$FERAL_WORK_ROOT"
BOOT_LOG="$FERAL_WORK_ROOT/bootstrap.log"
exec > >(tee -a "$BOOT_LOG") 2>&1
PACKAGE="$FERAL_WORK_ROOT/package"
OUT="$FERAL_WORK_ROOT/output"
STATUS="$FERAL_WORK_ROOT/host-terminal.json"
PHASE=bootstrap
CONTAINER_STARTED=0
COLLECTION_OK=1
FAILURE_PHASE=
install -d -m 0755 "$PACKAGE" "$OUT"
export AWS_DEFAULT_REGION=us-east-1 AWS_MAX_ATTEMPTS=1

remaining_command() {
  local reserve=$1
  shift
  local seconds=$((FERAL_LAUNCH_EPOCH + 3600 - reserve - $(date +%s)))
  test "$seconds" -gt 0 || return 124
  timeout --signal=TERM --kill-after=5s "${seconds}s" "$@"
}

write_status() {
  python3 - "$STATUS" "$1" "$2" "$PHASE" "$FERAL_RUN_ID" "$FERAL_LAUNCH_EPOCH" \
    "$FERAL_HOST_PACKAGE_SHA256" "$FERAL_EXECUTION_PLAN_SHA256" "$COLLECTION_OK" "$FAILURE_PHASE" \
    "${INSTANCE_ID:-}" "$FERAL_USER_DATA_FILE" <<'PY'
import hashlib,json,sys,time
from pathlib import Path
path,status,code,phase,run,launched,package,plan,collected,failed_phase,instance,user_data=sys.argv[1:]
value={'schema':'ilxyr.feral_host_terminal.v1','status':status,'exit_code':int(code),'phase':phase,
       'run_id':run,'host_package_sha256':package,'execution_plan_sha256':plan,
       'elapsed_instance_seconds':time.time()-int(launched),'collection_complete':collected=='1',
       'failed_phase':failed_phase or None,'instance_id':instance or None,
       'user_data_sha256':hashlib.sha256(Path(user_data).read_bytes()).hexdigest() if Path(user_data).is_file() else None,
       'instance_termination_verified':False,'actual_billed_usd':None}
Path(path).write_text(json.dumps(value,indent=2,sort_keys=True)+'\n')
PY
}

put_once() {
  local source=$1
  local key=$2
  local checksum
  checksum=$(python3 - "$source" <<'PY'
import base64,hashlib,sys
h=hashlib.sha256()
with open(sys.argv[1],'rb') as f:
    for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
print(base64.b64encode(h.digest()).decode())
PY
)
  remaining_command 60 aws s3api put-object --bucket "$FERAL_BUCKET" --key "$key" \
    --body "$source" --server-side-encryption AES256 --if-none-match '*' \
    --checksum-algorithm SHA256 --checksum-sha256 "$checksum" \
    --cli-connect-timeout 3 --cli-read-timeout 10 --no-cli-pager
}

collect_output() {
  local roster="$FERAL_WORK_ROOT/collect-files.txt"
  python3 - "$OUT" "$roster" <<'PY'
from pathlib import Path
import sys
root,roster=map(Path,sys.argv[1:])
files=[]
for path in sorted(root.rglob('*')):
    relative=path.relative_to(root)
    if relative.parts[0] in ['model','source'] or relative.parts[:2] in [('run','model'),('run','source')]: continue
    if path.is_symlink(): raise ValueError('result path is a link')
    if path.is_file():
        if '\n' in str(relative): raise ValueError('result path has a newline')
        files.append(relative.as_posix())
roster.write_text(''.join(name+'\n' for name in files))
PY
  while IFS= read -r relative; do
    put_once "$OUT/$relative" "runs/$FERAL_RUN_ID/results/$relative" || COLLECTION_OK=0
  done < "$roster"
}

finish() {
  local code=$?
  if [ "$code" -ne 0 ]; then FAILURE_PHASE=$PHASE; fi
  trap - EXIT
  set +e
  if [ "$CONTAINER_STARTED" -eq 1 ]; then
    remaining_command 90 docker rm -f "$FERAL_CONTAINER_NAME"
    if [ "$?" -ne 0 ]; then code=1; FAILURE_PHASE=${FAILURE_PHASE:-container_cleanup}; fi
  fi
  PHASE=collect
  collect_output || COLLECTION_OK=0
  # Snapshot the host log before uploading it.
  cp "$BOOT_LOG" "$FERAL_WORK_ROOT/bootstrap-snapshot.log"
  put_once "$FERAL_WORK_ROOT/bootstrap-snapshot.log" "runs/$FERAL_RUN_ID/bootstrap.log" || COLLECTION_OK=0
  if [ "$COLLECTION_OK" -ne 1 ]; then
    if [ "$code" -eq 0 ]; then code=1; fi
    FAILURE_PHASE=${FAILURE_PHASE:-collect}
  fi
  if [ "$code" -eq 0 ] && [ "$COLLECTION_OK" -eq 1 ]; then
    PHASE=complete
    write_status complete 0
  else
    PHASE=failed
    write_status failed "$code"
  fi
  put_once "$STATUS" "runs/$FERAL_RUN_ID/host-terminal.json" || code=1
  shutdown -h now
  exit "$code"
}
trap finish EXIT

# Check the reviewed body before touching cloud inputs.
python3 - "$FERAL_USER_DATA_FILE" "$FERAL_BOOTSTRAP_BODY_SHA256" <<'PY'
import hashlib,sys
raw=open(sys.argv[1],'rb').read()
parts=raw.split(b'\n# FERAL_BOOTSTRAP_BODY\n')
assert len(parts)==2 and hashlib.sha256(parts[1]).hexdigest()==sys.argv[2], 'bootstrap body digest differs'
PY

PHASE=metadata
IMDS=http://169.254.169.254/latest
TOKEN=$(curl --fail --silent --show-error --connect-timeout 3 --max-time 5 --request PUT \
  --header 'X-aws-ec2-metadata-token-ttl-seconds: 3600' "$IMDS/api/token")
metadata() {
  curl --fail --silent --show-error --connect-timeout 3 --max-time 5 \
    --header "X-aws-ec2-metadata-token: $TOKEN" "$IMDS/meta-data/$1"
}
INSTANCE_ID=$(metadata instance-id)
test "$(metadata instance-type)" = g6e.2xlarge
test "$(metadata ami-id)" = ami-0d3378afe7683c867

PHASE=package
remaining_command 330 aws s3api get-object --bucket "$FERAL_BUCKET" --key "$FERAL_HOST_PACKAGE_KEY" \
  --version-id "$FERAL_HOST_PACKAGE_VERSION" "$FERAL_WORK_ROOT/host-package.tar" \
  --cli-connect-timeout 3 --cli-read-timeout 30 --no-cli-pager
python3 - "$FERAL_WORK_ROOT/host-package.tar" "$FERAL_HOST_PACKAGE_SHA256" \
  "$PACKAGE" "$FERAL_EXECUTION_PLAN_SHA256" "$FERAL_BOOTSTRAP_BODY_SHA256" <<'PY'
import hashlib,json,sys,tarfile
from pathlib import Path,PurePosixPath
archive,expected,destination,plan_sha,body_sha=sys.argv[1:]
root=Path(destination)
def unpack(path,target,expected_digest):
    assert path.stat().st_size<=8*1024*1024, 'archive size exceeds bound'
    assert hashlib.sha256(path.read_bytes()).hexdigest()==expected_digest, 'archive digest differs'
    with tarfile.open(path,'r:') as t:
        members=t.getmembers()
        assert len({m.name for m in members})==len(members), 'duplicate archive member'
        for m in members:
            name=PurePosixPath(m.name)
            assert m.isfile() and not name.is_absolute() and '..' not in name.parts and str(name)==m.name, 'archive path differs'
            assert m.size<=8*1024*1024, 'member size exceeds bound'
            p=target/m.name; p.parent.mkdir(parents=True,exist_ok=True)
            with p.open('xb') as f: f.write(t.extractfile(m).read())
unpack(Path(archive),root,expected)
host=json.loads((root/'HOST-PACKAGE.json').read_bytes())
assert host['bootstrap_body_sha256']==body_sha and host['execution_plan_sha256']==plan_sha, 'host package binding differs'
assert hashlib.sha256((root/'user-data.sh').read_bytes()).hexdigest()==body_sha, 'packaged bootstrap differs'
execution=root/'execution'; execution.mkdir()
unpack(root/'execution.tar',execution,host['execution_archive_sha256'])
manifest=json.loads((execution/'EXECUTION-PACKAGE.json').read_bytes())
assert manifest['execution_plan_sha256']==plan_sha, 'execution manifest differs'
assert hashlib.sha256((execution/'EXECUTION-PLAN.json').read_bytes()).hexdigest()==plan_sha, 'execution plan differs'
for name,binding in manifest['files'].items():
    p=(execution/name).resolve()
    assert p.is_relative_to(execution.resolve()), 'execution file path differs'
    assert p.stat().st_size==binding['bytes'] and hashlib.sha256(p.read_bytes()).hexdigest()==binding['sha256'], 'execution file differs'
plan=json.loads((execution/'EXECUTION-PLAN.json').read_bytes())
assert plan['limits']['max_instance_seconds']==3600 and plan['budget']['max_infrastructure_usd']=='3.00', 'host budget differs'
PY
EXECUTION="$PACKAGE/execution"
IMAGE=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["runtime"]["image"])' "$EXECUTION/EXECUTION-PLAN.json")
[[ "$IMAGE" =~ ^ghcr.io/atimics/feral-7b-sec-qwen@sha256:[0-9a-f]{64}$ ]]

python3 - "$EXECUTION/EXECUTION-PLAN.json" "$FERAL_EXECUTION_PLAN_SHA256" "$INSTANCE_ID" \
  "$FERAL_LAUNCH_EPOCH" "$FERAL_APPROVAL_REFERENCE" "$OUT/launch-input.json" <<'PY'
import json,sys
from pathlib import Path
path,digest,instance,launched,approval,out=sys.argv[1:]
plan=json.load(open(path))
receipt={'schema':'ilxyr.feral_comparison_launch.v1','execution_plan_sha256':digest,
         'source_archive_sha256':plan['source']['archive_sha256'],'provider':plan['provider'],
         'image':plan['runtime']['image'],'max_instance_seconds':3600,'max_infrastructure_usd':'3.00',
         'approval_reference':approval,'instance_id':instance,'launch_epoch_seconds':int(launched)}
Path(out).write_text(json.dumps(receipt,indent=2,sort_keys=True)+'\n')
PY
PHASE=image
remaining_command 330 systemctl start docker
remaining_command 330 docker pull "$IMAGE"
remaining_command 330 docker image inspect "$IMAGE" > "$OUT/image-inspect.json"

PHASE=controller
CONTAINER_STARTED=1
remaining_command 300 docker run --name "$FERAL_CONTAINER_NAME" --gpus all --network none \
  --memory 56g --cpus 8 --shm-size 16g --read-only --tmpfs /tmp:rw,size=1g \
  --mount "type=bind,src=$EXECUTION,dst=/work/package,readonly" \
  --mount "type=bind,src=$OUT,dst=/work/output" \
  --entrypoint /opt/sec-qwen/.venv/bin/python "$IMAGE" \
  /work/package/scripts/run_feral_comparison.py --plan /work/package/EXECUTION-PLAN.json \
  --plan-sha256 "$FERAL_EXECUTION_PLAN_SHA256" --source-archive /work/package/comparison-source.tar \
  --launch-receipt /work/output/launch-input.json --out /work/output/run \
  > "$OUT/controller-stdout.log" 2> "$OUT/controller-stderr.log"
exit 0
