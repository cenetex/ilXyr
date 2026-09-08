"""Prepare isolated confidence workers and check parity on sixteen opened windows."""

import argparse
import csv
from fractions import Fraction
import json
from pathlib import Path
import shutil
import subprocess
import time

import research_solomon_answer_ownership as ownership
import research_solomon_suffix_probabilities as suffix
from feral_process import run_process

require, sha, save = ownership.require, ownership.sha, ownership.save
ARMS = ("native", "point_mass", "smoothed_point_mass", "suffix_empirical", "suffix_unit_prior")
WORKER_PATH = "crates/nsrl-train/src/bin/solomon-confidence-arm.rs"
SCRIPT_NAMES = ("research_solomon_confidence.py", "research_solomon_answer_ownership.py",
                "research_solomon_suffix_probabilities.py", "feral_process.py")


def process_schedule(documents):
    require(len(documents) == 12 and len(set(documents)) == 12, "document schedule coverage differs")
    jobs = []
    for replay in range(5):
        order = documents[replay:] + documents[:replay]
        for document in order:
            offset = (replay + documents.index(document)) % 5
            for arm in ARMS[offset:] + ARMS[:offset]:
                jobs.append({"index": len(jobs), "pass": replay, "document": document, "arm": arm})
    return jobs


def read_vectors(path, windows):
    rows = list(csv.DictReader(path.read_text().splitlines(), delimiter="\t"))
    require(len(rows) == windows, "probability row coverage differs")
    result = []
    for index, row in enumerate(rows):
        require(set(row) == {"index", "predicted", "masses"} and int(row["index"]) == index, "probability row identity differs")
        predicted = int(row["predicted"])
        vector = [int(n) for n in row["masses"].split(",")]
        require(0 <= predicted < 256 and len(vector) == 256
                and all(0 <= n <= 256 * 65536 + 1 for n in vector) and sum(vector) > 0, "probability vector differs")
        require(vector[predicted] == max(vector), "chosen byte is below the maximum probability")
        result.append({"predicted": predicted, "masses": vector})
    return result


def fixed_mass(arm, predicted):
    if arm == "point_mass":
        return [32767 if i == predicted else 0 for i in range(256)]
    require(arm == "smoothed_point_mass", "fixed probability arm differs")
    # 3,276 = 255 * 12 + 216; distribute the remainder in byte order.
    remaining = [i for i in range(256) if i != predicted]
    extra = set(remaining[:216])
    return [29491 if i == predicted else 12 + int(i in extra) for i in range(256)]


def verify_vectors(arm, rows, contexts, memory):
    require(arm in ARMS and len(contexts) == 64 * len(rows), "arm context coverage differs")
    for i, row in enumerate(rows):
        counts, _ = suffix.suffix_counts(memory, contexts[i * 64:(i + 1) * 64])
        predicted = max(range(256), key=lambda byte: (counts[byte], -byte))
        require(row["predicted"] == predicted, "chosen byte differs from frozen suffix memory")
        if arm in suffix.ARMS:
            require(row["masses"] == suffix.masses(counts, arm), "count probability vector differs")
        elif arm != "native":
            require(row["masses"] == fixed_mass(arm, predicted), "fixed probability vector differs")


