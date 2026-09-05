import json
from pathlib import Path
import tempfile
import unittest

from feral_comparison_worker import run_rows, run_package, file_sha, verify_model, verify_package
from feral_targets_v2 import ndjson
from feral_responses import parse_response
from score_feral_comparison import score_arm


def row(i="fixture"):
    return {"id": i, "schema": "ilxyr.feral_model_input.v2", "task": "finqa", "messages": [
        {"role": "system", "content": "Return one JSON object with exactly one field: answer."},
        {"role": "user", "content": json.dumps({"question": "What is the combined revenue in 2021 and 2022?",
            "retrieved_evidence": [["table_1", "the revenue of 2021 is 10 ; the revenue of 2022 is 20 ;"]]})}]}


def fixture_package(root):
    files = {"inputs/model-inputs.jsonl": ndjson([row()]), "model/FILES.json": b'{"files":{}}',
             "grader/targets.jsonl": b'{}\n', "scripts/worker.py": b'# controlled package\n'}
    bindings = {}
    for name, raw in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
        bindings[name] = {"bytes": len(raw), "sha256": file_sha(path),
                          "phase": "grading" if name.startswith("grader/") else "prediction"}
    (root / "PACKAGE.json").write_text(json.dumps({"files": bindings, "ordered_ids": ["fixture"]}))
    return file_sha(root / "PACKAGE.json")


