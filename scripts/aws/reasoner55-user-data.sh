set -Eeuo pipefail
trap 'shutdown -h now' EXIT
remaining=$((R_LAUNCH + 3570 - $(date +%s)))
test "$remaining" -gt 0
systemd-run --unit=reasoner55-deadline --on-active="$remaining" /usr/sbin/shutdown -h now
ROOT=/opt/reasoner55
install -d -m 0755 "$ROOT/output"
OUT="$ROOT/output"
exec > >(tee -a "$ROOT/bootstrap.log") 2>&1
PHASE=package
COLLECTION_OK=1
export AWS_DEFAULT_REGION=us-east-1 AWS_MAX_ATTEMPTS=1

bounded() {
  local reserve=$1
  shift
  local seconds=$((R_LAUNCH + 3600 - reserve - $(date +%s)))
  test "$seconds" -gt 0 || return 124
  timeout --signal=TERM --kill-after=5s "${seconds}s" "$@"
}
put_once() {
  local file=$1 key=$2 checksum
  checksum=$(python3 - "$file" <<'PY'
import base64,hashlib,sys
h=hashlib.sha256()
with open(sys.argv[1],'rb') as f:
    for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
print(base64.b64encode(h.digest()).decode())
PY
)
  bounded 60 aws s3api put-object --bucket "$R_BUCKET" --key "$key" --body "$file" \
    --server-side-encryption AES256 --if-none-match '*' --checksum-algorithm SHA256 \
    --checksum-sha256 "$checksum" --cli-connect-timeout 3 --cli-read-timeout 15 --no-cli-pager
}
finish() {
  local code=$?
  trap - EXIT
  set +e
  bounded 90 docker rm -f "$R_RUN"
  python3 - "$OUT" "$ROOT/roster.txt" <<'PY'
from pathlib import Path
import sys
root=Path(sys.argv[1]);names=[]
for p in sorted(root.rglob('*')):
    name=p.relative_to(root)
    if name.parts[0]=='source':continue
    if p.is_symlink() or '\n' in str(name):raise ValueError('result path differs')
    if p.is_file():names.append(str(name))
Path(sys.argv[2]).write_text(''.join(n+'\n' for n in names))
PY
  if [ "$?" -ne 0 ]; then COLLECTION_OK=0; fi
  while IFS= read -r name; do
    put_once "$OUT/$name" "runs/$R_RUN/results/$name" || COLLECTION_OK=0
  done < "$ROOT/roster.txt"
  cp "$ROOT/bootstrap.log" "$ROOT/bootstrap-snapshot.log"
  put_once "$ROOT/bootstrap-snapshot.log" "runs/$R_RUN/bootstrap.log" || COLLECTION_OK=0
  if [ "$COLLECTION_OK" -ne 1 ]; then code=1; fi
  python3 - "$ROOT/host-terminal.json" "$code" "$PHASE" "$R_RUN" "$R_LAUNCH" \
    "$R_PACKAGE_SHA" "$R_PLAN_SHA" "$COLLECTION_OK" "${INSTANCE_ID:-}" <<'PY'
import hashlib,json,sys,time
from pathlib import Path
path,code,phase,run,launch,package,plan,collected,instance=sys.argv[1:]
v={'schema':'ilxyr.reasoner55_host_terminal.v1','status':'complete' if code=='0' and collected=='1' else 'failed',
   'exit_code':int(code),'phase':phase,'run_id':run,'instance_id':instance or None,
   'package_sha256':package,'plan_sha256':plan,'collection_complete':collected=='1',
   'elapsed_instance_seconds':time.time()-int(launch),'actual_billed_usd':None,
   'instance_termination_verified':False,'user_data_sha256':hashlib.sha256(Path('/var/lib/cloud/instance/user-data.txt').read_bytes()).hexdigest()}
Path(path).write_text(json.dumps(v,indent=2,sort_keys=True)+'\n')
PY
  put_once "$ROOT/host-terminal.json" "runs/$R_RUN/host-terminal.json"
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
test "$(metadata instance-type)" = c6i.xlarge
test "$(metadata ami-id)" = ami-0d3378afe7683c867
unset TOKEN
bounded 3060 aws s3api get-object --bucket "$R_BUCKET" --key "$R_PACKAGE_KEY" \
  --version-id "$R_PACKAGE_VERSION" "$ROOT/package.tar" --no-cli-pager
python3 - "$ROOT/package.tar" "$R_PACKAGE_SHA" "$R_PLAN_SHA" "$ROOT/package" <<'PY'
import hashlib,io,json,sys,tarfile
from pathlib import Path,PurePosixPath
archive,expected,plan_sha,output=sys.argv[1:];root=Path(output);root.mkdir()
def unpack(raw,folder):
    if len(raw)>8*1024*1024:raise ValueError('package exceeds bound')
    with tarfile.open(fileobj=io.BytesIO(raw),mode='r:') as t:
        items=t.getmembers()
        assert len(items)==len({m.name for m in items})
        for m in items:
            p=PurePosixPath(m.name)
            assert m.isfile() and not p.is_absolute() and '..' not in p.parts and str(p)==m.name and m.size<=8*1024*1024
            target=folder/m.name;target.parent.mkdir(parents=True,exist_ok=True)
            with target.open('xb') as f:f.write(t.extractfile(m).read())
raw=Path(archive).read_bytes();assert hashlib.sha256(raw).hexdigest()==expected;unpack(raw,root)
manifest=json.loads((root/'PACKAGE.json').read_bytes());assert manifest['plan_sha256']==plan_sha
for name,binding in manifest['files'].items():
    p=(root/name).resolve();assert p.is_relative_to(root.resolve())
    assert p.stat().st_size==binding['bytes'] and hashlib.sha256(p.read_bytes()).hexdigest()==binding['sha256']
assert hashlib.sha256((root/'EXECUTION-PLAN.json').read_bytes()).hexdigest()==plan_sha
body=Path('/var/lib/cloud/instance/user-data.txt').read_bytes().split(b'\n# REASONER_BODY\n')
assert len(body)==2 and body[1]==(root/'scripts/aws/reasoner55-user-data.sh').read_bytes()
plan=json.loads((root/'EXECUTION-PLAN.json').read_bytes())
assert plan['limits']['max_instance_seconds']==3600 and plan['budget']['maximum_before_tax_usd']=='0.50'
source=(root/'source.tar').read_bytes();assert hashlib.sha256(source).hexdigest()==plan['source_archive_sha256']
unpack(source,root/'source')
PY
IMAGE=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["runtime_image"])' "$ROOT/package/EXECUTION-PLAN.json")
PHASE=image
bounded 3060 systemctl start docker
bounded 3060 docker pull "$IMAGE"
bounded 3060 docker image inspect "$IMAGE" > "$OUT/image-inspect.json"
PHASE=controller
bounded 300 docker run --name "$R_RUN" --network none --cpuset-cpus 0 --memory 6g \
  --read-only --tmpfs /tmp:rw,size=256m \
  --mount "type=bind,src=$ROOT/package,dst=/work/package,readonly" \
  --mount "type=bind,src=$OUT,dst=/work/output" --entrypoint node "$IMAGE" \
  /work/package/scripts/run_reasoner_cloud.mjs /work/package /work/output run \
  > "$OUT/controller.stdout.log" 2> "$OUT/controller.stderr.log"
PHASE=complete
