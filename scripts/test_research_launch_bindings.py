"""Check the same run, package and approval rules across five research launchers."""
import contextlib
import importlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

PROJECTS = [
    ('reasoner_study', 'reasoner-46', 5400, '0.30'),
    ('feral_coverage', 'feral-49', 1800, '0.15'),
    ('solomon', 'solomon38', 3600, '0.25'),
    ('weight', 'weight35', 5400, '2.00'),
    ('zero4', 'zero4-45', 48600, '12.00'),
]


def probe(project, change=None, clock=None):
    name, prefix, seconds, cost = project
    module = importlib.import_module(name + '_cloud_launch')
    now = time.time() if clock is None else clock
    package_sha, plan_sha = 'a' * 64, 'b' * 64
    binding = {'run_id': prefix + '-20260912T000000Z', 'launch_epoch_seconds': int(now),
               'package_version': 'fixture-version', 'approval_reference': 'fixture-approval'}
    approval = {'package_sha256': package_sha, 'plan_sha256': plan_sha,
                'maximum_instance_seconds': seconds, 'maximum_before_tax_usd': cost,
                'approval_reference': binding['approval_reference']}
    preflight = {'status': 'passed', 'run_id': binding['run_id'], 'package_sha256': package_sha,
                 'plan_sha256': plan_sha, 'package_version': binding['package_version'], 'checked_epoch': now}
    if change: change(binding, preflight, approval)
    calls = []
    def provider(command, **_):
        calls.append(command)
        if command[1:3] == ['sts', 'get-caller-identity']:
            return subprocess.CompletedProcess(command, 0, '022118847419\n', '')
        if command[1:3] == ['ec2', 'run-instances']:
            return subprocess.CompletedProcess(command, 0, '{"Instances":[{"InstanceId":"i-0123456789abcdef0"}]}', '')
        raise AssertionError('unexpected provider operation')
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        for key, value in [('binding', binding), ('approval', approval), ('preflight', preflight), ('network', {})]:
            (root / (key + '.json')).write_text(json.dumps(value))
        args = ['launch', '--package', str(root / 'fixture.tar'), '--package-sha256', package_sha,
                '--binding', str(root / 'binding.json'), '--network', str(root / 'network.json'),
                '--approval', str(root / 'approval.json'), '--preflight', str(root / 'preflight.json'), '--out', str(root / 'output')]
        error = None
        with patch.object(sys, 'argv', [module.__file__, *args]), \
             patch.object(module, 'render', return_value=(b'controlled bootstrap', {'DryRun': True}, {'plan_sha256': plan_sha})), \
             patch.object(module.time, 'time', return_value=now), \
             patch.object(module.subprocess, 'run', side_effect=provider), contextlib.redirect_stdout(io.StringIO()):
            try: module.main()
            except ValueError as caught: error = str(caught)
        receipt = json.loads((root / 'output/receipt.json').read_bytes()) if (root / 'output/receipt.json').exists() else None
    return {'error': error, 'provider_calls': len(calls), 'provider_operations': [v[1:3] for v in calls],
            'submitted_paid_request': any('--cli-input-json' in v and json.loads(v[v.index('--cli-input-json') + 1])['DryRun'] is False for v in calls),
            'receipt': receipt, 'actual_instances_created': 0}


class RunBindings(unittest.TestCase):
    def test_matching_run_permits_one_controlled_dispatch(self):
        for project in PROJECTS:
            with self.subTest(project=project[0]):
                result = probe(project)
                self.assertIsNone(result['error'])
                self.assertEqual(result['provider_operations'], [['sts', 'get-caller-identity'], ['ec2', 'run-instances']])
                self.assertEqual(result['receipt']['status'], 'launched')
                self.assertTrue(result['submitted_paid_request'])

    def assert_rejected(self, change, message):
        for project in PROJECTS:
            with self.subTest(project=project[0]):
                result = probe(project, change)
                self.assertEqual(result['error'], message)
                self.assertEqual(result['provider_calls'], 0)
                self.assertIsNone(result['receipt'])

    def test_changed_run_stops_before_provider_access(self):
        self.assert_rejected(lambda _, p, a: p.update(run_id='different-run'), 'fresh successful preflight required')

    def test_missing_run_stops_before_provider_access(self):
        self.assert_rejected(lambda _, p, a: p.pop('run_id'), 'fresh successful preflight required')

    def test_other_package_or_version_stops_before_provider_access(self):
        for key in ['package_sha256', 'plan_sha256', 'package_version']:
            with self.subTest(key=key):
                self.assert_rejected(lambda _, p, a: p.update({key: 'different'}), 'fresh successful preflight required')

    def test_old_or_future_preflight_stops_before_provider_access(self):
        for delta in [-3601, 1]:
            with self.subTest(delta=delta):
                self.assert_rejected(lambda _, p, a: p.update(checked_epoch=p['checked_epoch'] + delta), 'fresh successful preflight required')

    def test_preflight_keeps_run_identity_after_a_provider_failure(self):
        for project in PROJECTS:
            with self.subTest(project=project[0]), tempfile.TemporaryDirectory() as directory:
                module = importlib.import_module(project[0] + '_cloud_preflight')
                root = Path(directory); binding = {'run_id': project[1] + '-20260912T000000Z', 'package_version': 'fixture-version'}
                with patch.object(module, 'inspect', return_value=({}, {'plan_sha256': 'b' * 64}, {'provider': {'region': 'us-east-1'}, 'storage': {}})), \
                     patch.object(module.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, '', 'controlled identity failure')):
                    with self.assertRaisesRegex(RuntimeError, 'controlled identity failure'):
                        module.preflight(root / 'fixture.tar', 'a' * 64, binding, root / 'output', 'fixture')
                receipt = json.loads((root / 'output/receipt.json').read_bytes())
                self.assertEqual(receipt['run_id'], binding['run_id'])
                self.assertEqual(receipt['status'], 'failed')
                self.assertEqual(receipt['instances_created'], 0)

    def test_other_budget_stops_before_provider_access(self):
        self.assert_rejected(lambda _, p, a: a.update(maximum_before_tax_usd='999.00'), 'approval differs')


if __name__ == '__main__':
    unittest.main()
