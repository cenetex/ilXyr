import copy
from collections import Counter
import gzip
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from feral_process import run_process
from weight_source_kit import encode, sha
from weight_corpus_controller import CONTROLLER_PLAN, REPO, corpus_command, execution_deadline, plan_at
from weight_corpus_result import check_result, digest, load_context, trace_metrics

PROCESS = {'status': 'complete', 'exit_code': 0, 'stop_reason': None, 'descendant_cleanup': False}


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(encode(value))


def checksums(root):
    names = [str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() and p.name not in ['sha256sums.txt']]
    (root / 'sha256sums.txt').write_text(''.join(digest(root / name) + '  ' + name + '\n' for name in sorted(names)))


def fixture(base, slow=False):
    root = base / 'run'; root.mkdir()
    context = load_context(REPO)
    context['plan']['partitions'] = {'training': {'records': 1}, 'cross_rank_stratified': {'records': 1}, 'acr2_transformed': {'records': 1}}
    context['policy'].update(expected_corpus_records=3, lie_workers=1, zero_workers=1)
    context['plan']['oracle']['primary']['workers'] = 1
    context['plan']['oracle']['differential']['workers'] = 1
    context['policy_raw'] = encode(context['policy'])
    rows = []
    for name, kind, highest, target, depth in [('training', 'A1', [1], [1], 0), ('cross_rank_stratified', 'A2', [1, 1], [1, 1], 0), ('acr2_transformed', 'A2', [1, 1], [-1, 2], 1)]:
        rows.append({'id': name + '-000001', 'partition': name, 'canonical_type': kind,
            'canonical_representation_id': kind + ':fixture', 'rank': len(highest), 'highest_weight': highest,
            'target_weight': target, 'target_depth': depth, 'multiplicity': '1', 'multiplicity_stratum': '1',
            'in_exact_range': True, 'target_status': 'non_dominant' if min(target) < 0 else 'dominant'})
    context_path = base / 'context.json'; row_path = base / 'rows.json'
    write(context_path, {k: v for k, v in context.items() if k != 'policy_raw'}); write(row_path, rows)
    subprocess.run(['node', str(REPO / 'scripts/weight_corpus_fixture.mjs'), str(context_path), str(row_path), str(root / 'evidence'), *(['slow'] if slow else [])], check=True, timeout=10)
    (root / 'evidence/resource-policy.json').write_bytes(context['policy_raw'])
    limits = context['policy']['limits']
    frozen = {'status': 'frozen_before_first_workload_query', 'resource_policy_id': context['policy']['id'], 'workers': 1,
              'binding_call_limit': limits['oracle_calls'], 'binding_query_ms_limit': limits['total_query_ms'], 'binding_wall_seconds': limits['elapsed_wall_seconds']}
    write(root / 'evidence/frozen-budget.json', frozen)
    write(root / 'evidence/generation-progress.json', {'status': 'corpus_complete'})
    artifacts = []
    for row in rows: artifacts.append(partition(root, row))
    diff = {'selected': 3, 'completed': 3, 'agreements': 3, 'disagreements': 0, 'unavailable': 0, 'completion_fraction': 1,
            'records': [{'record_id': r['id'], 'canonical_type': r['canonical_type'], 'partition': r['partition'],
                'multiplicity_stratum': '1', 'target_status': r['target_status'], 'lie_multiplicity': '1',
                'zero_multiplicity': '1', 'status': 'agreement', 'elapsed_ms': 1} for r in rows]}
    diff_record = compressed_json(root / 'evidence/zero-differential.json.gz', diff)
    diff_record.update({k: v for k, v in diff.items() if k != 'records'})
    diff_record['gzip_file'] = diff_record.pop('file')
    control = {'model_facing_pair_metadata': False, 'pairs': [{'base_record_id': rows[1]['id'],
        'transformed_record_id': rows[2]['id'], 'coxeter_length': 1, 'weyl_word_zero_based_simple_reflections': [0]}]}
    control_record = compressed_json(root / 'corpus/acr2-control-manifest.json.gz', control); control_record['pairs'] = 1
    policy = context['policy']
    manifest = {'status': 'sealed', 'smoke': False, 'total_records': 3, 'unique_query_keys': 3, 'partitions': artifacts,
        'source_bindings': {'plan_sha256': policy['source_bindings']['examples/weight-multiplicity/phase1-corpus-plan-v1.json'],
            'reduced_manifest_sha256': policy['source_bindings']['examples/weight-multiplicity/phase06-reduced-corpus-manifest-v1.json'],
            'root_systems_sha256': policy['source_bindings']['examples/weight-multiplicity/phase1-root-systems-v1.json'],
            'resource_policy_sha256': sha(context['policy_raw']), 'frozen_budget_sha256': digest(root / 'evidence/frozen-budget.json')},
        'oracle_identity': {'lie_source_sha256': context['plan']['oracle']['primary']['source_sha256'], 'zero_source_commit': context['plan']['oracle']['differential']['source_commit']},
        'closures': {'model_training_authorized': False, 'model_evaluation_authorized': False, 'oracle_promotion_authorized': False},
        'zero_differential': diff_record, 'acr2_control': control_record}
    write(root / 'corpus-manifest.json', manifest)
    memory = {'failure': None, 'samples': 4, 'sample_interval_ms': 20,
        'lie_worker_baseline_rss_bytes': {'lie-1': 1000}, 'lie_worker_peak_rss_bytes': {'lie-1': 1020},
        'lie_worker_peak_incremental_rss_bytes': {'lie-1': 20}, 'zero_worker_peak_rss_bytes': {'zero-1': 1000},
        'peak_aggregate_oracle_rss_bytes': 2020}
    counts = {k: diff[k] for k in ['selected', 'completed', 'agreements', 'disagreements', 'unavailable']}
    evidence = {'status': 'corpus_complete', 'smoke': False, 'corpus_manifest_sha256': digest(root / 'corpus-manifest.json'), 'memory': memory, 'zero_differential': counts}
    summary = {'status': 'corpus_complete', 'corpus_manifest_sha256': evidence['corpus_manifest_sha256'],
        'frozen_budget_sha256': manifest['source_bindings']['frozen_budget_sha256'], 'total_records': 3,
        'oracle_calls': 3, 'oracle_query_ms': 153 if slow else 3, 'zero_differential': counts}
    write(root / 'evidence/generation-evidence.json', evidence); write(root / 'runner-summary.json', summary)
    checksums(root)
    return root, context, rows


