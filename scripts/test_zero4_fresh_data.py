"""Regression cases for equivalent tasks, text overlap, and sampler shortages."""
import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

import zero4_fresh_data as z


class FreshDataTests(unittest.TestCase):
    def test_commuted_operands_share_a_key(self):
        self.assertEqual(z.key('quantity.add -3 17'), z.key('quantity.add 17 -3'))
        self.assertEqual(z.key('quantity.multiply -3 17'), z.key('quantity.multiply 17 -3'))
        self.assertNotEqual(z.key('quantity.multiply 1 6'), z.key('quantity.multiply 2 3'))

    def test_reduced_rationals_share_a_key(self):
        self.assertEqual(z.key('quantity.add-rational 2/4 -3/9'), z.key('quantity.add-rational -1/3 1/2'))
        self.assertNotEqual(z.key('quantity.add-rational 1/4 1/4'), z.key('quantity.add-rational 1/3 1/6'))

    def test_scaled_linear_equations_share_a_key(self):
        self.assertEqual(z.key('quantity.solve-linear 2 4 10'), z.key('quantity.solve-linear 1 2 5'))
        self.assertNotEqual(z.key('quantity.solve-linear 1 2 5'), z.key('quantity.solve-linear 1 3 6'))
        with self.assertRaises(ValueError):
            z.key('quantity.solve-linear 0 3 6')

    def test_conversion_units_are_distinct(self):
        self.assertEqual(z.key('quantity.convert 596 kg-to-g'), z.key('quantity.convert 0596 kg-to-g'))
        self.assertNotEqual(z.key('quantity.convert 596 kg-to-g'), z.key('quantity.convert 596 m-to-cm'))

    def test_repeat_audit_keeps_source_identity(self):
        row = {'id': 'same-id', 'request': 'quantity.add 1 2', 'split': 'train'}
        val = {**row, 'request': 'quantity.add 2 1', 'split': 'promotion'}
        audit, _, repeats = z.old_task_audit({'a': [row], 'b': [val]})
        self.assertEqual(audit['cross_split_keys'], 1)
        self.assertEqual(audit['duplicate_rows'], 1)
        self.assertEqual([r['source'] for r in repeats[0]['rows']], ['a', 'b'])

    def test_foundation_has_one_exposed_window(self):
        result = z.retention_coverage([65] * 1406, samples=(1, 2, 8))
        self.assertEqual(result['sampled_starts'], [893])
        self.assertEqual(result['unused_start_positions'], 0)
        self.assertEqual(result['unused_windows_disjoint_from_sampled_tokens'], 0)
        self.assertFalse(result['two_disjoint_native_size_files_possible_by_length'])

    def test_different_offsets_can_share_every_test_window(self):
        result = z.retention_coverage([65] * 65811, samples=4)
        self.assertEqual(result['unused_start_positions'], 2774)
        self.assertEqual(result['unused_windows_disjoint_from_sampled_tokens'], 0)
        with self.assertRaises(ValueError):
            z.retention_coverage([65] * 1025)

    def test_channel_excludes_short_tail(self):
        data = [65] * 6000
        for i in range(30):
            data[200 * i] = 1
        with self.assertRaisesRegex(ValueError, 'validation start count'):
            z.retention_coverage(data, channel=True)
        data.extend([65] * 500)
        result = z.retention_coverage(data, channel=True)
        self.assertEqual(result['possible_validation_starts'], 2)

    def test_window_overlap_survives_case_and_spacing(self):
        text = 'A' * 64 + ' uniquely ending'
        self.assertTrue(z.shingles(text) & z.shingles('prefix ' + text.lower()))
        self.assertEqual(z.text_key(' The\t Cat\n'), 'the cat')

    def test_rejections_and_native_split_are_replayable(self):
        plan = copy.deepcopy(json.loads((z.RECORD / 'PLAN.json').read_text())['task'])
        plan['counts'] = {'train': 95, 'validation': 5, 'promotion': 5}
        first = z.candidate(plan['seed'], 'train', 'add', 0, 0)[1]
        first['id'] = 'opened-exclusion'
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for spec in plan['prior_generators']:
                folder = root / spec['name']
                folder.mkdir()
                z.write_rows(folder / 'quantity-request.jsonl', [first])
            result = z.tasks(plan, root, root / 'one')
            z.tasks(plan, root, root / 'two')
            self.assertEqual(z.files(root / 'one'), z.files(root / 'two'))
            decisions = z.jsonl(root / 'one/decisions.jsonl')
            self.assertEqual(decisions[0]['decision'], 'prior_key')
            self.assertEqual(decisions[0]['attempt'], 0)
            self.assertEqual(result['accepted'], 105)
            raw = (root / 'one/quantity-request.tok').read_bytes()
            tokens = list(z.struct.unpack('<' + 'H' * (len(raw) // 2), raw))
            self.assertEqual(tokens.count(1), 100)
            self.assertEqual(tokens.count(1) * 95 // 100, 95)

    @unittest.skipUnless(os.environ.get('ZERO4_SOURCE'), 'set ZERO4_SOURCE for pinned native oracle checks')
    def test_native_gold_and_tampered_rows(self):
        source = Path(os.environ['ZERO4_SOURCE'])
        binding = json.loads((z.RECORD / 'SOURCE-FILES.json').read_text())
        for name in ['quantity_oracle.c', 'quantity_oracle.h']:
            self.assertEqual(z.digest(source / name), binding['files'][name]['sha256'])
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            exe = root / 'oracle'
            subprocess.run(['cc', '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-I', str(source),
                            str(z.ROOT / 'scripts/zero4_native_gold.c'), str(source / 'quantity_oracle.c'), '-o', str(exe)], check=True, timeout=60)
            plan = json.loads((z.RECORD / 'PLAN.json').read_text())['task']
            rows = [z.candidate('opened-unit', 'train', op, i, 0)[1] for i in range(40) for op in plan['operations']]
            # Exact integer-valued rational sums exposed the first preparation error.
            rows.append({'id': 'opened-integer-rational', 'domain': 'quantity', 'previous_summary': rows[0]['previous_summary'],
                         'input': 'add-rational 2/4 1/2', 'model_request': 'quantity.add-rational',
                         'request': 'quantity.add-rational 2/4 1/2', 'artifact': 'result 1', 'summary': 'kernel committed result 1'})
            file = root / 'gold.tsv'
            z.tsv(file, rows)
            completed = subprocess.run([str(exe), str(file)], capture_output=True, text=True, timeout=30, check=True)
            self.assertEqual(json.loads(completed.stdout)['native_gold_rows'], 201)
            for field, value in [('artifact', 'result 1/1'), ('request', 'quantity.add 2 3'), ('model_request', 'quantity.multiply')]:
                altered = copy.deepcopy(rows[-1])
                altered[field] = value
                z.tsv(file, [altered])
                failed = subprocess.run([str(exe), str(file)], capture_output=True, timeout=30)
                self.assertEqual(failed.returncode, 4)


if __name__ == '__main__':
    unittest.main()
