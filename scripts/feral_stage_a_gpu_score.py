"""Verify a collected Stage A GPU result and score its frozen development forms."""
import argparse
import json
from pathlib import Path

from feral_stage_a_model import load_view, model_inputs, resolve
from feral_stage_a_selector import BASE, encode, score, sha


def verify_collection(base, launch, results):
    collection = json.loads((results / "COLLECTION.json").read_bytes())
    if (collection["run_id"] != launch["run_id"]
            or collection["instance_id"] != launch["instance_id"]
            or collection["instance_state"] != "terminated"
            or collection["source_archive_sha256"] != launch["source_sha256"]
            or collection["source_package_version"] != launch["source_version"]
            or collection["user_data_sha256"] != launch["user_data_sha256"]):
        raise ValueError("collection identity differs")
    for row in collection["objects"]:
        path = (results / row["path"]).resolve()
        if not path.is_relative_to(results.resolve()):
            raise ValueError("collected path leaves result directory")
        raw = path.read_bytes()
        if len(raw) != row["bytes"] or sha(raw) != row["sha256"]:
            raise ValueError("collected object differs: " + row["path"])
    terminal = json.loads((results / "TERMINAL.json").read_bytes())
    if terminal["status"] != "complete" or not terminal["collection_complete"]:
        raise ValueError("host did not complete and collect all output")
    return collection, terminal


def score_run(base, launch, results):
    collection, terminal = verify_collection(base, launch, results)
    smoke = json.loads((results / "smoke/RECEIPT.json").read_bytes())
    if smoke["scope"] != "one_form_loader_smoke" or smoke["rows"] != 1:
        raise ValueError("loader smoke receipt differs")
    if smoke["raw_sha256"] != sha((results / "smoke/RAW.jsonl").read_bytes()):
        raise ValueError("loader smoke raw digest differs")
    receipt = json.loads((results / "full/RECEIPT.json").read_bytes())
    if receipt["scope"] != "all_36_forms" or receipt["rows"] != 36:
        raise ValueError("full model result roster differs")
    raw_bytes = (results / "full/RAW.jsonl").read_bytes()
    if receipt["raw_sha256"] != sha(raw_bytes):
        raise ValueError("raw model output digest differs")
    outputs = [json.loads(line) for line in raw_bytes.splitlines()]
    evidence, questions, manifest = load_view(base)
    inputs = model_inputs(evidence, questions, manifest)
    if receipt["inputs_sha256"] != sha(encode(inputs)):
        raise ValueError("model input digest differs")
    predictions = resolve(evidence, questions, manifest, inputs, outputs, "qwen3.5-4b-prompting")
    saved = (results / "full/PREDICTIONS.json").read_bytes()
    if receipt["predictions_sha256"] != sha(saved) or saved != encode(predictions):
        raise ValueError("model prediction digest or replay differs")
    labels = json.loads((base / "DRAFT-LABELS.json").read_bytes())
    result = score(evidence, questions, predictions, labels)
    result["invalid_outputs"] = sum(row["kind"] == "invalid" for row in predictions["predictions"])
    review = {"schema": "ilxyr.feral_stage_a_gpu_score_review.v1",
              "run_id": launch["run_id"], "instance_id": launch["instance_id"],
              "source_archive_sha256": launch["source_sha256"],
              "collection_sha256": sha((results / "COLLECTION.json").read_bytes()),
              "terminal_sha256": sha((results / "TERMINAL.json").read_bytes()),
              "raw_sha256": receipt["raw_sha256"],
              "predictions_sha256": receipt["predictions_sha256"],
              "score_sha256": sha(encode(result)),
              "full_rows": receipt["rows"], "invalid_outputs": result["invalid_outputs"],
              "host_status": terminal["status"], "object_count": len(collection["objects"])}
    return result, review


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, default=BASE)
    parser.add_argument("--launch", type=Path, required=True)
    parser.add_argument("--results", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    result, review = score_run(args.base, json.loads(args.launch.read_bytes()), args.results)
    args.out.mkdir(parents=True, exist_ok=False)
    (args.out / "LEARNED-SCORE.json").write_bytes(encode(result))
    (args.out / "SCORE-REVIEW.json").write_bytes(encode(review))
    print(json.dumps({"complete_outcome_correct": result["complete_outcome_correct"],
                      "invalid_outputs": result["invalid_outputs"],
                      "incorrect_assertions": result["incorrect_assertions"]}))


if __name__ == "__main__":
    main()
