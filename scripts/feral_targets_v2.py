"""Materialize and score the FERAL FinQA target revision from fixed sources."""

import argparse
from collections import Counter
from decimal import Decimal
from fractions import Fraction
import json
from pathlib import Path
import re
import subprocess

from research_baselines import ROOT, normalize_answer, require, sha

PATCH = ROOT / "experiments/research-step-7/TARGET-PATCH.json"
PLAN = ROOT / "experiments/research-step-7/PLAN.md"
FROZEN = ROOT / "experiments/research-step-7/MANIFEST.json"
PREDICTIONS_PATH = "artifacts/feral-7b-sec-v2/evaluation/baseline-finqa-retrieved.jsonl"
PREDICTIONS_SHA = "4ade8a32e3b6d1c42dc49bf28826d65cf33f748dc1deec8eccc7399f2ad9f5c1"
UNITS = {"ratio", "percent", "percentage_points", "usd_million", "usd_per_share", "million_shares", "usd", "shares"}
ABSTENTIONS = {"insufficient_evidence", "insufficient evidence", "insufficient information",
               "unknown", "cannot determine", "unable to determine", "cannot be determined"}
NUMBER = re.compile(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d{1,2})?")


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()


def ndjson(rows):
    return b"".join(encode(row) + b"\n" for row in rows)


def read_rows(data):
    rows = [json.loads(line) for line in data.splitlines() if line.strip()]
    ids = [row.get("id") for row in rows]
    require(ids and all(isinstance(x, str) and x for x in ids) and len(set(ids)) == len(ids),
            "rows need ordered unique IDs")
    return rows


def calculate(tree, depth=0):
    require(depth <= 12, "calculation depth exceeds the audit limit")
    if isinstance(tree, str):
        require(len(tree) <= 100 and NUMBER.fullmatch(tree), "calculation needs a finite decimal")
        return Fraction(Decimal(tree))
    require(isinstance(tree, list) and len(tree) == 3, "calculation needs one binary operation")
    name, left, right = tree
    a, b = calculate(left, depth + 1), calculate(right, depth + 1)
    if name == "add":
        return a + b
    if name == "subtract":
        return a - b
    if name == "multiply":
        return a * b
    require(name == "divide" and b != 0, "calculation division is invalid")
    return a / b


def operands(tree):
    if isinstance(tree, str):
        return [tree]
    return operands(tree[1]) + operands(tree[2])


def rounded_cents(value):
    numerator = abs(value.numerator) * 100
    whole, remainder = divmod(numerator, value.denominator)
    return (whole + (2 * remainder >= value.denominator)) * (-1 if value < 0 else 1)


def abstained(value):
    return value is None or (isinstance(value, str)
                            and " ".join(value.strip().lower().rstrip(".!?").split()) in ABSTENTIONS)


def numeric_prediction(value, requested_unit):
    unit = requested_unit
    explicit_unit = False
    if isinstance(value, dict):
        require(set(value) == {"value", "unit"}, "numeric object needs value and unit")
        unit, value = value["unit"], value["value"]
        require(unit in UNITS, "unknown answer unit")
        explicit_unit = True
    require(isinstance(value, (str, int, float)) and not isinstance(value, bool), "answer needs one number")
    text = str(value).strip()
    if text.startswith("$"):
        require(unit in {"usd", "usd_million", "usd_per_share"}, "currency marker conflicts with answer unit")
        text = text[1:].strip()
    if text.endswith("%"):
        require(not explicit_unit or unit == "percent", "percent marker conflicts with explicit unit")
        unit, text = "percent", text[:-1].strip()
    if "," in text:
        require(re.fullmatch(r"[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?", text), "invalid number grouping")
        text = text.replace(",", "")
    require(len(text) <= 100 and NUMBER.fullmatch(text), "answer needs one finite decimal")
    number = Fraction(Decimal(text))
    if unit == requested_unit:
        return number
    dimensionless = {"ratio": 1, "percent": 100, "percentage_points": 100}
    if unit in dimensionless and requested_unit in dimensionless:
        return number * dimensionless[requested_unit] / dimensionless[unit]
    conversions = {("usd", "usd_million"): Fraction(1, 1000000),
                   ("shares", "million_shares"): Fraction(1, 1000000)}
    require((unit, requested_unit) in conversions, "incompatible answer units")
    return number * conversions[(unit, requested_unit)]


