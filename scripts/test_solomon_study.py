"""Exercise full collection checks and retained failures using synthetic workers."""

import copy
from contextlib import ExitStack
from fractions import Fraction
import hashlib
import json
import os
from pathlib import Path
import signal
import sys
import tempfile
import unittest
from unittest.mock import patch

import check_solomon_study as checker
import research_solomon_study as study
from feral_process import run_process, save

FAKE_MODEL = b"synthetic unit-test model"
WORKER = '''#!/usr/bin/env python3
import json, pathlib, sys, time
arm, artifact, contexts = sys.argv[1:]
n = len(pathlib.Path(contexts).read_bytes()) // 64
print("index\\tpredicted\\tmasses", flush=True)
{injection}
for i in range(n):
    mass = [0] * 256
    if arm == "native": mass[65], mass[66] = 16384, 16383
    elif arm == "point_mass": mass[65] = 32767
    elif arm == "smoothed_point_mass":
        extra = 216
        for byte in range(256):
            if byte == 65: mass[byte] = 29491
            else: mass[byte] = 12 + int(extra > 0); extra -= int(extra > 0)
    elif arm == "suffix_empirical": mass[65] = 1
    elif arm == "suffix_unit_prior": mass = [1] * 256; mass[65] = 257
    print(str(i) + "\\t65\\t" + ",".join(map(str, mass)), flush=True)
print(json.dumps(dict(arm=arm, windows=n, native_forward_calls=n if arm == "native" else 0,
                     context_bytes=n * 64, artifact_bytes=pathlib.Path(artifact).stat().st_size)), file=sys.stderr)
'''


def fixture_prepared(root):
    prepared = root / "prepared"
    for name, blob in [("BINDINGS.json", b"{}\n"), ("inputs/memory.bin", b"A"),
                       ("source/" + study.confidence.ownership.MODEL, FAKE_MODEL),
                       ("source/" + study.confidence.ownership.BASE + "eval.txt", b"A" * 100 + b"B" * 100),
                       ("source/build-marker", b"synthetic build")]:
        path = prepared / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(blob)
    return prepared


def fake_process(directory, command, stdout=b"", stderr=b"", cpu=0.01, wall=1000000):
    directory.mkdir(parents=True, exist_ok=False)
    (directory / "stdout.log").write_bytes(stdout)
    (directory / "stderr.log").write_bytes(stderr)
    receipt = {"schema": "ilxyr.feral_process.v1", "command": command, "status": "complete", "exit_code": 0,
               "stop_reason": None, "signals": [], "descendant_cleanup": False, "max_log_bytes": 1024 * 1024,
               "resource_usage": {"user_cpu_seconds": cpu, "system_cpu_seconds": 0, "max_rss_bytes": 1000000,
                                  "scope": "wait4_direct_child_and_waited_descendants"}, "total_wall_ns": wall,
               "outputs": {name: {"bytes": (directory / name).stat().st_size, "sha256": study.digest(directory / name)}
                           for name in ["stdout.log", "stderr.log"]}}
    save(directory / "process.json", receipt)
    return receipt


def seal_supervisor(collected, status="complete"):
    root = collected / "study"
    study.collect_files(root)
    save(collected / "SUPERVISOR.json", {"schema": "ilxyr.solomon_study_supervisor.v1", "status": status,
        "mode": "opened", "controller_receipt_sha256": study.digest(collected / "controller-process/process.json"),
        "collection_sha256": study.digest(root / "COLLECTION.json")})
    return study.digest(collected / "SUPERVISOR.json")


def add_supervisor(collected):
    root = collected / "study"
    run = checker.load(root / "RUN.json")
    child_receipts = [checker.load(p) for p in root.rglob("process.json")]
    command = [run["controller_executable"], run["controller_script"], "opened", "--worker", "--prepared", run["prepared_root"],
               "--out", run["output_root"], "--work", str(Path(run["build_root"]).parent)]
    cpu = sum(r["resource_usage"]["user_cpu_seconds"] + r["resource_usage"]["system_cpu_seconds"] for r in child_receipts) + 1
    wall = sum(r["total_wall_ns"] for r in child_receipts) + 1000000000
    fake_process(collected / "controller-process", command, cpu=cpu, wall=wall)
    return seal_supervisor(collected)


class StudyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.prepared = fixture_prepared(self.root)
        self.output, self.work = self.root / "result", self.root / "work"
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(study, "validate_inputs", return_value={"source/build-marker": {}}))
        self.stack.enter_context(patch.object(study.confidence.ownership, "MODEL_SHA", hashlib.sha256(FAKE_MODEL).hexdigest()))
        self.injection = ""
        self.stop_after_build = False

        def process(command, cwd, directory, deadline, grace, **kwargs):
            if command == ["rustc", "-Vv"]:
                return fake_process(directory, command, stdout=b"rustc synthetic fixture\n")
            if command == study.BUILD:
                worker = cwd / "target/release/solomon-confidence-arm"
                worker.parent.mkdir(parents=True)
                worker.write_text(WORKER.replace("{injection}", self.injection))
                worker.chmod(0o700)
                receipt = fake_process(directory, command)
                if self.stop_after_build:
                    os.kill(os.getpid(), signal.SIGTERM)
                return receipt
            return run_process(command, cwd, directory, deadline, grace, **kwargs)
        self.stack.enter_context(patch.object(study, "run_process", side_effect=process))

    def run_fixture(self):
        study.run(self.prepared, self.output / "study", self.work)
        return add_supervisor(self.output)

    def checked(self, sha=None):
        return checker.check(self.prepared, self.output, sha or study.digest(self.output / "SUPERVISOR.json"))

    def test_complete_pipeline_scores_and_charges_whole_processes(self):
        digest = self.run_fixture()
        result = self.checked(digest)
        self.assertEqual((result["documents"], result["jobs"], result["probability_rows"], result["native_forward_calls"]), (1, 10, 160, 32))
        self.assertEqual(result["fresh_model_calls"], 0)
        self.assertFalse(result["performance_evidence"])
        point = result["summary"]["arms"]["point_mass"]
        self.assertEqual(Fraction(point["normalized_brier_equal_document_mean"]), Fraction(2 * point["mistakes"], 16))
        self.assertAlmostEqual(result["controller_overhead_cpu_seconds"], 1, places=6)
        self.assertEqual(len(result["summary"]["native_comparisons"]), 4)

    def test_transport_tamper_and_extra_files_are_rejected(self):
        digest = self.run_fixture()
        path = self.output / "study/jobs/0000/process/stdout.log"
        old = path.read_bytes()
        path.write_bytes(old + b"changed")
        with self.assertRaisesRegex(ValueError, "collected bytes"):
            self.checked(digest)
        path.write_bytes(old)
        (self.output / "study/unexpected").write_text("extra")
        with self.assertRaisesRegex(ValueError, "file coverage"):
            self.checked(digest)

    def test_resealed_wrong_job_and_incomplete_roster_are_rejected(self):
        self.run_fixture()
        job_path = self.output / "study/jobs/0001/JOB.json"
        original = checker.load(job_path)
        changed = {**original, "arm": "native"}
        save(job_path, changed)
        with self.assertRaisesRegex(ValueError, "job input"):
            self.checked(seal_supervisor(self.output))
        save(job_path, original)
        path = self.output / "study/ATTEMPT.json"
        attempt = checker.load(path); attempt["completed_jobs"] -= 1; save(path, attempt)
        with self.assertRaisesRegex(ValueError, "job coverage"):
            self.checked(seal_supervisor(self.output))

    def test_resealed_changed_probability_and_omitted_child_cost_fail(self):
        self.run_fixture()
        directory = self.output / "study/jobs/0001/process"
        path = directory / "stdout.log"
        original = path.read_bytes()
        path.write_bytes(original.replace(b"32767", b"32766", 1))
        receipt = checker.load(directory / "process.json")
        receipt["outputs"]["stdout.log"] = {"bytes": path.stat().st_size, "sha256": study.digest(path)}
        save(directory / "process.json", receipt)
        with self.assertRaisesRegex(ValueError, "point probabilities"):
            self.checked(seal_supervisor(self.output))
        path.write_bytes(original)
        receipt["outputs"]["stdout.log"] = {"bytes": path.stat().st_size, "sha256": study.digest(path)}
        save(directory / "process.json", receipt)
        outer = self.output / "controller-process/process.json"
        receipt = checker.load(outer); receipt["resource_usage"]["user_cpu_seconds"] = 0; save(outer, receipt)
        with self.assertRaisesRegex(ValueError, "excludes child work"):
            self.checked(seal_supervisor(self.output))

    def test_failure_keeps_partial_stdout_and_unknown_native_call_count(self):
        self.injection = 'print("partial row", flush=True); sys.exit(7)'
        with self.assertRaisesRegex(ValueError, "worker failed"):
            study.run(self.prepared, self.output / "study", self.work)
        attempt = checker.load(self.output / "study/ATTEMPT.json")
        self.assertEqual((attempt["started_jobs"], attempt["completed_jobs"], attempt["native_calls_confirmed"]), (1, 0, 0))
        self.assertEqual(attempt["native_calls_started_upper_bound"], 16)
        self.assertTrue(attempt["failed_native_calls_unknown"])
        self.assertIn(b"partial row", (self.output / "study/jobs/0000/process/stdout.log").read_bytes())
        self.assertEqual(checker.load(self.output / "study/jobs/0000/process/process.json")["exit_code"], 7)
        self.assertTrue((self.output / "study/COLLECTION.json").is_file())
        before = (self.output / "study/ATTEMPT.json").read_bytes()
        with self.assertRaises(FileExistsError):
            study.run(self.prepared, self.output / "study", self.work)
        self.assertEqual((self.output / "study/ATTEMPT.json").read_bytes(), before)

    def test_deadline_and_cancellation_keep_terminal_records(self):
        self.injection = "time.sleep(3)"
        limits = {**study.OPENED_LIMITS, "job_seconds": 0.05, "grace_seconds": 0}
        with patch.object(study, "OPENED_LIMITS", limits), self.assertRaises(ValueError):
            study.run(self.prepared, self.output / "study", self.work)
        receipt = checker.load(self.output / "study/jobs/0000/process/process.json")
        self.assertEqual(receipt["stop_reason"], "deadline")
        self.assertTrue(receipt["signals"])
        self.stop_after_build = True
        old_handler = signal.getsignal(signal.SIGTERM)
        with self.assertRaisesRegex(ValueError, "stopped before next job"):
            study.run(self.prepared, self.root / "cancelled", self.root / "cancel-work")
        self.assertEqual(signal.getsignal(signal.SIGTERM), old_handler)
        record = checker.load(self.root / "cancelled/ATTEMPT.json")
        self.assertEqual((record["stop_signal"], record["started_jobs"]), (signal.SIGTERM, 0))

    def test_cloud_record_required_before_build_or_model_calls(self):
        with self.assertRaisesRegex(ValueError, "cloud execution record"):
            study.run(self.prepared, self.output / "study", self.work, "cloud")
        record = checker.load(self.output / "study/ATTEMPT.json")
        self.assertEqual(record["fresh_model_calls_confirmed"], 0)
        self.assertFalse(self.work.exists())

    def test_outer_wrapper_retains_failed_controller_and_restores_signal_handler(self):
        handler = signal.getsignal(signal.SIGTERM)
        with self.assertRaisesRegex(ValueError, "controller failed"):
            study.supervise(self.prepared, self.output, self.work)
        self.assertEqual(signal.getsignal(signal.SIGTERM), handler)
        terminal = checker.load(self.output / "SUPERVISOR.json")
        self.assertEqual(terminal["status"], "failed")
        self.assertIn("collection_sha256", terminal)
        self.assertEqual(checker.load(self.output / "study/ATTEMPT.json")["native_calls_confirmed"], 0)
        self.assertGreater((self.output / "controller-process/stderr.log").stat().st_size, 0)
        with self.assertRaisesRegex(ValueError, "supervisor is incomplete"):
            self.checked()

    def test_outer_cancellation_reaches_the_process_helper(self):
        def cancel(command, cwd, directory, deadline, grace, **kwargs):
            os.kill(os.getpid(), signal.SIGTERM)
            self.assertEqual(kwargs["cancelled"](), signal.SIGTERM)
            return run_process(command, cwd, directory, deadline, grace, **kwargs)
        with patch.object(study, "run_process", side_effect=cancel), self.assertRaisesRegex(ValueError, "controller failed"):
            study.supervise(self.prepared, self.output, self.work)
        terminal = checker.load(self.output / "SUPERVISOR.json")
        self.assertEqual(terminal["stop_signal"], signal.SIGTERM)
        receipt = checker.load(self.output / "controller-process/process.json")
        self.assertEqual((receipt["status"], receipt["stop_reason"], receipt["pid"]), ("skipped", "cancelled", None))

    def test_checker_preserves_native_answer_after_probability_quantization_tie(self):
        path = self.root / "tie.tsv"
        masses = [0] * 256
        masses[64], masses[65], masses[66] = 16383, 16383, 1
        path.write_text("index\tpredicted\tmasses\n0\t65\t" + ",".join(map(str, masses)) + "\n")
        score, _ = checker.vectors(path, [{"target": 65}], "native", b"A" * 64, b"A" * 16)
        self.assertEqual(score["mistakes"], 0)

    def test_native_mass_is_normalized_by_its_observed_sum(self):
        path = self.root / "mass.tsv"
        masses = [0] * 256
        masses[65], masses[66] = 20000, 14000
        path.write_text("index\tpredicted\tmasses\n0\t65\t" + ",".join(map(str, masses)) + "\n")
        score, _ = checker.vectors(path, [{"target": 65}], "native", b"A" * 64, b"A")
        self.assertEqual(Fraction(score["normalized_brier_mean"]), Fraction(98, 289))

    def test_cloud_limits_bind_sources_and_allow_checking_on_another_host(self):
        execution = {"schema": "ilxyr.solomon_study_execution.v1", "venue": "cloud", "run_id": "fixture",
            "package_sha256": "a" * 64, "prepared_bindings_sha256": study.digest(self.prepared / "BINDINGS.json"),
            "implementation": study.bindings(), "rustc_identity": "frozen compiler", "limits": dict(study.OPENED_LIMITS),
            "machine": {"provider": "aws", "region": "fixture", "instance_type": "fixture", "image_id": "fixture",
                        "architecture": "other-collection-host", "runtime_image": "fixed-image"}}
        self.assertEqual(study.execution_limits(self.prepared, "cloud", execution, check_host=False), study.OPENED_LIMITS)
        with self.assertRaisesRegex(ValueError, "architecture"):
            study.execution_limits(self.prepared, "cloud", execution)
        for field, value in [("implementation", {}), ("package_sha256", ""), ("limits", {**study.OPENED_LIMITS, "total_seconds": 9999})]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                study.execution_limits(self.prepared, "cloud", {**execution, field: value}, check_host=False)

    def test_linked_document_and_equal_weight_summary(self):
        docs = [{"id": "a", "stratum": "fiction"}, {"id": "b", "stratum": "nonfiction"}]
        rows = [{"arm": arm, "document": doc["id"], "score": {"normalized_brier_mean": "1/4" if doc["id"] == "a" else "3/4", "mistakes": 1, "zeros": 0},
                 "cost": {"cpu_seconds": 2 if arm == "native" else 1, "wall_ns": 10, "peak_rss_bytes": 100}}
                for arm in study.ARMS for doc in docs for _ in range(5)]
        summary = checker.summarize(docs, rows)
        self.assertEqual(summary["arms"]["native"]["normalized_brier_equal_document_mean"], "1/2")
        self.assertEqual(summary["native_comparisons"]["point_mass"]["native_over_control_equal_document_geometric_cpu"], 2)
        rows[0]["cost"]["cpu_seconds"] = 0
        for row in rows:
            if row["arm"] == "point_mass": row["cost"]["cpu_seconds"] = 0
        self.assertEqual(checker.summarize(docs, rows)["native_comparisons"]["point_mass"]["cpu_ratio_status"], "zero_cpu_resolution")


if __name__ == "__main__":
    unittest.main()