class ComparisonTests(unittest.TestCase):
    def test_answer_types_keep_exact_decimal_text_and_prose(self):
        for raw, expected in [('{"answer":12.340}', "12.340"), ('{"answer":"yes"}', "yes"),
            ('{"answer":"interest decreased 25.7%"}', "interest decreased 25.7%"),
            ('{"answer":{"value":"$1,234.00","unit":"usd"}}', {"value": "$1,234.00", "unit": "usd"})]:
            parsed = parse_response(raw)
            self.assertEqual(parsed["response_status"], "answered")
            self.assertEqual(parsed["prediction"], expected)
            self.assertEqual(parsed["raw_response"], raw)

    def test_explicit_abstention(self):
        for raw in ['{"answer":null}', '{"answer":"insufficient evidence"}']:
            parsed = parse_response(raw)
            self.assertEqual(parsed["response_status"], "abstained")
            self.assertIsNone(parsed["prediction"])

    def test_truncation_duplicate_fields_and_false_numbers_stay_invalid(self):
        for raw in ['{"answer":', 'Evidence is missing for 2020.', '12.34',
                    '{"answer":1,"answer":2}', '{"answer":1,"reason":"x"}',
                    '{"answer":true}', '{"answer":[]}', '{"answer":""}',
                    '{"answer":NaN}', '{"answer":1e9999999}', '{"answer":"$1e9999999"}']:
            self.assertEqual(parse_response(raw)["response_status"], "invalid", raw)

    def test_model_receives_only_the_complete_messages(self):
        with tempfile.TemporaryDirectory() as name:
            expected = row()
            seen = []
            def generate(messages):
                seen.append(messages)
                return '{"answer":30}', {"generated_tokens": 5, "termination": "eos"}
            out = Path(name) / "base"
            run_rows([expected], "base", out, lambda: generate)
            self.assertEqual(seen, [expected["messages"]])
            target = {"id": "fixture", "kind": "legacy_exact", "original_answer": "30"}
            scored = score_arm(out, [target], "base")
            self.assertEqual(scored["primary_metrics"]["v2_correct"], 1)
            with self.assertRaisesRegex(ValueError, "arm identity"):
                score_arm(out, [target], "calculator")
            with self.assertRaisesRegex(ValueError, "package or inputs"):
                score_arm(out, [target], "base", {"scope": "another_package"})

    def test_failed_generation_keeps_the_completed_prefix_and_row_identity(self):
        with tempfile.TemporaryDirectory() as name:
            calls = 0
            def generate(_messages):
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise RuntimeError("injected generator failure")
                return '{"answer":30}', {}
            out = Path(name) / "base"
            with self.assertRaises(RuntimeError):
                run_rows([row("a"), row("b")], "base", out, lambda: generate)
            terminal = json.loads((out / "result.json").read_bytes())
            self.assertEqual(terminal["status"], "failed")
            self.assertEqual(terminal["rows"], 1)
            self.assertEqual(terminal["failed_input_id"], "b")
            self.assertEqual(terminal["predictions_sha256"], file_sha(out / "predictions.jsonl"))
            self.assertEqual(score_arm(out, [{"id": "a"}, {"id": "b"}])["primary_metrics"], None)
            self.assertGreater(score_arm(out, [{"id": "a"}, {"id": "b"}])["raw_cost"]["total_wall_ns"], 0)

    def test_gold_fields_reject_before_generator_loading(self):
        with tempfile.TemporaryDirectory() as name:
            poisoned = {**row(), "answer": "30"}
            def forbidden():
                self.fail("generator loaded before input validation")
            with self.assertRaises(ValueError):
                run_rows([poisoned], "base", Path(name) / "bad", forbidden)

    def test_grader_replays_raw_response_and_controls_share_parser(self):
        with tempfile.TemporaryDirectory() as name:
            target = {"id": "fixture", "kind": "legacy_exact", "original_answer": "30"}
            for arm, expected in [("calculator", 1), ("operand_only", 0)]:
                out = Path(name) / arm
                run_rows([row()], arm, out)
                self.assertEqual(score_arm(out, [target])["primary_metrics"]["v2_correct"], expected)
            out = Path(name) / "calculator"
            path = out / "predictions.jsonl"
            record = json.loads(path.read_text())
            record["prediction"] = "999"
            path.write_text(json.dumps(record) + "\n")
            terminal = json.loads((out / "result.json").read_bytes())
            terminal["predictions_sha256"] = file_sha(path)
            (out / "result.json").write_text(json.dumps(terminal))
            with self.assertRaisesRegex(ValueError, "raw response"):
                score_arm(out, [target])

    def test_model_bytes_and_extra_files_are_checked(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name); path = root / "model.bin"; path.write_bytes(b"fixture")
            inventory = {"files": {"model.bin": {"bytes": path.stat().st_size, "sha256": file_sha(path)}}}
            verify_model(root, inventory)
            path.write_bytes(b"changed")
            with self.assertRaises(ValueError):
                verify_model(root, inventory)
            path.write_bytes(b"fixture"); (root / "adapter_config.json").write_text("{}")
            with self.assertRaisesRegex(ValueError, "extra files"):
                verify_model(root, inventory)

    def test_package_runs_with_grading_files_removed(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name) / "package"
            digest = fixture_package(root)
            (root / "grader/targets.jsonl").unlink()
            verify_package(root, digest)
            with self.assertRaises(FileNotFoundError):
                verify_package(root, digest, include_grading=True)
            out = Path(name) / "run"
            run_package(root, digest, "base", out,
                        generator_factory=lambda: lambda messages: ('{"answer":30}', {}))
            terminal = json.loads((out / "result.json").read_bytes())
            scored = score_arm(out, [{"id": "fixture", "kind": "legacy_exact", "original_answer": "30"}],
                               "base", terminal["bindings"])
            self.assertEqual(scored["primary_metrics"]["v2_correct"], 1)
            self.assertGreaterEqual(scored["invocation"]["total_wall_ns"], scored["raw_cost"]["total_wall_ns"])
            original = (out / "result.json").read_bytes()
            with self.assertRaises(FileExistsError):
                run_package(root, digest, "calculator", out)
            self.assertEqual((out / "result.json").read_bytes(), original)

    def test_changed_package_keeps_preflight_failure_and_cost(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name) / "package"
            digest = fixture_package(root)
            (root / "inputs/model-inputs.jsonl").write_text("changed\n")
            out = Path(name) / "run"
            with self.assertRaisesRegex(ValueError, "package file differs"):
                run_package(root, digest, "base", out,
                            generator_factory=lambda: self.fail("model opened during failed preflight"))
            failure = score_arm(out, [{"id": "fixture"}], "base", {"package_manifest_sha256": digest})
            self.assertEqual(failure["completed_rows"], 0)
            self.assertIsNone(failure["primary_metrics"])
            self.assertEqual(failure["invocation"]["phase"], "package_verification")
            self.assertGreater(failure["invocation"]["total_wall_ns"], 0)
            with self.assertRaisesRegex(ValueError, "manifest digest"):
                verify_package(root, "0" * 64)


if __name__ == "__main__":
    unittest.main()
