"""Controlled host failures, archive integrity and approval boundaries for zero4-45."""
import copy
import hashlib
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
from unittest.mock import patch
from package_zero4_cloud import BODY, PLAN, SOURCES, KIT, encode, sha, inspect
from zero4_cloud_launch import render
from zero4_cloud_collect import archive_outputs, unpack_results, receive
from zero4_cloud_preflight import lifecycle_rules
from test_feral_bootstrap import STUB, write_tar

ROOT = Path(__file__).resolve().parents[1]
STUB = STUB.replace("'g6e.2xlarge'", "'c6i.4xlarge'").replace('run/model/weight.bin', 'runtime/study/bin/lm').replace('run/source/grader/targets.jsonl', 'runtime/study/RESULT.json').replace('run/arms/base/predictions.jsonl', 'runtime/study/processes/0000-fixture/stdout.log').replace('run/execution.json', 'runtime/RUNTIME.json').replace("key.endswith('predictions.jsonl')", "key.endswith('results-00.part')")
STUB = STUB.replace("if args[:2]==['image','inspect']:print('[]');sys.exit(0)", "if args[:2]==['image','inspect']:print(json.dumps([{'Id':'sha256:a3535ab419a167bf1c5acc0ea5d536c358152a9fb8dd8504068ef24bb0f4a1f1','Architecture':'amd64','Os':'linux'}]));sys.exit(0)").replace("if args[:2]==['rm','-f']:sys.exit(0)", "if args[:2]==['rm','-f']:sys.exit(0)\n    if args[0]=='inspect':print('[]');sys.exit(0)")


def fixture(root):
    plan = json.loads((ROOT / PLAN).read_bytes())
    controller_files = {'scripts/zero4_study.py': b'# controlled source fixture\n'}
    controller = root / 'controller.tar'; write_tar(controller, controller_files)
    kit = {'sha256': sha(controller.read_bytes()), 'bytes': controller.stat().st_size,
           'files': {n: {'path': n, 'bytes': len(b), 'sha256': sha(b)} for n, b in controller_files.items()}}
    implementation = {'zero4_study.py': sha(controller_files['scripts/zero4_study.py'])}
    prepared_files = {'data/fixture': b'controlled inputs'}
    prepared_files['MANIFEST.json'] = encode({'mode': 'cloud', 'plan_sha256': plan['study_plan_sha256'],
        'config': {'limits': plan['study_limits']}, 'implementation': implementation,
        'files': {n: {'path': n, 'bytes': len(b), 'sha256': sha(b)} for n, b in prepared_files.items()}})
    prepared_files['PREPARE.json'] = encode({'status': 'complete'})
    prepared = root / 'prepared.tar'; write_tar(prepared, prepared_files)
    plan.update(controller_sha256=kit['sha256'], controller_bytes=kit['bytes'], implementation=implementation,
        prepared={'sha256': sha(prepared.read_bytes()), 'bytes': prepared.stat().st_size,
                  'manifest_sha256': sha(prepared_files['MANIFEST.json'])})
    files = {n: (ROOT / n).read_bytes() for n in SOURCES}; files[PLAN] = encode(plan); files[KIT] = encode(kit)
    files['controller.tar'] = controller.read_bytes(); files['prepared.tar'] = prepared.read_bytes()
    manifest = {'plan_sha256': sha(files[PLAN]), 'files': {n: {'bytes': len(b), 'sha256': sha(b)} for n, b in files.items()}}
    files['HOST.json'] = encode(manifest)
    package = root / 'host.tar'; write_tar(package, files)
    binding = {'run_id': 'zero4-45-20260912T000000Z', 'launch_epoch_seconds': int(time.time()), 'package_version': 'fixture-version', 'approval_reference': 'fixture-approval'}
    network = {k: plan['provider'][k] for k in ['subnet_id', 'security_group_id']}
    return package, binding, network, manifest


