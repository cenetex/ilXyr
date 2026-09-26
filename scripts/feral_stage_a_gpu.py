"""Freeze and launch the one-hour FERAL Stage A GPU comparison.

The paid launch takes a reviewed, versioned source object. The source archive
contains model inputs and code; the host downloads exact public model bytes.
"""
import argparse
import base64
from decimal import Decimal
import gzip
import hashlib
import json
from pathlib import Path
import re
import shlex
import subprocess
import time
import urllib.request

from feral_stage_a_package import archive, freeze, sha
from feral_cloud_package import launch_request

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "experiments/feral-source-selector/stage-a"
BUCKET = "ilxyr-feral-7b-calibration-022118847419-us-east-1"
IMAGE = "ghcr.io/atimics/feral-7b-sec-qwen@sha256:c7df646b246f9c853946201aa7ad5c06ea711c34633594943365153342df346b"
BODY = ROOT / "scripts/aws/feral-stage-a-gpu-user-data.sh"
MODEL_REVISION = "851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a"
ACCOUNT = "022118847419"
PRICE_URL = ("https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/"
             "ec2-ondemand-without-sec-sel/US%20East%20%28N.%20Virginia%29/Linux/index.json")
RATE_CODE = "HK3A8PU2TSC6EKP6.JRTCKXETXF.6YS6EN2CT7"


def encode(value):
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()


def aws(args, profile="default", check=True):
    result = subprocess.run(["aws", *args, "--profile", profile, "--region", "us-east-1",
                             "--no-cli-pager"], capture_output=True, text=True, timeout=90)
    if check and result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    return result


def render(binding):
    patterns = {
        "run_id": r"feral-stage-a-[0-9]{8}T[0-9]{6}Z",
        "source_sha256": r"[0-9a-f]{64}",
        "source_version": r"[A-Za-z0-9._+/=-]{1,256}",
    }
    for key, pattern in patterns.items():
        if not isinstance(binding.get(key), str) or not re.fullmatch(pattern, binding[key]):
            raise ValueError("launch binding differs: " + key)
    if type(binding.get("launch_epoch_seconds")) is not int or binding["launch_epoch_seconds"] <= 0:
        raise ValueError("launch time differs")
    values = {
        "FERAL_RUN_ID": binding["run_id"],
        "FERAL_LAUNCH_EPOCH": str(binding["launch_epoch_seconds"]),
        "FERAL_BUCKET": BUCKET,
        "FERAL_SOURCE_KEY": "packages/feral-comparison/" + binding["source_sha256"] + ".tar",
        "FERAL_SOURCE_VERSION": binding["source_version"],
        "FERAL_SOURCE_SHA256": binding["source_sha256"],
        "FERAL_IMAGE": IMAGE,
        "FERAL_MODEL_REVISION": MODEL_REVISION,
    }
    prefix = "#!/bin/bash\n" + "".join(key + "=" + shlex.quote(value) + "\n" for key, value in values.items())
    return (prefix + BODY.read_text()).encode()


def verify_local_package():
    frozen = freeze()
    if (BASE / "MODEL-PACKAGE.json").read_bytes() != encode(frozen):
        raise ValueError("source package manifest differs")
    raw = archive(frozen)
    if len(raw) > 8 * 1024 * 1024:
        raise ValueError("source archive exceeds host bound")
    return raw


def committed_source():
    changed = subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=all"], cwd=ROOT)
    if changed:
        raise ValueError("commit the source package before staging")
    return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()


def verify_staged_commit(binding):
    committed_source()
    source_commit = binding["source_commit"]
    if not re.fullmatch(r"[0-9a-f]{40}", source_commit):
        raise ValueError("staged source commit differs")
    if subprocess.run(["git", "merge-base", "--is-ancestor", source_commit, "HEAD"], cwd=ROOT).returncode:
        raise ValueError("staged source commit is outside current history")


