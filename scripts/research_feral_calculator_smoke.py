"""Replay five opened FERAL cases as a small calculator diagnostic."""

import argparse
import json
from pathlib import Path

from feral_evidence_calculator import digest, predict_row
from feral_targets_v2 import calculate, correct

ROOT = Path(__file__).resolve().parents[1]
IDS = ["MAS/2017/page_27.pdf-2", "AES/2002/page_128.pdf-2", "PNC/2012/page_100.pdf-3",
       "CE/2016/page_19.pdf-4", "HIG/2011/page_53.pdf-4"]
ARMS = ["calculator", "operand_only"]
BINDINGS = ["scripts/feral_evidence_calculator.py", "scripts/research_feral_calculator_smoke.py",
            "scripts/feral_targets_v2.py", "scripts/research_baselines.py",
            "experiments/research-step-7/MANIFEST.json", "experiments/research-step-7/TARGET-PATCH.json",
            "experiments/research-step-8/PLAN.md"]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def run_predictions(inputs):
    return {arm: [predict_row(row, arm) for row in inputs] for arm in ARMS}


def grade(predictions, targets):
    results = {}
    for arm in ARMS:
        rows = [{**prediction, "target_kind": target["kind"],
                 "target_correct": correct(prediction["prediction"], target)}
                for prediction, target in zip(predictions[arm], targets)]
        results[arm] = {"cases": rows, "case_count": len(rows),
                        "correct_cases": sum(row["target_correct"] for row in rows),
                        "numeric_answers": sum(row["prediction"] is not None for row in rows),
                        "abstentions": sum(row["prediction"] is None for row in rows),
                        "arithmetic_operations": sum(row["work"]["arithmetic_operations"] for row in rows)}
    return results


def check(result):
    require(result["schema"] == "ilxyr.feral_calculator_smoke.v1" and result["scope"] == "five_opened_cases",
            "smoke scope differs")
    require(result["bindings"] == {path: digest((ROOT / path).read_bytes()) for path in BINDINGS}, "source binding differs")
    manifest = json.loads((ROOT / "experiments/research-step-7/MANIFEST.json").read_bytes())
    require(result["model_inputs_sha256"] == manifest["model_inputs_sha256"]
            and result["targets_sha256"] == manifest["targets_sha256"], "target version differs")
    require([row["id"] for row in result["inputs"]] == IDS, "smoke input roster differs")
    require([row["id"] for row in result["targets"]] == IDS, "smoke target roster differs")
    patch = json.loads((ROOT / "experiments/research-step-7/TARGET-PATCH.json").read_bytes())
    patches = {row["id"]: row for row in patch["patches"]}
    for row, target in zip(result["inputs"], result["targets"]):
        update = patches[row["id"]]
        require(digest(row["messages"][1]["content"].encode()) == update["model_context_sha256"], "smoke context differs from reviewed input")
        expected = {"id": row["id"], "kind": update["kind"], "original_answer": ""}
        if expected["kind"] == "numeric":
            expected.update(unit=update["unit"], expected_rational=str(calculate(update["calculation"])))
        require(target == expected, "smoke target differs from reviewed target")
    require(result["results"] == grade(run_predictions(result["inputs"]), result["targets"]), "smoke replay differs")
    return {arm: {key: value for key, value in result["results"][arm].items() if key != "cases"} for arm in ARMS}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-inputs", type=Path)
    parser.add_argument("--targets", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--check-result", type=Path)
    args = parser.parse_args()
    if args.check_result:
        result = json.loads(args.check_result.read_bytes())
        print(json.dumps({"verified": str(args.check_result), "sha256": digest(args.check_result.read_bytes()), "results": check(result)}))
        return
    require(args.model_inputs and args.targets and args.output, "smoke needs model inputs, targets, and a new output path")
    manifest = json.loads((ROOT / "experiments/research-step-7/MANIFEST.json").read_bytes())
    input_bytes = args.model_inputs.read_bytes()
    require(digest(input_bytes) == manifest["model_inputs_sha256"], "model input digest differs")
    all_inputs = [json.loads(line) for line in input_bytes.splitlines()]
    inputs = [row for row in all_inputs if row["id"] in IDS]
    require([row["id"] for row in inputs] == IDS, "smoke roster differs")
    # Finish both prediction arms before opening the grader file.
    predictions = run_predictions(inputs)
    target_bytes = args.targets.read_bytes()
    require(digest(target_bytes) == manifest["targets_sha256"], "target digest differs")
    targets = [row for row in map(json.loads, target_bytes.splitlines()) if row["id"] in IDS]
    result = {"schema": "ilxyr.feral_calculator_smoke.v1", "scope": "five_opened_cases",
              "model_inputs_sha256": digest(input_bytes), "targets_sha256": digest(target_bytes),
              "bindings": {path: digest((ROOT / path).read_bytes()) for path in BINDINGS},
              "inputs": inputs, "targets": targets, "results": grade(predictions, targets)}
    summary = check(result)
    with args.output.open("x") as handle:
        handle.write(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"output": str(args.output), "results": summary}))


if __name__ == "__main__":
    main()
