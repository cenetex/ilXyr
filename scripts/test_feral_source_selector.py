"""Development fixture and altered-source checks for the selector contract."""

import copy
import hashlib
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from feral_source_selector import evaluate, run


ROOT = Path(__file__).resolve().parents[1] / "experiments/feral-source-selector/fixture"
VISIBLE = (ROOT / "visible.json").read_bytes()
LABELS = json.loads((ROOT / "labels.json").read_bytes())


class SelectorTest(unittest.TestCase):
    def test_source_selection_and_abstention_are_scored_separately(self):
        predictions = run(VISIBLE)
        score = evaluate(predictions, LABELS)
        self.assertEqual((score["requests"], score["source_correct"], score["answer_correct"],
                          score["operation_correct_on_answers"], score["correct_answer_coverage"],
                          score["incorrect_assertions"]), (11, 11, 11, 8, 8, 0))
        rows = {row["requestId"]: row for row in predictions["predictions"]}
        self.assertEqual(rows["q06"]["reason"], "conflicting_sources")
        self.assertEqual(len(rows["q06"]["support"]), 2)
        self.assertEqual(rows["q05"]["reason"], "wrong_index_identity")
        self.assertEqual((rows["q09"]["answer"], rows["q09"]["unit"]), ("75000", "usd_thousand"))

    def test_changed_source_bytes_and_label_binding_fail(self):
        view = json.loads(VISIBLE)
        view["resources"][0]["content"] += " altered"
        with self.assertRaisesRegex(ValueError, "changed source bytes"):
            run(json.dumps(view).encode())
        changed = copy.deepcopy(LABELS)
        changed["fixtureSha256"] = hashlib.sha256(b"different visible file").hexdigest()
        with self.assertRaisesRegex(ValueError, "different visible fixture"):
            evaluate(run(VISIBLE), changed)

    def test_wrong_source_and_incorrect_assertion_remain_visible(self):
        candidate = copy.deepcopy(run(VISIBLE))
        candidate["method"] = "test_altered_candidate"
        by_id = {row["requestId"]: row for row in candidate["predictions"]}
        by_id["q03"]["support"] = by_id["q01"]["support"]
        by_id["q04"].update(kind="answer", answer="120", unit="usd_million", reason="answered",
                             support=by_id["q01"]["support"])
        score = evaluate(candidate, LABELS)
        self.assertEqual(score["source_correct"], 9)
        self.assertEqual(score["answer_correct"], 10)
        self.assertEqual(score["incorrect_assertions"], 1)


if __name__ == "__main__":
    unittest.main()
