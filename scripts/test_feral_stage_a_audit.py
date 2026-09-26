"""Checks for the opened real-source FERAL Stage A feasibility audit."""
import json
from pathlib import Path
import tempfile
import unittest

from feral_stage_a_audit import ROOT, STEP47, audit


class StageAAuditTest(unittest.TestCase):
    def test_saved_audit_replays(self):
        actual = audit()
        saved = json.loads((ROOT / "experiments/feral-source-selector/REAL-SOURCE-AUDIT.json").read_text())
        self.assertEqual(actual, saved)
        self.assertEqual(actual["real_source_families"], 3)
        self.assertEqual(actual["fact_occurrences"], 81)
        self.assertEqual(actual["catalogue_label_unit_pairs"], 13)
        self.assertEqual(actual["link_availability"]["verified_occurrence_byte_spans"], 0)

    def test_rejects_broken_source_binding(self):
        source = json.loads((STEP47 / "SOURCES.json").read_text())
        source["sources"][0]["sha256"] = "0" * 64
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sources.json"
            path.write_text(json.dumps(source))
            with self.assertRaises(AssertionError):
                audit(source_path=path)

    def test_rejects_missing_fact_mapping(self):
        roster = json.loads((STEP47 / "data/ROSTER.json").read_text())
        roster[0]["source_mapping"][0]["fact_id"] = "absent-fact"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "roster.json"
            path.write_text(json.dumps(roster))
            with self.assertRaises(AssertionError):
                audit(roster_path=path)


if __name__ == "__main__":
    unittest.main()
