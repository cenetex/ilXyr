#!/usr/bin/env python3
"""Certified-lab wrapper for the public T=512 HRR reproduction.

The upstream training program writes human-readable progress to stdout and a
JSON result file. ilXyr requires the executor's stdout to be one exact JSON
metrics envelope, so this wrapper captures the upstream transcript, stores the
result under the run directory, forwards the transcript to stderr, and emits
only the declared metric envelope on stdout.
"""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
import os
import platform
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
UPSTREAM = ROOT / "vendor" / "holo-llm-hrr-attention"
RUNS = ROOT / "experiments" / "holo-llm-t512" / "runs"
PYTHON = Path(sys.executable)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    RUNS.mkdir(parents=True, exist_ok=True)
    run_id = os.environ.get("ILXYR_RUN_ID", "manual-t512")
    safe_id = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in run_id)
    result_path = RUNS / f"{safe_id}.json"
    transcript_path = RUNS / f"{safe_id}.transcript.txt"

    source_commit = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=UPSTREAM, text=True
    ).strip()
    source_dirty = bool(
        subprocess.check_output(
            ["git", "status", "--porcelain", "--untracked-files=no"],
            cwd=UPSTREAM,
            text=True,
        ).strip()
    )

    command = [
        str(PYTHON),
        str(UPSTREAM / "train.py"),
        "--corpus",
        str(UPSTREAM / "data" / "enwik8"),
        "--T",
        "512",
        "--B",
        "16",
        "--d_model",
        "256",
        "--n_layer",
        "4",
        "--n_head",
        "4",
        "--steps",
        "1500",
        "--lr",
        "3e-4",
        "--seed",
        "0",
        "--a_init",
        "0.99",
        "--log_every",
        "250",
        "--eval_iters",
        "20",
        "--arms",
        "softmax,hrr,gated",
        "--out",
        str(result_path),
    ]

    completed = subprocess.run(
        command,
        cwd=UPSTREAM,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        check=False,
    )
    transcript_path.write_text(completed.stdout)
    print(completed.stdout, file=sys.stderr, end="")
    if completed.returncode != 0:
        return completed.returncode

    payload = json.loads(result_path.read_text())
    by_arm = {row["attn"]: row for row in payload["results"]}
    softmax = by_arm["softmax"]
    hrr = by_arm["hrr"]
    gated = by_arm["gated"]

    metrics = {
        "execution_complete": 1.0,
        "source_clean": float(not source_dirty),
        "softmax_final_val_bpb": softmax["final_val_bpb"],
        "hrr_final_val_bpb": hrr["final_val_bpb"],
        "gated_final_val_bpb": gated["final_val_bpb"],
        "softmax_median_ms_per_step": softmax["median_ms_per_step"],
        "hrr_median_ms_per_step": hrr["median_ms_per_step"],
        "gated_median_ms_per_step": gated["median_ms_per_step"],
        "hrr_minus_softmax_bpb": hrr["final_val_bpb"] - softmax["final_val_bpb"],
        "gated_minus_softmax_bpb": gated["final_val_bpb"] - softmax["final_val_bpb"],
        "hrr_speedup_vs_softmax": softmax["median_ms_per_step"] / hrr["median_ms_per_step"],
        "gated_speedup_vs_softmax": softmax["median_ms_per_step"] / gated["median_ms_per_step"],
    }
    run_metadata = {
        "python": str(PYTHON),
        "python_version": platform.python_version(),
        "platform": platform.platform(),
        "torch_version": importlib.metadata.version("torch"),
        "numpy_version": importlib.metadata.version("numpy"),
        "torch_device": payload["device"],
        "config": payload["config"],
    }
    (RUNS / f"{safe_id}.metadata.json").write_text(json.dumps(run_metadata, indent=2, sort_keys=True))
    envelope = {
        "metrics": metrics,
        "source": {
            "repository": "https://huggingface.co/staccs/holo-llm-hrr-attention",
            "commit": source_commit,
            "artifacts": [
                {"path": "train.py", "sha256": sha256_file(UPSTREAM / "train.py")},
                {"path": "model.py", "sha256": sha256_file(UPSTREAM / "model.py")},
                {"path": "data/enwik8", "sha256": sha256_file(UPSTREAM / "data" / "enwik8")},
            ],
        },
    }
    print(json.dumps(envelope, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
