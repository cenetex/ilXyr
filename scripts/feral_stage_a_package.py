"""Freeze a source-only FERAL Stage A model worker package.

Model weights and grading labels stay outside this archive. The model profile
pins the public checkpoint revision; a GPU preflight verifies local model
files and the runtime image before execution.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import tarfile

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "experiments/feral-source-selector/stage-a"
FILES = [
    "experiments/feral-source-selector/stage-a/EVIDENCE.json",
    "experiments/feral-source-selector/stage-a/QUESTIONS.json",
    "experiments/feral-source-selector/stage-a/SOURCE-MANIFEST.json",
    "experiments/feral-source-selector/stage-a/MODEL-INPUTS.json",
    "experiments/feral-source-selector/stage-a/MODEL-PROFILE.json",
    "scripts/feral_stage_a_model.py",
    "scripts/feral_stage_a_selector.py",
    "scripts/check_feral_runtime_cache.py",
]


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encode(value):
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()


def freeze():
    bindings = {}
    for name in FILES:
        raw = (ROOT / name).read_bytes()
        bindings[name] = {"bytes": len(raw), "sha256": sha(raw)}
    profile = json.loads((BASE / "MODEL-PROFILE.json").read_bytes())
    return {
        "schema": "ilxyr.feral_stage_a_source_package.v1",
        "model_repository": profile["repository"],
        "model_revision": profile["revision"],
        "model_weights_in_archive": False,
        "grading_labels_in_archive": False,
        "files": bindings,
    }


def archive(manifest):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w", format=tarfile.PAX_FORMAT) as output:
        for name in FILES + ["PACKAGE.json"]:
            raw = encode(manifest) if name == "PACKAGE.json" else (ROOT / name).read_bytes()
            info = tarfile.TarInfo(name)
            info.size = len(raw)
            info.mtime = 0
            info.mode = 0o644
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            output.addfile(info, io.BytesIO(raw))
    return stream.getvalue()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--archive", type=Path)
    args = parser.parse_args()
    manifest = freeze()
    path = BASE / "MODEL-PACKAGE.json"
    if args.write:
        path.write_bytes(encode(manifest))
    if args.check and path.read_bytes() != encode(manifest):
        raise ValueError("source package binding differs")
    if args.archive:
        raw = archive(manifest)
        args.archive.write_bytes(raw)
        print(json.dumps({"archive_bytes": len(raw), "archive_sha256": sha(raw),
                          "manifest_sha256": sha(encode(manifest))}))
    elif args.write or args.check:
        print(json.dumps({"manifest_sha256": sha(encode(manifest)), "files": len(FILES)}))


if __name__ == "__main__":
    main()