def correct(value, target):
    if target["kind"] == "legacy_exact":
        return normalize_answer(value) == normalize_answer(target["original_answer"])
    if target["kind"] == "abstention":
        return abstained(value)
    try:
        number = numeric_prediction(value, target["unit"])
        return rounded_cents(number) == rounded_cents(Fraction(target["expected_rational"]))
    except (ValueError, TypeError, ArithmeticError):
        return False


def build_rows(base_bytes, source_bytes, patch):
    require(sha(base_bytes) == patch["base_inputs_sha256"], "base input digest differs")
    require(sha(source_bytes) == patch["source_sha256"], "source digest differs")
    require(patch["numeric_rounding"] == {"decimal_places": 2, "tie_rule": "away_from_zero"},
            "numeric rounding policy differs")
    base = read_rows(base_bytes)
    require(len(base) == patch["roster_count"], "base roster count differs")
    original_rows = json.loads(source_bytes)
    original = {row["id"]: row for row in original_rows}
    require(len(original) == len(original_rows), "source IDs are duplicated")
    updates = {row["id"]: row for row in patch["patches"]}
    require(len(updates) == len(patch["patches"]), "repair IDs are duplicated")
    empty_ids = [row["id"] for row in base if not str(row["answer"]).strip()]
    require(empty_ids == list(updates), "repairs must cover the complete ordered empty-target set")
    model_rows, targets = [], []
    for row in base:
        require(row["id"] in original, "base ID is absent from source")
        qa = original[row["id"]]["qa"]
        require(str(qa["answer"]) == row["answer"], "published target differs from source")
        messages = row["messages"]
        require([entry["role"] for entry in messages] == ["system", "user"], "input message roles differ")
        context = json.loads(messages[1]["content"])
        require(context == {"question": qa["question"], "retrieved_evidence": qa["model_input"]},
                "published model evidence differs from source")
        # Allowlist the model view. Targets and review calculations remain in the grader view.
        model_rows.append({"schema": "ilxyr.feral_model_input.v2", "task": "finqa",
                           "id": row["id"], "messages": messages})
        target = {"id": row["id"], "original_answer": row["answer"], "kind": "legacy_exact"}
        if row["id"] in updates:
            update = updates[row["id"]]
            require(sha(messages[1]["content"].encode()) == update["model_context_sha256"], "review context digest differs")
            require(sha(encode(qa)) == update["source_qa_sha256"], "review source digest differs")
            require(update["question"] == qa["question"] and update["source_program"] == qa["program"]
                    and update["source_execution_answer"] == str(qa["exe_ans"]), "review source fields differ")
            require(set(update["evidence_ids"]) <= {entry[0] for entry in qa["model_input"]}, "review uses evidence outside model input")
            require(update["kind"] in {"numeric", "abstention"}, "unknown repair kind")
            target["kind"] = update["kind"]
            if update["kind"] == "numeric":
                require(update["unit"] in UNITS, "unknown target unit")
                selected = " ".join(text for name, text in qa["model_input"] if name in update["evidence_ids"])
                evidence_numbers = {Fraction(Decimal(token.replace(",", ""))) for token in
                                    re.findall(r"[+-]?\d[\d,]*(?:\.\d+)?", selected)}
                require(all(Fraction(Decimal(value)) in evidence_numbers or value == "100"
                            for value in operands(update["calculation"])), "calculation uses an operand outside supplied evidence")
                target.update(unit=update["unit"], expected_rational=str(calculate(update["calculation"])))
            else:
                require(update["unit"] is None and update["calculation"] is None, "abstention carries a numeric target")
        targets.append(target)
    return model_rows, targets