def current_compute_price():
    with urllib.request.urlopen(PRICE_URL, timeout=15) as stream:
        raw = stream.read(8 * 1024 * 1024)
    catalogue = json.loads(gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw)
    rows = catalogue["regions"]["US East (N. Virginia)"].values()
    matches = [row for row in rows if row.get("rateCode") == RATE_CODE
               and row.get("Instance Type") == "g6e.2xlarge"]
    if len(matches) != 1:
        raise ValueError("instance price identity differs")
    price = Decimal(matches[0]["price"])
    if price + Decimal("0.75") > Decimal("3.00"):
        raise ValueError("cost ceiling exceeded")
    return {"publication_at": catalogue["manifest"]["hawkFilePublicationDate"],
            "source_sha256": sha(raw), "rate_code": RATE_CODE,
            "compute_usd_per_hour": str(price), "reserve_usd": "0.75",
            "max_before_tax_usd": str(price + Decimal("0.75"))}


def stage(profile, out):
    source_commit = committed_source()
    raw = verify_local_package()
    out.mkdir(parents=True, exist_ok=False)
    path = out / "source.tar"
    path.write_bytes(raw)
    digest = sha(raw)
    key = "packages/feral-comparison/" + digest + ".tar"
    checksum = base64.b64encode(hashlib.sha256(raw).digest()).decode()
    identity = aws(["sts", "get-caller-identity", "--query", "Account", "--output", "text"], profile).stdout.strip()
    if identity != ACCOUNT:
        raise ValueError("AWS account differs")
    result = json.loads(aws(["s3api", "put-object", "--bucket", BUCKET, "--key", key,
                            "--body", str(path), "--server-side-encryption", "AES256",
                            "--if-none-match", "*", "--checksum-algorithm", "SHA256",
                            "--checksum-sha256", checksum], profile).stdout)
    binding = {"schema": "ilxyr.feral_stage_a_gpu_source_binding.v1", "bucket": BUCKET,
               "source_commit": source_commit,
               "key": key, "source_sha256": digest, "source_bytes": len(raw),
               "source_version": result["VersionId"], "source_checksum_sha256": checksum,
               "image": IMAGE, "model_revision": MODEL_REVISION}
    (out / "BINDING.json").write_bytes(encode(binding))
    return binding


def preflight(profile, binding, network, out):
    verify_staged_commit(binding)
    if binding["image"] != IMAGE or binding["model_revision"] != MODEL_REVISION:
        raise ValueError("runtime identity differs")
    raw = verify_local_package()
    if sha(raw) != binding["source_sha256"] or len(raw) != binding["source_bytes"]:
        raise ValueError("source package changed")
    head = json.loads(aws(["s3api", "head-object", "--bucket", BUCKET, "--key", binding["key"],
                          "--version-id", binding["source_version"], "--checksum-mode", "ENABLED"], profile).stdout)
    if head["ContentLength"] != len(raw) or head.get("ChecksumSHA256") != binding["source_checksum_sha256"]:
        raise ValueError("versioned source object differs")
    caller = aws(["sts", "get-caller-identity", "--query", "Account", "--output", "text"], profile).stdout.strip()
    if caller != ACCOUNT:
        raise ValueError("AWS account differs")
    image = json.loads(aws(["ec2", "describe-images", "--image-ids", "ami-0d3378afe7683c867"], profile).stdout)["Images"]
    if len(image) != 1 or image[0]["Architecture"] != "x86_64":
        raise ValueError("AMI identity differs")
    run = {"run_id": "feral-stage-a-20260101T000000Z", "source_sha256": binding["source_sha256"],
           "host_package_sha256": binding["source_sha256"],
           "source_version": binding["source_version"], "launch_epoch_seconds": 1}
    request = launch_request(render(run), run, network)
    dry = aws(["ec2", "run-instances", "--cli-input-json", json.dumps(request, separators=(",", ":"))], profile, False)
    if dry.returncode == 0 or "DryRunOperation" not in dry.stderr:
        raise RuntimeError("EC2 dry run failed: " + dry.stderr.strip())
    price = current_compute_price()
    receipt = {"schema": "ilxyr.feral_stage_a_gpu_preflight.v1", "status": "dry_run_passed",
               "checked_epoch_seconds": int(time.time()), "source_sha256": binding["source_sha256"],
               "source_version": binding["source_version"], "ami": image[0]["ImageId"],
               "image": IMAGE, "account": caller, "instance_type": "g6e.2xlarge",
               "max_instance_seconds": 3600, "max_before_tax_usd": "3.00", "price": price}
    out.mkdir(parents=True, exist_ok=False)
    (out / "PREFLIGHT.json").write_bytes(encode(receipt))
    return receipt


