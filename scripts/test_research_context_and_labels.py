import math
import struct
import unittest
from fractions import Fraction

from research_context_and_labels import (
    constant_model_logits, context_scores, execute_gold_program, log2_q20,
    missing_labels, score_row,
)


class ContextAndLabelTests(unittest.TestCase):
    def test_integer_logarithm_matches_known_values(self):
        for power in range(50):
            self.assertEqual(log2_q20(1 << power), power << 20)
        for value in [3, 5, 255, 32767, 9324, 8388352]:
            self.assertLessEqual(abs(log2_q20(value) - math.log2(value) * (1 << 20)), 1)
        for value in [0, -1, 1.5]:
            with self.assertRaises(ValueError):
                log2_q20(value)

    def test_uniform_loss_and_zero_mass_floor(self):
        table = [32767] * 256
        predicted, losses = score_row([0] * 256, table)
        self.assertEqual(predicted, 0)
        self.assertEqual(losses, [8000] * 256)
        predicted, losses = score_row([0] + [-15 * 256] * 255, table)
        self.assertEqual(losses, [0] + [32000] * 255)

    def test_context_signal_survives_scoring_and_breaks_under_reversal(self):
        # Independent real-valued table supplies this synthetic scorer fixture.
        table = [round(32767 * 2 ** (-value / 256)) for value in range(256)]
        result = context_scores(b"ab" * 1000, b"ab" * 50 + b"a", 1, table, [0] * 256)
        bigram, unigram = result["smoothed_bigram"], result["smoothed_unigram"]
        self.assertEqual(bigram["correct"], 100)
        self.assertEqual(bigram["reversed_context_correct"], 0)
        self.assertEqual(bigram["changed_top_one_predictions"], 100)
        self.assertLess(bigram["canonical_integer_nll_millibits"], unigram["canonical_integer_nll_millibits"])
        self.assertGreater(bigram["reversed_context_nll_millibits"], unigram["canonical_integer_nll_millibits"])
        self.assertEqual(unigram["changed_top_one_predictions"], 0)

    def test_artifact_context_weights_are_checked(self):
        counts = [256, 1] + [1] * 7 + [256]
        header = b"NSRLMT5\n" + struct.pack("<5I", 256, 1, 1, 1, 1)
        header += struct.pack("<10Q", *counts) + bytes(64)
        embedding = struct.pack("<256h", *([32767] * 256))
        artifact = header + embedding + bytes(2 + 7 + 256)
        logits, shape = constant_model_logits(artifact)
        self.assertEqual(logits, [0] * 256)
        self.assertTrue(shape["context_independent_for_every_input"])
        for offset in [172, 172 + len(embedding), 172 + len(embedding) + 2]:
            changed = bytearray(artifact)
            changed[offset] ^= 1
            with self.assertRaises(ValueError):
                constant_model_logits(changed)
        with self.assertRaises(ValueError):
            constant_model_logits(artifact + b"\0")

    def test_program_replay_uses_exact_fractions(self):
        self.assertEqual(execute_gold_program("subtract(1.24, 0.78), divide(#0, 0.78)"), Fraction(23, 39))
        self.assertEqual(execute_gold_program("multiply(0.1, const_100), add(#0, 0.2)"), Fraction(51, 5))
        for program in ["", "eval(1, 2)", "divide(1, 0)", "add(#0, 1)",
                        "add(1, 2); print(1)", "add(1, 2) trailing", "add(1, 2, 3)"]:
            with self.assertRaises(ValueError):
                execute_gold_program(program)

    def test_label_audit_preserves_precision_and_identity(self):
        inputs = [{"id": "A", "answer": ""}, {"id": "B", "answer": "3"}]
        original = [{"id": "A", "qa": {"answer": "", "exe_ans": 0.33333, "program": "divide(1, 3)"}},
                    {"id": "B", "qa": {"answer": "3"}}]
        rows = missing_labels(inputs, original)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["replayed_rational"], "1/3")
        self.assertTrue(rows[0]["agrees_at_source_precision"])
        original[0]["qa"]["exe_ans"] = 0.33332
        self.assertFalse(missing_labels(inputs, original)[0]["agrees_at_source_precision"])
        for changed in [original[:1], original + [original[0]],
                        [{"id": "A", "qa": {"answer": "changed"}}, original[1]]]:
            with self.assertRaises(ValueError):
                missing_labels(inputs, changed)


if __name__ == "__main__":
    unittest.main()
