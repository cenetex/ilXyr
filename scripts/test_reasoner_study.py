"""Exercise scheduling, input guards, retained worker failures and altered receipts."""
import argparse
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest

import research_reasoner_study as study
import check_reasoner_study as checker
from feral_process import digest, save, run_process


class StudyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        for src, dest in [('research-step-40/PLAN.json', 'PLAN.json'), ('research-step-40/OPENED.jsonl', 'OPENED.jsonl'),
                          ('research-step-39/ROSTER.json', 'ROSTER.json')]:
            shutil.copyfile(study.ROOT / 'experiments' / src, self.root / dest)

    def tearDown(self):
        self.tmp.cleanup()

    def test_fixed_plan(self):
        self.assertEqual(digest(self.root / 'PLAN.json'), study.PLAN_SHA)

    def test_balanced_schedule_and_coverage(self):
        w = study.workload(self.root, 'cloud')
        self.assertEqual(len(w['jobs']), 48)
        for arm in study.ARMS:
            jobs = [j for j in w['jobs'] if j['arm'] == arm]
            self.assertEqual([sum(j['index'] % 4 == p for j in jobs) for p in range(4)], [3]*4)
        for order in w['orders']:
            self.assertEqual(sorted(order), list(range(512)))
        self.assertEqual(len({tuple(o) for o in w['orders']}), 12)

    def test_opened_uses_previous_four_families(self):
        w = study.workload(self.root, 'opened')
        self.assertEqual(sorted(w['orders'][0]), [base + v for base in [0,128,256,384] for v in range(4)])
        self.assertEqual(len(w['jobs']), 8)
        self.assertIn('#define R40_EPISODES 16', study.header(self.root, 'opened'))

    def test_cloud_requires_execution(self):
        with self.assertRaisesRegex(ValueError, 'cloud execution record'):
            study.limits('cloud', None, self.root)
        with self.assertRaisesRegex(ValueError, 'fixed local limits'):
            study.limits('opened', {}, self.root)

    def test_constant_ratio_interval(self):
        r = checker.interval([math.log(.5)] * 8, [list(range(4)), list(range(4,8))], draws=100)
        self.assertAlmostEqual(r['ratio'], .5)
        self.assertAlmostEqual(r['upper_one_sided_9875'], .5)

    def test_family_cluster_resampling(self):
        r = checker.interval([0,0,math.log(4),math.log(4)], [[0,1],[2,3]], draws=100)
        self.assertAlmostEqual(r['ratio'], 2)
        self.assertAlmostEqual(r['upper_one_sided_9875'], 2)

    def test_seed_sequence(self):
        rng = checker.random_indices(553540)
        self.assertEqual([rng(32) for _ in range(8)], [4, 21, 22, 7, 7, 31, 18, 17])

    def test_nonfinite_ratio(self):
        with self.assertRaisesRegex(ValueError, 'ratio inputs'):
            checker.interval([float('nan')], [[0]], draws=10)


