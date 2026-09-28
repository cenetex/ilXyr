"""Checks that opened-data review catches ambiguous and altered observations."""

import json
import unittest

from reasoner4_data_review import DATA, ROOT, build_review, review_row


class DataReviewTests(unittest.TestCase):
    def row(self, pairs, operation):
        return {'symbol': 'opaque', 'label': 'candidate',
                'demonstrations': [f'opaque {x} {y} {operation(x, y)}'
                                   for x, y in pairs]}

    def test_unique_and_ambiguous_signatures(self):
        pairs = [(-i, i + 1) for i in range(1, 17)]
        unique = review_row(self.row(pairs, lambda x, y: x))
        self.assertEqual(unique['matches'], ['candidate'])
        self.assertGreater(unique['nearest_wrong_role_witnesses'], 0)
        positive = [(i, i + 1) for i in range(1, 17)]
        ambiguous = review_row(self.row(positive, lambda x, y: x))
        self.assertEqual(ambiguous['matches'], ['candidate', 'absolute'])

    def test_changed_output_breaks_declared_role(self):
        pairs = [(-i, i + 1) for i in range(1, 17)]
        row = self.row(pairs, lambda x, y: x)
        row['demonstrations'][0] = 'opaque -1 2 999'
        reviewed = review_row(row)
        self.assertFalse(reviewed['declared_label_matches'])
        self.assertEqual(reviewed['matches'], [])

    def test_committed_review_replays(self):
        saved = ROOT / 'experiments/reasoner4-representation-audit/DATA-REVIEW.json'
        self.assertEqual(build_review(DATA), json.loads(saved.read_bytes()))


if __name__ == '__main__':
    unittest.main()
