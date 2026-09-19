"""Score completed FERAL arm records against the separate version-two targets."""

import argparse
import json
from pathlib import Path

from feral_comparison_worker import ROOT, ARMS, file_sha, verify_package, write_json
from feral_responses import parse_response
from feral_targets_v2 import read_rows, score


def score_arm(directory, targets, expected_arm=None, expected_bindings=None):
    invocation_path = directory / "invocation.json"
    invocation = json.loads(invocation_path.read_bytes()) if invocation_path.exists() else None
    if invocation is not None:
        if expected_arm is not None and invocation["arm"] != expected_arm:
            raise ValueError("invocation arm differs")
        if expected_bindings is not None and invocation["package_manifest_sha256"] != expected_bindings["package_manifest_sha256"]:
            raise ValueError("invocation package differs")
    if not (directory / "result.json").exists():
        if invocation is None or invocation["status"] != "failed":
            raise ValueError("terminal failure record is missing")
        return {"status": "incomplete", "completed_rows": 0, "expected_rows": len(targets),
                "error": invocation.get("error"), "invocation": invocation,
                "primary_metrics": None, "performance_evidence": False}
    terminal = json.loads((directory / "result.json").read_bytes())
    if expected_arm is not None and terminal["arm"] != expected_arm:
        raise ValueError("arm identity differs")
    if expected_bindings is not None and terminal["bindings"] != expected_bindings:
        raise ValueError("prediction package or inputs differ")
    path = directory / "predictions.jsonl"
    if path.exists() and file_sha(path) != terminal["predictions_sha256"]:
        raise ValueError("prediction digest differs")
    raw = path.read_bytes() if path.exists() else b""
    rows = read_rows(raw) if raw else []
    if len(rows) != terminal["rows"] or [r["id"] for r in rows] != [r["id"] for r in targets][:len(rows)]:
        raise ValueError("completed prediction prefix differs")
    for row in rows:
        parsed = parse_response(row["raw_response"])
        if row["prediction"] != parsed["prediction"] or row["response_status"] != parsed["response_status"]:
            raise ValueError("stored answer differs from raw response")
    costs = {key: terminal[key] for key in ["total_wall_ns", "process_cpu_ns", "setup_wall_ns"] if key in terminal}
    if terminal["status"] != "complete" or terminal["rows"] != len(targets) or (invocation is not None and invocation["status"] != "complete"):
        return {"status": "incomplete", "completed_rows": terminal["rows"], "expected_rows": len(targets),
                "error": terminal.get("error"), "primary_metrics": None,
                "raw_cost": costs, "invocation": invocation, "performance_evidence": False}
    return {"status": "complete", "primary_metrics": score(rows, targets),
            "response_counts": {kind: sum(row["response_status"] == kind for row in rows)
                                for kind in ["answered", "abstained", "invalid"]},
            "raw_cost": costs, "invocation": invocation,
            "performance_evidence": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest-sha256", required=True)
    parser.add_argument("--runs", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    package = verify_package(ROOT, args.manifest_sha256, include_grading=True)
    targets = read_rows((ROOT / "grader/targets.jsonl").read_bytes())
    if [r["id"] for r in targets] != package["ordered_ids"]:
        raise ValueError("grader roster differs")
    bindings = {"package_manifest_sha256": args.manifest_sha256,
                "inputs_sha256": package["files"]["inputs/model-inputs.jsonl"]["sha256"],
                "model_inventory_sha256": package["files"]["model/FILES.json"]["sha256"]}
    results = {arm: score_arm(args.runs / arm, targets, arm, bindings) for arm in ARMS}
    if args.out.exists():
        raise FileExistsError(args.out)
    write_json(args.out, {"schema": "ilxyr.feral_comparison_result.v1", "scope": package["scope"],
                         "package_manifest_sha256": args.manifest_sha256, "arms": results,
                         "status": "complete" if all(r["status"] == "complete" for r in results.values()) else "incomplete"})


if __name__ == "__main__":
    main()
