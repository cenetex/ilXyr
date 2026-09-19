import copy
from fractions import Fraction
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from feral_targets_v2 import (FROZEN, PATCH, abstained, build_rows, calculate, correct, encode,
                              ndjson, numeric_prediction, read_rows, rounded_cents, score, sha)


class TargetVersionTests(unittest.TestCase):
    def test_units_and_requested_precision(self):
        target = {"kind": "numeric", "unit": "percent", "expected_rational": "1650/43"}
        self.assertTrue(correct("38.37%", target))
        self.assertTrue(correct("38.37", target))
        self.assertTrue(correct({"value": "0.38372093", "unit": "ratio"}, target))
        self.assertFalse(correct("0.38372093", target))
        self.assertFalse(correct("59.5", target))
        self.assertEqual(numeric_prediction({"value": "184000000", "unit": "usd"}, "usd_million"), 184)
        self.assertEqual(numeric_prediction("$184", "usd_million"), 184)
        self.assertEqual(numeric_prediction("1,234.50", "ratio"), Fraction(2469, 2))
        self.assertEqual(rounded_cents(Fraction("1.005")), 101)
        self.assertEqual(rounded_cents(Fraction("-1.005")), -101)
        self.assertEqual(rounded_cents(Fraction("1.004999")), 100)

    def test_invalid_or_conflicting_values(self):
        target = {"kind": "numeric", "unit": "percent", "expected_rational": "12"}
        for value in [True, None, "NaN", "Infinity", float("inf"), "1,2", "12 and 13", "$12", "1e1000",
                      {"value": "12%", "unit": "ratio"}, {"value": "12", "unit": "usd"},
                      {"value": "12", "unit": "percent", "extra": "ignored"}]:
            with self.subTest(value=value):
                self.assertFalse(correct(value, target))
        for value in [None, "unknown", "insufficient_evidence", " Cannot Determine ", "Unable to determine."]:
            self.assertTrue(abstained(value))
        for value in ["", "12", 0, False, {"answer": None}]:
            self.assertFalse(abstained(value))

    def test_roster_denominator_and_old_targets(self):
        targets = [{"id": "A/1", "kind": "legacy_exact", "original_answer": "14%"},
                   {"id": "B/2", "kind": "numeric", "original_answer": "", "unit": "ratio", "expected_rational": "5/2"},
                   {"id": "B/3", "kind": "abstention", "original_answer": ""}]
        predictions = [{"id": "A/1", "prediction": "14", "answer": "spoofed"},
                       {"id": "B/2", "prediction": "2.50"}, {"id": "B/3", "prediction": None}]
        result = score(predictions, targets)
        self.assertEqual(result["rows"], 3)
        self.assertEqual(result["original_correct"], 1)
        self.assertEqual(result["v2_correct"], 3)
        self.assertEqual(result["by_issuer"]["B"], {"rows": 2, "correct": 2})
        for bad in [predictions[:-1], predictions[::-1], predictions + [predictions[0]],
                    [predictions[0], {"id": "B/2"}, predictions[2]]]:
            with self.assertRaises(ValueError):
                score(bad, targets)
        all_abstain = score([{"id": row["id"], "prediction": None} for row in targets], targets)
        self.assertEqual(all_abstain["v2_correct"], 1)
        self.assertEqual(all_abstain["non_abstained_fraction"], 0)

    def fixture(self):
        qa = {"answer": "", "question": "What is the ratio of 10 to 4?",
              "model_input": [["table_1", "The amounts are 10 and 4."]],
              "program": "divide(10, 4)", "exe_ans": 2.5}
        context = encode({"question": qa["question"], "retrieved_evidence": qa["model_input"]}).decode()
        messages = [{"role": "system", "content": "Answer from the evidence."}, {"role": "user", "content": context}]
        base = [{"id": "X/1", "answer": "", "messages": messages, "hidden_gold": "grader-only"}]
        source = encode([{"id": "X/1", "qa": qa}])
        patch = {"base_inputs_sha256": sha(ndjson(base)), "source_sha256": sha(source), "roster_count": 1,
                 "numeric_rounding": {"decimal_places": 2, "tie_rule": "away_from_zero"},
                 "patches": [{"id": "X/1", "kind": "numeric", "unit": "ratio", "calculation": ["divide", "10", "4"],
                    "question": qa["question"], "source_program": qa["program"], "source_execution_answer": "2.5",
                    "model_context_sha256": sha(context.encode()), "source_qa_sha256": sha(encode(qa)), "evidence_ids": ["table_1"]}]}
        return ndjson(base), source, patch, messages

    def test_materialized_model_view_and_source_changes(self):
        base, source, patch, messages = self.fixture()
        model, targets = build_rows(base, source, patch)
        self.assertEqual(set(model[0]), {"schema", "task", "id", "messages"})
        self.assertEqual(model[0]["messages"], messages)
        self.assertEqual(targets[0]["expected_rational"], "5/2")
        self.assertNotIn("grader-only", ndjson(model).decode())
        self.assertNotIn("divide(10, 4)", ndjson(model).decode())
        with self.assertRaisesRegex(ValueError, "digest"):
            build_rows(base + b" ", source, patch)
        for mutate in [lambda p: p["patches"].clear(),
                       lambda p: p["patches"].append(copy.deepcopy(p["patches"][0])),
                       lambda p: p["patches"][0].update(evidence_ids=["gold_only"]),
                       lambda p: p["patches"][0].update(calculation=["divide", "999", "4"]),
                       lambda p: p["patches"][0].update(source_program="different")]:
            changed = copy.deepcopy(patch)
            mutate(changed)
            with self.assertRaises(ValueError):
                build_rows(base, source, changed)
        with self.assertRaises(ValueError):
            read_rows(base + base)

    def test_reviewed_calculations_and_answerability(self):
        patch = json.loads(PATCH.read_bytes())
        by_id = {row["id"]: row for row in patch["patches"]}
        self.assertEqual(calculate(by_id["CE/2016/page_19.pdf-4"]["calculation"]), Fraction(1650, 43))
        self.assertEqual(calculate(by_id["MAS/2017/page_27.pdf-2"]["calculation"]), Fraction(11197, 100))
        self.assertEqual(calculate(by_id["RSG/2018/page_135.pdf-2"]["calculation"]), Fraction(-130, 3))
        self.assertEqual({key for key, row in by_id.items() if row["kind"] == "abstention"},
                         {"AES/2002/page_128.pdf-2", "HIG/2011/page_53.pdf-4", "ETR/2016/page_23.pdf-4"})

    def test_coupled_file_and_manifest_change_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            manifest = json.loads(FROZEN.read_bytes())
            malicious_targets = b'{"id":"changed","kind":"abstention"}\n'
            manifest["targets_sha256"] = sha(malicious_targets)
            (directory / "targets.jsonl").write_bytes(malicious_targets)
            (directory / "manifest.json").write_bytes(encode(manifest))
            predictions = directory / "predictions.jsonl"
            predictions.write_bytes(b'{"id":"changed","prediction":null}\n')
            result = subprocess.run([sys.executable, str(Path(__file__).with_name("feral_targets_v2.py")),
                                     "--score-dir", str(directory), "--predictions", str(predictions)],
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("differs from frozen version", result.stderr)


if __name__ == "__main__":
    unittest.main()
