set -Eeuo pipefail
trap 'shutdown -h now' EXIT
remaining=$((W_LAUNCH + 3570 - $(date +%s)))
test "$remaining" -gt 0
systemd-run --unit=solomon38-deadline --on-active="$remaining" /usr/sbin/shutdown -h now
ROOT=${W_WORK_ROOT:-/opt/solomon38}
USER_DATA=${W_USER_DATA_FILE:-/var/lib/cloud/instance/user-data.txt}
install -d -m 0755 "$ROOT/output"
OUT="$ROOT/output"
exec > >(python3 -u -c 'import sys,os
f=open(sys.argv[1],"ab");n=0
while True:
 b=os.read(0,4096)
 if not b:break
 keep=b[:max(0,16777216-n)];f.write(keep);f.flush();n+=len(keep)
' "$ROOT/bootstrap.log") 2>&1
PHASE=metadata
VERIFIED=0
export AWS_DEFAULT_REGION=us-east-1 AWS_MAX_ATTEMPTS=1
bounded() {
  local end=$1
  shift
  local seconds=$((W_LAUNCH + end - $(date +%s)))
  test "$seconds" -gt 0 || return 124
  timeout --signal=TERM --kill-after=5s "${seconds}s" "$@"
}
finish() {
  local code=$?
  trap - EXIT
  set +e
  bounded 3020 docker rm -f "$W_RUN"
  cp "$ROOT/bootstrap.log" "$OUT/bootstrap.log"
  python3 - "$ROOT/identity.json" "$code" "$PHASE" "$W_RUN" "$W_LAUNCH" \
    "$W_PACKAGE_SHA" "$W_PLAN_SHA" "${INSTANCE_ID:-}" "$USER_DATA" <<'PY'
import hashlib,json,sys
from pathlib import Path
path,code,phase,run,launch,package,plan,instance,user_data=sys.argv[1:]
v={'exit_code':int(code),'phase':phase,'run_id':run,'launch_epoch_seconds':int(launch),
   'instance_id':instance or None,'package_sha256':package,'plan_sha256':plan,
   'user_data_sha256':hashlib.sha256(Path(user_data).read_bytes()).hexdigest()}
Path(path).write_text(json.dumps(v,indent=2,sort_keys=True)+'\n')
PY
  if [ "$VERIFIED" = 1 ]; then
    bounded 3545 python3 "$ROOT/package/scripts/solomon_cloud_collect.py" host --root "$ROOT" \
      --plan "$ROOT/package/experiments/research-step-38/EXECUTION-PLAN.json" --identity "$ROOT/identity.json" || code=1
  else
    checksum=$(python3 -c 'import hashlib,base64,sys;print(base64.b64encode(hashlib.sha256(open(sys.argv[1],"rb").read()).digest()).decode())' "$OUT/bootstrap.log")
    bounded 3500 aws s3api put-object --bucket "$W_BUCKET" --key "runs/$W_RUN/bootstrap.log" \
      --body "$OUT/bootstrap.log" --server-side-encryption AES256 --if-none-match '*' \
      --checksum-algorithm SHA256 --checksum-sha256 "$checksum" --cli-connect-timeout 3 --cli-read-timeout 15 --no-cli-pager > "$ROOT/bootstrap-put.json"
    python3 - "$ROOT/identity.json" "$ROOT/host-terminal.json" "$OUT/bootstrap.log" "$ROOT/bootstrap-put.json" <<'PYINNER'
import base64,hashlib,json,sys
from pathlib import Path
identity,terminal,log,receipt=sys.argv[1:]
v=json.loads(Path(identity).read_bytes());v.update(schema='ilxyr.solomon_host_terminal.v1',status='failed',collection_complete=False,instance_termination_verified=False,actual_billed_usd=None)
try:
 r=json.loads(Path(receipt).read_bytes());raw=Path(log).read_bytes();h=hashlib.sha256(raw).digest()
 assert r.get('VersionId') and r.get('ChecksumSHA256')==base64.b64encode(h).decode()
 v['bootstrap_receipt']={'key':'runs/'+v['run_id']+'/bootstrap.log','version_id':r['VersionId'],'bytes':len(raw),'sha256':h.hex()}
except Exception as error:v['bootstrap_upload_error']=str(error)
Path(terminal).write_text(json.dumps(v,indent=2,sort_keys=True)+'\n')
PYINNER
    checksum=$(python3 -c 'import hashlib,base64,sys;print(base64.b64encode(hashlib.sha256(open(sys.argv[1],"rb").read()).digest()).decode())' "$ROOT/host-terminal.json")
    bounded 3540 aws s3api put-object --bucket "$W_BUCKET" --key "runs/$W_RUN/host-terminal.json" \
      --body "$ROOT/host-terminal.json" --server-side-encryption AES256 --if-none-match '*' \
      --checksum-algorithm SHA256 --checksum-sha256 "$checksum" --cli-connect-timeout 3 --cli-read-timeout 15 --no-cli-pager
  fi
  shutdown -h now
  exit "$code"
}
trap finish EXIT
TOKEN=$(curl --fail --silent --show-error --connect-timeout 3 --max-time 5 --request PUT \
  --header 'X-aws-ec2-metadata-token-ttl-seconds: 3600' http://169.254.169.254/latest/api/token)
metadata() {
  curl --fail --silent --show-error --connect-timeout 3 --max-time 5 \
    --header "X-aws-ec2-metadata-token: $TOKEN" "http://169.254.169.254/latest/meta-data/$1"
}
INSTANCE_ID=$(metadata instance-id)
test "$(metadata instance-type)" = c6i.large
test "$(metadata ami-id)" = ami-0d3378afe7683c867
unset TOKEN
PHASE=package
bounded 900 aws s3api get-object --bucket "$W_BUCKET" --key "$W_PACKAGE_KEY" \
  --version-id "$W_PACKAGE_VERSION" "$ROOT/package.tar" --no-cli-pager
bounded 900 python3 - "$ROOT/package.tar" "$W_PACKAGE_SHA" "$W_PLAN_SHA" "$ROOT/package" "$USER_DATA" <<'PY'
import hashlib,io,json,sys,tarfile
from pathlib import Path,PurePosixPath
archive,expected,plan_sha,output,user_data=sys.argv[1:];root=Path(output)
def sha(b):return hashlib.sha256(b).hexdigest()
def unpack(raw,folder,manifest_name):
    assert len(raw)<=128*1024*1024
    with tarfile.open(fileobj=io.BytesIO(raw),mode='r:') as t:
        items=t.getmembers();assert len(items)<=20 and len(items)==len({m.name for m in items})
        assert sum(m.size for m in items)<=128*1024*1024
        files={}
        for m in items:
            p=PurePosixPath(m.name)
            assert m.isfile() and not p.is_absolute() and '..' not in p.parts and str(p)==m.name
            files[m.name]=t.extractfile(m).read()
    manifest=json.loads(files[manifest_name]);assert set(manifest['files'])==set(files)-{manifest_name}
    for name,value in manifest['files'].items():assert value=={'bytes':len(files[name]),'sha256':sha(files[name])}
    folder.mkdir()
    for name,raw in files.items():
        p=folder/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw)
    return manifest,files
raw=Path(archive).read_bytes();assert sha(raw)==expected
host,files=unpack(raw,root.with_name('verified-host'),'HOST.json');assert host['plan_sha256']==plan_sha
plan_raw=files['experiments/research-step-38/EXECUTION-PLAN.json'];assert sha(plan_raw)==plan_sha
plan=json.loads(plan_raw);assert plan['limits']['max_instance_seconds']==3600 and plan['budget']['maximum_before_tax_usd']=='0.25'
body=Path(user_data).read_bytes().split(b'\n# SOLOMON38_BODY\n')
assert len(body)==2 and body[1]==files['scripts/aws/solomon38-user-data.sh']
sys.path.insert(0,str(root.with_name('verified-host')/'scripts'))
from package_solomon_cloud import unpack as verify_and_unpack
verify_and_unpack(Path(archive),expected,root)
PY
VERIFIED=1
PLAN="$ROOT/package/experiments/research-step-38/EXECUTION-PLAN.json"
IMAGE=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["runtime_image"])' "$PLAN")
python3 - "$ROOT/package/execution.json" "$W_RUN" "$W_PACKAGE_SHA" "$PLAN" <<'PYEXEC'
import json,sys
from pathlib import Path
path,run,package,plan=sys.argv[1:];p=json.loads(Path(plan).read_bytes());v=p['provider']
Path(path).write_text(json.dumps({'schema':'ilxyr.solomon_study_execution.v1','venue':'cloud','run_id':run,
  'package_sha256':package,'prepared_bindings_sha256':p['prepared_bindings_sha256'],'implementation':p['implementation'],
  'machine':{'provider':'AWS','region':v['region'],'instance_type':v['instance_type'],'image_id':v['ami_id'],
  'architecture':v['architecture'],'runtime_image':p['runtime_image']},'rustc_identity':p['rustc_identity'],'limits':p['study_limits']},indent=2,sort_keys=True)+'\n')
