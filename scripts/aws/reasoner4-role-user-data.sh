set -Eeuo pipefail
ROOT=/opt/reasoner4-role-audit
install -d -m 0755 "$ROOT/output"
remaining=$((W_LAUNCH + 870 - $(date +%s)))
test "$remaining" -gt 0
systemd-run --unit=reasoner4-role-deadline --on-active="$remaining" /usr/sbin/shutdown -h now
export AWS_DEFAULT_REGION=us-east-1 AWS_MAX_ATTEMPTS=1
PHASE=metadata
INSTANCE_ID=
finish() {
  code=$?
  trap - EXIT
  set +e
  python3 - "$ROOT/output" "$code" "$PHASE" "$INSTANCE_ID" "$W_RUN" "$W_PACKAGE_SHA" <<'PY'
import hashlib,json,sys
from pathlib import Path
folder,code,phase,instance,run,package=sys.argv[1:]
root=Path(folder)
files={str(p.relative_to(root)):{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
       for p in root.rglob('*') if p.is_file() and p.name!='terminal.json'}
value={'schema':'ilxyr.reasoner4_role_host_terminal.v1','status':'complete' if int(code)==0 else 'failed',
       'exit_code':int(code),'phase':phase,'instance_id':instance or None,
       'run_id':run,'package_sha256':package,'files':files}
(root/'terminal.json').write_text(json.dumps(value,sort_keys=True)+'\n')
PY
  upload_failed=0
  while IFS= read -r -d '' file; do
    name=${file#"$ROOT/output/"}
    timeout 30s aws s3api put-object --bucket "$W_BUCKET" --key "runs/$W_RUN/$name" \
      --body "$file" --server-side-encryption AES256 --if-none-match '*' \
      --no-cli-pager > "$ROOT/put-receipt.json" 2> "$ROOT/put-error.txt" || upload_failed=1
  done < <(find "$ROOT/output" -type f ! -name terminal.json -print0)
  if test "$upload_failed" -ne 0; then
    code=1
    python3 - "$ROOT/output/terminal.json" <<'PY'
import json,sys
from pathlib import Path
p=Path(sys.argv[1]);v=json.loads(p.read_text());v['status']='failed';v['upload_failed']=True
p.write_text(json.dumps(v,sort_keys=True)+'\n')
PY
  fi
  timeout 30s aws s3api put-object --bucket "$W_BUCKET" --key "runs/$W_RUN/terminal.json" \
    --body "$ROOT/output/terminal.json" --server-side-encryption AES256 --if-none-match '*' \
    --no-cli-pager > "$ROOT/terminal-put.json" 2> "$ROOT/terminal-put.stderr" || code=1
  shutdown -h now
  exit "$code"
}
trap finish EXIT
TOKEN=$(curl --fail --silent --show-error --connect-timeout 3 --max-time 5 --request PUT \
  --header 'X-aws-ec2-metadata-token-ttl-seconds: 3600' http://169.254.169.254/latest/api/token)
INSTANCE_ID=$(curl --fail --silent --show-error --connect-timeout 3 --max-time 5 \
  --header "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)
INSTANCE_TYPE=$(curl --fail --silent --show-error --connect-timeout 3 --max-time 5 \
  --header "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-type)
AMI=$(curl --fail --silent --show-error --connect-timeout 3 --max-time 5 \
  --header "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/ami-id)
test "$INSTANCE_TYPE" = c6i.large
test "$AMI" = ami-0d3378afe7683c867
PHASE=package
timeout 90s aws s3api get-object --bucket "$W_BUCKET" --key "$W_PACKAGE_KEY" \
  --version-id "$W_PACKAGE_VERSION" "$ROOT/package.tar" --no-cli-pager > "$ROOT/download.json"
test "$(sha256sum "$ROOT/package.tar" | cut -d' ' -f1)" = "$W_PACKAGE_SHA"
mkdir "$ROOT/package"
tar -xf "$ROOT/package.tar" -C "$ROOT/package"
python3 "$ROOT/package/scripts/reasoner4_package.py" verify "$ROOT/package.tar" > "$ROOT/output/package-verification.json"
PHASE=image
timeout 90s systemctl start docker
timeout 180s docker pull "$W_IMAGE"
docker image inspect "$W_IMAGE" --format '{{.Id}}' > "$ROOT/output/image-id.txt"
test "$(cat "$ROOT/output/image-id.txt")" = sha256:7b4141c49095bb5a8dfa2ba85266d4f1d836887c46deb33b43f542387e5656bd
PHASE=probe
timeout --signal=TERM --kill-after=5s 660s docker run --name "$W_RUN" --network none \
  --cpuset-cpus 0 --memory 3g --memory-swap 3g --pids-limit 256 --read-only \
  --tmpfs /tmp:rw,exec,size=512m --log-driver none \
  --env OPENBLAS_NUM_THREADS=1 --env OMP_NUM_THREADS=1 --env MKL_NUM_THREADS=1 \
  --env PIP_NO_CACHE_DIR=1 --env PYTHONDONTWRITEBYTECODE=1 \
  --mount "type=bind,src=$ROOT/package,dst=/work,readonly" \
  --mount "type=bind,src=$ROOT/package.tar,dst=/work/package.tar,readonly" \
  --mount "type=bind,src=$ROOT/output,dst=/work/output" \
  --entrypoint python3 "$W_IMAGE" /work/scripts/reasoner4_package.py run \
  /work/package.tar /work/output/diagnostic --expected-sha256 "$W_PACKAGE_SHA" \
  > "$ROOT/output/probe.stdout.log" 2> "$ROOT/output/probe.stderr.log"
PHASE=complete