def score(predictions, targets):
    require([row["id"] for row in predictions] == [row["id"] for row in targets], "prediction roster differs")
    require(len({row["id"] for row in targets}) == len(targets) and targets, "target roster needs unique IDs")
    totals = {kind: {"rows": 0, "correct": 0} for kind in ["legacy_exact", "numeric", "abstention"]}
    original_correct = 0
    abstentions = 0
    by_issuer = {}
    reviewed = []
    for prediction, target in zip(predictions, targets):
        require("prediction" in prediction, "prediction value is missing")
        value = prediction["prediction"]
        passed = correct(value, target)
        original_correct += normalize_answer(value) == normalize_answer(target["original_answer"])
        abstentions += abstained(value)
        totals[target["kind"]]["rows"] += 1
        totals[target["kind"]]["correct"] += passed
        issuer = target["id"].split("/", 1)[0]
        group = by_issuer.setdefault(issuer, {"rows": 0, "correct": 0})
        group["rows"] += 1
        group["correct"] += passed
        if target["kind"] != "legacy_exact":
            reviewed.append({"id": target["id"], "kind": target["kind"], "prediction": value, "correct": passed})
    count = len(targets)
    total_correct = sum(value["correct"] for value in totals.values())
    return {"rows": count, "original_correct": original_correct, "v2_correct": total_correct,
            "original_accuracy": original_correct / count, "v2_accuracy": total_correct / count,
            "by_target_kind": totals, "explicit_abstentions": abstentions,
            "non_abstained_fraction": (count - abstentions) / count,
            "by_issuer": dict(sorted(by_issuer.items())), "reviewed_cases": reviewed}