def engineering(prepared, collected, output):
    output.mkdir(parents=True, exist_ok=False)
    root = collected / 'study'
    source = prepared / 'source'
    replay = study.ROOT / 'scripts/replay_reasoner_study.mjs'
    cases = []
    # Keep each altered log and the rejection receipt; copy only the small opened result.
    changes = {
        'heap_count': lambda r: r.update(heap_comparisons=r['heap_comparisons']+1),
        'batch_count': lambda r: r.update(batches=r['batches']+1),
        'feature_digest': lambda r: r.update(features_sha256='0'*64),
        'proposal_order': lambda r: r['proposal_keys'].__setitem__(0, r['proposal_keys'][0]+1),
        'verifier_count': lambda r: r.update(verifier_checks=r['verifier_checks']+1),
        'fallback_count': lambda r: r.update(fallback_attempts=r['fallback_attempts']+1),
        'accepted_map': lambda r: r.update(accepted_semantic_sha256='0'*64),
    }
    for name, change in changes.items():
        target = output / name
        shutil.copytree(root, target / 'study')
        for path in (target / 'study/jobs').glob('*/stdout.log'):
            records = [json.loads(s) for s in path.read_text().splitlines()]
            for r in records:
                if r['kind'] == 'row':
                    change(r)
            path.write_text(''.join(json.dumps(r, separators=(',', ':'))+'\n' for r in records))
        command = ['node', str(replay), str(source), str(target / 'study'), str(prepared), str(target / 'REPLAY.json')]
        receipt = run_process(command, study.ROOT, target / 'process', time.monotonic()+30, 2)
        study.require(receipt['status'] == 'failed' and receipt['exit_code'] != 0, 'altered evidence accepted: '+name)
        cases.append({'case': name, 'status': 'rejected', 'stderr_sha256': digest(target / 'process/stderr.log')})
    for name, alter in [('missing_row', lambda rows: rows.pop(1)), ('duplicate_row', lambda rows: rows.insert(1, rows[1])),
                        ('changed_order', lambda rows: rows.__setitem__(slice(1,3), rows[1:3][::-1]))]:
        target = output / name
        shutil.copytree(root, target / 'study')
        path = target / 'study/jobs/0000/stdout.log'
        records = [json.loads(s) for s in path.read_text().splitlines()]; alter(records)
        path.write_text(''.join(json.dumps(r)+'\n' for r in records))
        receipt = run_process(['node', str(replay), str(source), str(target / 'study'), str(prepared), str(target / 'REPLAY.json')],
                              study.ROOT, target / 'process', time.monotonic()+30, 2)
        study.require(receipt['status'] == 'failed', 'row coverage alteration accepted')
        cases.append({'case': name, 'status': 'rejected', 'stderr_sha256': digest(target / 'process/stderr.log')})
    for name, seconds in [('missing_model', 5), ('deadline', .001)]:
        cwd = output / (name+'-cwd'); cwd.mkdir()
        receipt = run_process([str(root / 'bin/reasoner-study'), 'task_guide', '0'], cwd if name == 'missing_model' else source,
                              output / name, time.monotonic()+seconds, .05)
        study.require(receipt['status'] != 'complete', 'worker failure was accepted')
        if name == 'missing_model':
            records = [json.loads(s) for s in (output / name / 'stdout.log').read_text().splitlines()]
            study.require(records[-1]['failed'] and records[-1]['completed_episodes'] == 0, 'model failure visited episodes')
        cases.append({'case': name, 'status': receipt['status'], 'stop_reason': receipt['stop_reason']})
    # An invalid compiler exercises the complete supervisor and its partial collection.
    command = [os.sys.executable, str(study.ROOT / 'scripts/research_reasoner_study.py'), 'opened', '--prepared', str(prepared),
               '--out', str(output / 'compiler-failure'), '--work', str(output / 'compiler-failure-work')]
    child = subprocess.run(command, env={**os.environ, 'CC': '/usr/bin/false'}, capture_output=True, timeout=30)
    (output / 'compiler-failure.stdout').write_bytes(child.stdout)
    (output / 'compiler-failure.stderr').write_bytes(child.stderr)
    study.require(child.returncode != 0, 'invalid compiler accepted')
    attempt = study.load(output / 'compiler-failure/study/ATTEMPT.json')
    study.require(attempt['status'] == 'failed' and attempt['started_jobs'] == 0, 'partial attempt record differs')
    study.require((output / 'compiler-failure/study/COLLECTION.json').is_file(), 'partial collection missing')
    cases.append({'case': 'compiler_failure', 'status': 'retained', 'started_jobs': 0})
    for name in ['negative_cpu', 'altered_header', 'extra_collection_file', 'incomplete_supervisor']:
        target = output / name
        shutil.copytree(collected, target / 'collected')
        data = target / 'collected/study'
        supervisor_path = target / 'collected/SUPERVISOR.json'
        supervisor = study.load(supervisor_path)
        if name == 'negative_cpu':
            path = data / 'jobs/0000/process.json'
            receipt = study.load(path); receipt['resource_usage']['user_cpu_seconds'] = -1
            save(path, receipt)
            save(data / 'COLLECTION.json', {'files': study.inventory(data)})
            supervisor['collection_sha256'] = digest(data / 'COLLECTION.json')
        elif name == 'altered_header':
            path = data / 'inputs/study_inputs.h'
            path.write_text(path.read_text() + '\n/* altered header */\n')
            save(data / 'COLLECTION.json', {'files': study.inventory(data)})
            supervisor['collection_sha256'] = digest(data / 'COLLECTION.json')
        elif name == 'extra_collection_file':
            (data / 'inputs/COLLECTION.json').write_text('{}\n')
        else:
            supervisor['status'] = 'failed'
        save(supervisor_path, supervisor)
        try:
            checker.check(prepared, target / 'collected', digest(supervisor_path), target / 'check')
        except ValueError as error:
            cases.append({'case': name, 'status': 'rejected', 'error': str(error)})
        else:
            raise AssertionError('altered collected record accepted: ' + name)
    save(output / 'CASES.json', {'status': 'passed', 'cases': cases, 'fresh_episode_visits': 0})
    return cases


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--prepared', type=Path); p.add_argument('--collected', type=Path); p.add_argument('--out', type=Path)
    a, rest = p.parse_known_args()
    if a.prepared:
        print(json.dumps(engineering(a.prepared.resolve(), a.collected.resolve(), a.out.resolve())))
    else:
        unittest.main(argv=[__file__, *rest])
