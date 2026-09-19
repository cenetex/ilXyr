"""Check train-only counts, exact probabilities, and altered native rows."""

from copy import deepcopy
from fractions import Fraction
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import research_solomon_suffix_probabilities as baseline


class SuffixProbabilityTests(unittest.TestCase):
    def test_overlapping_continuations_and_terminal_suffix(self):
        counts, order = baseline.suffix_counts(b"aaaa", b"a")
        self.assertEqual((order, sum(counts), counts[97]), (1, 3, 3))
        counts, order = baseline.suffix_counts(b"abc", b"abc")
        self.assertEqual((order, sum(counts)), (0, 3))

    def test_longest_suffix_ties_and_global_fallback(self):
        counts, order = baseline.suffix_counts(b"abcaabdxabcaabdy", b"zzabd")
        self.assertEqual((order, counts[ord("x")], counts[ord("y")]), (3, 1, 1))
        self.assertEqual(baseline.score(counts, 0)["predicted"], ord("x"))
        counts, order = baseline.suffix_counts(b"aaaaaaaaazxzy", b"q")
        self.assertEqual((order, sum(counts), counts[97]), (0, 13, 9))

    def test_uniform_prior_has_one_total_observation_and_keeps_ties(self):
        counts = [0] * 256
        counts[7], counts[8] = 2, 2
        vector = baseline.masses(counts, "suffix_unit_prior")
        self.assertEqual(sum(vector), 256 * 5)
        self.assertEqual(Fraction(vector[7], sum(vector)), Fraction(513, 1280))
        self.assertTrue(all(n > 0 for n in vector))
        for target in range(256):
            self.assertEqual(baseline.score(vector, target)["predicted"], 7)
            self.assertEqual(baseline.score(vector, target)["zero_target_probability"], 0)

    def test_brier_matches_independent_fraction_sum(self):
        vector = [0] * 256
        vector[3], vector[9] = 3, 1
        for arm in baseline.ARMS:
            masses = baseline.masses(vector, arm)
            for target in (0, 3, 9):
                expected = sum((Fraction(n, sum(masses)) - int(i == target)) ** 2
                               for i, n in enumerate(masses))
                self.assertEqual(baseline.score(masses, target)["brier"], expected)
        self.assertEqual(baseline.score(vector, 3)["brier"], Fraction(1, 8))
        self.assertEqual(baseline.score(vector, 0)["zero_target_probability"], 1)

    def test_invalid_mass_and_target_rejected(self):
        for counts in ([0] * 256, [1] * 255, [-1] + [1] * 255, [True] + [1] * 255):
            with self.assertRaises(ValueError):
                baseline.masses(counts, "suffix_empirical")
        for target in (-1, 256, True):
            with self.assertRaises(ValueError):
                baseline.score([1] * 256, target)
        with self.assertRaises(ValueError):
            baseline.suffix_counts(b"", b"context")

    @staticmethod
    def rows():
        tokens = b"a" * 80
        rows = []
        for window in range(16):
            start = window
            rows.extend({"arm": arm, "start": str(start), "target": "97", "predicted": "97"}
                        for arm in ("native", "point_mass", "smoothed_point_mass"))
        return tokens, rows

    def test_comparison_checks_roster_target_and_native_answer(self):
        tokens, rows = self.rows()
        records, totals = baseline.compare(tokens, rows, b"a" * 40)
        self.assertEqual(len(records), 16)
        self.assertEqual(totals["suffix_empirical"]["normalized_brier_mean"], "0")
        for key, value in (("start", "1"), ("target", "98"), ("predicted", "98"), ("arm", "changed")):
            changed = deepcopy(rows)
            changed[0][key] = value
            with self.assertRaises(ValueError):
                baseline.compare(tokens, changed, b"a" * 40)
        with self.assertRaises(ValueError):
            baseline.compare(tokens, rows[:-1], b"a" * 40)

    def test_source_failure_is_retained_and_existing_attempt_is_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "attempt"
            with patch.object(baseline.ownership, "materialize_sources", side_effect=RuntimeError("source failure")):
                with self.assertRaisesRegex(RuntimeError, "source failure"):
                    baseline.smoke(Path(temp), output)
            before = (output / "attempt.json").read_bytes()
            record = json.loads(before)
            self.assertEqual((record["status"], record["phase"], record["error"]),
                             ("failed", "source", "source failure"))
            with self.assertRaises(FileExistsError):
                baseline.smoke(Path(temp), output)
            self.assertEqual((output / "attempt.json").read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
