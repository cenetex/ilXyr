"""Build the Reasoner source archive from a full commit and its smoke bindings."""

import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile

SMOKE = "benchmarks/reasoner55-matched-controls-v1/SMOKE.json"
REPORT = "benchmarks/reasoner55-matched-controls-v1/REPORT.md"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def package_sources(repo, revision, output):
    require(re.fullmatch(r"[0-9a-f]{40}", revision), "use a full source commit")

    def git(*args):
        return subprocess.check_output(["git", "-C", str(repo), *args], stderr=subprocess.PIPE)

    require(git("rev-parse", "--verify", revision + "^{commit}").decode().strip() == revision, "source commit differs")

    def source(path):
        return git("show", revision + ":" + path)

    smoke = json.loads(source(SMOKE))
    require(smoke["schema"] == "zero.reasoner55_matched_smoke.v1" and smoke["timing_evidence"] is False,
            "source needs the engineering smoke record")
    paths = set(smoke["source_bindings"]) | {SMOKE, REPORT}
    files = {}
    for path in sorted(paths):
        parsed = PurePosixPath(path)
        require(path == str(parsed) and not parsed.is_absolute() and ".." not in parsed.parts
                and "\\" not in path and "\0" not in path and parsed.parts, "source path must stay in the archive")
        blob = source(path)
        if path in smoke["source_bindings"]:
            require(sha(blob) == smoke["source_bindings"][path], "smoke source digest differs: " + path)
        files[path] = blob
    identity = {"schema": "zero.reasoner55_matched_source_archive.v1", "source_commit": revision,
                "files": {path: sha(blob) for path, blob in files.items()}}
    files["SOURCE-IDENTITY.json"] = (json.dumps(identity, indent=2, sort_keys=True) + "\n").encode()
    with tarfile.open(output, "x", format=tarfile.USTAR_FORMAT) as archive:
        for path, blob in sorted(files.items()):
            entry = tarfile.TarInfo(path)
            entry.size, entry.mode, entry.mtime = len(blob), 0o644, 0
            archive.addfile(entry, io.BytesIO(blob))
    return {"source_commit": revision, "archive": str(output), "sha256": sha(output.read_bytes()),
            "bytes": output.stat().st_size, "source_files": len(identity["files"])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zero-repo", type=Path, required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(package_sources(args.zero_repo, args.revision, args.output)))


if __name__ == "__main__":
    main()