def environment(root, package, failure=''):
    bin_dir = root / 'bin'; bin_dir.mkdir()
    for name in ['aws', 'curl', 'docker', 'systemd-run', 'systemctl', 'shutdown', 'timeout']:
        path = bin_dir / name; path.write_text('#!' + sys.executable + '\n' + STUB); path.chmod(0o755)
    return {**os.environ, 'PATH': str(bin_dir) + os.pathsep + os.environ['PATH'], 'FERAL_TEST_LOG': str(root / 'calls.jsonl'),
            'FERAL_TEST_PACKAGE': str(package), 'FERAL_TEST_S3': str(root / 's3'), 'FERAL_TEST_FAILURE': failure}


def host(root, failure='', expired=False, tamper=False):
    package, binding, network, _ = fixture(root)
    if expired: binding['launch_epoch_seconds'] -= 50000
    script, _, _ = render(package, sha(package.read_bytes()), binding, network)
    path = root / 'user-data.sh'; path.write_bytes(script + (b':\n' if tamper else b''))
    env = environment(root, package, failure); env.update(W_WORK_ROOT=str(root / 'work'), W_USER_DATA_FILE=str(path))
    result = subprocess.run(['bash', str(path)], env=env, capture_output=True, text=True, timeout=25)
    calls = [json.loads(line) for line in (root / 'calls.jsonl').read_text().splitlines()]
    if os.environ.get('ZERO4_CLOUD_TEST_RECEIPTS'):
        destination = Path(os.environ['ZERO4_CLOUD_TEST_RECEIPTS']) / ('host-' + (failure or 'success') + ('-expired' if expired else '-tampered' if tamper else ''))
        destination.mkdir(parents=True, exist_ok=True)
        for filename in ['calls.jsonl', 'user-data.sh']:
            shutil.copyfile(root / filename, destination / filename)
        if (root / 'work').exists(): shutil.copytree(root / 'work', destination / 'work', dirs_exist_ok=True)
        (destination / 'process.json').write_bytes(encode({'returncode': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr}))
    terminal = root / 'work/host-terminal.json'
    return result, calls, json.loads(terminal.read_bytes()) if terminal.exists() else None, binding


class HostTests(unittest.TestCase):
    def test_success_arms_watchdog_first_collects_native_bytes_and_uses_fixed_limits(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name); result, calls, terminal, binding = host(root)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr + (root / 'work/bootstrap.log').read_text())
            self.assertEqual(terminal['status'], 'complete'); self.assertTrue(terminal['collection_complete'])
            self.assertEqual(calls[0]['name'], 'systemd-run'); self.assertEqual(calls[-1]['name'], 'shutdown')
            timer = int(next(v.split('=', 1)[1] for v in calls[0]['args'] if v.startswith('--on-active=')))
            self.assertTrue(48000 < timer <= 48570)
            docker = next(v['args'] for v in calls if v['name'] == 'docker' and v['args'][0] == 'run')
            for option, value in [('--memory', '24g'), ('--memory-swap', '24g'), ('--cpuset-cpus', '0-15'), ('--network', 'none'), ('--pids-limit', '1024')]:
                self.assertEqual(docker[docker.index(option) + 1], value)
            self.assertIn('/tmp:rw,exec,size=512m', docker)
            prefix = root / 's3/runs' / binding['run_id']
            receipt = json.loads((prefix / 'collection.json').read_bytes())
            self.assertEqual(receipt['sha256'], sha((prefix / 'results-00.part').read_bytes()))
            with tarfile.open(prefix / 'results-00.part') as archive:
                self.assertEqual(archive.extractfile('runtime/study/bin/lm').read(), b'fixture-model')
                self.assertEqual(archive.extractfile('runtime/study/processes/0000-fixture/stdout.log').read(), b'{"id":"fixture"}\n')
            self.assertEqual(terminal['user_data_sha256'], sha((root / 'user-data.sh').read_bytes()))

    def test_failures_preserve_cause_and_shutdown(self):
        for mode in ['metadata', 'package', 'image', 'controller', 'collection']:
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as name:
                root = Path(name); result, calls, terminal, binding = host(root, mode)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(terminal['status'], 'failed'); self.assertEqual(calls[-1]['name'], 'shutdown')
                if mode in ['metadata', 'package', 'image']:
                    self.assertEqual(terminal['phase'], mode)
                    self.assertFalse(any(v['name'] == 'docker' and v['args'][0] == 'run' for v in calls))
                if mode == 'controller':
                    self.assertEqual(terminal['exit_code'], 7); self.assertTrue(terminal['collection_complete'])
                    self.assertTrue((root / 's3/runs' / binding['run_id'] / 'results-00.part').exists())
                if mode == 'collection':
                    self.assertFalse(terminal['collection_complete']); self.assertIn('collection_error', terminal)

    def test_expired_launch_and_changed_bootstrap_stop_before_worker(self):
        for expired in [True, False]:
            with self.subTest(expired=expired), tempfile.TemporaryDirectory() as name:
                result, calls, terminal, _ = host(Path(name), expired=expired, tamper=not expired)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(any(v['name'] == 'docker' and v['args'][0] == 'run' for v in calls))
                self.assertEqual(calls[-1]['name'], 'shutdown')
                if expired: self.assertEqual([v['name'] for v in calls], ['shutdown']); self.assertIsNone(terminal)
                else: self.assertEqual(terminal['phase'], 'package')


