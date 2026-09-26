"""Result collection retains exact S3 bytes and terminal instance evidence."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from reasoner4_cloud_collect import collect

ARCHIVE = 'a' * 64
RUN = 'reasoner4-role-audit-20260926T000000Z'


def raw(value):
    return (json.dumps(value, sort_keys=True) + '\n').encode()


class CollectorTests(unittest.TestCase):
    def provider(self, args):
        if args[1] == 'describe-instances':
            return {'Reservations': [{'Instances': [{'InstanceId': 'i-1234',
                'State': {'Name': 'terminated'}, 'Tags': [
                    {'Key': 'RunId', 'Value': RUN},
                    {'Key': 'HostPackageSha256', 'Value': ARCHIVE},
                    {'Key': 'Project', 'Value': 'reasoner4-role-audit'}]}]}]}
        if args[1] == 'describe-volumes':
            return {'Volumes': []}
        if args[1] == 'describe-network-interfaces':
            return {'NetworkInterfaces': []}
        raise AssertionError(args)

    def objects(self):
        capture = raw({'source_revision': '3b917b6f54d151a43dd65e45f094606272d166c5',
                       'verifier_evaluations': 2880})
        result = raw({'smoke': False, 'shuffle_null': {'runs': 60},
                      'selection': [{'seed': seed} for seed in (3, 9, 39)],
                      'predictions': [{}] * 180, 'measurements': {'held_out_typed_role_accuracy': 1000000}})
        receipt = raw({'archive_sha256': ARCHIVE,
                       'result_sha256': hashlib.sha256(result).hexdigest(),
                       'capture_verification_sha256': hashlib.sha256(capture).hexdigest()})
        data = {'diagnostic/result.json': result,
                'diagnostic/receipt.json': receipt,
                'diagnostic/capture-verification.json': capture}
        terminal = {'run_id': RUN, 'package_sha256': ARCHIVE,
                    'instance_id': 'i-1234', 'status': 'complete',
                    'files': {name: {'bytes': len(value),
                                     'sha256': hashlib.sha256(value).hexdigest()}
                              for name, value in data.items()}}
        data['terminal.json'] = raw(terminal)
        return data

    def test_complete_result_with_terminated_host(self):
        data = self.objects()
        def fake_head(key, _profile):
            name = key.split('/', 2)[2]
            return {'VersionId': 'v1', 'ContentLength': len(data[name])}
        def fake_download(key, version, path, _profile):
            self.assertEqual(version, 'v1')
            path.write_bytes(data[key.split('/', 2)[2]])
        with tempfile.TemporaryDirectory() as directory, \
             patch('reasoner4_cloud_collect.identity'), \
             patch('reasoner4_cloud_collect.head', side_effect=fake_head), \
             patch('reasoner4_cloud_collect.download', side_effect=fake_download), \
             patch('reasoner4_cloud_collect.call', side_effect=lambda args, _: self.provider(args)):
            output = Path(directory) / 'collection'
            launch = Path(directory) / 'launch.json'
            launch.write_bytes(raw({'status': 'launched', 'run_id': RUN,
                                    'archive_sha256': ARCHIVE, 'instance_id': 'i-1234'}))
            receipt = collect(RUN, ARCHIVE, launch, output, 'default')
            self.assertEqual(receipt['status'], 'verified')
            self.assertEqual(receipt['instance_state'], 'terminated')
            self.assertTrue((output / 'COLLECTION.json').exists())

    def test_failed_host_retains_verified_logs(self):
        data = self.objects()
        terminal = json.loads(data['terminal.json'])
        terminal.update(status='failed', phase='probe', exit_code=125)
        data['terminal.json'] = raw(terminal)
        def fake_head(key, _profile):
            name = key.split('/', 2)[2]
            return {'VersionId': 'v1', 'ContentLength': len(data[name])}
        def fake_download(key, version, path, _profile):
            path.write_bytes(data[key.split('/', 2)[2]])
        with tempfile.TemporaryDirectory() as directory, \
             patch('reasoner4_cloud_collect.identity'), \
             patch('reasoner4_cloud_collect.head', side_effect=fake_head), \
             patch('reasoner4_cloud_collect.download', side_effect=fake_download), \
             patch('reasoner4_cloud_collect.call', side_effect=lambda args, _: self.provider(args)):
            launch = Path(directory) / 'launch.json'
            launch.write_bytes(raw({'status': 'launched', 'run_id': RUN,
                                    'archive_sha256': ARCHIVE, 'instance_id': 'i-1234'}))
            receipt = collect(RUN, ARCHIVE, launch, Path(directory) / 'collection', 'default')
            self.assertEqual(receipt['status'], 'verified_host_failure')
            self.assertEqual(receipt['host_exit_code'], 125)


if __name__ == '__main__':
    unittest.main()
