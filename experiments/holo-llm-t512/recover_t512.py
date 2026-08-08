#!/usr/bin/env python3
"""Recover a strict ilXyr metrics envelope from the completed T=512 run.

The first admitted training run completed all computation, but its wrapper
included non-schema metadata in stdout and therefore could not be finalized by
ilXyr. This recovery is intentionally transparent: it verifies the captured
result file's SHA-256, frozen config, upstream source commit, and source-file
hashes, then emits only the metrics/source envelope accepted by ilXyr.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
UPSTREAM = ROOT / "vendor" / "holo-llm-hrr-attention"
CAPTURED = ROOT / "experiments" / "holo-llm-t512" / "runs" / "run_holo.hrr.t512.enwik8.v2_1786214604523.json"
CAPTURED_SHA256 = "f7c319079cc22135782b05e0e75e0be104782b2b017e3bffa7010249cb6b1369"
EXPECTED_COMMIT = "578af4e5f368c198fa8c1ca8e32ae7258762b28b"
EXPECTED_ARTIFACTS = {
    "train.py": "c159707df262a312d851d2fd091d79ed59fc60b37131a936c210b19a35f6fd87",
    "model.py": "05f6eb89cd76d0b0f118e638e7cebf6f0d1b5724c97cc3e9be652685feb9e580",
    "data/enwik8": "2b49720ec4d78c3c9fabaee6e4179a5e997302b3a70029f30f2d582218c024a8",
}
EXPECTED_CONFIG = {
    "B": 16,
    "T": 512,
    "d_model": 256,
    "n_layer": 4,
    "n_head": 4,
    "steps": 1500,
    "lr": 0.0003,
    "seed": 0,
    "a_init": 0.99,
    "log_every": 250,
    "eval_iters": 20,
    "arms": "softmax,hrr,gated",
    "train_frac": 0.95,
    "val_frac": 0.05,
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    if sha256_file(CAPTURED) != CAPTURED_SHA256:
        raise SystemExit("captured result SHA-256 mismatch")
    payload = json.loads(CAPTURED.read_text())
    config = payload["config"]
    for key, expected in EXPECTED_CONFIG.items():
        if config.get(key) != expected:
            raise SystemExit(f"frozen config mismatch for {key}: {config.get(key)!r}")
    if payload.get("device") != "cpu":
        raise SystemExit(f"unexpected captured device: {payload.get('device')!r}")

    import subprocess

    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=UPSTREAM, text=True).strip()
    if commit != EXPECTED_COMMIT:
        raise SystemExit(f"upstream commit mismatch: {commit}")
    for relative, expected in EXPECTED_ARTIFACTS.items():
        actual = sha256_file(UPSTREAM / relative)
        if actual != expected:
            raise SystemExit(f"upstream artifact mismatch for {relative}: {actual}")

    by_arm = {row["attn"]: row for row in payload["results"]}
    softmax = by_arm["softmax"]
    hrr = by_arm["hrr"]
    gated = by_arm["gated"]
    metrics = {
        "execution_complete": 1.0,
        "source_clean": 1.0,
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
    run_id = os.environ.get("ILXYR_RUN_ID", "manual-t512-recovery")
    safe_id = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in run_id)
    metadata = {
        "recovery_of": str(CAPTURED.relative_to(ROOT)),
        "captured_result_sha256": CAPTURED_SHA256,
        "captured_device": payload["device"],
        "captured_config": config,
    }
    (CAPTURED.parent / f"{safe_id}.metadata.json").write_text(json.dumps(metadata, indent=2, sort_keys=True))
    print(json.dumps({
        "metrics": metrics,
        "source": {
            "repository": "https://huggingface.co/staccs/holo-llm-hrr-attention",
            "commit": EXPECTED_COMMIT,
            "artifacts": [
                {"path": relative, "sha256": digest} for relative, digest in EXPECTED_ARTIFACTS.items()
            ] + [{"path": str(CAPTURED.relative_to(ROOT)), "sha256": CAPTURED_SHA256}],
        },
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