PYEXEC
PHASE=image
bounded 900 systemctl start docker
bounded 900 docker pull "$IMAGE"
bounded 900 docker image inspect "$IMAGE" > "$OUT/image-inspect.json"
PHASE=controller
install -d -m 0755 "$ROOT/scratch"
(
  ulimit -f 2048
  bounded 3000 docker run --name "$W_RUN" --network none --cpuset-cpus 0 --memory 2g --memory-swap 2g \
    --pids-limit 256 --read-only --log-driver none --tmpfs /tmp:rw,exec,size=256m \
    --env RUSTUP_TOOLCHAIN=1.98.0-x86_64-unknown-linux-gnu --env CARGO_BUILD_JOBS=1 --env CARGO_NET_OFFLINE=true --env CARGO_HOME=/tmp/solomon-cargo \
    --env PYTHONDONTWRITEBYTECODE=1 --env PYTHONHASHSEED=0 --env LANG=C.UTF-8 --env LC_ALL=C.UTF-8 --env TZ=UTC \
    --mount "type=bind,src=$ROOT/package,dst=/work/package,readonly" \
    --mount "type=bind,src=$OUT,dst=/work/output" --mount "type=bind,src=$ROOT/scratch,dst=/work/scratch" \
    --entrypoint python3 "$IMAGE" /work/package/scripts/solomon_cloud_runtime.py cloud \
    --package /work/package --output /work/output/runtime --work /work/scratch/build \
    --execution /work/package/execution.json > "$OUT/runtime.stdout.log" 2> "$OUT/runtime.stderr.log"
)
PHASE=complete
