set -Eeuo pipefail
trap 'shutdown -h now' EXIT
remaining=$((W_LAUNCH + 1770 - $(date +%s)))
test "$remaining" -gt 0
systemd-run --unit=feral-49-deadline --on-active="$remaining" /usr/sbin/shutdown -h now
ROOT=${W_WORK_ROOT:-/opt/feral-49}
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
  bounded 1100 docker inspect "$W_RUN" > "$OUT/container-inspect.json"
  bounded 1110 docker rm -f "$W_RUN"
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
    bounded 1745 python3 "$ROOT/package/scripts/feral_coverage_cloud_collect.py" host --root "$ROOT" \
      --plan "$ROOT/package/experiments/research-step-49/EXECUTION-PLAN.json" --identity "$ROOT/identity.json" || code=1
  else
    checksum=$(python3 -c 'import hashlib,base64,sys;print(base64.b64encode(hashlib.sha256(open(sys.argv[1],"rb").read()).digest()).decode())' "$OUT/bootstrap.log")
    bounded 1700 aws s3api put-object --bucket "$W_BUCKET" --key "runs/$W_RUN/bootstrap.log" \
      --body "$OUT/bootstrap.log" --server-side-encryption AES256 --if-none-match '*' \
      --checksum-algorithm SHA256 --checksum-sha256 "$checksum" --cli-connect-timeout 3 --cli-read-timeout 15 --no-cli-pager > "$ROOT/bootstrap-put.json"
    python3 - "$ROOT/identity.json" "$ROOT/host-terminal.json" "$OUT/bootstrap.log" "$ROOT/bootstrap-put.json" <<'PYINNER'
import base64,hashlib,json,sys
from pathlib import Path
identity,terminal,log,receipt=sys.argv[1:]
v=json.loads(Path(identity).read_bytes());v.update(schema='ilxyr.feral_coverage_host_terminal.v1',status='failed',collection_complete=False,instance_termination_verified=False,actual_billed_usd=None)
try:
 r=json.loads(Path(receipt).read_bytes());raw=Path(log).read_bytes();h=hashlib.sha256(raw).digest()
 assert r.get('VersionId') and r.get('ChecksumSHA256')==base64.b64encode(h).decode()
 v['bootstrap_receipt']={'key':'runs/'+v['run_id']+'/bootstrap.log','version_id':r['VersionId'],'bytes':len(raw),'sha256':h.hex()}
except Exception as error:v['bootstrap_upload_error']=str(error)
Path(terminal).write_text(json.dumps(v,indent=2,sort_keys=True)+'\n')
PYINNER
    checksum=$(python3 -c 'import hashlib,base64,sys;print(base64.b64encode(hashlib.sha256(open(sys.argv[1],"rb").read()).digest()).decode())' "$ROOT/host-terminal.json")
    bounded 1740 aws s3api put-object --bucket "$W_BUCKET" --key "runs/$W_RUN/host-terminal.json" \
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
bounded 600 aws s3api get-object --bucket "$W_BUCKET" --key "$W_PACKAGE_KEY" \
  --version-id "$W_PACKAGE_VERSION" "$ROOT/package.tar" --no-cli-pager