class IntegrityTests(unittest.TestCase):
    def test_archive_bound_keeps_prefix_and_marks_incomplete(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name); source = root / 'output'; source.mkdir()
            raw = b'x' * (10 * 1024 * 1024); (source / 'trace').write_bytes(raw)
            archive = root / 'result.tar'; cap = 10 * 1024 * 1024
            receipt = archive_outputs(source, archive, cap, 10, time.time() + 20)
            self.assertFalse(receipt['complete']); self.assertLessEqual(archive.stat().st_size, cap)
            unpack_results(archive, root / 'unpacked', cap, 11)
            prefix = (root / 'unpacked/trace').read_bytes(); self.assertGreater(len(prefix), 0); self.assertLess(len(prefix), len(raw))
            self.assertTrue(raw.startswith(prefix))
            inventory = json.loads((root / 'unpacked/COLLECTION-INVENTORY.json').read_bytes())
            self.assertEqual(inventory['files'][0]['status'], 'truncated_byte_ceiling')

    def test_links_and_changed_archive_paths_fail_closed(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name); source = root / 'output'; source.mkdir(); (source / 'link').symlink_to('/etc/passwd')
            receipt = archive_outputs(source, root / 'result.tar', 12 * 1024 * 1024, 10, time.time() + 20)
            self.assertFalse(receipt['complete'])
            bad = root / 'bad.tar'; write_tar(bad, {'../outside': b'x'})
            with self.assertRaisesRegex(ValueError, 'path differs'): unpack_results(bad, root / 'unpacked', 4096, 10)
            self.assertFalse((root / 'outside').exists())

    def test_receive_requires_termination_before_s3_calls(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name); plan = json.loads((ROOT / PLAN).read_bytes())
            launch = {'status': 'launched', 'instance_id': 'i-123abc', 'plan_sha256': sha(encode(plan))}
            response = {'Reservations': [{'Instances': [{'InstanceId': 'i-123abc', 'State': {'Name': 'running'}}]}]}
            with patch('zero4_cloud_collect.aws', return_value=response) as call, self.assertRaisesRegex(ValueError, 'termination required'):
                receive(launch, plan, root / 'received', 'fixture')
            self.assertEqual(call.call_count, 1)

    def test_package_identity_network_and_safe_bindings_are_required(self):
        with tempfile.TemporaryDirectory() as name:
            package, binding, network, _ = fixture(Path(name)); expected = sha(package.read_bytes())
            script, request, _ = render(package, expected, binding, network)
            self.assertLessEqual(len(script), 16384); self.assertEqual(request['UserData'].encode(), script)
            self.assertEqual(request['MinCount'], 1); self.assertEqual(request['MaxCount'], 1)
            self.assertTrue(request['DryRun']); self.assertEqual(request['ClientToken'], binding['run_id'])
            self.assertEqual(request['MetadataOptions']['HttpTokens'], 'required')
            disk = request['BlockDeviceMappings'][0]['Ebs']; self.assertEqual(disk['VolumeSize'], 80)
            self.assertTrue(disk['Encrypted']); self.assertTrue(disk['DeleteOnTermination'])
            for key in ['run_id', 'package_version', 'approval_reference']:
                with self.subTest(key=key), self.assertRaises(ValueError): render(package, expected, {**binding, key: 'x; touch /tmp/unsafe'}, network)
            with self.assertRaisesRegex(ValueError, 'network differs'): render(package, expected, binding, {**network, 'subnet_id': 'subnet-123'})
            package.write_bytes(package.read_bytes()[:-1] + b'x')
            with self.assertRaisesRegex(ValueError, 'digest differs'): inspect(package, expected)

    def test_approval_preflight_and_unknown_launch_are_preserved(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name); package, binding, network, manifest = fixture(root); expected = sha(package.read_bytes())
            for file, data in [('binding.json', binding), ('network.json', network)]: (root / file).write_bytes(encode(data))
            env = environment(root, package)
            runner = ROOT / 'scripts/zero4_cloud_launch.py'
            command = [sys.executable, str(runner), 'launch', '--package', str(package), '--package-sha256', expected,
                '--binding', str(root / 'binding.json'), '--network', str(root / 'network.json'), '--out', str(root / 'launch')]
            result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=15)
            self.assertIn('approval differs', result.stderr); self.assertFalse((root / 'calls.jsonl').exists())
            approval = {'package_sha256': expected, 'plan_sha256': manifest['plan_sha256'], 'maximum_instance_seconds': 48600,
                'maximum_before_tax_usd': '12.00', 'approval_reference': binding['approval_reference']}
            (root / 'approval.json').write_bytes(encode(approval)); command += ['--approval', str(root / 'approval.json')]
            result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=15)
            self.assertIn('fresh successful preflight required', result.stderr); self.assertFalse((root / 'calls.jsonl').exists())
            preflight = {'status': 'passed', 'package_sha256': expected, 'plan_sha256': manifest['plan_sha256'], 'package_version': binding['package_version'], 'checked_epoch': time.time()}
            preflight['run_id'] = 'zero4-45-20260911T000000Z'
            (root / 'preflight.json').write_bytes(encode(preflight))
            wrong = subprocess.run(command + ['--preflight', str(root / 'preflight.json')], env=env, capture_output=True, text=True, timeout=15)
            if os.environ.get('ZERO4_CLOUD_TEST_RECEIPTS'):
                destination = Path(os.environ['ZERO4_CLOUD_TEST_RECEIPTS']) / 'changed-preflight-run'
                shutil.copytree(root, destination)
                (destination / 'CHECK.json').write_bytes(encode({'returncode': wrong.returncode, 'stderr': wrong.stderr,
                    'aws_called': (root / 'calls.jsonl').exists()}))
            self.assertIn('fresh successful preflight required', wrong.stderr)
            self.assertFalse((root / 'calls.jsonl').exists())
            preflight['run_id'] = binding['run_id']
            (root / 'preflight.json').write_bytes(encode(preflight))
            result = subprocess.run(command + ['--preflight', str(root / 'preflight.json')], env=env, capture_output=True, text=True, timeout=15)
            receipt = json.loads((root / 'launch/receipt.json').read_bytes())
            self.assertEqual(receipt['status'], 'launch_outcome_unknown')
            self.assertEqual(receipt['request_sha256'], sha((root / 'launch/submitted-request.json').read_bytes()))
            calls = [json.loads(v) for v in (root / 'calls.jsonl').read_text().splitlines()]
            self.assertEqual(len(calls), 2)


    def test_collection_checks_exact_versions_hashes_and_cleanup(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name); result, _, terminal, binding = host(root)
            self.assertEqual(result.returncode, 0)
            plan = json.loads((root / 'work/package' / PLAN).read_bytes())
            launch = {**terminal, 'status': 'launched'}; prefix = root / 's3'
            def fake_aws(args, deadline, profile):
                if args[:2] == ['ec2', 'describe-instances']:
                    return {'Reservations': [{'Instances': [{'InstanceId': launch['instance_id'], 'State': {'Name': 'terminated'}, 'ImageId': plan['provider']['ami_id'], 'InstanceType': plan['provider']['instance_type'], 'Architecture': plan['provider']['architecture'],
                        'Tags': [{'Key': 'RunId', 'Value': launch['run_id']}, {'Key': 'PackageSha256', 'Value': launch['package_sha256']}]}]}]}
                if args[:2] == ['ec2', 'describe-volumes']: return {'Volumes': []}
                if args[:2] == ['ec2', 'describe-network-interfaces']: return {'NetworkInterfaces': []}
                key = args[args.index('--key') + 1]; source = prefix / key
                if '--version-id' in args: self.assertEqual(args[args.index('--version-id') + 1], 'fixture-version')
                raw = source.read_bytes()
                import base64
                metadata = {'VersionId': 'fixture-version', 'ContentLength': len(raw), 'ChecksumSHA256': base64.b64encode(hashlib.sha256(raw).digest()).decode()}
                if args[:2] == ['s3api', 'get-object']: Path(args[-1]).write_bytes(raw)
                else: self.assertEqual(args[:2], ['s3api', 'head-object'])
                return metadata
            with patch('zero4_cloud_collect.aws', side_effect=fake_aws):
                receipt = receive(launch, plan, root / 'received', 'fixture')
                self.assertTrue(receipt['instance_termination_verified'])
                self.assertEqual((root / 'received/results/runtime/study/processes/0000-fixture/stdout.log').read_bytes(), b'{"id":"fixture"}\n')
                self.assertTrue((root / 'received/volumes.json').exists())
                archive = prefix / 'runs' / binding['run_id'] / 'results-00.part'; archive.write_bytes(archive.read_bytes()[:-1] + b'x')
                with self.assertRaisesRegex(ValueError, 'metadata differs'): receive(launch, plan, root / 'changed', 'fixture')
                self.assertFalse((root / 'changed/results').exists())

    def test_lifecycle_only_covers_new_study_folders(self):
        plan = json.loads((ROOT / PLAN).read_bytes()); rules = lifecycle_rules(plan)
        self.assertEqual([v['Filter']['Prefix'] for v in rules[:2]], ['packages/zero4-45/', 'runs/zero4-45-'])
        for rule in rules[:2]:
            self.assertEqual(rule['Expiration']['Days'], 30); self.assertEqual(rule['NoncurrentVersionExpiration']['NoncurrentDays'], 1)


