"""Controlled host failures, archive integrity and approval boundaries for solomon38."""
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
from package_solomon_cloud import BODY, PLAN, SOURCES, encode, sha, inspect
from solomon_cloud_launch import render
from solomon_cloud_collect import archive_outputs, unpack_results, receive
from solomon_cloud_preflight import lifecycle_rules
from test_feral_bootstrap import STUB, write_tar

ROOT = Path(__file__).resolve().parents[1]
STUB = STUB.replace("'g6e.2xlarge'", "'c6i.large'").replace('run/model/weight.bin', 'runtime/controller/study/bin/solomon-confidence-arm').replace('run/source/grader/targets.jsonl', 'runtime/controller/study/RUN.json').replace('run/arms/base/predictions.jsonl', 'runtime/controller/study/jobs/0000/process/stdout.log').replace('run/execution.json', 'runtime/RUNTIME.json').replace("key.endswith('predictions.jsonl')", "key.endswith('results.tar')")


def fixture(root):
    plan = json.loads((ROOT / PLAN).read_bytes())
    import package_solomon_cloud as pack
    controller_files = {'prepared/source/Cargo.lock': b'# fixture lock\n'}
    controller_files['FILES.json'] = encode({n: {'bytes':len(b),'sha256':sha(b)} for n,b in controller_files.items()})
    controller = root / 'controller.tar.gz'; write_tar(controller, controller_files)
    pack.KIT_SHA = sha(controller.read_bytes()); pack.KIT_MANIFEST = sha(controller_files['FILES.json'])
    deps = {'Cargo.lock': controller_files['prepared/source/Cargo.lock']}
    deps['FILES.json'] = encode({n:{'bytes':len(b),'sha256':sha(b)} for n,b in deps.items()})
    dep = root / 'dependencies.tar.gz'; write_tar(dep,deps)
    plan.update(controller_sha256=pack.KIT_SHA,controller_bytes=controller.stat().st_size,
        dependencies={'bytes':dep.stat().st_size,'sha256':sha(dep.read_bytes())})
    files = {n: (ROOT / n).read_bytes() for n in SOURCES}; files[PLAN] = encode(plan)
    code = files['scripts/package_solomon_cloud.py'].decode()
    import re
    code = re.sub(r"KIT_SHA = '[^']+'", 'KIT_SHA = ' + repr(pack.KIT_SHA), code)
    code = re.sub(r"KIT_MANIFEST = '[^']+'", 'KIT_MANIFEST = ' + repr(pack.KIT_MANIFEST), code)
    files['scripts/package_solomon_cloud.py'] = code.encode()
    files['controller.tar.gz'] = controller.read_bytes(); files['dependencies.tar.gz'] = dep.read_bytes()
    manifest = {'plan_sha256': sha(files[PLAN]), 'files': {n: {'bytes': len(b), 'sha256': sha(b)} for n, b in files.items()}}
    files['HOST.json'] = encode(manifest)
    package = root / 'host.tar'; write_tar(package, files)
    binding = {'run_id': 'solomon38-20260908T000000Z', 'launch_epoch_seconds': int(time.time()), 'package_version': 'fixture-version', 'approval_reference': 'fixture-approval'}
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
    if expired: binding['launch_epoch_seconds'] -= 5500
    script, _, _ = render(package, sha(package.read_bytes()), binding, network)
    path = root / 'user-data.sh'; path.write_bytes(script + (b':\n' if tamper else b''))
    env = environment(root, package, failure); env.update(W_WORK_ROOT=str(root / 'work'), W_USER_DATA_FILE=str(path))
    result = subprocess.run(['bash', str(path)], env=env, capture_output=True, text=True, timeout=25)
    calls = [json.loads(line) for line in (root / 'calls.jsonl').read_text().splitlines()]
    if os.environ.get('SOLOMON_CLOUD_TEST_RECEIPTS'):
        destination = Path(os.environ['SOLOMON_CLOUD_TEST_RECEIPTS']) / ('host-' + (failure or 'success') + ('-expired' if expired else '-tampered' if tamper else ''))
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
            self.assertTrue(3500 < timer <= 3570)
            docker = next(v['args'] for v in calls if v['name'] == 'docker' and v['args'][0] == 'run')
            for option, value in [('--memory', '2g'), ('--memory-swap', '2g'), ('--cpuset-cpus', '0'), ('--network', 'none'), ('--pids-limit', '256')]:
                self.assertEqual(docker[docker.index(option) + 1], value)
            self.assertIn('/tmp:rw,exec,size=256m', docker)
            prefix = root / 's3/runs' / binding['run_id']
            receipt = json.loads((prefix / 'collection.json').read_bytes())
            self.assertEqual(receipt['object']['sha256'], sha((prefix / 'results.tar').read_bytes()))
            with tarfile.open(prefix / 'results.tar') as archive:
                self.assertEqual(archive.extractfile('runtime/controller/study/bin/solomon-confidence-arm').read(), b'fixture-model')
                self.assertEqual(archive.extractfile('runtime/controller/study/jobs/0000/process/stdout.log').read(), b'{"id":"fixture"}\n')
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
                    self.assertTrue((root / 's3/runs' / binding['run_id'] / 'results.tar').exists())
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
            raw = b'x' * (3 * 1024 * 1024); (source / 'trace').write_bytes(raw)
            archive = root / 'result.tar'; cap = 3 * 1024 * 1024
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
            receipt = archive_outputs(source, root / 'result.tar', 4 * 1024 * 1024, 10, time.time() + 20)
            self.assertFalse(receipt['complete'])
            bad = root / 'bad.tar'; write_tar(bad, {'../outside': b'x'})
            with self.assertRaisesRegex(ValueError, 'path differs'): unpack_results(bad, root / 'unpacked', 4096, 10)
            self.assertFalse((root / 'outside').exists())

    def test_receive_requires_termination_before_s3_calls(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name); plan = json.loads((ROOT / PLAN).read_bytes())
            launch = {'status': 'launched', 'instance_id': 'i-123abc', 'plan_sha256': sha(encode(plan))}
            response = {'Reservations': [{'Instances': [{'InstanceId': 'i-123abc', 'State': {'Name': 'running'}}]}]}
            with patch('solomon_cloud_collect.aws', return_value=response) as call, self.assertRaisesRegex(ValueError, 'termination required'):
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
            import package_solomon_cloud as pack
            runner = root / 'fixture-launch.py'
            runner.write_text('import sys;sys.path.insert(0,' + repr(str(ROOT / 'scripts')) + ');import package_solomon_cloud as p;p.KIT_SHA=' + repr(pack.KIT_SHA) + ';p.KIT_MANIFEST=' + repr(pack.KIT_MANIFEST) + ';import solomon_cloud_launch;solomon_cloud_launch.main()')
            command = [sys.executable, str(runner), 'launch', '--package', str(package), '--package-sha256', expected,
                '--binding', str(root / 'binding.json'), '--network', str(root / 'network.json'), '--out', str(root / 'launch')]
            result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=15)
            self.assertIn('approval differs', result.stderr); self.assertFalse((root / 'calls.jsonl').exists())
            approval = {'package_sha256': expected, 'plan_sha256': manifest['plan_sha256'], 'maximum_instance_seconds': 3600,
                'maximum_before_tax_usd': '0.25', 'approval_reference': binding['approval_reference']}
            (root / 'approval.json').write_bytes(encode(approval)); command += ['--approval', str(root / 'approval.json')]
            result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=15)
            self.assertIn('fresh successful preflight required', result.stderr); self.assertFalse((root / 'calls.jsonl').exists())
            preflight = {'status': 'passed', 'package_sha256': expected, 'plan_sha256': manifest['plan_sha256'], 'package_version': binding['package_version'], 'checked_epoch': time.time()}
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
                    return {'Reservations': [{'Instances': [{'InstanceId': launch['instance_id'], 'State': {'Name': 'terminated'},
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
            with patch('solomon_cloud_collect.aws', side_effect=fake_aws):
                receipt = receive(launch, plan, root / 'received', 'fixture')
                self.assertTrue(receipt['instance_termination_verified'])
                self.assertEqual((root / 'received/results/runtime/controller/study/jobs/0000/process/stdout.log').read_bytes(), b'{"id":"fixture"}\n')
                self.assertTrue((root / 'received/volumes.json').exists())
                archive = prefix / 'runs' / binding['run_id'] / 'results.tar'; archive.write_bytes(archive.read_bytes()[:-1] + b'x')
                with self.assertRaisesRegex(ValueError, 'metadata differs'): receive(launch, plan, root / 'changed', 'fixture')
                self.assertFalse((root / 'changed/results.tar').exists())

    def test_lifecycle_only_covers_new_study_folders(self):
        plan = json.loads((ROOT / PLAN).read_bytes()); rules = lifecycle_rules(plan)
        self.assertEqual([v['Filter']['Prefix'] for v in rules[:2]], ['packages/solomon38/', 'runs/solomon38-'])
        for rule in rules[:2]:
            self.assertEqual(rule['Expiration']['Days'], 30); self.assertEqual(rule['NoncurrentVersionExpiration']['NoncurrentDays'], 1)


class DependencyTests(unittest.TestCase):
    def test_registry_and_file_checksums_both_bind_offline_sources(self):
        from package_solomon_cloud import vendor_files
        with tempfile.TemporaryDirectory() as name:
            root = Path(name); crate = root / 'example'; crate.mkdir()
            raw = b'[package]\nname = "example"\nversion = "1.0.0"\n'
            (crate / 'Cargo.toml').write_bytes(raw)
            checksum = {'package': 'a' * 64, 'files': {'Cargo.toml': sha(raw)}}
            (crate / '.cargo-checksum.json').write_bytes(encode(checksum))
            lock = b'[[package]]\nname = "example"\nversion = "1.0.0"\nchecksum = "' + b'a' * 64 + b'"\n'
            self.assertIn('vendor/example/Cargo.toml', vendor_files(root, lock))
            (crate / 'Cargo.toml').write_bytes(raw + b'# changed\n')
            with self.assertRaisesRegex(ValueError, 'source file checksum'): vendor_files(root, lock)
            (crate / 'Cargo.toml').write_bytes(raw)
            with self.assertRaisesRegex(ValueError, 'registry checksum'): vendor_files(root, lock.replace(b'a' * 64, b'b' * 64))
            (crate / 'extra').write_bytes(b'unlisted')
            with self.assertRaisesRegex(ValueError, 'source file checksum'): vendor_files(root, lock)

    def test_dependency_archive_keeps_identical_bytes_and_rejects_duplicate_paths(self):
        import io
        from package_solomon_cloud import archive, read_archive
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            one = archive({'b': b'2', 'a': b'1'}, root / 'one', True)
            two = archive({'a': b'1', 'b': b'2'}, root / 'two', True)
            self.assertEqual(one, two); self.assertEqual(read_archive((root / 'one').read_bytes()), {'a': b'1', 'b': b'2'})
            with tarfile.open(root / 'bad', 'w') as t:
                for _ in range(2):
                    m = tarfile.TarInfo('a'); m.size = 1; t.addfile(m, io.BytesIO(b'x'))
            with self.assertRaisesRegex(ValueError, 'archive member'): read_archive((root / 'bad').read_bytes())


if __name__ == '__main__': unittest.main()
