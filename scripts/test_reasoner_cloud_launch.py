"""Exercise the host lifecycle and one-attempt launcher with controlled cloud tools."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

from package_reasoner_cloud import encode, sha
from reasoner_cloud_launch import render
from test_feral_bootstrap import STUB, write_tar

ROOT = Path(__file__).resolve().parents[1]
BODY = 'scripts/aws/reasoner55-user-data.sh'
NETWORK = {'subnet_id': 'subnet-abc', 'security_group_id': 'sg-abc'}
# Keep the shared cloud failure behavior; use Reasoner's CPU shape and result tree.
CPU_STUB = STUB.replace("'g6e.2xlarge'", "'c6i.xlarge'").replace(
    'run/model/weight.bin', 'source/weight.bin').replace(
    'run/source/grader/targets.jsonl', 'source/targets.jsonl').replace(
    'run/arms/base/predictions.jsonl', 'study/predictions.jsonl').replace(
    'run/execution.json', 'terminal.json')


def fixture(root):
    source = root / 'source.tar'
    write_tar(source, {'SOURCE-IDENTITY.json': b'{"files":{}}\n'})
    plan = json.loads((ROOT / 'experiments/research-step-23/EXECUTION-PLAN.json').read_bytes())
    plan['source_archive_sha256'] = sha(source.read_bytes())
    plan['source_archive_bytes'] = source.stat().st_size
    files = {'EXECUTION-PLAN.json': encode(plan), 'source.tar': source.read_bytes(),
             BODY: (ROOT / BODY).read_bytes(), 'scripts/run_reasoner_cloud.mjs': b'// controlled worker\n'}
    manifest = {'plan_sha256': sha(files['EXECUTION-PLAN.json']),
                'files': {n: {'bytes': len(raw), 'sha256': sha(raw)} for n, raw in files.items()}}
    files['PACKAGE.json'] = encode(manifest)
    package = root / 'package.tar'; write_tar(package, files)
    binding = {'run_id': 'reasoner55-20260908T000000Z', 'launch_epoch_seconds': int(time.time()),
               'package_version': 'fixture-version', 'approval_reference': 'fixture-approval'}
    return package, binding, manifest


def stub_environment(root, package, failure=''):
    bin_dir = root / 'bin'; bin_dir.mkdir()
    for name in ['aws', 'curl', 'docker', 'systemd-run', 'systemctl', 'shutdown', 'timeout']:
        path = bin_dir / name; path.write_text('#!' + sys.executable + '\n' + CPU_STUB); path.chmod(0o755)
    return {**os.environ, 'PATH': str(bin_dir) + os.pathsep + os.environ['PATH'],
            'FERAL_TEST_LOG': str(root / 'calls.jsonl'), 'FERAL_TEST_PACKAGE': str(package),
            'FERAL_TEST_S3': str(root / 's3'), 'FERAL_TEST_FAILURE': failure}


def host(root, failure='', expired=False, tamper=False):
    package, binding, _ = fixture(root)
    if expired: binding['launch_epoch_seconds'] -= 4000
    script, _, _ = render(package, sha(package.read_bytes()), binding, NETWORK)
    path = root / 'user-data.sh'; path.write_bytes(script + (b':\n' if tamper else b''))
    env = stub_environment(root, package, failure)
    env.update(R_WORK_ROOT=str(root / 'work'), R_USER_DATA_FILE=str(path))
    result = subprocess.run(['bash', str(path)], env=env, capture_output=True, text=True, timeout=20)
    calls = [json.loads(line) for line in (root / 'calls.jsonl').read_text().splitlines()]
    terminal = root / 'work/host-terminal.json'
    return result, calls, json.loads(terminal.read_bytes()) if terminal.exists() else None, binding


class HostTests(unittest.TestCase):
    def test_success_collects_study_rows_and_uses_fixed_cpu_limits(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name); result, calls, status, binding = host(root)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(status['status'], 'complete')
            self.assertTrue(status['collection_complete'])
            self.assertEqual(status['user_data_sha256'], sha((root / 'user-data.sh').read_bytes()))
            self.assertEqual(calls[0]['name'], 'systemd-run')
            seconds = int(next(v.split('=', 1)[1] for v in calls[0]['args'] if v.startswith('--on-active=')))
            self.assertTrue(3500 <= seconds <= 3570)
            self.assertEqual(calls[-1]['name'], 'shutdown')
            outputs = root / 's3/runs' / binding['run_id'] / 'results'
            self.assertEqual((outputs / 'study/predictions.jsonl').read_bytes(), b'{"id":"fixture"}\n')
            self.assertFalse((outputs / 'source').exists())
            docker = next(c['args'] for c in calls if c['name'] == 'docker' and c['args'][0] == 'run')
            for option, value in [('--cpuset-cpus', '0'), ('--memory', '6g'), ('--network', 'none')]:
                self.assertEqual(docker[docker.index(option) + 1], value)
            self.assertIn('--read-only', docker)

    def test_setup_failures_preserve_phase_and_shutdown(self):
        for failure in ['metadata', 'package', 'image']:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as name:
                result, calls, status, _ = host(Path(name), failure)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(status['status'], 'failed')
                self.assertEqual(status['phase'], failure)
                self.assertEqual(calls[-1]['name'], 'shutdown')
                self.assertFalse(any(c['name'] == 'docker' and c['args'][0] == 'run' for c in calls))

    def test_controller_failure_keeps_rows_and_collection_failure_sets_failed_status(self):
        for failure, code in [('controller', 7), ('collection', 1)]:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as name:
                root = Path(name); result, calls, status, binding = host(root, failure)
                self.assertEqual(result.returncode, code)
                self.assertEqual(status['status'], 'failed')
                self.assertEqual(status['collection_complete'], failure != 'collection')
                if failure == 'controller':
                    self.assertTrue((root / 's3/runs' / binding['run_id'] / 'results/study/predictions.jsonl').exists())
                self.assertTrue(any(c['name'] == 'docker' and c['args'][:2] == ['rm', '-f'] for c in calls))
                self.assertEqual(calls[-1]['name'], 'shutdown')

    def test_expired_host_stops_before_setup_and_changed_body_stops_before_worker(self):
        for expired in [True, False]:
            with self.subTest(expired=expired), tempfile.TemporaryDirectory() as name:
                root = Path(name); result, calls, status, _ = host(root, expired=expired, tamper=not expired)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(calls[-1]['name'], 'shutdown')
                self.assertFalse(any(c['name'] == 'docker' and c['args'][0] == 'run' for c in calls))
                if expired:
                    self.assertEqual([c['name'] for c in calls], ['shutdown'])
                    self.assertIsNone(status)
                else: self.assertEqual(status['phase'], 'package')


class LauncherTests(unittest.TestCase):
    def test_render_preserves_plain_script_and_one_instance_limits(self):
        with tempfile.TemporaryDirectory() as name:
            package, binding, _ = fixture(Path(name))
            script, request, _ = render(package, sha(package.read_bytes()), binding, NETWORK)
            self.assertLessEqual(len(script), 16384)
            self.assertEqual(request['UserData'].encode(), script)
            self.assertTrue(request['DryRun'])
            self.assertEqual(request['ClientToken'], binding['run_id'])
            self.assertEqual(request['MinCount'], 1); self.assertEqual(request['MaxCount'], 1)
            self.assertEqual(request['InstanceType'], 'c6i.xlarge')
            self.assertEqual(request['InstanceInitiatedShutdownBehavior'], 'terminate')
            disk = request['BlockDeviceMappings'][0]['Ebs']
            self.assertEqual(disk['VolumeSize'], 80)
            self.assertTrue(disk['Encrypted']); self.assertTrue(disk['DeleteOnTermination'])
            for key in ['run_id', 'package_version', 'approval_reference']:
                with self.subTest(key=key), self.assertRaises(ValueError):
                    render(package, sha(package.read_bytes()), {**binding, key: 'x; touch /tmp/unsafe'}, NETWORK)

    def test_cli_checks_approval_before_call_and_retains_unknown_launch(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name); package, binding, manifest = fixture(root)
            digest = sha(package.read_bytes())
            for file, value in [('binding.json', binding), ('network.json', NETWORK)]:
                (root / file).write_bytes(encode(value))
            env = stub_environment(root, package)
            command = [sys.executable, str(ROOT / 'scripts/reasoner_cloud_launch.py'), 'launch',
                       '--package', str(package), '--package-sha256', digest,
                       '--binding', str(root / 'binding.json'), '--network', str(root / 'network.json'),
                       '--out', str(root / 'launch')]
            result = subprocess.run(command, env=env, text=True, capture_output=True, timeout=15)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('approval differs', result.stderr)
            self.assertFalse((root / 'calls.jsonl').exists())
            approval = {'package_sha256': digest, 'plan_sha256': manifest['plan_sha256'],
                        'maximum_instance_seconds': 3600, 'maximum_before_tax_usd': '0.50',
                        'approval_reference': binding['approval_reference']}
            (root / 'approval.json').write_bytes(encode(approval))
            result = subprocess.run(command + ['--approval', str(root / 'approval.json')],
                                    env=env, text=True, capture_output=True, timeout=15)
            self.assertNotEqual(result.returncode, 0)
            receipt = json.loads((root / 'launch/receipt.json').read_bytes())
            self.assertEqual(receipt['status'], 'launch_outcome_unknown')
            self.assertEqual(receipt['request_sha256'], sha((root / 'launch/submitted-request.json').read_bytes()))
            calls = [json.loads(line) for line in (root / 'calls.jsonl').read_text().splitlines()]
            self.assertEqual(len(calls), 2)
            request = json.loads(calls[1]['args'][calls[1]['args'].index('--cli-input-json') + 1])
            self.assertFalse(request['DryRun'])
            self.assertEqual(request['ClientToken'], binding['run_id'])


if __name__ == '__main__': unittest.main()