def compressed_json(path, value):
    raw = encode(value); path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(gzip.compress(raw, mtime=0))
    return {'file': path.name, 'uncompressed_sha256': sha(raw), 'gzip_sha256': digest(path), 'gzip_bytes': path.stat().st_size}


def partition(root, row):
    raw = json.dumps(row).encode() + b'\n'; path = root / 'corpus' / (row['partition'] + '.ndjson.gz')
    path.parent.mkdir(exist_ok=True); path.write_bytes(gzip.compress(raw, mtime=0))
    strata = dict.fromkeys(['0', '1', '2-7', '8-31', '>31'], 0); strata[row['multiplicity_stratum']] += 1
    status = dict.fromkeys(['dominant', 'non_dominant'], 0); status[row['target_status']] += 1
    return {'partition': row['partition'], 'file': path.name, 'records': 1, 'uncompressed_bytes': len(raw),
        'uncompressed_sha256': sha(raw), 'gzip_bytes': path.stat().st_size, 'gzip_sha256': digest(path),
        'multiplicity_strata': strata, 'target_statuses': status, 'per_type': {row['canonical_type']: 1}}


def refresh_manifest(root, manifest):
    write(root / 'corpus-manifest.json', manifest)
    for name in ['runner-summary.json', 'evidence/generation-evidence.json']:
        value = json.loads((root / name).read_text()); value['corpus_manifest_sha256'] = digest(root / 'corpus-manifest.json'); write(root / name, value)
    checksums(root)


class ResultTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root, self.context, self.rows = fixture(Path(self.temp.name))

    def check(self, process=PROCESS): return check_result(self.root, self.context, process)

    def test_complete_small_fixture_is_accepted(self):
        result = self.check(); self.assertEqual(result['status'], 'verified_corpus', result)
        self.assertEqual(result['corpus_records'], 3)
        self.assertEqual(result['trace']['phases']['workload']['calls'], 3)

    def test_exact_p99_counts_out_of_range_slow_queries(self):
        path = self.root / 'evidence/oracle-attempts.jsonl'
        template = json.loads(path.read_text().splitlines()[1])
        rows = []
        for index in range(100):
            row = copy.deepcopy(template); row.update(sequence=index + 1, dispatch_sequence=index + 1, elapsed_ms=1001 if index == 0 else 50)
            if index == 0: row.update(multiplicity='32', multiplicity_bit_length=6, label_range='outside_above_31')
            rows.append(row)
        path.write_text(''.join(json.dumps(row) + '\n' for row in rows))
        result = trace_metrics(path, self.context['policy']['limits'])['phases']['workload']
        self.assertEqual(result['calls'], 100); self.assertEqual(result['cumulative_p99_ms'], 50)
        self.assertEqual(result['total_query_ms'], 1001 + 99 * 50)
        self.assertEqual(result['label_ranges']['outside_above_31'], 1)
        self.assertEqual(result['top_50'][0]['trace_sequence'], 1)
        rows[1]['elapsed_ms'] = 51
        path.write_text(''.join(json.dumps(row) + '\n' for row in rows))
        self.assertEqual(trace_metrics(path, self.context['policy']['limits'])['phases']['workload']['cumulative_p99_ms'], 51)

    def test_truncated_trace_retains_complete_prefix(self):
        path = self.root / 'evidence/oracle-attempts.jsonl'; path.write_bytes(path.read_bytes()[:-9])
        result = self.check(); self.assertFalse(result['corpus_accepted']); self.assertEqual(result['trace']['phases']['all']['calls'], 3)
        self.assertTrue(result['trace']['errors'])

    def test_provisional_p99_rejects_a_sealed_manifest(self):
        path = self.root / 'evidence/oracle-accounting.json'; value = json.loads(path.read_text())
        value['workload_accounting']['p99_decision_stage'] = 'progress_only'; write(path, value); checksums(self.root)
        self.assertIn('p99 is provisional', self.check()['errors'])

    def test_memory_worker_missing_rejects_corpus(self):
        path = self.root / 'evidence/generation-evidence.json'; value = json.loads(path.read_text())
        value['memory']['lie_worker_baseline_rss_bytes'] = {}; write(path, value); checksums(self.root)
        self.assertIn('LiE memory workers differ', self.check()['errors'])

    def test_changed_label_rejected_even_after_new_artifact_hashes(self):
        row = self.rows[0]; row.update(multiplicity='2', multiplicity_stratum='2-7')
        manifest = json.loads((self.root / 'corpus-manifest.json').read_text()); manifest['partitions'][0] = partition(self.root, row)
        refresh_manifest(self.root, manifest)
        self.assertIn('corpus label differs from oracle trace', self.check()['errors'])

    def test_duplicate_row_query_rejected(self):
        row = self.rows[2]; row['target_weight'] = [1, 1]; row['target_status'] = 'dominant'
        manifest = json.loads((self.root / 'corpus-manifest.json').read_text()); manifest['partitions'][2] = partition(self.root, row)
        refresh_manifest(self.root, manifest)
        self.assertIn('duplicate corpus query', self.check()['errors'])

    def test_wrong_reflection_word_rejected(self):
        manifest = json.loads((self.root / 'corpus-manifest.json').read_text())
        path = self.root / 'corpus/acr2-control-manifest.json.gz'; control = json.loads(gzip.decompress(path.read_bytes()))
        control['pairs'][0]['weyl_word_zero_based_simple_reflections'] = [1]
        manifest['acr2_control'] = {**compressed_json(path, control), 'pairs': 1}; refresh_manifest(self.root, manifest)
        self.assertIn('ACR2 reflected target differs', self.check()['errors'])

    def test_generation_evidence_must_be_in_seal(self):
        path = self.root / 'sha256sums.txt'; path.write_text(''.join(line for line in path.read_text().splitlines(True) if 'generation-evidence.json' not in line))
        self.assertIn('complete result checksum roster differs', self.check()['errors'])

    def test_successful_stdout_or_exit_alone_cannot_accept(self):
        (self.root / 'runner-summary.json').unlink()
        self.assertFalse(self.check()['corpus_accepted'])

    def test_interrupted_process_rejects_complete_files(self):
        process = {**PROCESS, 'status': 'failed', 'stop_reason': 'deadline'}
        self.assertIn('successful result has failed process', self.check(process)['errors'])


