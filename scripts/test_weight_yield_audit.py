"""Invented traces test query yield and corpus accounting independently of an oracle."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from weight_yield_audit import audit, stratum


def query(sequence, target, value, desired='1', slice_id='training'):
    return {'sequence': sequence, 'dispatch_sequence': sequence, 'phase': 'workload',
            'slice_id': slice_id, 'status': 'ok', 'canonical_type': 'A1',
            'highest_weight': [4], 'target_weight': [target], 'target_status': 'dominant',
            'multiplicity': value, 'desired_stratum': desired,
            'disposition': 'pilot_observation' if slice_id.startswith('pilot:') else
                           'candidate_for_selection' if stratum(value) == desired else 'stratum_mismatch'}


def record(target=4):
    return {'canonical_type': 'A1', 'highest_weight': [4], 'target_weight': [target],
            'multiplicity': '1', 'multiplicity_stratum': '1', 'target_status': 'dominant',
            'partition': 'training'}


class AuditTests(unittest.TestCase):
    def run_audit(self, trace, corpus=None, **options):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            raw = b''.join((json.dumps(r) + '\n').encode() for r in trace)
            (root/'trace').write_bytes(raw)
            (root/'corpus').write_text(''.join(json.dumps(r)+'\n' for r in (corpus if corpus is not None else [record()])))
            return audit(root/'trace', root/'corpus', options.pop('expected', hashlib.sha256(raw).hexdigest()),
                         max_calls=options.pop('max_calls', 100), **options)

    def test_rejected_repeats_and_selection_are_separate(self):
        trace = [query(1, 9, '0'), query(2, 9, '0'), query(3, 4, '1'), query(4, 5, '1')]
        result = self.run_audit(trace, block_calls=2)
        self.assertEqual((result['generation_calls'], result['unique_generation_queries'],
                          result['repeated_generation_mismatch_calls'], result['generation_matching_calls'],
                          result['corpus_records']), (4, 3, 1, 2, 1))
        self.assertEqual([b['corpus_records'] for b in result['generation_blocks']], [0, 1])
        self.assertEqual(result['new_oracle_calls'], 0)

    def test_pilot_replacement_hits_exceed_unique_hits(self):
        trace = [query(1, 4, '1', slice_id='pilot:training|1|dominant'),
                 query(2, 4, '1', slice_id='pilot:training|1|dominant'), query(3, 4, '1')]
        result = self.run_audit(trace)
        pilot = next(g for g in result['groups'] if g['slice_id'].startswith('pilot:'))
        self.assertEqual((pilot['matching_calls'], pilot['unique_matching_queries']), (2, 1))
        self.assertEqual(result['repeated_generation_calls'], 0)

    def test_query_reused_under_another_requested_stratum(self):
        result = self.run_audit([query(1, 4, '1', '2-7'), query(2, 4, '1')])
        self.assertEqual(result['repeated_generation_calls'], 1)
        self.assertEqual(result['repeated_generation_mismatch_calls'], 0)
        self.assertEqual(result['corpus_records'], 1)

    def test_completion_order_can_differ_from_dispatch_order(self):
        trace = [query(1, 9, '0'), query(2, 4, '1')]
        trace[0]['dispatch_sequence'], trace[1]['dispatch_sequence'] = 2, 1
        self.assertEqual(self.run_audit(trace)['trace_calls'], 2)

    def test_large_exact_labels_and_boundaries(self):
        self.assertEqual([stratum(v) for v in ['0','1','2','7','8','9','10','31','32','1000000000000000000000001']],
                         ['0','1','2-7','2-7','8-31','8-31','8-31','8-31','>31','>31'])
        self.assertEqual(self.run_audit([query(1, 9, '1000000000000000000000001')], [])['generation_matching_calls'], 0)
        for value in ['-1', '01', '1.0', None, True]:
            with self.assertRaises(ValueError): stratum(value)

    def test_hash_and_sequence_tampering(self):
        with self.assertRaisesRegex(ValueError, 'hash differs'):
            self.run_audit([query(1, 4, '1')], expected='0'*64)
        with self.assertRaisesRegex(ValueError, 'sequence differs'):
            self.run_audit([query(2, 4, '1')])

    def test_dispatch_repeats_and_gaps(self):
        for dispatch in (1, 3):
            trace = [query(1, 9, '0'), query(2, 4, '1')]
            trace[1]['dispatch_sequence'] = dispatch
            with self.assertRaisesRegex(ValueError, 'dispatch'):
                self.run_audit(trace)

    def test_conflicting_oracle_values(self):
        with self.assertRaisesRegex(ValueError, 'conflicting labels'):
            self.run_audit([query(1, 9, '0'), query(2, 9, '1')], [])

    def test_missing_duplicate_and_mislabeled_corpus_rows(self):
        with self.assertRaisesRegex(ValueError, 'missing'):
            self.run_audit([query(1, 9, '0')])
        with self.assertRaisesRegex(ValueError, 'duplicate corpus'):
            self.run_audit([query(1, 4, '1')], [record(), record()])
        bad = record(); bad['multiplicity_stratum'] = '0'
        with self.assertRaisesRegex(ValueError, 'corpus label'):
            self.run_audit([query(1, 4, '1')], [bad])
        with self.assertRaisesRegex(ValueError, 'appears twice'):
            self.run_audit([query(1, 4, '1'), query(2, 4, '1')])

    def test_trace_disposition_must_match_exact_value(self):
        bad = query(1, 4, '1'); bad['disposition'] = 'stratum_mismatch'
        with self.assertRaisesRegex(ValueError, 'disposition'):
            self.run_audit([bad])

    def test_bounds_stop_before_growth(self):
        trace = [query(1, 9, '0'), query(2, 4, '1')]
        for options, error in [({'max_calls': 1}, 'call bound'), ({'max_unique': 1}, 'unique bound'),
                               ({'max_group_keys': 1}, 'group unique bound')]:
            with self.assertRaisesRegex(ValueError, error):
                self.run_audit(trace, **options)

    def test_warmup_and_workload_accounting(self):
        warmup = query(1, 4, '1', slice_id='setup:warmup')
        warmup.update(phase='setup', desired_stratum=None, disposition='warmup')
        result = self.run_audit([warmup, query(2, 4, '1')])
        self.assertEqual(result['phase_calls'], {'setup': 1, 'workload': 1})
        self.assertEqual(result['generation_calls'], 1)

    def test_incomplete_and_oversized_lines(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); (root/'corpus').write_bytes(b'')
            for raw in (b'{}', b' '*65537+b'\n'):
                (root/'trace').write_bytes(raw)
                with self.assertRaisesRegex(ValueError, 'oversized or incomplete'):
                    audit(root/'trace', root/'corpus', hashlib.sha256(raw).hexdigest())


if __name__ == '__main__':
    unittest.main()