def launch(profile, binding, network, preflight_path, authorization_path, out):
    verify_staged_commit(binding)
    receipt = json.loads(preflight_path.read_bytes())
    if (receipt["status"] != "dry_run_passed"
            or receipt["source_sha256"] != binding["source_sha256"]
            or receipt["source_version"] != binding["source_version"]
            or receipt["image"] != IMAGE
            or receipt["account"] != ACCOUNT
            or receipt["max_instance_seconds"] != 3600
            or receipt["max_before_tax_usd"] != "3.00"):
        raise ValueError("preflight binding differs")
    if time.time() - receipt["checked_epoch_seconds"] > 3600:
        raise ValueError("preflight expired")
    authorization = json.loads(authorization_path.read_bytes())
    approved_run_id = authorization.get("run_id")
    if not isinstance(approved_run_id, str) or not re.fullmatch(r"feral-stage-a-[0-9]{8}T[0-9]{6}Z", approved_run_id):
        raise ValueError("authorized run ID differs")
    expected = {"schema": "ilxyr.feral_stage_a_gpu_authorization.v1",
                "run_id": approved_run_id,
                "source_sha256": binding["source_sha256"],
                "source_version": binding["source_version"],
                "max_instance_seconds": 3600, "max_before_tax_usd": "3.00",
                "run_count": 1, "reference": "user-four-priorities-2026-09-26"}
    if authorization != expected:
        raise ValueError("launch authorization differs")
    now = int(time.time())
    run = {"run_id": approved_run_id,
           "source_sha256": binding["source_sha256"], "host_package_sha256": binding["source_sha256"],
           "source_version": binding["source_version"],
           "launch_epoch_seconds": now}
    request = launch_request(render(run), run, network)
    request["DryRun"] = False
    out.mkdir(parents=True, exist_ok=False)
    (out / "REQUEST.json").write_bytes(encode(request))
    (out / "SUBMITTED.json").write_bytes(encode({"status": "submission_started",
        "run_id": run["run_id"], "source_sha256": binding["source_sha256"],
        "request_sha256": sha(encode(request)), "authorization_sha256": sha(authorization_path.read_bytes()),
        "launch_epoch_seconds": now}))
    try:
        response = json.loads(aws(["ec2", "run-instances", "--cli-input-json",
                                   json.dumps(request, separators=(",", ":"))], profile).stdout)
    except BaseException as error:
        (out / "OUTCOME-UNKNOWN.json").write_bytes(encode({"status": "launch_outcome_unknown",
            "run_id": run["run_id"], "request_sha256": sha(encode(request)),
            "error": str(error)}))
        raise
    instances = response["Instances"]
    if len(instances) != 1:
        raise ValueError("launch response instance roster differs")
    result = {"schema": "ilxyr.feral_stage_a_gpu_launch.v1", "status": "launched",
              "run_id": run["run_id"], "instance_id": instances[0]["InstanceId"],
              "source_sha256": binding["source_sha256"], "source_version": binding["source_version"],
              "request_sha256": sha(encode(request)), "launch_epoch_seconds": now,
              "authorization_sha256": sha(authorization_path.read_bytes()),
              "max_instance_seconds": 3600, "max_before_tax_usd": "3.00"}
    (out / "LAUNCH.json").write_bytes(encode(result))
    return result


def observe(profile, launch_record):
    run_id = launch_record["run_id"]
    if not re.fullmatch(r"feral-stage-a-[0-9]{8}T[0-9]{6}Z", run_id):
        raise ValueError("run ID differs")
    instance_id = launch_record["instance_id"]
    if not re.fullmatch(r"i-[0-9a-f]+", instance_id):
        raise ValueError("instance ID differs")
    reservations = json.loads(aws(["ec2", "describe-instances", "--instance-ids", instance_id], profile).stdout)["Reservations"]
    instances = [item for group in reservations for item in group["Instances"]]
    if len(instances) != 1 or instances[0]["InstanceId"] != instance_id:
        raise ValueError("instance lookup differs")
    objects = json.loads(aws(["s3api", "list-object-versions", "--bucket", BUCKET,
                              "--prefix", "runs/" + run_id + "/"], profile).stdout)
    versions = [{"key": row["Key"], "version_id": row["VersionId"], "bytes": row["Size"]}
                for row in objects.get("Versions", [])]
    if objects.get("IsTruncated"):
        raise ValueError("result version listing is truncated")
    if len({row["key"] for row in versions}) != len(versions):
        raise ValueError("result object has multiple versions")
    return {"schema": "ilxyr.feral_stage_a_gpu_observation.v1", "run_id": run_id,
            "instance_id": instance_id, "instance_state": instances[0]["State"]["Name"],
            "result_versions": sorted(versions, key=lambda row: row["key"])}


