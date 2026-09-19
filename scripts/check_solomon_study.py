"""Independently check collected Solomon vectors, costs, coverage and hashes."""

import argparse
import csv
from fractions import Fraction
import hashlib
import json
import math
from pathlib import Path
import statistics

import research_solomon_confidence as confidence
import research_solomon_study as study
from feral_process import save

require = confidence.require


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path):
    return json.loads(path.read_bytes())


def inventory(root, expected_sha):
    require(digest(root / "COLLECTION.json") == expected_sha, "collection identity differs")
    manifest = load(root / "COLLECTION.json")
    require(manifest["schema"] == "ilxyr.solomon_study_collection.v1", "collection schema differs")
    names = set()
    for path in root.rglob("*"):
        require(not path.is_symlink(), "collected symbolic link")
        if path.is_file() and path != root / "COLLECTION.json":
            names.add(str(path.relative_to(root)))
    require(names == set(manifest["files"]), "collected file coverage differs")
    for name, info in manifest["files"].items():
        path = Path(name)
        require(not path.is_absolute() and ".." not in path.parts and str(path) == name, "unsafe collected path")
        path = root / path
        require(info == {"bytes": path.stat().st_size, "sha256": digest(path)}, "collected bytes differ: " + name)
    return manifest


def process_at(directory, command, limit, max_log_bytes):
    receipt = load(directory / "process.json")
    require(receipt["schema"] == "ilxyr.feral_process.v1" and receipt["command"] == command, "process command differs")
    require(receipt["status"] == "complete" and receipt["exit_code"] == 0 and receipt["stop_reason"] is None
            and receipt["descendant_cleanup"] is False and receipt["signals"] == [], "process completion differs")
    require(receipt["max_log_bytes"] == max_log_bytes, "process output limit differs")
    require(set(receipt["outputs"]) == {"stdout.log", "stderr.log"}, "process log coverage differs")
    for name, info in receipt["outputs"].items():
        path = directory / name
        require(info == {"bytes": path.stat().st_size, "sha256": digest(path)}, "process log bytes differ")
    require(sum(v["bytes"] for v in receipt["outputs"].values()) <= max_log_bytes, "process logs exceed their limit")
    usage = receipt["resource_usage"]
    require(usage["scope"] == "wait4_direct_child_and_waited_descendants", "process resource scope differs")
    for name in ("user_cpu_seconds", "system_cpu_seconds"):
        require(type(usage[name]) in (int, float) and math.isfinite(usage[name]) and usage[name] >= 0, "process CPU differs")
    require(type(usage["max_rss_bytes"]) is int and usage["max_rss_bytes"] > 0, "process peak RSS differs")
    wall = receipt["total_wall_ns"]
    require(type(wall) is int and 0 < wall <= (limit + 2) * 1e9, "process wall limit differs")
    return {"cpu_seconds": usage["user_cpu_seconds"] + usage["system_cpu_seconds"],
            "wall_ns": wall, "peak_rss_bytes": usage["max_rss_bytes"]}


def vectors(path, windows, arm, contexts, memory):
    with path.open(newline="") as stream:
        reader = csv.DictReader(stream, delimiter="\t")
        require(reader.fieldnames == ["index", "predicted", "masses"], "vector columns differ")
        rows = list(reader)
    require(len(rows) == len(windows), "vector row coverage differs")
    brier, mistakes, zeros, normalized = Fraction(0), 0, 0, []
    for index, (row, gold) in enumerate(zip(rows, windows)):
        require(set(row) == {"index", "predicted", "masses"} and row["index"] == str(index), "vector row order differs")
        raw = row["masses"].split(",")
        require(len(raw) == 256 and all(v.isascii() and v.isdecimal() for v in raw), "vector masses differ")
        mass = [int(value) for value in raw]
        total = sum(mass)
        require(total > 0 and all(n <= 256 * 65536 + 1 for n in mass), "vector mass range differs")
        predicted = int(row["predicted"])
        require(0 <= predicted < 256 and mass[predicted] == max(mass), "vector chosen byte differs")
        context = contexts[index * 64:(index + 1) * 64]
        expected_counts, _ = confidence.suffix.suffix_counts(memory, context)
        expected_answer = max(range(256), key=lambda i: (expected_counts[i], -i))
        require(predicted == expected_answer, "frozen suffix answer differs")
        if arm == "suffix_empirical":
            require(mass == expected_counts, "empirical probabilities differ")
        elif arm == "suffix_unit_prior":
            require(mass == [256 * n + 1 for n in expected_counts], "prior probabilities differ")
        elif arm == "point_mass":
            require(mass == [32767 * int(i == predicted) for i in range(256)], "point probabilities differ")
        elif arm == "smoothed_point_mass":
            # Divide the non-chosen mass into 255 bins in byte order.
            expected, rank = [], 0
            for byte in range(256):
                expected.append(29491 if byte == predicted else 12 + int(rank < 216))
                rank += int(byte != predicted)
            require(mass == expected, "smoothed probabilities differ")
        else:
            require(arm == "native" and all(n <= 32767 for n in mass), "native Q15 component differs")
        target = gold["target"]
        require(type(target) is int and 0 <= target < 256, "gold byte differs")
        brier += sum((Fraction(n, total) - int(i == target)) ** 2 for i, n in enumerate(mass))
        mistakes += int(predicted != target)
        zeros += int(mass[target] == 0)
        normalized.append({"predicted": predicted, "masses": mass})
    return {"normalized_brier_mean": str(brier / len(windows)), "mistakes": mistakes, "zeros": zeros}, normalized


