"""Focused checks for the Reasoner role audit capture and split firewall."""
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import zipfile

import numpy as np

from reasoner4_representation_audit import DIMENSION, REVISION, ROLES, capture, verify_firewall
from reasoner4_role_probe import features, header_features, labels, select_penalty, swap_consistency
from reasoner4_cloud_launch import BODY, request, retention_rules
from reasoner4_package import install_wheel

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'experiments/reasoner4-representation-audit/v1'


class Reasoner4AuditTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fit, cls.held, cls.scrambled = [json.loads((DATA / name).read_bytes())
                                        for name in ('fit.json', 'held.json', 'scrambled.json')]

    def test_split_firewall_and_roles(self):
        verify_firewall(self.fit, self.held, self.scrambled)
        self.assertEqual({item['source_revision'] for item in (self.fit, self.held)}, {REVISION})
        self.assertEqual(set(ROLES), {row['label'] for row in self.fit['rows']})
        self.assertEqual(set(ROLES), {row['label'] for row in self.held['rows']})
        self.assertEqual({row['surface_template'] for row in self.held['rows']},
                         {'held-four-column-v2', 'held-bracket-arrow-v1'})

    def test_capture_excludes_label_and_template(self):
        row = self.held['rows'][0]
        altered = copy.deepcopy(row)
        altered['label'] = 'wrong label'
        altered['family'] = 'other family'
        altered['surface_template'] = 'other template'
        self.assertEqual(capture(row), capture(altered))
        self.assertEqual(len(capture(row)), DIMENSION)

    def test_header_only_reads_symbol(self):
        rows = self.fit['rows'][:2]
        self.assertFalse(np.array_equal(header_features(rows)[0], header_features(rows)[1]))
        self.assertFalse(np.array_equal(header_features(rows), features(rows)))

    def test_fit_selection_is_held_out_blind(self):
        fit_x, fit_y = features(self.fit['rows']), labels(self.fit['rows'])
        first = select_penalty(fit_x, fit_y, self.fit['rows'], 3)
        altered = copy.deepcopy(self.held)
        for row in altered['rows']:
            row['label'] = 'candidate'
        self.assertEqual(first, select_penalty(fit_x, fit_y, self.fit['rows'], 3))
        self.assertNotEqual([r['label'] for r in self.held['rows']],
                            [r['label'] for r in altered['rows']])

    def test_swap_metric_rejects_constant_predictions(self):
        constant = np.zeros(len(self.held['rows']), dtype=int)
        self.assertAlmostEqual(swap_consistency(self.held['rows'], constant), 1 / len(ROLES))

    def test_frozen_bindings_match_files(self):
        audit = json.loads((ROOT / 'examples/diagnostics/reasoner-4-representation-audit.json').read_bytes())
        self.assertEqual(audit['state'], 'frozen')
        self.assertEqual(audit['unresolved'], [])
        def sha(path):
            return hashlib.sha256(path.read_bytes()).hexdigest()
        self.assertEqual(audit['execution_profile_sha256'],
                         sha(DATA.parent / 'EXECUTION-PROFILE.json'))
        self.assertEqual(audit['capture']['implementation_sha256'], sha(DATA / 'bindings.json'))
        self.assertEqual(audit['probe']['implementation_sha256'],
                         sha(ROOT / 'scripts/reasoner4_role_probe.py'))
        self.assertEqual(audit['representations'][0]['artifact_sha256'], sha(DATA / 'states.json'))
        self.assertEqual(audit['inputs']['fit_split']['sha256'], sha(DATA / 'fit.json'))
        self.assertEqual(audit['inputs']['evaluation_splits'][0]['sha256'], sha(DATA / 'held.json'))
        self.assertEqual(audit['inputs']['evaluation_splits'][1]['sha256'], sha(DATA / 'scrambled.json'))

    def test_cloud_request_keeps_fixed_limits(self):
        record = json.loads((DATA.parent / 'PACKAGE.json').read_bytes())
        binding = {'archive_sha256': record['archive_sha256'],
                   'bucket': 'ilxyr-feral-7b-calibration-022118847419-us-east-1',
                   'key': 'packages/reasoner4-role-audit/' + record['archive_sha256'] + '.tar',
                   'version_id': 'test-version'}
        with patch('reasoner4_cloud_launch.verify', return_value={
                'scripts/aws/reasoner4-role-user-data.sh': BODY.read_bytes()}):
            rendered = request(binding, 'reasoner4-role-audit-20260926T000000Z',
                               1790380800, Path('/tmp/frozen-package.tar'))
        self.assertTrue(rendered['DryRun'])
        self.assertEqual(rendered['InstanceType'], 'c6i.large')
        self.assertEqual(rendered['MetadataOptions']['HttpTokens'], 'required')
        self.assertTrue(rendered['BlockDeviceMappings'][0]['Ebs']['Encrypted'])
        self.assertEqual(rendered['InstanceInitiatedShutdownBehavior'], 'terminate')
        self.assertEqual(len(retention_rules()), 4)

    def test_wheel_extraction_checks_hash_and_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            wheel = root / 'wheel.whl'
            with zipfile.ZipFile(wheel, 'w') as archive:
                archive.writestr('../outside', 'bad')
            correct_hash = hashlib.sha256(wheel.read_bytes()).hexdigest()
            with self.assertRaisesRegex(ValueError, 'digest differs'):
                install_wheel(wheel, root / 'wrong-hash', '0' * 64)
            with self.assertRaisesRegex(ValueError, 'unsafe wheel member'):
                install_wheel(wheel, root / 'unsafe-path', correct_hash)
            self.assertFalse((root / 'outside').exists())


if __name__ == '__main__':
    unittest.main()
