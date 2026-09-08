"""Check paired cost accounting with small, independently calculated records."""

import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import research_reasoner_costs as costs


def fixture():
    processes = []
    for pass_id in range(2):
        for arm in costs.ARMS:
            full = arm == "task_guide"
            cpu, wall = (24, 35) if full else (20, 30)
            rows = [{"kind": "metadata", "arm": arm, "pass": pass_id,
                     "corpus_cpu_ns": 10, "model_load_cpu_ns": 0,
                     "corpus_ns": 15, "model_load_ns": 0}]
            for phase in ("warmup", "measured"):
                for episode in range(4):
                    rows.append({"kind": "row", "phase": phase, "episode": episode,
                                 "failed": False, "exact": True, "certificate_valid": True,
                                 "injected_invalid_rejected": True, "groups": 4,
                                 "verifier_checks": 3 if full else 1, "partial_expansions": 6,
                                 "observation_queries": 2,
                                 "source_artifact_reads": costs.DECLARED_BYTES[arm],
                                 **dict.fromkeys(costs.STAGES, 0), "enumerate_ns": 5,
                                 "score_ns": 11 if full else 4, "sort_ns": 3 if full else 5,
                                 "search_ns": 3 if full else 2,
                                 "wall_ns": wall, "cpu_ns": cpu})
            rows.append({"kind": "process", "failed": False, "completed_episodes": 8,
                         "process_cpu_ns": 8 * cpu + 27,
                         "process_wall_ns": 8 * wall + 26, "peak_rss_bytes": 100})
            processes.append({"arm": arm, "pass": pass_id, "rows": rows})
    return processes


def analyze(processes):
    return costs.summarize(processes, families=2, passes=2, views=2, cells=2)


class CostTests(unittest.TestCase):
    def test_wall_deltas_keep_offsets_and_cpu_separate(self):
        result = analyze(fixture())
        pair = next(p for p in result["comparisons"]
                    if p["candidate"] == "task_guide" and p["reference"] == "task_without_prior_feature")
        self.assertEqual(pair["measured_delta"]["score_ns"], 56)
        self.assertEqual(pair["measured_delta"]["sort_ns"], -16)
        self.assertEqual(pair["measured_delta"]["wall_ns"], 40)
        self.assertEqual(pair["measured_delta"]["cpu_ns"], 32)
        self.assertEqual(pair["score_share_of_wall_delta"], 1.4)
        self.assertEqual(pair["zero_search_accounting_bound"]["candidate_wall_ns"], 256)
        self.assertEqual(pair["zero_search_accounting_bound"]["reference_wall_ns"], 240)
        self.assertAlmostEqual(pair["zero_search_accounting_bound"]["ratio"], 256 / 240)
        self.assertAlmostEqual(pair["metrics"]["cpu"]["family_geometric_ratio"], 1.2)
        self.assertEqual(pair["metrics"]["checks_plus_one"]["family_geometric_ratio"], 2)
        self.assertEqual(pair["metrics"]["cpu"]["family_losses"], 2)
        total = result["totals"]["task_guide"]
        self.assertEqual(total["unattributed_process_cpu_ns"], 34)
        self.assertEqual(total["measured"]["source_artifact_reads"], 921 * 8)

    def test_family_weights_use_log_ratios(self):
        processes = fixture()
        for p in processes:
            if p["arm"] == "task_guide":
                for row in p["rows"][1:-1]:
                    row["cpu_ns"] = 40 if row["episode"] < 2 else 10
                p["rows"][-1]["process_cpu_ns"] = 227
        pair = analyze(processes)["comparisons"][0]
        self.assertEqual(pair["metrics"]["cpu"]["family_geometric_ratio"], 1)
        self.assertEqual(pair["metrics"]["cpu"]["stratum_ratios"], [2, 0.5])

    def test_duplicate_or_missing_process(self):
        rows = fixture()
        rows[-1] = copy.deepcopy(rows[0])
        with self.assertRaisesRegex(ValueError, "duplicate process"):
            analyze(rows)
        with self.assertRaisesRegex(ValueError, "process count"):
            analyze(fixture()[:-1])

    def test_missing_episode_and_changed_repeated_answer(self):
        rows = fixture()
        rows[0]["rows"][2]["episode"] = 0
        with self.assertRaisesRegex(ValueError, "episode roster"):
            analyze(rows)
        rows = fixture()
        rows[0]["rows"][5]["verifier_checks"] += 1
        with self.assertRaisesRegex(ValueError, "repeated behavior"):
            analyze(rows)

    def test_cost_boundaries(self):
        for key, value, message in (("score_ns", 100, "stage wall"),
                                    ("cpu_ns", -1, "invalid stage"),
                                    ("cpu_ns", True, "invalid stage"),
                                    ("source_artifact_reads", 1, "guide-byte")):
            rows = fixture()
            rows[0]["rows"][1][key] = value
            with self.assertRaisesRegex(ValueError, message):
                analyze(rows)
        rows = fixture()
        rows[0]["rows"][-1]["process_cpu_ns"] = 1
        with self.assertRaisesRegex(ValueError, "excludes completed work"):
            analyze(rows)

    def test_tampered_input_rejected_before_analysis(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = root / "results/study/identity.json"
            path.parent.mkdir(parents=True)
            path.write_bytes(b"changed")
            collection = {"objects": [{"path": "results/study/identity.json",
                                       "bytes": 2, "sha256": costs.sha(b"{}")}]}
            with self.assertRaisesRegex(ValueError, "input digest differs"):
                costs.inspect(root, root, collection)

    def test_failed_attempt_is_retained_and_existing_output_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output = root / "attempt"
            command = [sys.executable, str(Path(costs.__file__)), "--results", str(root),
                       "--source", str(root), "--out", str(output)]
            first = subprocess.run(command, capture_output=True)
            self.assertNotEqual(first.returncode, 0)
            saved = (output / "ATTEMPT.json").read_bytes()
            self.assertEqual(json.loads(saved)["status"], "failed")
            second = subprocess.run(command, capture_output=True)
            self.assertNotEqual(second.returncode, 0)
            self.assertEqual((output / "ATTEMPT.json").read_bytes(), saved)


if __name__ == "__main__":
    unittest.main()
