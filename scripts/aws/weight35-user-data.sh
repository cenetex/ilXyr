set -Eeuo pipefail
trap 'shutdown -h now' EXIT
remaining=$((W_LAUNCH + 5370 - $(date +%s)))
test "$remaining" -gt 0
systemd-run --unit=weight35-deadline --on-active="$remaining" /usr/sbin/shutdown -h now
ROOT=${W_WORK_ROOT:-/opt/weight35}
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
  bounded 5120 docker rm -f "$W_RUN"
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
    bounded 5345 python3 "$ROOT/package/scripts/weight_cloud_collect.py" host --root "$ROOT" \
      --plan "$ROOT/package/experiments/research-step-35/EXECUTION-PLAN.json" --identity "$ROOT/identity.json" || code=1
  else
    python3 - "$ROOT/identity.json" "$ROOT/host-terminal.json" <<'PY'
import json,sys
from pathlib import Path
v=json.loads(Path(sys.argv[1]).read_bytes());v.update(schema='ilxyr.weight_host_terminal.v1',status='failed',collection_complete=False,instance_termination_verified=False,actual_billed_usd=None)
Path(sys.argv[2]).write_text(json.dumps(v,indent=2,sort_keys=True)+'\n')
PY
    checksum=$(python3 -c 'import hashlib,base64,sys;print(base64.b64encode(hashlib.sha256(open(sys.argv[1],"rb").read()).digest()).decode())' "$ROOT/host-terminal.json")
    bounded 5340 aws s3api put-object --bucket "$W_BUCKET" --key "runs/$W_RUN/host-terminal.json" \
      --body "$ROOT/host-terminal.json" --server-side-encryption AES256 --if-none-match '*' \
      --checksum-algorithm SHA256 --checksum-sha256 "$checksum" --cli-connect-timeout 3 --cli-read-timeout 15 --no-cli-pager
  fi
  shutdown -h now
  exit "$code"
}
trap finish EXIT
TOKEN=$(curl --fail --silent --show-error --connect-timeout 3 --max-time 5 --request PUT \
  --header 'X-aws-ec2-metadata-token-ttl-seconds: 5400' http://169.254.169.254/latest/api/token)
metadata() {
  curl --fail --silent --show-error --connect-timeout 3 --max-time 5 \
    --header "X-aws-ec2-metadata-token: $TOKEN" "http://169.254.169.254/latest/meta-data/$1"
}
INSTANCE_ID=$(metadata instance-id)
test "$(metadata instance-type)" = c6i.4xlarge
test "$(metadata ami-id)" = ami-0d3378afe7683c867
unset TOKEN
PHASE=package
bounded 1200 aws s3api get-object --bucket "$W_BUCKET" --key "$W_PACKAGE_KEY" \
  --version-id "$W_PACKAGE_VERSION" "$ROOT/package.tar" --no-cli-pager
bounded 1200 python3 - "$ROOT/package.tar" "$W_PACKAGE_SHA" "$W_PLAN_SHA" "$ROOT/package" "$USER_DATA" <<'PY'
import hashlib,io,json,sys,tarfile
from pathlib import Path,PurePosixPath
archive,expected,plan_sha,output,user_data=sys.argv[1:];root=Path(output)
def sha(b):return hashlib.sha256(b).hexdigest()
def unpack(raw,folder,manifest_name):
    assert len(raw)<=32*1024*1024
    with tarfile.open(fileobj=io.BytesIO(raw),mode='r:') as t:
        items=t.getmembers();assert len(items)<=100 and len(items)==len({m.name for m in items})
        files={}
        for m in items:
            p=PurePosixPath(m.name)
            assert m.isfile() and not p.is_absolute() and '..' not in p.parts and str(p)==m.name and m.size<=32*1024*1024
            files[m.name]=t.extractfile(m).read()
    manifest=json.loads(files[manifest_name]);assert set(manifest['files'])==set(files)-{manifest_name}
    for name,value in manifest['files'].items():assert value=={'bytes':len(files[name]),'sha256':sha(files[name])}
    folder.mkdir()
    for name,raw in files.items():
        p=folder/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw)
    return manifest,files
raw=Path(archive).read_bytes();assert sha(raw)==expected
host,files=unpack(raw,root,'HOST.json');assert host['plan_sha256']==plan_sha
plan_raw=files['experiments/research-step-35/EXECUTION-PLAN.json'];assert sha(plan_raw)==plan_sha
plan=json.loads(plan_raw);assert plan['limits']['max_instance_seconds']==5400 and plan['budget']['maximum_before_tax_usd']=='2.00'
body=Path(user_data).read_bytes().split(b'\n# WEIGHT35_BODY\n')
assert len(body)==2 and body[1]==files['scripts/aws/weight35-user-data.sh']
assert sha(files['controller.tar'])==plan['controller_sha256'] and len(files['controller.tar'])==plan['controller_bytes']
controller,cfiles=unpack(files['controller.tar'],root/'controller','PACKAGE.json')
assert sha(cfiles['experiments/research-step-34/CONTROLLER-PLAN.json'])==plan['controller_plan_sha256']
assert sha(cfiles['source-kit.tar'])==plan['source_kit_sha256']
PY
VERIFIED=1
PLAN="$ROOT/package/experiments/research-step-35/EXECUTION-PLAN.json"
IMAGE=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["runtime_image"])' "$PLAN")
python3 - "$ROOT/package/execution.json" "$W_LAUNCH" "$PLAN" <<'PY'
import json,sys
from pathlib import Path
path,launch,plan=sys.argv[1:];p=json.loads(Path(plan).read_bytes())
Path(path).write_text(json.dumps({'launch_epoch':int(launch),'deadline_epoch':int(launch)+5400,
  'source_kit_sha256':p['source_kit_sha256'],'controller_plan_sha256':p['controller_plan_sha256']}))
PY
PHASE=image
bounded 1200 systemctl start docker
bounded 1200 docker pull "$IMAGE"
bounded 1200 docker image inspect "$IMAGE" > "$OUT/image-inspect.json"
PHASE=controller
bounded 5100 docker run --name "$W_RUN" --network none --cpuset-cpus 0-15 --memory 24g --memory-swap 24g \
  --pids-limit 1024 --read-only --log-driver none --tmpfs /tmp:rw,exec,size=1g \
  --mount "type=bind,src=$ROOT/package,dst=/work/package,readonly" \
  --mount "type=bind,src=$OUT,dst=/work/output" --entrypoint python3 "$IMAGE" \
  /work/package/controller/scripts/weight_corpus_controller.py run \
  --source-kit /work/package/controller/source-kit.tar --execution /work/package/execution.json \
  --output /work/output/controller > "$OUT/controller.stdout.log" 2> "$OUT/controller.stderr.log"
PHASE=complete
