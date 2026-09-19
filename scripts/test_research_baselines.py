import math
import unittest
from unittest.mock import patch

from research_baselines import Sources, finqa_diagnostic, geometric_mean, unigram_metrics


class BaselineTests(unittest.TestCase):
    def test_unigram_has_a_fixed_train_only_distribution(self):
        first = unigram_metrics(b"aaaaab", b"aaaz", context=0)
        second = unigram_metrics(b"aaaaab", b"zzzz", context=0)
        self.assertEqual(first["predicted_byte"], ord("a"))
        self.assertEqual(first["predicted_byte"], second["predicted_byte"])
        self.assertEqual(first["correct"], 3)
        self.assertEqual(second["correct"], 0)
        self.assertAlmostEqual(first["probability_sum"], 1)
        self.assertAlmostEqual(first["float_bits_per_target"],
                               (-3 * math.log2(6 / 262) - math.log2(1 / 262)) / 4)

    def test_context_prefix_is_excluded_from_targets(self):
        result = unigram_metrics(b"zzzaab", b"zzza", context=3)
        self.assertEqual(result["training_targets"], 3)
        self.assertEqual(result["evaluation_targets"], 1)
        self.assertEqual(result["correct"], 1)
        with self.assertRaises(ValueError):
            unigram_metrics(b"a", b"b", context=1)

    def test_family_ratios_use_equal_log_weights(self):
        self.assertAlmostEqual(geometric_mean([0.25, 4]), 1)
        for values in [[], [0], [-1], [float("nan")], [float("inf")]]:
            with self.assertRaises(ValueError):
                geometric_mean(values)

    def test_empty_labels_keep_the_original_denominator(self):
        rows = [
            {"id": "A/1", "answer": "", "prediction": ""},
            {"id": "A/2", "answer": "12%", "prediction": 12},
            {"id": "B/1", "answer": "12", "prediction": 13},
            {"id": "C/1", "answer": "12", "prediction": "The value is 12."},
            {"id": "D/1", "answer": "yes", "prediction": "no"},
        ]
        inputs = [{"id": row["id"], "answer": row["answer"]} for row in rows]
        result = finqa_diagnostic(inputs, list(reversed(rows)))
        self.assertEqual(result["frozen_score_accuracy"], 2 / 5)
        self.assertEqual(result["valid_gold_accuracy_diagnostic"], 1 / 4)
        self.assertEqual(result["counts"]["empty_gold"], 1)
        self.assertEqual(result["counts"]["numeric_disagreement"], 1)
        self.assertEqual(result["counts"]["numeric_gold_with_non_numeric_output"], 1)
        self.assertEqual(result["counts"]["boolean_error"], 1)
        self.assertEqual(result["issuer_groups"], 4)

    def test_misaligned_or_changed_gold_is_rejected(self):
        inputs = [{"id": "A", "answer": "3"}]
        for predictions in [[], [{"id": "B", "answer": "3", "prediction": "3"}],
                            [{"id": "A", "answer": "4", "prediction": "4"}],
                            [{"id": "A", "answer": "3"}],
                            [{"id": "A", "answer": "3", "prediction": "3"}] * 2]:
            with self.assertRaises(ValueError):
                finqa_diagnostic(inputs, predictions)

    def test_changed_source_bytes_are_rejected(self):
        with patch("research_baselines.subprocess.check_output", return_value=b"changed"):
            with self.assertRaises(ValueError):
                Sources().git("unused", "repo", "a" * 40, "result.json", "0" * 64)


if __name__ == "__main__":
    unittest.main()
