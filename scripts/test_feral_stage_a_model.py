"""Local schema and shared-resolver checks for the pinned 4B selector package."""
import json
import unittest

from feral_stage_a_model import BASE, encode, load_view, model_inputs, parse_selection, resolve, sha
from feral_stage_a_selector import score


class StageAModelTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.evidence, cls.questions, cls.manifest = load_view(BASE)
        cls.inputs = model_inputs(cls.evidence, cls.questions, cls.manifest)

    def test_saved_model_inputs_replay(self):
        self.assertEqual(encode(self.inputs), (BASE / "MODEL-INPUTS.json").read_bytes())
        self.assertEqual(len(self.inputs["rows"]), 36)
        self.assertTrue(all(len(row["messages"]) == 2 for row in self.inputs["rows"]))
        self.assertNotIn("answer", self.inputs["rows"][0]["messages"][1]["content"])
        self.assertLess(max(len(row["messages"][1]["content"]) for row in self.inputs["rows"]), 10000)

    def test_shared_exact_resolver(self):
        control = json.loads((BASE / "CONTROL-PREDICTIONS.json").read_bytes())
        outputs = []
        for row in control["predictions"]:
            raw = json.dumps(row["selection"] if row["kind"] == "answer"
                             else {"abstain": row["reason"]})
            outputs.append({"id": row["id"], "raw": raw})
        candidate = resolve(self.evidence, self.questions, self.manifest,
                            self.inputs, outputs, "mock-selector")
        labels = json.loads((BASE / "DRAFT-LABELS.json").read_bytes())
        result = score(self.evidence, self.questions, candidate, labels)
        self.assertEqual(result["complete_outcome_correct"], 36)
        self.assertEqual(result["incorrect_assertions"], 0)

    def test_invalid_model_output_has_a_distinct_reason(self):
        selection, reason = parse_selection("not json", set(), set())
        self.assertIsNone(selection)
        self.assertEqual(reason, "invalid_json")
        selection, reason = parse_selection('{"issuer":"cat","concept":"bad","years":[2025],"operation":"lookup"}',
                                            {"us-gaap:Assets"}, {"cat"})
        self.assertIsNone(selection)
        self.assertEqual(reason, "unknown_selection")

    def test_invalid_output_on_abstention_form_fails(self):
        control = json.loads((BASE / "CONTROL-PREDICTIONS.json").read_bytes())
        labels = json.loads((BASE / "DRAFT-LABELS.json").read_bytes())
        outputs = []
        abstention_id = next(row["id"] for row in control["predictions"] if row["kind"] == "abstain")
        for row in control["predictions"]:
            raw = json.dumps(row["selection"] if row["kind"] == "answer"
                             else {"abstain": row["reason"]})
            outputs.append({"id": row["id"], "raw": "not json" if row["id"] == abstention_id else raw})
        candidate = resolve(self.evidence, self.questions, self.manifest,
                            self.inputs, outputs, "mock-selector")
        prediction = next(row for row in candidate["predictions"] if row["id"] == abstention_id)
        self.assertEqual((prediction["kind"], prediction["reason"]), ("invalid", "invalid_json"))
        result = score(self.evidence, self.questions, candidate, labels)
        self.assertEqual(result["complete_outcome_correct"], 35)
        self.assertFalse(next(row for row in result["rows"] if row["id"] == abstention_id)["selection_correct"])

    def test_missing_or_wrong_answer_is_scored(self):
        control = json.loads((BASE / "CONTROL-PREDICTIONS.json").read_bytes())
        labels = json.loads((BASE / "DRAFT-LABELS.json").read_bytes())
        missing = json.loads(json.dumps(control))
        missing["predictions"].pop()
        with self.assertRaises(ValueError):
            score(self.evidence, self.questions, missing, labels)
        wrong = json.loads(json.dumps(control))
        wrong["predictions"][0]["answer"] = "1"
        result = score(self.evidence, self.questions, wrong, labels)
        self.assertEqual(result["incorrect_assertions"], 1)
        self.assertEqual(result["complete_outcome_correct"], 35)


if __name__ == "__main__":
    unittest.main()
