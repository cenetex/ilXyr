"""Build and run the pinned Qwen3.5-4B FERAL selector prompting control.

The worker receives the same issuer identities, 60 concepts, question text,
and exact resolver as the deterministic selector. Gold labels stay separate.
"""
import argparse
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import time

from feral_stage_a_selector import BASE, encode, pick, sha

MODEL = "Qwen/Qwen3.5-4B"
REVISION = "851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a"
SYSTEM = (
    "Select evidence for one financial question. Reply with one JSON object only. "
    "For a supported numeric lookup or change, use exactly these keys: issuer, concept, "
    "years, operation. issuer is cat, ibm, or wmt. concept is one listed us-gaap name. "
    "years is one fiscal-end year for lookup or two ascending fiscal-end years for "
    "difference. operation is lookup or difference. A difference means later minus "
    "earlier. For missing, ambiguous, index, or explanatory requests, reply with "
    '{"abstain":"short reason"}. Do not invent a fact or concept.'
)


def model_inputs(evidence, questions, manifest):
    catalogue = [{"concept": row["concept"], "label": row["standard_label"],
                  "period_type": row["structural_metadata"]["period_type"]}
                 for row in evidence["catalogue"]]
    issuers = [{"id": row["id"], "issuer": row["issuer"], "fiscal_end": row["fiscal_end"]}
               for row in manifest["families"]]
    rows = []
    for form in questions["forms"]:
        user = json.dumps({"question": form["text"], "issuers": issuers,
                           "concepts": catalogue}, separators=(",", ":"), ensure_ascii=False)
        rows.append({"id": form["id"], "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": user},
        ]})
    return {"schema": "ilxyr.feral_stage_a_model_inputs.v1",
            "evidence_sha256": sha(encode(evidence)),
            "questions_sha256": sha(encode(questions)),
            "model": MODEL, "revision": REVISION,
            "rows": rows}


def parse_selection(raw, concepts, issuers):
    try:
        value = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return None, "invalid_json"
    if not isinstance(value, dict):
        return None, "invalid_shape"
    if set(value) == {"abstain"} and isinstance(value["abstain"], str) and value["abstain"]:
        return None, "model_abstain"
    if set(value) != {"issuer", "concept", "years", "operation"}:
        return None, "invalid_shape"
    if not isinstance(value["issuer"], str) or not isinstance(value["concept"], str):
        return None, "invalid_shape"
    if value["issuer"] not in issuers or value["concept"] not in concepts:
        return None, "unknown_selection"
    years = value["years"]
    operation = value["operation"]
    if not isinstance(operation, str):
        return None, "invalid_shape"
    if not isinstance(years, list) or not all(type(year) is int and 1900 <= year <= 2099 for year in years):
        return None, "invalid_years"
    if operation == "lookup" and len(years) != 1:
        return None, "invalid_operation"
    if operation == "difference" and (len(years) != 2 or years != sorted(set(years))):
        return None, "invalid_operation"
    if operation not in {"lookup", "difference"}:
        return None, "invalid_operation"
    return value, None


def resolve(evidence, questions, manifest, inputs, outputs, method):
    catalogue = {row["concept"]: row for row in evidence["catalogue"]}
    families = {row["id"]: row for row in evidence["families"]}
    issuer_ids = set(families)
    if inputs["evidence_sha256"] != sha(encode(evidence)) or inputs["questions_sha256"] != sha(encode(questions)):
        raise ValueError("model input binding differs")
    if len(outputs) != len(inputs["rows"]) or [row["id"] for row in outputs] != [row["id"] for row in inputs["rows"]]:
        raise ValueError("model output roster differs")
    predictions = []
    for row in outputs:
        parsed, reason = parse_selection(row["raw"], catalogue, issuer_ids)
        kind = "abstain" if reason == "model_abstain" else "invalid" if reason else "abstain"
        prediction = {"id": row["id"], "kind": kind, "reason": reason,
                      "selection": parsed, "support": [], "answer": None, "unit": None}
        if parsed is not None:
            selected = []
            for year in parsed["years"]:
                fact, failure = pick(families[parsed["issuer"]], parsed["concept"], year, catalogue)
                if failure:
                    prediction["reason"] = failure
                    break
                selected.append(fact)
            else:
                values = [Decimal(item["value"]) for item in selected]
                value = values[0] if parsed["operation"] == "lookup" else values[1] - values[0]
                prediction.update(kind="answer", reason="answered",
                                  support=[item["id"] for item in selected],
                                  answer=format(value, "f"), unit="usd")
        predictions.append(prediction)
    return {"schema": "ilxyr.feral_stage_a_selector_predictions.v1",
            "method": method, "evidence_sha256": inputs["evidence_sha256"],
            "questions_sha256": inputs["questions_sha256"], "predictions": predictions}