bounded 600 python3 - "$ROOT/package.tar" "$W_PACKAGE_SHA" "$W_PLAN_SHA" "$ROOT/package" "$USER_DATA" <<'PY'
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
plan_raw=files['experiments/research-step-49/EXECUTION-PLAN.json'];assert sha(plan_raw)==plan_sha
plan=json.loads(plan_raw);assert plan['limits']['max_instance_seconds']==1800 and plan['budget']['maximum_before_tax_usd']=='0.15'
body=Path(user_data).read_bytes().split(b'\n# FERAL_49_BODY\n')
assert len(body)==2 and body[1]==files['scripts/aws/feral-49-user-data.sh']
sys.path.insert(0,str(root.with_name('verified-host')/'scripts'))
from package_feral_coverage_cloud import unpack as verify_and_unpack
verify_and_unpack(Path(archive),expected,root)
PY
VERIFIED=1
PLAN="$ROOT/package/experiments/research-step-49/EXECUTION-PLAN.json"
IMAGE=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["runtime_image"])' "$PLAN")
python3 - "$ROOT/package/execution.json" "$W_RUN" "$W_PACKAGE_SHA" "$W_PLAN_SHA" "$PLAN" <<'PYEXEC'
import json,sys
from pathlib import Path
path,run,package,plan_sha,plan=sys.argv[1:];p=json.loads(Path(plan).read_bytes());v=p['provider']
Path(path).write_text(json.dumps({'schema':'ilxyr.feral_coverage_execution.v1','venue':'cloud','run_id':run,
  'package_sha256':package,'plan_sha256':plan_sha,'prepared_bindings_sha256':p['prepared']['bindings_sha256'],
  'implementation':p['implementation'], 'worker_count':1,
  'python_identity':p['python_identity'], 'node_identity':p['node_identity'],
  'machine':{'provider':'AWS',**{k:v[k] for k in ['region','instance_type','architecture']},'image_id':v['ami_id'],'runtime_image':p['runtime_image']},
  'limits':p['study_limits'],'host_limits':p['limits']},indent=2,sort_keys=True)+'\n')
PYEXEC
PHASE=image
bounded 600 systemctl start docker
bounded 600 docker pull "$IMAGE"
bounded 600 docker image inspect "$IMAGE" > "$OUT/image-inspect.json"
python3 - "$PLAN" "$OUT/image-inspect.json" <<'PYIMAGE'
import json,sys
from pathlib import Path
plan=json.loads(Path(sys.argv[1]).read_bytes());images=json.loads(Path(sys.argv[2]).read_bytes())
assert len(images)==1 and images[0]['Id']==plan['runtime_image_id']
assert images[0]['Architecture']=='amd64' and images[0]['Os']=='linux'
PYIMAGE
PHASE=storage
bounded 600 df -Pk "$ROOT" > "$OUT/filesystem.txt"
python3 - "$PLAN" "$OUT/filesystem.txt" "$OUT/DISK.json" <<'PYDISK'
import json,sys
from pathlib import Path
plan=json.loads(Path(sys.argv[1]).read_bytes())
free=int(Path(sys.argv[2]).read_text().splitlines()[1].split()[3])*1024
required=plan['storage']['max_output_bytes']+plan['storage']['max_archive_bytes']+plan['storage']['archive_chunk_bytes']+1024**3
Path(sys.argv[3]).write_text(json.dumps({'free_bytes':free,'required_bytes':required,'passes':free>=required},sort_keys=True)+'\n')
assert free>=required, 'disk space must cover output, archive, one upload part and host reserve'
PYDISK
PHASE=controller
(
  ulimit -f 32768
  bounded 1080 docker run --name "$W_RUN" --network none --cgroupns private --cpuset-cpus 0 --memory 3g --memory-swap 3g \
    --pids-limit 256 --read-only --log-driver none --tmpfs /tmp:rw,exec,size=512m \
    --env PATH=/work/package/runtime/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin --env NODE_OPTIONS=--max-old-space-size=1536 \
    --env PYTHONDONTWRITEBYTECODE=1 --env PYTHONHASHSEED=0 --env LANG=C --env LC_ALL=C --env TZ=UTC \
    --env OMP_NUM_THREADS=1 --env OPENBLAS_NUM_THREADS=1 --env MKL_NUM_THREADS=1 --env VECLIB_MAXIMUM_THREADS=1 \
    --mount "type=bind,src=$ROOT/package,dst=/work/package,readonly" \
    --mount "type=bind,src=$OUT,dst=/work/output" \
    --entrypoint python3 "$IMAGE" /work/package/scripts/feral_coverage_cloud_runtime.py cloud \
    --package /work/package --output /work/output/runtime --execution /work/package/execution.json \
    > "$OUT/runtime.stdout.log" 2> "$OUT/runtime.stderr.log"
)
PHASE=complete
