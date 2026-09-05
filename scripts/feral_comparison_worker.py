"""Run one frozen FERAL comparison arm and retain each completed response."""

import argparse
import copy
import hashlib
import json
from pathlib import Path
import time

from feral_evidence_calculator import predict_row
from feral_responses import parse_response
from feral_targets_v2 import read_rows, sha

ROOT = Path(__file__).resolve().parents[1]
ARMS = ("base", "calculator", "operand_only")


def file_sha(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for part in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(part)
    return digest.hexdigest()


def write_json(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n")
    temporary.replace(path)


def validate_input(row):
    if set(row) != {"schema", "task", "id", "messages"} or row["schema"] != "ilxyr.feral_model_input.v2" or row["task"] != "finqa":
        raise ValueError("model input view differs")
    if not isinstance(row["id"], str) or not row["id"] or [m["role"] for m in row["messages"]] != ["system", "user"]:
        raise ValueError("input identity or roles differ")
    if any(set(m) != {"role", "content"} or not isinstance(m["content"], str) for m in row["messages"]):
        raise ValueError("message fields differ")
    context = json.loads(row["messages"][1]["content"])
    if set(context) != {"question", "retrieved_evidence"}:
        raise ValueError("evidence view differs")


def verify_package(root, expected, include_grading=False):
    raw = (root / "PACKAGE.json").read_bytes()
    if sha(raw) != expected:
        raise ValueError("package manifest digest differs")
    manifest = json.loads(raw)
    for name, binding in manifest["files"].items():
        if binding["phase"] == "grading" and not include_grading:
            continue
        path = (root / name).resolve()
        if not path.is_relative_to(root.resolve()) or file_sha(path) != binding["sha256"] or path.stat().st_size != binding["bytes"]:
            raise ValueError("package file differs: " + name)
    return manifest


def verify_model(path, inventory):
    for name, binding in inventory["files"].items():
        file = (path / name).resolve()
        if not file.is_relative_to(path.resolve()) or file.stat().st_size != binding["bytes"] or file_sha(file) != binding["sha256"]:
            raise ValueError("model file differs: " + name)
    extras = {p.relative_to(path).as_posix() for p in path.rglob("*") if p.is_file()} - set(inventory["files"])
    if extras:
        raise ValueError("model directory has extra files")


class BaseGenerator:
    def __init__(self, model_dir, inventory):
        verify_model(model_dir, inventory)
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
        torch.manual_seed(17)
        self.torch = torch
        self.tokenizer = AutoTokenizer.from_pretrained(model_dir, local_files_only=True, trust_remote_code=False)
        self.model = AutoModelForCausalLM.from_pretrained(model_dir, local_files_only=True,
            trust_remote_code=False, dtype=torch.bfloat16, attn_implementation="sdpa", device_map={"": "cuda:0"})
        self.model.eval()
        self.generation = copy.deepcopy(self.model.generation_config)
        self.generation.do_sample = False
        self.generation.num_beams = 1
        self.generation.max_new_tokens = 32
        self.generation.pad_token_id = self.tokenizer.eos_token_id
        self.generation.validate()

    def __call__(self, messages):
        prompt = self.tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = self.tokenizer(prompt, return_tensors="pt", truncation=False,
                                add_special_tokens=False).to(self.model.device)
        count = int(inputs["input_ids"].shape[1])
        if count > 8192:
            raise ValueError("input_context_limit")
        with self.torch.inference_mode():
            generated = self.model.generate(**inputs, generation_config=self.generation)
        self.torch.cuda.synchronize()
        tokens = generated[0, count:]
        raw = self.tokenizer.decode(tokens, skip_special_tokens=True)
        eos = self.generation.eos_token_id
        eos = [eos] if isinstance(eos, int) else eos
        ended = bool(len(tokens) and int(tokens[-1]) in (eos or []))
        return raw, {"input_tokens": count, "generated_tokens": len(tokens),
                     "termination": "eos" if ended else "token_limit" if len(tokens) == 32 else "other",
                     "generation_config": self.generation.to_dict()}


def run_rows(rows, arm, output, generator_factory=None, bindings=None):
    output.mkdir(parents=True, exist_ok=False)
    return _run_rows(rows, arm, output, generator_factory, bindings)


def _run_rows(rows, arm, output, generator_factory=None, bindings=None):
    started, cpu = time.perf_counter_ns(), time.process_time_ns()
    result = {"schema": "ilxyr.feral_arm_result.v1", "arm": arm, "status": "running",
              "performance_evidence": False, "rows": 0, "expected_rows": len(rows)}
    result["bindings"] = bindings or {"scope": "controlled_fixture"}
    active_id = None
    predictions = output / "predictions.jsonl"
    try:
        if arm not in ARMS:
            raise ValueError("unknown comparison arm")
        for row in rows:
            validate_input(row)
        if not rows or len({row["id"] for row in rows}) != len(rows):
            raise ValueError("input roster differs")
        generator = generator_factory() if arm == "base" else None
        result["setup_wall_ns"] = time.perf_counter_ns() - started
        with predictions.open("x") as stream:
            for row in rows:
                active_id = row["id"]
                row_started = time.perf_counter_ns()
                if arm == "base":
                    raw, work = generator(copy.deepcopy(row["messages"]))
                else:
                    selected = predict_row(row, arm)
                    raw = json.dumps({"answer": selected["prediction"]}, allow_nan=False)
                    work = {"calculator_trace": selected}
                record = {"id": row["id"], **parse_response(raw), "work": work,
                          "prediction_wall_ns": time.perf_counter_ns() - row_started}
                stream.write(json.dumps(record, sort_keys=True, allow_nan=False) + "\n")
                stream.flush()
                result["rows"] += 1
                active_id = None
        result["status"] = "complete"
    except BaseException as error:
        result.update(status="failed", error=str(error), failed_input_id=active_id)
        raise
    finally:
        result.update(total_wall_ns=time.perf_counter_ns() - started,
                      process_cpu_ns=time.process_time_ns() - cpu)
        if predictions.exists():
            result["predictions_sha256"] = file_sha(predictions)
        write_json(output / "result.json", result)
    return result


def run_package(root, manifest_sha256, arm, output, model_dir=None, generator_factory=None):
    started, cpu = time.perf_counter_ns(), time.process_time_ns()
    output.mkdir(parents=True, exist_ok=False)
    invocation = {"schema": "ilxyr.feral_invocation.v1", "arm": arm, "status": "failed",
                  "package_manifest_sha256": manifest_sha256, "phase": "package_verification",
                  "performance_evidence": False}
    try:
        package = verify_package(root, manifest_sha256)
        rows = read_rows((root / "inputs/model-inputs.jsonl").read_bytes())
        if [r["id"] for r in rows] != package["ordered_ids"]:
            raise ValueError("package input roster differs")
        inventory = json.loads((root / "model/FILES.json").read_bytes())
        if arm == "base" and model_dir is None and generator_factory is None:
            raise ValueError("base arm requires a model directory")
        factory = generator_factory or (lambda: BaseGenerator(model_dir, inventory))
        invocation["phase"] = "prediction"
        result = _run_rows(rows, arm, output, factory, {
            "package_manifest_sha256": manifest_sha256,
            "inputs_sha256": package["files"]["inputs/model-inputs.jsonl"]["sha256"],
            "model_inventory_sha256": package["files"]["model/FILES.json"]["sha256"],
        })
        invocation.update(status="complete", phase="finished")
        return result
    except BaseException as error:
        invocation["error"] = str(error)
        raise
    finally:
        invocation.update(total_wall_ns=time.perf_counter_ns() - started,
                          process_cpu_ns=time.process_time_ns() - cpu)
        write_json(output / "invocation.json", invocation)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest-sha256", required=True)
    parser.add_argument("--arm", choices=ARMS, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--model-dir", type=Path)
    args = parser.parse_args()
    result = run_package(ROOT, args.manifest_sha256, args.arm, args.out.resolve(), args.model_dir)
    print(json.dumps({"status": result["status"], "rows": result["rows"], "arm": args.arm}))


if __name__ == "__main__":
    main()
