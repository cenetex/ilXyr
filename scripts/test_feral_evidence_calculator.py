import copy
from fractions import Fraction
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from feral_evidence_calculator import amount, extract_cells, predict, predict_row, render
from research_feral_calculator_smoke import ROOT, check


def table(label="revenue", old="80", new="100", name="table_1"):
    return [name, f"the {label} of 2014 is {old} ; the {label} of 2015 is {new} ;"]


QUESTION = "What was the percentage change in revenue from 2014 to 2015?"


def model_row():
    return {"id": "unrelated/identity", "schema": "ilxyr.feral_model_input.v2", "task": "finqa",
            "messages": [{"role": "system", "content": "Use supplied evidence."},
                         {"role": "user", "content": json.dumps({"question": QUESTION,
                                                                   "retrieved_evidence": [table()]})}]}


class CalculatorTests(unittest.TestCase):
    def test_counterfactual_operand_and_year_changes(self):
        self.assertEqual(predict(QUESTION, [table()])["prediction"], "25%")
        self.assertEqual(predict(QUESTION, [table(new="120")])["prediction"], "50%")
        self.assertEqual(predict(QUESTION.replace("2015", "2016"), [table()])["reason"], "missing_requested_year")
        self.assertEqual(predict(QUESTION, [table(old="100", new="80")])["prediction"], "-20%")
        self.assertEqual(predict(QUESTION, [table(old="0")])["reason"], "zero_denominator")

    def test_same_retrieval_two_arms_and_source_span_replay(self):
        evidence = [table(old="$ 80", new="$ 100")]
        full, operand = [predict(QUESTION, evidence, arm) for arm in ["calculator", "operand_only"]]
        self.assertEqual(full["operands"], operand["operands"])
        self.assertEqual(operand["prediction"], "100")
        self.assertEqual([full["work"]["arithmetic_operations"], operand["work"]["arithmetic_operations"]], [3, 0])
        supplied = dict(evidence)
        values = []
        for cell in full["operands"]:
            start, end = cell["span"]
            raw = supplied[cell["evidence_id"]][start:end]
            self.assertEqual(raw, cell["text"])
            values.append(amount(raw)[0])
        self.assertEqual((values[1] - values[0]) / values[0] * 100, Fraction(full["exact_result"]))

    def test_evidence_order_and_identity_do_not_choose_answer(self):
        evidence = [table(), table("expense", "30", "50", "table_2")]
        self.assertEqual(predict(QUESTION, evidence), predict(QUESTION, list(reversed(evidence))))
        row = model_row()
        original = predict_row(row, "calculator")
        row["id"] = "gold-answer-is-999"
        changed = predict_row(row, "calculator")
        self.assertEqual({k: v for k, v in original.items() if k != "id"},
                         {k: v for k, v in changed.items() if k != "id"})

    def test_ambiguity_conflict_and_missing_evidence(self):
        self.assertEqual(predict(QUESTION, [table("domestic revenue"), table("foreign revenue", name="b")])["reason"], "ambiguous_series")
        self.assertEqual(predict(QUESTION, [table(), table(new="101", name="b")])["reason"], "conflicting_values")
        self.assertEqual(predict(QUESTION, [table(), table(name="b")])["prediction"], "25%")
        self.assertEqual(predict(QUESTION, [table("expense")])["reason"], "missing_matching_series")
        self.assertIsNone(predict(QUESTION, [])["prediction"])

    def test_best_series_is_chosen_before_year_coverage(self):
        evidence = [table("revenue growth").copy(), table("revenue", name="b")]
        evidence[0][1] = evidence[0][1].replace("2015", "2016")
        # Both words in the stronger label matter; a weaker complete row cannot replace it.
        evidence[0][1] = evidence[0][1].replace("revenue growth", "domestic revenue")
        self.assertEqual(predict(QUESTION.replace("revenue", "domestic revenue"), evidence)["reason"], "missing_requested_year")

    def test_respectively_preserves_year_pairing_and_units(self):
        text = ("research and development expense was $ 78 million , $ 119 million and $ 86 million "
                "for the years ended december 31 , 2016 , 2015 and 2014 , respectively .")
        question = "What was the percentage change in research and development costs from 2014 to 2015?"
        result = predict(question, [["text_1", text]])
        self.assertEqual(result["prediction"], "38.37%")
        self.assertEqual(result["exact_result"], "1650/43")
        self.assertEqual([cell["value"] for cell in result["operands"]], ["86", "119"])
        self.assertEqual([cell["unit"] for cell in result["operands"]], ["usd_million", "usd_million"])
        self.assertEqual(extract_cells([["text", text.replace("and $ 86 million", "")]]), [])
        self.assertEqual(extract_cells([["text", "revenue was 1,23 million for the years 2014 and 2015, respectively."]]), [])

    def test_units_accounting_signs_and_rounding(self):
        self.assertEqual(predict(QUESTION, [table(old="$ 80", new="100%")])["reason"], "incompatible_units")
        self.assertEqual(predict(QUESTION, [table(old="$ 80 million", new="$ 100 billion")])["reason"], "incompatible_units")
        self.assertEqual(amount("$ (1,234.50) million"), (Fraction(-2469, 2), "usd_million"))
        self.assertEqual(amount(".5"), (Fraction(1, 2), "number"))
        self.assertEqual(render(Fraction("1.005"), "number"), "1.01")
        self.assertEqual(render(Fraction("-1.005"), "number"), "-1.01")
        self.assertEqual(predict(QUESTION, [table(old="(80)", new="(100)")])["prediction"], "25%")

    def test_fixed_operations_and_question_failures(self):
        evidence = [table()]
        cases = [("What was the change in revenue from 2014 to 2015?", "20"),
                 ("What was revenue in 2014 and 2015 combined?", "180"),
                 ("What was average revenue in 2014 and 2015?", "90"),
                 ("What was the ratio of revenue in 2015 to 2014?", "1.25")]
        for question, answer in cases:
            self.assertEqual(predict(question, evidence)["prediction"], answer)
        for question in ["What was revenue in 2015?", QUESTION.replace("2014", "2015"),
                         "What was the difference in revenue between 2014 and 2015?",
                         "What was revenue excluding expense in 2014 and 2015 combined?"]:
            self.assertIsNone(predict(question, evidence)["prediction"])

    def test_model_view_rejects_target_fields(self):
        row = model_row()
        for field in ["answer", "target", "program"]:
            altered = copy.deepcopy(row)
            altered[field] = "25%"
            with self.assertRaises(ValueError):
                predict_row(altered, "calculator")
        altered = copy.deepcopy(row)
        context = json.loads(altered["messages"][1]["content"])
        context["program"] = "divide(100,80)"
        altered["messages"][1]["content"] = json.dumps(context)
        with self.assertRaises(ValueError):
            predict_row(altered, "calculator")
        with self.assertRaises(ValueError):
            predict(QUESTION, [table(), table()])

    def test_saved_smoke_rejects_changed_targets_contexts_and_outputs(self):
        result = json.loads((ROOT / "experiments/research-step-8/RESULT.json").read_bytes())
        check(result)
        changed = copy.deepcopy(result)
        changed["targets"][2]["expected_rational"] = "110"
        with self.assertRaisesRegex(ValueError, "target differs"):
            check(changed)
        changed = copy.deepcopy(result)
        changed["inputs"][2]["messages"][1]["content"] = changed["inputs"][2]["messages"][1]["content"].replace("74", "75")
        with self.assertRaisesRegex(ValueError, "context differs"):
            check(changed)
        changed = copy.deepcopy(result)
        changed["results"]["calculator"]["cases"][2]["prediction"] = "110"
        with self.assertRaisesRegex(ValueError, "replay differs"):
            check(changed)

    def test_cli_roster_output_and_existing_file_protection(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, output = root / "inputs.jsonl", root / "predictions.jsonl"
            first, second = model_row(), model_row()
            second["id"] = "second"
            source.write_text(json.dumps(first) + "\n" + json.dumps(second) + "\n")
            command = [sys.executable, str(Path(__file__).with_name("feral_evidence_calculator.py")),
                       "--inputs", str(source), "--output", str(output), "--arm", "calculator", "--limit", "1"]
            completed = subprocess.run(command, capture_output=True, text=True, check=True)
            self.assertEqual(json.loads(completed.stdout)["rows"], 1)
            rows = [json.loads(line) for line in output.read_text().splitlines()]
            self.assertEqual([(row["id"], row["prediction"]) for row in rows], [(first["id"], "25%")])
            original = output.read_bytes()
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
            self.assertEqual(output.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