def prepare(repo, plan_path, frozen, output):
    output.mkdir(parents=True, exist_ok=False)
    attempt = {"status": "failed", "phase": "inputs", "fresh_model_calls": 0}
    save(output / "PREPARE-ATTEMPT.json", attempt)
    try:
        plan = json.loads(plan_path.read_bytes())
        roster_path = frozen / "ROSTER.json"
        roster = json.loads(roster_path.read_bytes())
        terminal = json.loads((frozen / "ATTEMPT.json").read_bytes())
        require(terminal["status"] == "complete" and terminal["model_calls"] == 0
                and terminal["roster_sha256"] == sha(roster_path.read_bytes())
                and terminal["overlap_sha256"] == sha((frozen / "OVERLAP.json").read_bytes()), "roster verification differs")
        require(terminal["plan_sha256"] == roster["plan_sha256"] == sha(plan_path.read_bytes()), "roster plan differs")
        require(roster["source_commit"] == ownership.REVISION and roster["model_sha256"] == ownership.MODEL_SHA,
                "roster candidate differs")
        require([d["id"] for d in plan["documents"]] == [d["id"] for d in roster["documents"]], "document roster differs")
        source = output / "source"
        bindings = ownership.materialize_sources(repo, source)
        license_blob = subprocess.check_output(["git", "-C", str(repo), "show", ownership.REVISION + ":LICENSE"])
        (source / "LICENSE").write_bytes(license_blob)
        bindings["LICENSE"] = {"sha256": sha(license_blob), "bytes": len(license_blob)}
        worker = Path(__file__).with_name("solomon_confidence_arm.rs").read_bytes()
        (source / WORKER_PATH).write_bytes(worker)
        bindings[WORKER_PATH] = {"sha256": sha(worker), "bytes": len(worker), "origin": "ilxyr"}
        save(output / "SOURCE-IDENTITY.json", {"source_commit": ownership.REVISION, "files": bindings})
        scripts = output / "scripts"
        scripts.mkdir()
        for name in SCRIPT_NAMES:
            shutil.copyfile(Path(__file__).with_name(name), scripts / name)
        memory = ownership.memory_bytes((source / ownership.MODEL).read_bytes(), (source / (ownership.BASE + "train.txt")).read_bytes())
        inputs = output / "inputs"
        inputs.mkdir()
        (inputs / "memory.bin").write_bytes(memory)
        context_bindings = {}
        for doc in roster["documents"]:
            require(len(doc["windows"]) == 32, "document window coverage differs")
            contexts = b""
            for index, row in enumerate(doc["windows"]):
                context = bytes.fromhex(row["context_hex"])
                require(row["index"] == index and len(context) == 64 and sha(context) == row["context_sha256"], "context identity differs")
                require(type(row["target"]) is int and 0 <= row["target"] < 256
                        and sha(context + bytes([row["target"]])) == row["context_target_sha256"], "gold binding differs")
                contexts += context
            (inputs / (doc["id"] + ".bin")).write_bytes(contexts)
            context_bindings[doc["id"]] = {"bytes": len(contexts), "sha256": sha(contexts)}
        shutil.copyfile(plan_path, output / "PLAN.json")
        shutil.copyfile(roster_path, output / "ROSTER.json")
        shutil.copyfile(frozen / "OVERLAP.json", output / "OVERLAP.json")
        jobs = process_schedule([doc["id"] for doc in roster["documents"]])
        save(output / "SCHEDULE.json", jobs)
        save(output / "RUN-DESIGN.json", {"status": "source_prepared_cloud_binding_pending", "execution_authorized": False,
             "scope": "twelve_document_confidence_diagnostic", "arm_order": "five-position Latin rotation within each document",
             "window_order": "fixed increasing index within each document and all five passes",
             "jobs": len(jobs), "probability_rows": len(jobs) * 32,
             "native_forward_calls": 12 * 32 * 5, "control_forward_calls": 0,
             "contexts": context_bindings, "native_artifact": "source/" + ownership.MODEL,
             "control_artifact": "inputs/memory.bin", "process_cost_scope": "All child-process loading, inference, probability construction, and output formatting; user plus system CPU, wall time, and peak RSS. Controller and build costs are separate.",
             "measurement_mode": "separate cold process per arm and document; operating-system caches may persist across processes",
             "remaining_cloud_bindings": ["compiler and machine image", "resource caps and watchdog", "immutable staged package", "price and user-approved budget"]})
        files = {str(path.relative_to(output)): {"bytes": path.stat().st_size, "sha256": sha(path.read_bytes())}
                 for path in sorted(output.rglob("*")) if path.is_file() and path.name != "PREPARE-ATTEMPT.json"}
        save(output / "BINDINGS.json", files)
        attempt.update(status="complete", phase="complete", bindings_sha256=sha((output / "BINDINGS.json").read_bytes()))
    except BaseException as error:
        attempt["error"] = str(error)
        raise
    finally:
        save(output / "PREPARE-ATTEMPT.json", attempt)


def check_prepared(prepared):
    terminal = json.loads((prepared / "PREPARE-ATTEMPT.json").read_bytes())
    require(terminal["status"] == "complete" and terminal["bindings_sha256"] == sha((prepared / "BINDINGS.json").read_bytes()), "prepared binding differs")
    files = json.loads((prepared / "BINDINGS.json").read_bytes())
    for name, info in files.items():
        path = Path(name)
        require(not path.is_absolute() and ".." not in path.parts, "prepared path leaves root")
        blob = (prepared / path).read_bytes()
        require(len(blob) == info["bytes"] and sha(blob) == info["sha256"], "prepared bytes differ: " + name)
    require(sha(Path(__file__).read_bytes()) == files["scripts/research_solomon_confidence.py"]["sha256"], "controller source differs")
    return files