class ChunkTests(unittest.TestCase):
    def test_ordered_parts_bind_exact_coverage(self):
        from zero4_cloud_collect import upload_parts, validate_parts
        with tempfile.TemporaryDirectory() as name:
            root = Path(name); bundle = root / 'results.tar'; raw = bytes(range(81)); bundle.write_bytes(raw)
            storage = {'archive_chunk_bytes': 32, 'max_archive_bytes': 96, 'max_archive_chunks': 3, 'bucket': 'fixture'}
            receipt = {'bytes': len(raw), 'sha256': sha(raw)}; uploaded = []
            def put(path, bucket, key, deadline):
                b = path.read_bytes(); uploaded.append(b)
                return {'key': key, 'version_id': 'fixture-version', 'bytes': len(b), 'sha256': sha(b)}
            with patch('zero4_cloud_collect.put', side_effect=put):
                upload_parts(bundle, storage, 'runs/fixture/', time.time() + 5, receipt, root / 'collection.json')
            self.assertEqual(b''.join(uploaded), raw); self.assertEqual([len(b) for b in uploaded], [32, 32, 17])
            validate_parts(receipt, storage, 'runs/fixture/')
            for parts in [list(reversed(receipt['parts'])), receipt['parts'][:-1]]:
                with self.assertRaises(ValueError): validate_parts({**receipt, 'parts': parts}, storage, 'runs/fixture/')
            self.assertFalse(bundle.with_suffix('.part').exists())

    def test_failed_second_upload_keeps_first_binding_and_partial_bytes(self):
        from zero4_cloud_collect import upload_parts
        with tempfile.TemporaryDirectory() as name:
            root = Path(name); bundle = root / 'results.tar'; bundle.write_bytes(bytes(range(81)))
            storage = {'archive_chunk_bytes': 32, 'max_archive_bytes': 96, 'max_archive_chunks': 3, 'bucket': 'fixture'}
            receipt = {'bytes': 81}; calls = []
            def put(path, bucket, key, deadline):
                calls.append(key)
                if len(calls) == 2: raise RuntimeError('injected upload failure')
                b = path.read_bytes(); return {'key': key, 'bytes': len(b), 'sha256': sha(b), 'version_id': 'fixture-version'}
            with patch('zero4_cloud_collect.put', side_effect=put), self.assertRaisesRegex(RuntimeError, 'injected upload'):
                upload_parts(bundle, storage, 'runs/fixture/', time.time() + 5, receipt, root / 'collection.json')
            kept = json.loads((root / 'collection.json').read_bytes())
            self.assertEqual(len(kept['parts']), 1)
            self.assertEqual(kept['parts'][0]['key'], 'runs/fixture/results-00.part')
            self.assertEqual(kept['pending_part'], {'key': 'runs/fixture/results-01.part', 'bytes': 32,
                                                  'sha256': sha(bytes(range(32, 64)))})
            self.assertEqual(bundle.with_suffix('.part').read_bytes(), bytes(range(32, 64)))

    def test_cost_ceiling_rejects_an_omitted_download_charge(self):
        from package_zero4_cloud import check_budget
        plan = json.loads((ROOT / PLAN).read_bytes()); check_budget(plan)
        plan['budget']['download_ceiling_usd'] = '0'
        with self.assertRaisesRegex(ValueError, 'cost arithmetic'): check_budget(plan)


