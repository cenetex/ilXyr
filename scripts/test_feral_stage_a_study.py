"""Replay the compact Stage A selector evidence and its custody boundaries."""
import json
from pathlib import Path
import tempfile
import unittest

from feral_stage_a_selector import BASE, draft_labels, encode, score, select, sha


class StageAStudyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.evidence = json.loads((BASE / "EVIDENCE.json").read_bytes())
        cls.questions = json.loads((BASE / "QUESTIONS.json").read_bytes())
        cls.manifest = json.loads((BASE / "SOURCE-MANIFEST.json").read_bytes())
        cls.specs = json.loads((BASE / "DRAFT-LABEL-SPECS.json").read_bytes())

    def test_saved_study_replays(self):
        labels = draft_labels(self.evidence, self.questions, self.manifest, self.specs)
        predictions = select(self.evidence, self.questions, self.manifest)
        result = score(self.evidence, self.questions, predictions, labels)
        for name, value in [("DRAFT-LABELS.json", labels),
                            ("CONTROL-PREDICTIONS.json", predictions),
                            ("CONTROL-SCORE.json", result)]:
            self.assertEqual(encode(value), (BASE / name).read_bytes())
        self.assertEqual(len(self.evidence["catalogue"]), 60)
        self.assertEqual(len(self.evidence["families"]), 3)
        self.assertEqual(len(self.questions["forms"]), 36)
        self.assertEqual(result["answer_correct"], 36)
        self.assertEqual(result["incorrect_assertions"], 0)

    def test_occurrences_have_resolvable_source_links(self):
        files = {item["id"]: item for family in self.manifest["families"]
                 for item in family["filing"]}
        ids = set()
        for family in self.evidence["families"]:
            for fact in family["facts"]:
                self.assertNotIn(fact["id"], ids)
                ids.add(fact["id"])
                self.assertEqual(fact["source_sha256"], files[fact["source_file"]]["sha256"])
                self.assertTrue(0 <= fact["span"][0] < fact["span"][1] <= files[fact["source_file"]]["bytes"])
                self.assertEqual(fact["context"]["cik"],
                                 next(item["cik"] for item in self.manifest["families"]
                                      if item["id"] == family["id"]))
                self.assertTrue(fact["unit"])

    def test_label_custody_rejects_changed_visible_inputs(self):
        labels = draft_labels(self.evidence, self.questions, self.manifest, self.specs)
        altered = json.loads(json.dumps(self.questions))
        altered["forms"][0]["text"] += " changed"
        predictions = select(self.evidence, altered, self.manifest)
        with self.assertRaises(ValueError):
            score(self.evidence, altered, predictions, labels)


if __name__ == "__main__":
    unittest.main()