def collect(profile, launch_record, out):
    observation = observe(profile, launch_record)
    if observation["instance_state"] != "terminated":
        raise ValueError("instance termination is pending")
    prefix = "runs/" + launch_record["run_id"] + "/"
    out.mkdir(parents=True, exist_ok=False)
    records = []
    for row in observation["result_versions"]:
        key = row["key"]
        if not key.startswith(prefix) or not key[len(prefix):] or ".." in Path(key[len(prefix):]).parts:
            raise ValueError("result path differs")
        target = out / key[len(prefix):]
        target.parent.mkdir(parents=True, exist_ok=True)
        aws(["s3api", "get-object", "--bucket", BUCKET, "--key", key,
             "--version-id", row["version_id"], str(target)], profile)
        raw = target.read_bytes()
        if len(raw) != row["bytes"]:
            raise ValueError("result object size differs: " + key)
        head = json.loads(aws(["s3api", "head-object", "--bucket", BUCKET,
                              "--key", key, "--version-id", row["version_id"],
                              "--checksum-mode", "ENABLED"], profile).stdout)
        expected = base64.b64encode(hashlib.sha256(raw).digest()).decode()
        if head.get("ChecksumSHA256") != expected:
            raise ValueError("result object checksum differs: " + key)
        records.append({"path": key[len(prefix):], "version_id": row["version_id"],
                        "bytes": len(raw), "sha256": sha(raw)})
    terminal_path = out / "TERMINAL.json"
    if not terminal_path.is_file():
        raise ValueError("terminal result is missing")
    terminal = json.loads(terminal_path.read_bytes())
    if terminal["run_id"] != launch_record["run_id"] or terminal["source_archive_sha256"] != launch_record["source_sha256"]:
        raise ValueError("terminal identity differs")
    receipt = {"schema": "ilxyr.feral_stage_a_gpu_collection.v1", "run_id": launch_record["run_id"],
               "instance_id": launch_record["instance_id"], "instance_state": "terminated",
               "terminal_status": terminal["status"], "objects": records}
    (out / "COLLECTION.json").write_bytes(encode(receipt))
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    for action in ("stage", "preflight", "launch", "observe", "collect"):
        item = sub.add_parser(action)
        item.add_argument("--out", type=Path, required=True)
        item.add_argument("--profile", default="default")
        if action in ("preflight", "launch"):
            item.add_argument("--binding", type=Path, required=True)
            item.add_argument("--network", type=Path, required=True)
        if action == "launch":
            item.add_argument("--preflight", type=Path, required=True)
            item.add_argument("--authorization", type=Path, required=True)
        if action in ("observe", "collect"):
            item.add_argument("--launch", type=Path, required=True)
    args = parser.parse_args()
    binding = json.loads(args.binding.read_bytes()) if args.action in ("preflight", "launch") else None
    network = json.loads(args.network.read_bytes()) if args.action in ("preflight", "launch") else None
    if args.action == "stage":
        result = stage(args.profile, args.out)
    elif args.action == "preflight":
        result = preflight(args.profile, binding, network, args.out)
    elif args.action == "launch":
        result = launch(args.profile, binding, network, args.preflight, args.authorization, args.out)
    elif args.action == "observe":
        result = observe(args.profile, json.loads(args.launch.read_bytes()))
        args.out.mkdir(parents=True, exist_ok=False)
        (args.out / "OBSERVATION.json").write_bytes(encode(result))
    else:
        result = collect(args.profile, json.loads(args.launch.read_bytes()), args.out)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
