"""Build an immutable FERAL source and input package from committed files."""

import argparse
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile

from feral_targets_v2 import encode, ndjson, read_rows, sha

FERAL_SOURCE = "4f2a40d3ad7372e2a5620cf3657959d4b1cac4cf"
SMOKE_IDS = ["MAS/2017/page_27.pdf-2", "AES/2002/page_128.pdf-2", "PNC/2012/page_100.pdf-3",
             "CE/2016/page_19.pdf-4", "HIG/2011/page_53.pdf-4"]
CODE = ["feral_responses.py", "feral_comparison_worker.py", "score_feral_comparison.py",
        "feral_evidence_calculator.py", "feral_targets_v2.py", "research_baselines.py"]


def package_comparison(repo, revision, feral_repo, inputs, output, smoke=False):
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("a full ilXyr commit is required")
    def source(root, commit, path):
        return subprocess.check_output(["git", "-C", str(root), "show", commit + ":" + path], stderr=subprocess.PIPE)
    frozen_bytes = source(repo, revision, "experiments/research-step-7/MANIFEST.json")
    frozen = json.loads(frozen_bytes)
    model_bytes, target_bytes = (inputs / "model-inputs.jsonl").read_bytes(), (inputs / "targets.jsonl").read_bytes()
    if sha(model_bytes) != frozen["model_inputs_sha256"] or sha(target_bytes) != frozen["targets_sha256"]:
        raise ValueError("version-two input or target digest differs")
    model_rows, targets = read_rows(model_bytes), read_rows(target_bytes)
    if [r["id"] for r in model_rows] != [r["id"] for r in targets]:
        raise ValueError("input and target rosters differ")
    if smoke:
        model_map, target_map = {r["id"]: r for r in model_rows}, {r["id"]: r for r in targets}
        model_rows, targets = [model_map[i] for i in SMOKE_IDS], [target_map[i] for i in SMOKE_IDS]
    files = {"scripts/" + path: source(repo, revision, "scripts/" + path) for path in CODE}
    if sha(files["scripts/feral_targets_v2.py"]) != frozen["runner_sha256"] or sha(files["scripts/research_baselines.py"]) != frozen["dependency_sha256"]:
        raise ValueError("version-two scorer source differs")
    files.update({"inputs/model-inputs.jsonl": ndjson(model_rows), "grader/targets.jsonl": ndjson(targets),
        "grader/TARGET-VERSION.json": frozen_bytes,
        "model/FILES.json": source(repo, revision, "experiments/research-step-13/MODEL-FILES.json"),
        "PLAN.md": source(repo, revision, "experiments/research-step-13/PLAN.md")})
    for path in ["pyproject.toml", "uv.lock"]:
        files["environment/" + path] = source(feral_repo, FERAL_SOURCE, "ml/sec-qwen/" + path)
    files["provenance/legacy-baseline.py"] = source(feral_repo, FERAL_SOURCE, "ml/sec-qwen/src/sec_qwen/baseline.py")
    identity = {"schema": "ilxyr.feral_comparison_package.v1", "scope": "opened_five_case_smoke" if smoke else "full_finqa_1147",
        "source_commit": revision, "runner_watch_source_commit": FERAL_SOURCE,
        "arms": ["base", "calculator", "operand_only"], "ordered_ids": [r["id"] for r in model_rows],
        "target_manifest_sha256": sha(frozen_bytes),
        "files": {name: {"sha256": sha(raw), "bytes": len(raw), "phase": "grading" if name.startswith("grader/") else "prediction"}
                  for name, raw in sorted(files.items())}}
    files["PACKAGE.json"] = (json.dumps(identity, indent=2, sort_keys=True) + "\n").encode()
    with tarfile.open(output, "x", format=tarfile.USTAR_FORMAT) as archive:
        for name, raw in sorted(files.items()):
            entry = tarfile.TarInfo(name)
            entry.size, entry.mode, entry.mtime = len(raw), 0o644, 0
            archive.addfile(entry, io.BytesIO(raw))
    return {"archive_sha256": sha(output.read_bytes()), "archive_bytes": output.stat().st_size,
            "package_manifest_sha256": sha(files["PACKAGE.json"]), "source_commit": revision,
            "scope": identity["scope"], "rows": len(model_rows), "files": len(files)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--feral-repo", type=Path, required=True)
    parser.add_argument("--inputs", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--smoke", action="store_true")
    args = parser.parse_args()
    print(json.dumps(package_comparison(args.repo, args.revision, args.feral_repo, args.inputs, args.out, args.smoke)))


if __name__ == "__main__":
    main()
