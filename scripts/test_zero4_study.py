"""Small checks for the outcome rule and selection boundary."""
import copy
import math
import unittest

import zero4_study as study
import zero4_study_scores as scores


def endpoint(losses, artifacts=0, blimp=2, tiny=4):
    return {'retention_rows': [{'range': i, 'loss': loss} for i, loss in enumerate(losses)],
            'task_rows': [{'exact_artifact': int(i < artifacts)} for i in range(5)],
            'blimp_rows': [{'raw_prediction': int(i >= blimp), 'gold': 0} for i in range(2)],
            'tinystories_rows': [{'scores': [{'bits': tiny * 10, 'bytes': 10}]}] * 2,
            'task': {'cases': 5, 'exact_artifact': artifacts, 'rejected_state_mutations': 0},
            'tinystories': {'bits_per_byte': tiny}}


class StudyTests(unittest.TestCase):
    def setUp(self):
        self.limits = study.plan()['primary']
        self.base = endpoint([4] * 6)

    def test_mean_gain_keeps_source_failure(self):
        candidate = endpoint([3, 3, 3, 3, 3, 4.2], artifacts=5)
        result = scores.compare(candidate, self.base, self.limits)
        self.assertLess(sum(r['loss'] for r in candidate['retention_rows']), 24)
        self.assertFalse(result['retention_passes'])
        self.assertFalse(result['sources'][5]['passes'])

    def test_language_failure_survives_task_gain(self):
        candidate = endpoint([3] * 6, artifacts=5, tiny=4.2)
        rows = {(1, arm): copy.deepcopy(candidate if arm in study.MODES else self.base) for arm in study.ARMS}
        self.assertTrue(scores.compare(candidate, self.base, self.limits)['retention_passes'])
        self.assertTrue(all(not r['passes'] for r in scores.decisions(rows, [1], self.limits)))

    def test_candidate_must_gain_against_plain_replay(self):
        rows = {(1, arm): endpoint([4] * 6, artifacts=5 if arm != 'frozen' else 0) for arm in study.ARMS}
        self.assertTrue(all(not r['passes'] for r in scores.decisions(rows, [1], self.limits)))

    def test_each_seed_must_pass(self):
        rows = {(seed, arm): endpoint([4] * 6, artifacts=5 if arm in study.MODES and seed == 1 else 0)
                for seed in [1, 2] for arm in study.ARMS}
        self.assertTrue(all(not r['passes'] for r in scores.decisions(rows, [1, 2], self.limits)))

    def test_rejected_mutation_blocks_all_candidates(self):
        rows = {(1, arm): endpoint([4] * 6, artifacts=5 if arm in study.MODES else 0) for arm in study.ARMS}
        self.assertTrue(all(r['passes'] for r in scores.decisions(rows, [1], self.limits)))
        rows[1, 'task_only']['task']['rejected_state_mutations'] = 1
        self.assertTrue(all(not r['passes'] for r in scores.decisions(rows, [1], self.limits)))

    def test_budget_crossing_keeps_prior_checkpoint(self):
        candidates = [{'attempts': 0, 'training_cpu_us': 0}, {'attempts': 10, 'training_cpu_us': 90},
                      {'attempts': 20, 'training_cpu_us': 101}]
        self.assertEqual(study.eligible(candidates, 100)['attempts'], 10)
        self.assertEqual(study.eligible(candidates, 90)['attempts'], 10)
        self.assertEqual(study.eligible(candidates, 89)['attempts'], 0)

    def test_one_window_has_unknown_sampling_error(self):
        self.assertIsNone(scores.paired([1])['standard_error'])
        self.assertAlmostEqual(scores.paired([1, 3])['standard_error'], 1)

    def test_false_and_nonfinite_values_are_rejected(self):
        self.assertFalse(scores.finite(True))
        self.assertFalse(scores.finite(float('nan')))
        self.assertFalse(scores.finite(float('inf')))
        self.assertTrue(scores.finite(0))


if __name__ == '__main__':
    unittest.main()
