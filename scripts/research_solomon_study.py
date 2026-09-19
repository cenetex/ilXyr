"""Run the frozen Solomon panel, or a small check using the opened windows."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import signal
import sys
import time

import research_solomon_confidence as confidence
from feral_process import run_process, save

ARMS = confidence.ARMS
require = confidence.require
PLAN_SHA = "b5795071922a214e6b7319dfd3bafee82acefb8df60195625cc2de4d130854f3"
ROSTER_SHA = "c7bd5d15e7c9a6b5266a18cff57857ac4e273b634439b2005868fbb66721df95"
SCHEDULE_SHA = "e19464f4e4a640cebb70ceb72da0426640021e4c031f0f51af298992e1262504"
BUILD = ["cargo", "build", "--release", "--locked", "--offline", "-p", "nsrl-train",
         "--bin", "solomon-confidence-arm", "--features", "mini-heads-8,mini-calibrated"]
OPENED_LIMITS = {"total_seconds": 240, "build_seconds": 180, "job_seconds": 15,
                 "grace_seconds": 2, "max_log_bytes": 1024 * 1024}
SCRIPTS = ("research_solomon_study.py", "check_solomon_study.py",
           "research_solomon_confidence.py", "research_solomon_answer_ownership.py",
           "research_solomon_suffix_probabilities.py", "feral_process.py")


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def bindings():
    return {name: digest(Path(__file__).with_name(name)) for name in SCRIPTS}


def validate_inputs(prepared):
    files = confidence.check_prepared(prepared)
    for name, expected in [("PLAN.json", PLAN_SHA), ("ROSTER.json", ROSTER_SHA),
                           ("SCHEDULE.json", SCHEDULE_SHA)]:
        require(digest(prepared / name) == expected, name + " fixed identity differs")
    for name in files:
        path = prepared / name
        require(path.is_file() and not path.is_symlink(), "prepared input must be a regular file")
        require(prepared in path.resolve().parents, "prepared input leaves its root")
    require(digest(prepared / "source" / confidence.ownership.MODEL) == confidence.ownership.MODEL_SHA,
            "native artifact differs")
    expected_memory = confidence.ownership.memory_bytes(
        (prepared / "source" / confidence.ownership.MODEL).read_bytes(),
        (prepared / "source" / (confidence.ownership.BASE + "train.txt")).read_bytes())
    require((prepared / "inputs/memory.bin").read_bytes() == expected_memory, "stored memory differs")
    return files


def workload(prepared, mode):
    if mode == "cloud":
        roster = json.loads((prepared / "ROSTER.json").read_bytes())
        docs = [{"id": d["id"], "stratum": d["stratum"], "windows": d["windows"]}
                for d in roster["documents"]]
        jobs = json.loads((prepared / "SCHEDULE.json").read_bytes())
        require(jobs == confidence.process_schedule([d["id"] for d in docs]), "fixed schedule differs")
        return {"mode": mode, "documents": docs, "jobs": jobs,
                "document_groups": json.loads((prepared / "OVERLAP.json").read_bytes())["document_groups"]}
    require(mode == "opened", "workload mode differs")
    tokens = (prepared / "source" / (confidence.ownership.BASE + "eval.txt")).read_bytes()
    windows = []
    for index in range(16):
        start = (index * (len(tokens) - 65) + 7) // 15
        context = tokens[start:start + 64]
        windows.append({"index": index, "context_hex": context.hex(), "target": tokens[start + 64]})
    jobs = [{"index": replay * 5 + position, "pass": replay, "document": "opened-eval", "arm": arm}
            for replay in range(2) for position, arm in enumerate(ARMS[replay:] + ARMS[:replay])]
    return {"mode": mode, "documents": [{"id": "opened-eval", "stratum": "opened", "windows": windows}],
            "jobs": jobs, "document_groups": [["opened-eval"]]}


def execution_limits(prepared, mode, execution, check_host=True):
    if mode == "opened":
        require(execution is None, "opened check uses its own fixed limits")
        return dict(OPENED_LIMITS)
    require(mode == "cloud" and isinstance(execution, dict), "full panel requires a cloud execution record")
    require(execution.get("schema") == "ilxyr.solomon_study_execution.v1" and execution.get("venue") == "cloud",
            "cloud execution identity differs")
    require(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}", execution.get("run_id", "")), "run identity differs")
    require(re.fullmatch(r"[a-f0-9]{64}", execution.get("package_sha256", "")), "package identity differs")
    require(execution.get("prepared_bindings_sha256") == digest(prepared / "BINDINGS.json"), "execution inputs differ")
    require(execution.get("implementation") == bindings(), "execution implementation differs")
    machine = execution.get("machine", {})
    require(all(isinstance(machine.get(k), str) and machine[k] for k in
                ["provider", "region", "instance_type", "image_id", "architecture", "runtime_image"]),
            "frozen machine identity is incomplete")
    if check_host:
        require(machine["architecture"] == platform.machine(), "worker architecture differs")
    require(isinstance(execution.get("rustc_identity"), str) and bool(execution["rustc_identity"]),
            "frozen compiler identity is absent")
    limits = execution.get("limits", {})
    bounds = {"total_seconds": (1, 1800), "build_seconds": (1, 300), "job_seconds": (1, 120),
              "grace_seconds": (0, 5), "max_log_bytes": (65536, 1024 * 1024)}
    require(set(limits) == set(bounds), "execution limit names differ")
    for name, (lower, upper) in bounds.items():
        require(type(limits[name]) is int and lower <= limits[name] <= upper, "execution limit differs: " + name)
    return limits


def collect_files(root):
    files = {}
    for path in sorted(root.rglob("*")):
        require(not path.is_symlink(), "result includes a symbolic link")
        if path.is_file() and path != root / "COLLECTION.json":
            files[str(path.relative_to(root))] = {"bytes": path.stat().st_size, "sha256": digest(path)}
    save(root / "COLLECTION.json", {"schema": "ilxyr.solomon_study_collection.v1", "files": files})


def run(prepared, output, work, mode="opened", execution=None):
    prepared, output, work = prepared.resolve(), output.resolve(), work.resolve()
    require(prepared != output and prepared not in output.parents and output not in prepared.parents,
            "output must be separate from prepared inputs")
    require(all(work != p and work not in p.parents and p not in work.parents for p in [prepared, output]),
            "build work must be separate from inputs and results")
    output.mkdir(parents=True, exist_ok=False)
    attempt = {"schema": "ilxyr.solomon_study_attempt.v1", "status": "failed", "phase": "inputs", "mode": mode,
               "started_jobs": 0, "completed_jobs": 0, "native_calls_confirmed": 0,
               "native_calls_started_upper_bound": 0, "failed_native_calls_unknown": False}
    save(output / "ATTEMPT.json", attempt)
    started, cpu_started = time.monotonic_ns(), time.process_time_ns()
    stopped = [None]
    handlers = {}
    try:
        for number in (signal.SIGTERM, signal.SIGINT):
            handlers[number] = signal.signal(number, lambda signum, _frame: stopped.__setitem__(0, signum))
        files = validate_inputs(prepared)
        limits = execution_limits(prepared, mode, execution)
        deadline = started / 1e9 + limits["total_seconds"]
        selected = workload(prepared, mode)
        save(output / "WORKLOAD.json", selected)
        attempt["expected_jobs"] = len(selected["jobs"])
        source = work / "source"
        work.mkdir(parents=True, exist_ok=False)
        source.mkdir()
        for name in files:
            if name.startswith("source/"):
                destination = work / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(prepared / name, destination)
        (output / "inputs").mkdir()
        (output / "bin").mkdir()
        artifacts = {"native": "inputs/model.nsrlmt", "control": "inputs/memory.bin"}
        shutil.copyfile(prepared / "source" / confidence.ownership.MODEL, output / artifacts["native"])
        shutil.copyfile(prepared / "inputs/memory.bin", output / artifacts["control"])
        for doc in selected["documents"]:
            contexts = b"".join(bytes.fromhex(w["context_hex"]) for w in doc["windows"])
            require(len(contexts) == 64 * len(doc["windows"]), "context length differs")
            (output / "inputs" / (doc["id"] + ".bin")).write_bytes(contexts)
        run_record = {"schema": "ilxyr.solomon_study_run.v1", "mode": mode, "execution": execution,
                      "limits": limits, "implementation": bindings(), "prepared_bindings_sha256": digest(prepared / "BINDINGS.json"),
                      "plan_sha256": PLAN_SHA, "roster_sha256": ROSTER_SHA, "schedule_sha256": SCHEDULE_SHA,
                      "output_root": str(output), "build_root": str(source), "artifacts": artifacts,
                      "prepared_root": str(prepared), "controller_script": str(Path(__file__).resolve()),
                      "controller_executable": sys.executable,
                      "platform": platform.platform(), "python": platform.python_version(),
                      "build_command": BUILD, "workload_sha256": digest(output / "WORKLOAD.json"),
                      "cost_scope": "Whole child processes; setup and controller CPU and wall costs are separate."}
        save(output / "RUN.json", run_record)

        def child(command, directory, seconds):
            receipt = run_process(command, source, directory, min(deadline, time.monotonic() + seconds),
                                  limits["grace_seconds"], cancelled=lambda: stopped[0], max_log_bytes=limits["max_log_bytes"])
            require(receipt["status"] == "complete", "worker failed; inspect " + str(directory))
            return receipt

        attempt["phase"] = "compiler"
        child(["rustc", "-Vv"], output / "setup/compiler", 15)
        compiler = (output / "setup/compiler/stdout.log").read_text().strip()
        if mode == "cloud":
            require(compiler == execution["rustc_identity"], "compiler differs from frozen execution")
        attempt["phase"] = "build"
        child(BUILD, output / "setup/build", limits["build_seconds"])
        worker = output / "bin/solomon-confidence-arm"
        shutil.copy2(source / "target/release/solomon-confidence-arm", worker)
        save(output / "BINARY.json", {"sha256": digest(worker), "bytes": worker.stat().st_size,
                                      "compiler_identity": compiler, "prepared_bindings_sha256": run_record["prepared_bindings_sha256"]})
        previous = {}
        documents = {d["id"]: d for d in selected["documents"]}
        memory = (output / artifacts["control"]).read_bytes()
        for job in selected["jobs"]:
            attempt["phase"] = "jobs"
            attempt["last_job"] = job["index"]
            require(stopped[0] is None and time.monotonic() < deadline, "controller stopped before next job")
            arm, doc = job["arm"], documents[job["document"]]
            artifact = output / artifacts["native" if arm == "native" else "control"]
            context_path = output / "inputs" / (doc["id"] + ".bin")
            directory = output / "jobs" / f"{job['index']:04d}"
            directory.mkdir(parents=True)
            command = [str(worker), arm, str(artifact), str(context_path)]
            save(directory / "JOB.json", {**job, "command": command, "worker_sha256": digest(worker),
                 "artifact_sha256": digest(artifact), "contexts_sha256": digest(context_path)})
            attempt["started_jobs"] += 1
            if arm == "native":
                attempt["native_calls_started_upper_bound"] += len(doc["windows"])
                attempt["failed_native_calls_unknown"] = True
            save(output / "ATTEMPT.json", attempt)
            child(command, directory / "process", limits["job_seconds"])
            rows = confidence.read_vectors(directory / "process/stdout.log", len(doc["windows"]))
            confidence.verify_vectors(arm, rows, context_path.read_bytes(), memory)
            meta = json.loads((directory / "process/stderr.log").read_bytes())
            require(meta == {"arm": arm, "windows": len(doc["windows"]), "native_forward_calls": len(doc["windows"]) if arm == "native" else 0,
                             "context_bytes": context_path.stat().st_size, "artifact_bytes": artifact.stat().st_size}, "worker work accounting differs")
            key = (arm, doc["id"])
            if key in previous:
                require(rows == previous[key], "probability vectors changed across passes")
            previous[key] = rows
            attempt["native_calls_confirmed"] += meta["native_forward_calls"]
            attempt["failed_native_calls_unknown"] = False
            attempt["completed_jobs"] += 1
            save(output / "ATTEMPT.json", attempt)
        require(stopped[0] is None and time.monotonic() < deadline, "controller stopped before completion")
        attempt.update(status="complete", phase="complete")
        return attempt
    except BaseException as error:
        attempt["error"] = str(error)
        raise
    finally:
        attempt["controller_preseal_wall_ns"] = time.monotonic_ns() - started
        attempt["controller_preseal_cpu_ns"] = time.process_time_ns() - cpu_started
        attempt["stop_signal"] = stopped[0]
        attempt["fresh_model_calls_confirmed"] = attempt["native_calls_confirmed"] if mode == "cloud" else 0
        for number, handler in handlers.items():
            signal.signal(number, handler)
        save(output / "ATTEMPT.json", attempt)
        collect_files(output)


def supervise(prepared, output, work, mode="opened", execution_path=None):
    """Measure the complete controller, including result checks and sealing."""
    output = output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    terminal = {"schema": "ilxyr.solomon_study_supervisor.v1", "status": "failed", "mode": mode}
    stopped, handlers = [None], {}
    save(output / "SUPERVISOR.json", terminal)
    try:
        for number in (signal.SIGTERM, signal.SIGINT):
            handlers[number] = signal.signal(number, lambda signum, _frame: stopped.__setitem__(0, signum))
        execution = json.loads(execution_path.read_bytes()) if execution_path else None
        limits = execution_limits(prepared.resolve(), mode, execution)
        command = [sys.executable, str(Path(__file__).resolve()), mode, "--worker", "--prepared", str(prepared.resolve()),
                   "--out", str(output / "study"), "--work", str(work.resolve())]
        if execution_path:
            command += ["--execution", str(execution_path.resolve())]
        receipt = run_process(command, Path(__file__).parent, output / "controller-process",
                              time.monotonic() + limits["total_seconds"], limits["grace_seconds"] + 2,
                              cancelled=lambda: stopped[0], max_log_bytes=limits["max_log_bytes"])
        terminal["controller_receipt_sha256"] = digest(output / "controller-process/process.json")
        collection = output / "study/COLLECTION.json"
        if collection.is_file():
            terminal["collection_sha256"] = digest(collection)
        require(receipt["status"] == "complete", "controller failed; inspect retained controller process")
        require(collection.is_file(), "controller collection is absent")
        terminal["status"] = "complete"
        return terminal
    except BaseException as error:
        terminal["error"] = str(error)
        raise
    finally:
        terminal["stop_signal"] = stopped[0]
        for number, handler in handlers.items():
            signal.signal(number, handler)
        save(output / "SUPERVISOR.json", terminal)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["opened", "cloud"])
    parser.add_argument("--prepared", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--execution", type=Path)
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.worker:
        run(args.prepared, args.out, args.work, args.mode,
            json.loads(args.execution.read_bytes()) if args.execution else None)
        print(json.dumps({"status": "complete", "collection_sha256": digest(args.out / "COLLECTION.json")}))
    else:
        print(json.dumps(supervise(args.prepared, args.out, args.work, args.mode, args.execution)))