def verify_frozen(path):
    manifest = json.loads(path.read_bytes())
    require(manifest["schema"] == "ilxyr.feral_target_version.v2" and manifest["execution_authorized"] is False,
            "target version scope differs")
    require(manifest["runner_sha256"] == sha(Path(__file__).read_bytes()), "target runner digest differs")
    require(manifest["dependency_sha256"] == sha((ROOT / "scripts/research_baselines.py").read_bytes()), "legacy scorer digest differs")
    require(manifest["patch_sha256"] == sha(PATCH.read_bytes()), "target patch digest differs")
    require(manifest["plan_sha256"] == sha(PLAN.read_bytes()), "target plan digest differs")
    require(manifest["counts"] == {"legacy_exact": 1133, "numeric": 11, "abstention": 3}, "target count differs")
    patch = json.loads(PATCH.read_bytes())
    require(manifest["source_sha256"] == patch["source_sha256"] and manifest["base_inputs_sha256"] == patch["base_inputs_sha256"], "source bindings differ")
    expected = {row["id"]: str(calculate(row["calculation"])) for row in patch["patches"] if row["kind"] == "numeric"}
    require(manifest["reviewed_numeric_targets"] == expected, "reviewed arithmetic differs")
    audit = manifest["historical_output_audit"]
    require(audit["rows"] == 1147 and audit["original_correct"] == 168, "historical score differs")
    require(manifest["historical_predictions_sha256"] == PREDICTIONS_SHA, "historical output source differs")
    require([row["id"] for row in audit["reviewed_cases"]] == [row["id"] for row in patch["patches"]], "reviewed audit roster differs")
    for row, update in zip(audit["reviewed_cases"], patch["patches"]):
        target = {"kind": update["kind"], "unit": update["unit"]}
        if update["kind"] == "numeric":
            target["expected_rational"] = str(calculate(update["calculation"]))
        require(row["kind"] == target["kind"] and row["correct"] == correct(row["prediction"], target), "reviewed score differs")
    require(audit["by_target_kind"]["legacy_exact"] == {"rows": 1133, "correct": 168}, "retained target score differs")
    for kind in ["numeric", "abstention"]:
        cases = [row for row in audit["reviewed_cases"] if row["kind"] == kind]
        require(audit["by_target_kind"][kind] == {"rows": len(cases), "correct": sum(row["correct"] for row in cases)}, "reviewed group score differs")
    require(audit["v2_correct"] == sum(row["correct"] for row in audit["by_target_kind"].values()), "v2 audit total differs")
    require(sum(row["rows"] for row in audit["by_issuer"].values()) == audit["rows"]
            and sum(row["correct"] for row in audit["by_issuer"].values()) == audit["v2_correct"], "issuer audit totals differ")
    require(audit["original_accuracy"] == audit["original_correct"] / audit["rows"]
            and audit["v2_accuracy"] == audit["v2_correct"] / audit["rows"], "audit accuracy differs")
    return {"verified": str(path), "sha256": sha(path.read_bytes())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--feral-repo", type=Path)
    parser.add_argument("--finqa-source", type=Path)
    parser.add_argument("--out-dir", type=Path)
    parser.add_argument("--score-dir", type=Path)
    parser.add_argument("--predictions", type=Path)
    parser.add_argument("--check-manifest", type=Path)
    args = parser.parse_args()
    if args.check_manifest:
        print(json.dumps(verify_frozen(args.check_manifest)))
        return
    if args.score_dir:
        require(args.predictions, "scoring needs a prediction file")
        manifest = json.loads((args.score_dir / "manifest.json").read_bytes())
        require(manifest == json.loads(FROZEN.read_bytes()), "materialized manifest differs from frozen version")
        verify_frozen(args.score_dir / "manifest.json")
        target_bytes = (args.score_dir / "targets.jsonl").read_bytes()
        input_bytes = (args.score_dir / "model-inputs.jsonl").read_bytes()
        require(sha(target_bytes) == manifest["targets_sha256"] and sha(input_bytes) == manifest["model_inputs_sha256"], "materialized files differ")
        print(json.dumps(score(read_rows(args.predictions.read_bytes()), read_rows(target_bytes)), indent=2))
        return
    require(args.feral_repo and args.finqa_source and args.out_dir, "build needs source repository, FinQA file, and new output directory")
    patch = json.loads(PATCH.read_bytes())
    def source(path):
        return subprocess.check_output(["git", "-C", str(args.feral_repo), "show", f"{patch['base_revision']}:{path}"])
    base_bytes = source(patch["base_inputs_path"])
    predictions_bytes = source(PREDICTIONS_PATH)
    require(sha(predictions_bytes) == PREDICTIONS_SHA, "historical prediction digest differs")
    model_rows, targets = build_rows(base_bytes, args.finqa_source.read_bytes(), patch)
    model_bytes, target_bytes = ndjson(model_rows), ndjson(targets)
    historical = score(read_rows(predictions_bytes), targets)
    require(historical["original_correct"] == 168, "historical score replay differs")
    manifest = {"schema": "ilxyr.feral_target_version.v2", "version": patch["version"],
        "evidence_kind": "posthoc_target_revision_and_old_output_audit", "execution_authorized": False,
        "runner_sha256": sha(Path(__file__).read_bytes()), "dependency_sha256": sha((ROOT / "scripts/research_baselines.py").read_bytes()),
        "patch_sha256": sha(PATCH.read_bytes()), "plan_sha256": sha(PLAN.read_bytes()),
        "base_inputs_sha256": sha(base_bytes), "source_sha256": patch["source_sha256"],
        "historical_predictions_sha256": sha(predictions_bytes),
        "model_inputs_sha256": sha(model_bytes), "targets_sha256": sha(target_bytes),
        "ordered_ids_sha256": sha(encode([row["id"] for row in targets])),
        "counts": dict(Counter(row["kind"] for row in targets)),
        "reviewed_numeric_targets": {row["id"]: row["expected_rational"] for row in targets if row["kind"] == "numeric"},
        "historical_output_audit": historical}
    args.out_dir.mkdir(parents=True, exist_ok=False)
    (args.out_dir / "model-inputs.jsonl").write_bytes(model_bytes)
    (args.out_dir / "targets.jsonl").write_bytes(target_bytes)
    (args.out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"output": str(args.out_dir), "counts": manifest["counts"],
                      "original_correct": historical["original_correct"], "v2_correct": historical["v2_correct"]}))


if __name__ == "__main__":
    main()
