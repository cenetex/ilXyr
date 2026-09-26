"""Check the fixed pilot host archive, launch binding and collection limits."""
import json
import os
import subprocess
import sys
import time
from pathlib import Path
import tempfile
import unittest

from package_weight_pilot_cloud import PLAN, SOURCES, encode, inspect, sha
from weight_pilot_cloud_launch import render
from weight_pilot_cloud_preflight import lifecycle_rules
from test_feral_bootstrap import STUB, write_tar

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
            self.assertEqual(plan['budget']['maximum_before_tax_usd'], '1.85')
            self.assertEqual(plan['limits']['max_instance_seconds'], 5400)

    def test_packaged_host_reaches_controller_and_collects(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            package, plan = fixture(folder)
            pilot_plan = b'{}\n'
            base_files = {'scripts/feral_process.py': b'def save(): pass\n'}
            base_files['KIT.json'] = encode({'files': {
                name: {'bytes': len(raw), 'sha256': sha(raw)} for name, raw in base_files.items()}})
            base_path = folder / 'base.tar'
            write_tar(base_path, base_files)
            controller = (b'from feral_process import save\n'
                          b'import json\n'
                          b'print(json.dumps({"base_import_verified": True, "oracle_starts": 0}))\n')
            pilot_files = {'SOURCE-KIT.tar': base_path.read_bytes(),
                           'scripts/weight_pilot_controller.py': controller,
                           'experiments/research-step-56/PILOT-PLAN.json': pilot_plan}
            pilot_files['PILOT-KIT.json'] = encode({'files': {
                name: {'bytes': len(raw), 'sha256': sha(raw)} for name, raw in pilot_files.items()}})
            pilot_path = folder / 'pilot.tar'
            write_tar(pilot_path, pilot_files)
            plan['pilot_sha256'] = sha(pilot_path.read_bytes())
            plan['pilot_bytes'] = pilot_path.stat().st_size
            plan['pilot_plan_sha256'] = sha(pilot_plan)
            files = {name: (ROOT / name).read_bytes() for name in SOURCES}
            files[PLAN] = encode(plan)
            files['pilot.tar'] = pilot_path.read_bytes()
            files['HOST.json'] = encode({'plan_sha256': sha(files[PLAN]), 'files': {
                name: {'bytes': len(raw), 'sha256': sha(raw)} for name, raw in files.items()}})
            package.unlink()
            write_tar(package, files)
            binding = {'run_id': 'weight-pilot-56-20260926T000000Z',
                       'launch_epoch_seconds': int(time.time()),
                       'package_version': 'fixture-version', 'approval_reference': 'fixture-approval'}
            network = {name: plan['provider'][name] for name in ['subnet_id', 'security_group_id']}
            script, _, _ = render(package, sha(package.read_bytes()), binding, network)
            user_data = folder / 'user-data.sh'
            user_data.write_bytes(script)
            binary = folder / 'bin'
            binary.mkdir()
            stub = STUB.replace("'g6e.2xlarge'", "'c6i.4xlarge'")
            for name in ['aws', 'curl', 'docker', 'systemd-run', 'systemctl', 'shutdown', 'timeout']:
                path = binary / name
                path.write_text('#!' + sys.executable + '\n' + stub)
                path.chmod(0o755)
            env = {**os.environ, 'PATH': str(binary) + os.pathsep + os.environ['PATH'],
                   'FERAL_TEST_LOG': str(folder / 'calls.jsonl'),
                   'FERAL_TEST_PACKAGE': str(package),
                   'FERAL_TEST_S3': str(folder / 's3'),
                   'W_WORK_ROOT': str(folder / 'work'),
                   'W_USER_DATA_FILE': str(user_data)}
            process = subprocess.run(['bash', str(user_data)], env=env, capture_output=True, text=True, timeout=30)
            log = (folder / 'work/bootstrap.log').read_text()
            self.assertEqual(process.returncode, 0, process.stderr + process.stdout + log)
            calls = [json.loads(line) for line in (folder / 'calls.jsonl').read_text().splitlines()]
            self.assertEqual(calls[0]['name'], 'systemd-run')
            self.assertEqual(calls[-1]['name'], 'shutdown')
            self.assertTrue(any(call['name'] == 'docker' and call['args'][0] == 'run' for call in calls))
            terminal = json.loads((folder / 'work/host-terminal.json').read_text())
            self.assertEqual(terminal['status'], 'complete')
            self.assertTrue(terminal['collection_complete'])
            preparation = json.loads((folder / 'work/output/prepare.json').read_text())
            self.assertTrue(preparation['base_import_verified'])
            self.assertEqual(preparation['oracle_starts'], 0)
            self.assertTrue((folder / 'work/package/pilot/scripts/feral_process.py').is_file())

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
