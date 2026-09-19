"""Exercise worker coverage, cancellation and recursive CPU accounting."""
import json
import os
import shutil
from pathlib import Path
import sys
import tempfile
import time
import unittest

from feral_process import run_process
import zero4_endpoint as worker
import zero4_study as study


class EndpointTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='zero4-worker-test-')
        self.root = Path(self.temporary.name)
        self.model = self.root / 'model'
        self.model.write_bytes(b'opened-stub-model')
        self.cases = self.root / 'cases.tsv'
        self.cases.write_text('id\tvalue\na\t1\nb\t2\nc\t3\n')

    def tearDown(self):
        if os.environ.get('ZERO4_TEST_EVIDENCE_ROOT'):
            target = Path(os.environ['ZERO4_TEST_EVIDENCE_ROOT']) / self._testMethodName
            shutil.copytree(self.root, target)
        self.temporary.cleanup()

    def native(self, behavior):
        file = self.root / 'native'
        file.write_text('#!' + sys.executable + '\n' + '''import csv,json,sys,time
from pathlib import Path
model,cases,output,_,index,_,count=sys.argv[1:]
index,count=int(index),int(count)
''' + behavior + '''
with open(cases) as stream: rows=list(csv.DictReader(stream,delimiter='\\t'))
with open(output,'w') as stream:
 for i,row in enumerate(rows):
  if i%count==index: stream.write(json.dumps({'ordinal':i,'id':row['id']})+'\\n')
''')
        file.chmod(0o755)
        return file

    def parent(self, native, seconds=5):
        out = self.root / 'endpoint'
        command = [sys.executable, str(Path(worker.__file__)), '--kind', 'task', '--native', str(native), '--model', str(self.model),
                   '--cases', str(self.cases), '--out', str(out), '--jobs', '2', '--seconds', str(seconds)]
        receipt = run_process(command, self.root, self.root / 'parent', time.monotonic() + 10, 2)
        return out, receipt

    def test_waited_worker_cpu_is_counted_once(self):
        native = self.native('started=time.process_time()\nwhile time.process_time()-started<0.15: pass\n')
        out, parent = self.parent(native)
        self.assertEqual(parent['status'], 'complete')
        result = worker.check(out, 'task', native, self.model, self.cases, 2, worker.cpu(parent))
        self.assertGreaterEqual(result['worker_cpu_us'], 290000)
        self.assertGreaterEqual(result['parent_cpu_us'] + 2, result['worker_cpu_us'])
        self.assertEqual(result['counted_in_total'], 'parent_only')
        self.assertEqual(result['cases'], 3)

    def test_worker_failure_cancels_and_joins_peers(self):
        native = self.native('if index==0: raise SystemExit(7)\ntime.sleep(5)\n')
        out, parent = self.parent(native)
        self.assertEqual(parent['status'], 'failed')
        result = json.loads((out / 'WORKERS.json').read_bytes())
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(len(result['workers']), 2)
        self.assertFalse((out / 'ROWS.jsonl').exists())
        self.assertLess(parent['total_wall_ns'], 4000000000)
        self.assertTrue(all((out / f'worker-{r["index"]:02d}/process.json').exists() for r in result['workers']))

    def test_deadline_keeps_worker_receipts(self):
        native = self.native('time.sleep(5)\n')
        out, parent = self.parent(native, seconds=0.15)
        self.assertEqual(parent['status'], 'failed')
        result = json.loads((out / 'WORKERS.json').read_bytes())
        self.assertEqual(len(result['workers']), 2)
        self.assertTrue(any(json.loads((out / f'worker-{r["index"]:02d}/process.json').read_bytes())['stop_reason'] == 'deadline'
                            for r in result['workers']))

    def test_changed_shard_assignment_is_rejected(self):
        inputs = worker.read_cases(self.cases)
        for i, ordinals in [(0, [0, 2]), (1, [1])]:
            (self.root / f'worker-{i:02d}.jsonl').write_text(''.join(json.dumps({'ordinal': j, 'id': inputs[j]['id']}) + '\n' for j in ordinals))
        self.assertEqual(len(worker.merge_rows(self.root, inputs, 2)), 3)
        (self.root / 'worker-00.jsonl').write_text(json.dumps({'ordinal': 1, 'id': 'b'}) + '\n')
        with self.assertRaisesRegex(ValueError, 'shard coverage'):
            worker.merge_rows(self.root, inputs, 2)

    def test_missing_case_is_rejected(self):
        (self.root / 'worker-00.jsonl').write_text(json.dumps({'ordinal': 0, 'id': 'a'}) + '\n')
        (self.root / 'worker-01.jsonl').write_text(json.dumps({'ordinal': 1, 'id': 'b'}) + '\n')
        with self.assertRaisesRegex(ValueError, 'shard coverage'):
            worker.merge_rows(self.root, worker.read_cases(self.cases), 2)

    def test_expired_study_deadline_preserves_skipped_process(self):
        output = self.root / 'study'
        output.mkdir()
        processes = study.Processes(output, study.plan()['limits'])
        processes.deadline = time.monotonic() - 1
        marker = self.root / 'started'
        with self.assertRaisesRegex(ValueError, 'native process failed'):
            processes.run([sys.executable, '-c', 'from pathlib import Path; Path(' + repr(str(marker)) + ').touch()'],
                          self.root, 'opened', 'task')
        row = json.loads((output / 'PROCESSES.json').read_bytes())[0]
        receipt = json.loads((output / row['path'] / 'process.json').read_bytes())
        self.assertEqual(row['status'], 'skipped')
        self.assertEqual(receipt['status'], row['status'])
        self.assertEqual(receipt['stop_reason'], 'deadline')
        self.assertEqual(row['receipt_sha256'], worker.digest(output / row['path'] / 'process.json'))
        self.assertFalse(marker.exists())

    def test_invalid_worker_cpu_is_rejected(self):
        for value in [-1, True, float('nan'), float('inf')]:
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'invalid worker CPU'):
                worker.cpu({'status': 'complete', 'resource_usage': {'user_cpu_seconds': value, 'system_cpu_seconds': 0}})
        with self.assertRaisesRegex(ValueError, 'lacks CPU'):
            worker.cpu({'status': 'complete', 'resource_usage': None})
        self.assertEqual(worker.cpu({'status': 'skipped', 'resource_usage': None}), 0)


if __name__ == '__main__':
    unittest.main()
