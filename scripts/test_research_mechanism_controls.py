import copy
import unittest

from research_mechanism_controls import paired_families, projection_audit


def row(episode, checks):
    return {"episode": episode, "verifier_checks": checks, "exact": True,
            "certificate_valid": True, "injected_invalid_rejected": True,
            "accepted_semantic_sha256": "a" * 64}


class MechanismTests(unittest.TestCase):
    def test_pairing_uses_episode_identity_and_equal_family_weights(self):
        candidate = [row(i, 1 if i < 4 else 7) for i in range(8)]
        baseline = [row(i, 3) for i in range(8)]
        cost = {i: {"cpu_ns": 10, "wall_ns": 20} for i in range(8)}
        result = paired_families(list(reversed(candidate)), baseline, (cost, cost), 2)
        self.assertEqual(result[0]["checks"], 0.5)
        self.assertEqual(result[1]["checks"], 2)
        self.assertEqual(result[0]["cpu"], 1)

    def test_partial_duplicate_or_inexact_pairs_are_rejected(self):
        candidate = [row(i, 1) for i in range(4)]
        cost = {i: {"cpu_ns": 10, "wall_ns": 20} for i in range(4)}
        altered = copy.deepcopy(candidate)
        altered[0]["accepted_semantic_sha256"] = "b" * 64
        inexact = copy.deepcopy(candidate)
        inexact[0]["exact"] = False
        for baseline in [candidate[:3], candidate + candidate[:1], altered, inexact]:
            with self.assertRaises(ValueError):
                paired_families(candidate, baseline, (cost, cost), 1)

    def test_zero_time_cannot_create_a_speed_claim(self):
        rows = [row(i, 1) for i in range(4)]
        cost = {i: {"cpu_ns": 0, "wall_ns": 20} for i in range(4)}
        with self.assertRaises(ValueError):
            paired_families(rows, rows, (cost, cost), 1)

    def test_rejected_projection_trials_keep_their_cost(self):
        def trial(projected):
            return {"projection_applied": projected, "projection_removed_fraction": 0.25 if projected else 0,
                    "ranges": [0, 1, 2, 3, 4, 5]}
        attempts = [
            {"attempt": 1, "decision": "accept", "projection_applied": True, "accepted_scale": 1,
             "backtrack_trial_count": 1, "backtrack_trials": [trial(True)]},
            {"attempt": 2, "decision": "reject", "projection_applied": False, "accepted_scale": 0,
             "backtrack_trial_count": 2, "backtrack_trials": [trial(True), trial(False)]},
        ]
        diagnostics = {"trialEvaluations": 3, "projectedTrials": 2, "unprojectedTrials": 1,
                       "projectedAccepted": 1, "fullScaleAccepted": 1, "backtrackedAccepted": 0,
                       "exhausted": 1, "maxProjectionRemovedFraction": 0.25, "meanProjectionRemovedFraction": 0.25}
        result = projection_audit(attempts, diagnostics)
        self.assertEqual(result["attempts"], 2)
        self.assertEqual(result["accepted"], 1)
        self.assertEqual(result["direct_replay_trial_evaluations"], 18)
        self.assertEqual(result["fraction_of_trials_projected"], 2 / 3)
        with self.assertRaises(ValueError):
            projection_audit(attempts, {**diagnostics, "trialEvaluations": 1})
        attempts[1]["attempt"] = 3
        with self.assertRaises(ValueError):
            projection_audit(attempts, diagnostics)


if __name__ == "__main__":
    unittest.main()