def summarize(documents, records):
    by_arm = {}
    for arm in confidence.ARMS:
        per_document = []
        for doc in documents:
            rows = [r for r in records if r["arm"] == arm and r["document"] == doc["id"]]
            require(bool(rows), "arm document coverage differs")
            per_document.append({"document": doc["id"], "stratum": doc["stratum"], **rows[0]["score"],
                "median_process_cpu_seconds": statistics.median(r["cost"]["cpu_seconds"] for r in rows),
                "median_process_wall_ns": statistics.median(r["cost"]["wall_ns"] for r in rows),
                "maximum_process_peak_rss_bytes": max(r["cost"]["peak_rss_bytes"] for r in rows)})
        strata = {}
        for stratum in sorted({d["stratum"] for d in documents}):
            selected = [d for d in per_document if d["stratum"] == stratum]
            strata[stratum] = {"documents": len(selected),
                "normalized_brier_equal_document_mean": str(sum((Fraction(d["normalized_brier_mean"]) for d in selected), Fraction(0)) / len(selected)),
                "mistakes": sum(d["mistakes"] for d in selected), "zeros": sum(d["zeros"] for d in selected)}
        by_arm[arm] = {"documents": per_document, "strata": strata,
            "normalized_brier_equal_document_mean": str(sum((Fraction(d["normalized_brier_mean"]) for d in per_document), Fraction(0)) / len(documents)),
            "mistakes": sum(d["mistakes"] for d in per_document), "zeros": sum(d["zeros"] for d in per_document)}
    comparisons = {}
    for arm in confidence.ARMS[1:]:
        rows = []
        for native, control in zip(by_arm["native"]["documents"], by_arm[arm]["documents"]):
            require(native["document"] == control["document"], "paired document order differs")
            cpu_denominator, cpu_numerator = control["median_process_cpu_seconds"], native["median_process_cpu_seconds"]
            rows.append({"document": native["document"],
                "native_minus_control_brier": str(Fraction(native["normalized_brier_mean"]) - Fraction(control["normalized_brier_mean"])),
                "native_over_control_cpu": cpu_numerator / cpu_denominator if cpu_denominator > 0 else None})
        ratios = [r["native_over_control_cpu"] for r in rows]
        comparisons[arm] = {"documents": rows,
            "native_minus_control_equal_document_brier": str(sum((Fraction(r["native_minus_control_brier"]) for r in rows), Fraction(0)) / len(rows)),
            "native_over_control_equal_document_geometric_cpu": math.exp(sum(math.log(r) for r in ratios) / len(ratios))
                if all(r is not None and r > 0 for r in ratios) else None,
            "cpu_ratio_status": "measured" if all(r is not None and r > 0 for r in ratios) else "zero_cpu_resolution"}
    return {"arms": by_arm, "native_comparisons": comparisons}