def load_view(base):
    return tuple(json.loads((base / name).read_bytes())
                 for name in ("EVIDENCE.json", "QUESTIONS.json", "SOURCE-MANIFEST.json"))


def write_inputs(base):
    evidence, questions, manifest = load_view(base)
    result = model_inputs(evidence, questions, manifest)
    (base / "MODEL-INPUTS.json").write_bytes(encode(result))
    return result




def verify_model_files(model_dir, profile):
    if profile["repository"] != MODEL or profile["revision"] != REVISION:
        raise ValueError("model identity differs")
    for name, binding in profile["files"].items():
        path = (model_dir / name).resolve()
        if not path.is_relative_to(model_dir.resolve()) or path.stat().st_size != binding["bytes"]:
            raise ValueError("model file size differs: " + name)
        digest = hashlib.sha256()
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest() != binding["sha256"]:
            raise ValueError("model file digest differs: " + name)

def run_model(base, model_dir, output_dir, smoke_only=False):
    """Run one bounded GPU control; the caller freezes image and model files."""
    import torch
    from transformers import AutoTokenizer, Qwen3_5ForCausalLM

    output_dir.mkdir(parents=True, exist_ok=False)
    evidence, questions, manifest = load_view(base)
    profile = json.loads((base / "MODEL-PROFILE.json").read_bytes())
    verify_model_files(model_dir, profile)
    inputs = json.loads((base / "MODEL-INPUTS.json").read_bytes())
    if inputs != model_inputs(evidence, questions, manifest):
        raise ValueError("model input bytes differ")
    tokenizer = AutoTokenizer.from_pretrained(model_dir, local_files_only=True, trust_remote_code=False)
    model = Qwen3_5ForCausalLM.from_pretrained(
        model_dir, local_files_only=True, trust_remote_code=False,
        dtype=torch.bfloat16, device_map={"": "cuda:0"})
    model.eval()
    torch.manual_seed(17)
    outputs = []
    started = time.perf_counter_ns()
    with (output_dir / "RAW.jsonl").open("x") as stream:
        for row in inputs["rows"][:1] if smoke_only else inputs["rows"]:
            prompt = tokenizer.apply_chat_template(
                row["messages"], tokenize=False, add_generation_prompt=True,
                enable_thinking=False)
            tokens = tokenizer(prompt, return_tensors="pt", add_special_tokens=False).to(model.device)
            input_count = int(tokens["input_ids"].shape[1])
            if input_count > 4096:
                raw = ""
                result = {"status": "input_limit", "input_tokens": input_count}
            else:
                torch.cuda.synchronize()
                row_started = time.perf_counter_ns()
                with torch.inference_mode():
                    generated = model.generate(
                        **tokens, max_new_tokens=160, do_sample=True,
                        temperature=0.7, top_p=0.8, top_k=20,
                        pad_token_id=tokenizer.eos_token_id)
                torch.cuda.synchronize()
                continuation = generated[0, input_count:]
                raw = tokenizer.decode(continuation, skip_special_tokens=True)
                result = {"status": "generated", "input_tokens": input_count,
                          "output_tokens": len(continuation),
                          "wall_ns": time.perf_counter_ns() - row_started}
            record = {"id": row["id"], "raw": raw, **result}
            stream.write(json.dumps(record, sort_keys=True) + "\n")
            stream.flush()
            outputs.append(record)
    predictions = None
    if not smoke_only:
        predictions = resolve(evidence, questions, manifest, inputs, outputs, "qwen3.5-4b-prompting")
        (output_dir / "PREDICTIONS.json").write_bytes(encode(predictions))
    receipt = {"schema": "ilxyr.feral_stage_a_model_receipt.v1",
               "model": MODEL, "revision": REVISION,
               "inputs_sha256": sha(encode(inputs)),
               "raw_sha256": sha((output_dir / "RAW.jsonl").read_bytes()),
               "predictions_sha256": sha(encode(predictions)) if predictions else None,
               "rows": len(outputs), "total_wall_ns": time.perf_counter_ns() - started,
               "peak_gpu_bytes": torch.cuda.max_memory_allocated(),
               "scope": "one_form_loader_smoke" if smoke_only else "all_36_forms"}
    (output_dir / "RECEIPT.json").write_bytes(encode(receipt))
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, default=BASE)
    parser.add_argument("--write-inputs", action="store_true")
    parser.add_argument("--model-dir", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--smoke-only", action="store_true")
    args = parser.parse_args()
    if args.write_inputs:
        value = write_inputs(args.base)
        print(json.dumps({"rows": len(value["rows"]), "sha256": sha(encode(value))}))
    elif args.model_dir and args.output:
        print(json.dumps(run_model(args.base, args.model_dir, args.output, args.smoke_only), sort_keys=True))
    else:
        parser.error("choose --write-inputs or --model-dir with --output")


if __name__ == "__main__":
    main()