class CommandTests(unittest.TestCase):
    def test_full_command_selects_frozen_policy_and_original_sources(self):
        plan = plan_at(); command = corpus_command(Path('/kit'), Path('/build'), Path('/out'), plan)
        self.assertEqual(command.count('--resource-policy'), 1)
        self.assertEqual(command[command.index('--resource-policy') + 1], '/kit/' + plan['resource_policy_path'])
        self.assertNotIn('--smoke', command); self.assertNotIn('--pilot-only', command)
        self.assertEqual(command[command.index('--zero-commit') + 1], '7be2367458acc8b004bfb3646322048a233d1b09')

    def test_deadline_rejects_extension_stale_and_wrong_package(self):
        plan = plan_at(); record = {'launch_epoch': 1000, 'deadline_epoch': 6400,
            'source_kit_sha256': plan['source_kit_sha256'], 'controller_plan_sha256': sha((REPO / CONTROLLER_PLAN).read_bytes())}
        for change in [{'deadline_epoch': 6401}, {'deadline_epoch': 1999}, {'source_kit_sha256': '0' * 64}]:
            with self.subTest(change=change), self.assertRaises(ValueError): execution_deadline({**record, **change}, plan, now=2000)
        with patch('weight_corpus_controller.time.monotonic', return_value=500):
            self.assertEqual(execution_deadline(record, plan, now=2000), 4900)
            self.assertEqual(execution_deadline(record, plan, now=2500), 4400)


class ActualRunnerHoldTests(unittest.TestCase):
    def test_actual_runner_preserves_failed_attempts_and_closes_workers(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp); lie = base / 'lie'; zero = base / 'zero'
            lie.write_text('#!' + sys.executable + '\nimport sys\nn=0\nfor line in sys.stdin:\n if line.strip()=="quit": break\n n+=1\n print("1" if n==1 else "-1",flush=True)\n')
            zero.write_text('#!' + sys.executable + '\nimport sys\nprint(\'{"status":"ready"}\',flush=True)\nfor line in sys.stdin: print(\'{"multiplicity":"1"}\',flush=True)\n')
            lie.chmod(0o700); zero.chmod(0o700)
            # Only input hashing is needed here; the failing test oracle is a small process fixture.
            supplied = os.environ.get('WEIGHT_LIE_SOURCE_ARCHIVE')
            if not supplied: self.skipTest('integration workflow supplies the original LiE archive')
            source = Path(supplied)
            self.assertTrue(source.is_file(), 'supplied original archive is missing')
            command = ['node', str(REPO / 'scripts/run-weight-multiplicity-phase1-corpus.mjs'),
                '--resource-policy', str(REPO / 'experiments/research-step-12/RESOURCE-POLICY.json'),
                '--lie', str(lie), '--lie-source', str(source), '--zero', str(zero),
                '--zero-commit', '7be2367458acc8b004bfb3646322048a233d1b09', '--out', str(base / 'run')]
            process = run_process(command, REPO, base / 'process', time.monotonic() + 20, 2)
            self.assertEqual(process['exit_code'], 2, (base / 'process/stderr.log').read_text())
            result = check_result(base / 'run', load_context(REPO), process)
            self.assertEqual(result['status'], 'verified_hold', result)
            self.assertFalse(result['corpus_accepted'])
            self.assertGreater(result['trace']['phases']['workload']['calls'], 0)
            self.assertFalse(process['descendant_cleanup'])
            write(base / 'run/corpus-manifest.json', {'status': 'sealed'})
            rejected = check_result(base / 'run', load_context(REPO), process)
            self.assertIn('Hold has a sealed corpus', rejected['errors'])
            (base / 'run/corpus-manifest.json').unlink()
            if os.environ.get('WEIGHT_TEST_RECEIPTS'):
                target = Path(os.environ['WEIGHT_TEST_RECEIPTS']); target.mkdir(parents=True, exist_ok=True)
                write(target / 'ACTUAL-RUNNER-HOLD.json', result)
                write(target / 'ACTUAL-RUNNER-PROCESS.json', process)


if __name__ == '__main__': unittest.main()
