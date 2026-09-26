"""Check the fixed pilot host archive, launch binding and collection limits."""
import json
from pathlib import Path
import tempfile
import unittest

from package_weight_pilot_cloud import PLAN, SOURCES, encode, inspect, sha
from weight_pilot_cloud_launch import render
from weight_pilot_cloud_preflight import lifecycle_rules
from test_feral_bootstrap import write_tar

ROOT = Path(__file__).resolve().parents[1]


def fixture(folder):
    plan = json.loads((ROOT / PLAN).read_bytes())
    files = {name: (ROOT / name).read_bytes() for name in SOURCES}
    pilot = b'controlled pilot source archive'
    plan['pilot_sha256'] = sha(pilot)
    plan['pilot_bytes'] = len(pilot)
    files[PLAN] = encode(plan)
    files['pilot.tar'] = pilot
    files['HOST.json'] = encode({
        'schema': 'ilxyr.weight_pilot_host_package.v1',
        'source_commit': 'a' * 40,
        'plan_sha256': sha(files[PLAN]),
        'files': {name: {'bytes': len(raw), 'sha256': sha(raw)} for name, raw in files.items()},
    })
    package = folder / 'host.tar'
    write_tar(package, files)
    return package, plan


class HostPackageTests(unittest.TestCase):
    def test_render_binds_pilot_and_budget(self):
        with tempfile.TemporaryDirectory() as temp:
            package, plan = fixture(Path(temp))
            digest = sha(package.read_bytes())
            binding = {'run_id': 'weight-pilot-56-20260926T000000Z', 'launch_epoch_seconds': 1790460000,
                       'package_version': 'fixed-version', 'approval_reference': 'fixed-approval'}
            network = {name: plan['provider'][name] for name in ['subnet_id', 'security_group_id']}
            script, request, manifest = render(package, digest, binding, network)
            self.assertEqual(manifest['plan_sha256'], sha(encode(plan)))
            self.assertIn(('W_PILOT_SHA=' + plan['pilot_sha256']).encode(), script)
            self.assertIn(b'# WEIGHT_PILOT_56_BODY', script)
            self.assertIn(b'systemd-run --unit=weight-pilot-56-deadline', script)
            self.assertEqual(request['BlockDeviceMappings'][0]['Ebs']['VolumeSize'], 80)
            self.assertEqual(request['InstanceType'], 'c6i.4xlarge')
            self.assertTrue(request['DryRun'])
            self.assertEqual(plan['budget']['maximum_before_tax_usd'], '2.00')
            self.assertEqual(plan['limits']['max_instance_seconds'], 5400)

    def test_archive_integrity_and_fresh_namespace(self):
        with tempfile.TemporaryDirectory() as temp:
            package, plan = fixture(Path(temp))
            digest = sha(package.read_bytes())
            self.assertEqual(inspect(package, digest)[2]['pilot_sha256'], plan['pilot_sha256'])
            with self.assertRaisesRegex(ValueError, 'digest differs'):
                inspect(package, '0' * 64)
            rules = lifecycle_rules(plan)
            self.assertEqual(len(rules), 4)
            self.assertEqual({rule['Filter']['Prefix'] for rule in rules},
                             {plan['storage']['package_prefix'], plan['storage']['result_prefix']})
            self.assertTrue(all(rule['Status'] == 'Enabled' for rule in rules))


if __name__ == '__main__':
    unittest.main()