def smoke(prepared, output):
    output.mkdir(parents=True, exist_ok=False)
    attempt = {"status": "failed", "phase": "inputs", "fresh_model_calls": 0, "performance_evidence": False}
    save(output / "ATTEMPT.json", attempt)
    try:
        bindings = check_prepared(prepared)
        source = prepared / "source"
        attempt["phase"] = "build"
        for name, command, limit in [
            ("compiler", ["rustc", "-Vv"], 15),
            ("build", ["cargo", "build", "--release", "--locked", "--offline", "-p", "nsrl-train", "--bin", "solomon-confidence-arm", "--bin", "nsrl-mini-transformer-eval", "--features", "mini-heads-8,mini-calibrated"], 180),
            ("unit", ["cargo", "test", "--release", "--locked", "--offline", "-p", "nsrl-train", "--bin", "solomon-confidence-arm", "--features", "mini-heads-8,mini-calibrated"], 60),
        ]:
            receipt = run_process(command, source, output / (name + "-process"), time.monotonic() + limit, 2)
            require(receipt["status"] == "complete", name + " failed; inspect retained process")
        tokens = (source / (ownership.BASE + "eval.txt")).read_bytes()
        starts = [(i * (len(tokens) - 65) + 7) // 15 for i in range(16)]
        contexts = b"".join(tokens[start:start + 64] for start in starts)
        context_path = output / "opened-contexts.bin"
        context_path.write_bytes(contexts)
        targets = [tokens[start + 64] for start in starts]
        worker = source / "target/release/solomon-confidence-arm"
        native = source / "target/release/nsrl-mini-transformer-eval"
        attempt["phase"] = "reference"
        command = [str(native), "--model", str(source / ownership.MODEL), "--tokens", str(source / (ownership.BASE + "eval.txt")),
                   "--max-windows", "16", "--attention", "linear", "--position", "nope", "--out", str(output / "reference.json"),
                   "--probability-controls-out", str(output / "reference.tsv")]
        receipt = run_process(command, source, output / "reference-process", time.monotonic() + 60, 2)
        require(receipt["status"] == "complete", "reference process failed")
        reference = list(csv.DictReader((output / "reference.tsv").read_text().splitlines(), delimiter="\t"))
        require(len(reference) == 48, "reference control coverage differs")
        scores, processes = {}, {}
        memory = (prepared / "inputs/memory.bin").read_bytes()
        for arm in ARMS:
            attempt["phase"] = arm
            artifact = source / ownership.MODEL if arm == "native" else prepared / "inputs/memory.bin"
            directory = output / (arm + "-process")
            receipt = run_process([str(worker), arm, str(artifact), str(context_path)], source, directory, time.monotonic() + 60, 2)
            require(receipt["status"] == "complete", arm + " process failed")
            rows = read_vectors(directory / "stdout.log", 16)
            verify_vectors(arm, rows, contexts, memory)
            meta = json.loads((directory / "stderr.log").read_bytes())
            require(meta == {"arm": arm, "windows": 16, "native_forward_calls": 16 if arm == "native" else 0,
                             "context_bytes": len(contexts), "artifact_bytes": artifact.stat().st_size}, "worker work accounting differs")
            if arm in ARMS[:3]:
                for i, row in enumerate(rows):
                    original = reference[3 * i + ARMS.index(arm)]
                    require(original["arm"] == arm and int(original["start"]) == starts[i]
                            and int(original["target"]) == targets[i] and int(original["predicted"]) == row["predicted"]
                            and [int(n) for n in original["probabilities_q15"].split(",")] == row["masses"], "native reference parity differs")
            briers = [suffix.score(row["masses"], target)["brier"] for row, target in zip(rows, targets)]
            scores[arm] = {"normalized_brier_mean": str(sum(briers, Fraction(0)) / 16),
                           "mistakes": sum(row["predicted"] != target for row, target in zip(rows, targets)),
                           "zeros": sum(row["masses"][target] == 0 for row, target in zip(rows, targets))}
            processes[arm] = {"receipt_sha256": sha((directory / "process.json").read_bytes()), **meta}
        result = {"schema": "ilxyr.solomon_isolated_confidence_smoke.v1", "scope": "sixteen_opened_windows",
                  "fresh_model_calls": 0, "performance_evidence": False, "promotion_evidence": False,
                  "scores": scores, "work": processes, "reference_forward_calls": 32,
                  "worker_sha256": sha(worker.read_bytes()), "prepared_bindings_sha256": sha((prepared / "BINDINGS.json").read_bytes()),
                  "worker_source_sha256": bindings["source/" + WORKER_PATH]["sha256"],
                  "compiler_identity": (output / "compiler-process/stdout.log").read_text().strip()}
        save(output / "RESULT.json", result)
        attempt.update(status="complete", phase="complete", result_sha256=sha((output / "RESULT.json").read_bytes()))
        return result
    except BaseException as error:
        attempt["error"] = str(error)
        raise
    finally:
        save(output / "ATTEMPT.json", attempt)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["prepare", "smoke"])
    parser.add_argument("--nsrl-repo", type=Path)
    parser.add_argument("--plan", type=Path)
    parser.add_argument("--frozen", type=Path)
    parser.add_argument("--prepared", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if args.mode == "prepare":
        if any(value is None for value in (args.nsrl_repo, args.plan, args.frozen)):
            parser.error("prepare requires --nsrl-repo, --plan and --frozen")
        prepare(args.nsrl_repo.resolve(), args.plan, args.frozen, args.out.resolve())
    else:
        if args.prepared is None:
            parser.error("smoke requires --prepared")
        smoke(args.prepared.resolve(), args.out.resolve())