class RuntimeTests(unittest.TestCase):
    def test_changed_memory_limit_stops_before_full_controller(self):
        from package_zero4_cloud import unpack
        import zero4_cloud_runtime as runtime
        with tempfile.TemporaryDirectory() as name:
            root = Path(name); package, _, _, _ = fixture(root)
            unpack(package, sha(package.read_bytes()), root / 'package')
            plan = json.loads((root / 'package' / PLAN).read_bytes()); provider = plan['provider']
            execution = {'schema': 'ilxyr.zero4_study_execution.v1', 'plan_sha256': sha(encode(plan)),
                'prepared_manifest_sha256': plan['prepared']['manifest_sha256'], 'limits': plan['limits'],
                'machine': {'provider': 'AWS', **{k: provider[k] for k in ['region', 'instance_type', 'ami_id', 'architecture']},
                            'runtime_image': plan['runtime_image']}}
            (root / 'execution.json').write_bytes(encode(execution))
            with patch.dict(os.environ, plan['environment']), patch.object(runtime.platform, 'machine', return_value='x86_64'), \
                 patch.object(runtime.subprocess, 'check_output', side_effect=[plan['compiler_identity'], plan['python_identity']]), \
                 patch.object(runtime, 'memory', return_value={'limit_bytes': 1024}), patch.object(runtime.subprocess, 'Popen') as start:
                with self.assertRaisesRegex(ValueError, 'memory limit'):
                    runtime.run(root / 'package', root / 'output', 'cloud', root / 'execution.json')
                start.assert_not_called()
            record = json.loads((root / 'output/RUNTIME.json').read_bytes())
            self.assertEqual(record['status'], 'failed'); self.assertEqual(record['phase'], 'identity')


if __name__ == '__main__':
    unittest.main()