def check(prepared, collected, expected_supervisor_sha):
    prepared, collected = prepared.resolve(), collected.resolve()
    require(digest(collected / "SUPERVISOR.json") == expected_supervisor_sha, "supervisor identity differs")
    supervisor = load(collected / "SUPERVISOR.json")
    require(supervisor["schema"] == "ilxyr.solomon_study_supervisor.v1" and supervisor["status"] == "complete", "controller supervisor is incomplete")
    require(supervisor.get("stop_signal") is None, "outer controller was cancelled")
    study.validate_inputs(prepared)
    root = collected / "study"
    manifest = inventory(root, supervisor["collection_sha256"])
    run, attempt = load(root / "RUN.json"), load(root / "ATTEMPT.json")
    require(run["schema"] == "ilxyr.solomon_study_run.v1" and attempt["schema"] == "ilxyr.solomon_study_attempt.v1", "run schema differs")
    mode = run["mode"]
    require(mode == supervisor["mode"] == attempt["mode"], "run mode differs")
    limits = study.execution_limits(prepared, mode, run["execution"], check_host=False)
    require(run["limits"] == limits and run["implementation"] == study.bindings(), "run implementation or limits differ")
    require(run["prepared_bindings_sha256"] == digest(prepared / "BINDINGS.json"), "run inputs differ")
    require([run["plan_sha256"], run["roster_sha256"], run["schedule_sha256"]] == [study.PLAN_SHA, study.ROSTER_SHA, study.SCHEDULE_SHA], "run plan binding differs")
    require(attempt["status"] == attempt["phase"] == "complete" and attempt["stop_signal"] is None, "controller attempt is incomplete")
    selected = load(root / "WORKLOAD.json")
    require(selected == study.workload(prepared, mode) and digest(root / "WORKLOAD.json") == run["workload_sha256"], "workload differs from frozen inputs")
    require(attempt["started_jobs"] == attempt["completed_jobs"] == attempt["expected_jobs"] == len(selected["jobs"]), "controller job coverage differs")
    native_calls = sum(len(d["windows"]) for d in selected["documents"]) * (5 if mode == "cloud" else 2)
    require(attempt["native_calls_confirmed"] == attempt["native_calls_started_upper_bound"] == native_calls
            and attempt["failed_native_calls_unknown"] is False, "native call accounting differs")
    require(attempt["fresh_model_calls_confirmed"] == (native_calls if mode == "cloud" else 0), "fresh call accounting differs")
    require(run["artifacts"] == {"native": "inputs/model.nsrlmt", "control": "inputs/memory.bin"}, "artifact paths differ")
    require(digest(root / run["artifacts"]["native"]) == confidence.ownership.MODEL_SHA, "collected model differs")
    memory = (root / run["artifacts"]["control"]).read_bytes()
    require(memory == (prepared / "inputs/memory.bin").read_bytes(), "collected memory differs")
    binary = load(root / "BINARY.json")
    worker = root / "bin/solomon-confidence-arm"
    require(binary["sha256"] == digest(worker) and binary["bytes"] == worker.stat().st_size
            and binary["prepared_bindings_sha256"] == run["prepared_bindings_sha256"], "collected executable differs")
    compiler = (root / "setup/compiler/stdout.log").read_text().strip()
    require(binary["compiler_identity"] == compiler, "compiler receipt differs")
    if mode == "cloud":
        require(compiler == run["execution"]["rustc_identity"], "frozen compiler differs")
    setup = {"compiler": process_at(root / "setup/compiler", ["rustc", "-Vv"], 15, limits["max_log_bytes"]),
             "build": process_at(root / "setup/build", study.BUILD, limits["build_seconds"], limits["max_log_bytes"])}
    require(run["build_command"] == study.BUILD, "build command differs")
    require({p.name for p in (root / "jobs").iterdir()} == {f"{j['index']:04d}" for j in selected["jobs"]}, "job directory coverage differs")
    output_root = Path(run["output_root"])
    require(output_root.is_absolute(), "recorded execution root differs")
    records, previous = [], {}
    documents = {d["id"]: d for d in selected["documents"]}
    for job in selected["jobs"]:
        directory = root / "jobs" / f"{job['index']:04d}"
        arm, doc = job["arm"], documents[job["document"]]
        artifact = run["artifacts"]["native" if arm == "native" else "control"]
        context_name = "inputs/" + doc["id"] + ".bin"
        contexts = (root / context_name).read_bytes()
        require(contexts == b"".join(bytes.fromhex(w["context_hex"]) for w in doc["windows"]), "collected contexts differ")
        command = [str(output_root / "bin/solomon-confidence-arm"), arm, str(output_root / artifact), str(output_root / context_name)]
        expected_job = {**job, "command": command, "worker_sha256": binary["sha256"],
                        "artifact_sha256": digest(root / artifact), "contexts_sha256": digest(root / context_name)}
        require(load(directory / "JOB.json") == expected_job, "job input bindings differ")
        cost = process_at(directory / "process", command, limits["job_seconds"], limits["max_log_bytes"])
        meta = load(directory / "process/stderr.log")
        require(meta == {"arm": arm, "windows": len(doc["windows"]), "native_forward_calls": len(doc["windows"]) if arm == "native" else 0,
                         "context_bytes": len(contexts), "artifact_bytes": (root / artifact).stat().st_size}, "job work accounting differs")
        score, rows = vectors(directory / "process/stdout.log", doc["windows"], arm, contexts, memory)
        key = (arm, doc["id"])
        if key in previous:
            require(rows == previous[key], "repeated vectors differ")
        previous[key] = rows
        records.append({**job, "cost": cost, "score": score})
    supervisor_path = collected / "controller-process/process.json"
    require(digest(supervisor_path) == supervisor["controller_receipt_sha256"], "outer controller receipt differs")
    command = [run["controller_executable"], run["controller_script"], mode, "--worker", "--prepared", run["prepared_root"],
               "--out", run["output_root"], "--work", str(Path(run["build_root"]).parent)]
    actual_command = load(supervisor_path)["command"]
    if mode == "cloud":
        require(len(actual_command) == len(command) + 2 and actual_command[-2] == "--execution", "cloud execution command differs")
        command += actual_command[-2:]
    total = process_at(collected / "controller-process", command, limits["total_seconds"], limits["max_log_bytes"])
    children = [*setup.values(), *(r["cost"] for r in records)]
    child_cpu = sum(c["cpu_seconds"] for c in children)
    require(total["cpu_seconds"] + 0.00001 >= child_cpu and total["wall_ns"] >= sum(c["wall_ns"] for c in children), "complete process cost excludes child work")
    return {"schema": "ilxyr.solomon_study_check.v1", "status": "verified_complete", "mode": mode,
            "supervisor_sha256": expected_supervisor_sha, "collection_sha256": supervisor["collection_sha256"],
            "files": len(manifest["files"]), "documents": len(documents), "jobs": len(records),
            "probability_rows": sum(len(documents[r["document"]]["windows"]) for r in records),
            "native_forward_calls": native_calls, "fresh_model_calls": native_calls if mode == "cloud" else 0,
            "performance_evidence": mode == "cloud", "promotion_evidence": False,
            "native_probability_scope": "Frozen Rust worker; opened reference parity; format, chosen-byte and repeated-vector checks here.",
            "control_probability_scope": "Each vector reconstructed from frozen training memory and context.",
            "document_groups": selected["document_groups"], "uncertainty": "Fixed panel diagnostic; paired document differences with linked groups retained.",
            "setup": setup, "complete_controller_process": total,
            "controller_overhead_cpu_seconds": max(0, total["cpu_seconds"] - child_cpu),
            "jobs_detail": records, "summary": summarize(selected["documents"], records)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepared", type=Path, required=True)
    parser.add_argument("--collected", type=Path, required=True)
    parser.add_argument("--supervisor-sha256", required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--opened-reference", type=Path)
    args = parser.parse_args()
    require(not args.out.exists(), "check output already exists")
    result = check(args.prepared, args.collected, args.supervisor_sha256)
    if args.opened_reference:
        require(result["mode"] == "opened", "opened reference requires the opened workload")
        reference = load(args.opened_reference)
        for arm in confidence.ARMS:
            actual = result["summary"]["arms"][arm]
            require({"normalized_brier_mean": actual["normalized_brier_equal_document_mean"],
                     "mistakes": actual["mistakes"], "zeros": actual["zeros"]} == reference["scores"][arm],
                    "opened reference score differs: " + arm)
        result["opened_reference_scores_equal"] = True
        result["opened_reference_sha256"] = digest(args.opened_reference)
    save(args.out, result)
    print(json.dumps({k: result[k] for k in ["status", "mode", "documents", "jobs", "probability_rows", "fresh_model_calls"]}))
