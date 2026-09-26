"""Focused SPO mechanics and failure-accounting tests."""

import math
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from spo_pilot import (BetaTracker, accept_rollouts, clipped_objective, discount,
                       global_advantages, kl_divergence, prompt_weight, readiness,
                       replay)


class PilotTest(unittest.TestCase):
    def test_pre_update_baseline_and_kl_discount(self):
        tracker = BetaTracker([1] * 4 + [0] * 4, [0.5, 0.5])
        first = tracker.observe(1, [0.5, 0.5], 0.1)
        self.assertEqual(first["pre_update_baseline"], 0.5)
        self.assertEqual(first["advantage"], 0.5)
        self.assertEqual(first["rho"], 0.96)
        self.assertAlmostEqual(first["post_update_baseline"], 4.84 / 8.68)
        second = tracker.observe(0, [0.9, 0.1], 0.1)
        self.assertAlmostEqual(second["pre_update_baseline"], first["post_update_baseline"])
        self.assertEqual(second["rho"], 0.875)
        self.assertLess(second["post_update_baseline"], first["post_update_baseline"])
        self.assertGreater(kl_divergence([0.5, 0.5], [0.9, 0.1]), 0)
        self.assertEqual(discount(math.inf, 0.1), 0.875)

    def test_global_normalization_clipping_and_weights(self):
        normalized = global_advantages([-0.5, 0.5])
        self.assertEqual(normalized, [-1, 1])
        self.assertEqual(global_advantages([0.0, 0.0]), [0.0, 0.0])
        self.assertEqual(clipped_objective(2, 1), 1.28)
        self.assertEqual(clipped_objective(0.1, -1), -0.8)
        self.assertEqual(prompt_weight(0), 0.05)
        self.assertEqual(prompt_weight(0.5), 0.55)

    def test_failed_rejected_and_warm_start_cost(self):
        stream = {"kl_half_life": 0.1, "prompts": [
            {"id": "real-source-choice", "warm_rewards": [0, 1] * 4,
             "initial_policy": [0.5, 0.5]}], "batches": [[
                 {"prompt_id": "real-source-choice", "status": "failed"},
                 {"prompt_id": "real-source-choice", "status": "rejected", "reward": 1},
                 {"prompt_id": "real-source-choice", "status": "accepted",
                  "reward": 1, "resolver_verified": True, "policy": [0.5, 0.5]}]]}
        receipt = replay(stream)
        self.assertEqual(receipt["cost_rollouts"],
                         {"warm_start": 8, "attempted": 3, "accepted": 1,
                          "failed": 1, "rejected": 1})
        self.assertEqual(receipt["batches"][0]["observations"][0]["normalized_advantage"], 0)
        with self.assertRaisesRegex(ValueError, "verified binary reward"):
            accept_rollouts([{"status": "accepted", "reward": 1}])

    def test_readiness_requires_all_real_gates(self):
        receipt = readiness({"training_prompts": 36, "learned_candidate": True})
        self.assertEqual(receipt["decision"], "no_go")
        self.assertEqual(receipt["minimum_warm_start_rollouts"], 288)
        self.assertEqual(readiness({key: True for key in receipt["gates"]})["decision"], "ready")


if __name__ == "__main__":
    unittest.main()
