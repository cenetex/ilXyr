"""Exercise the invented FERAL run, moved collection, and altered evidence records."""
import copy
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

import research_feral_coverage as study
import check_feral_coverage as checker
import feral_coverage_worker as worker
from feral_process import digest, run_process, save


def json_lines(path):
    return [json.loads(s) for s in path.read_text().splitlines()]


def write_lines(path, rows):
    path.write_text(''.join(json.dumps(v, sort_keys=True, separators=(',', ':')) + '\n' for v in rows))


def reseal(collected):
    root = collected / 'study'
    for path in sorted((root / 'jobs').iterdir()):
        if (path / 'PREDICTIONS.jsonl').is_file():
            footer = study.load(path / 'stdout.log'); footer['output_sha256'] = digest(path / 'PREDICTIONS.jsonl')
            footer['output_bytes'] = (path / 'PREDICTIONS.jsonl').stat().st_size
            (path / 'stdout.log').write_text(json.dumps(footer, sort_keys=True) + '\n')
        receipt = study.load(path / 'process.json')
        receipt['outputs'] = {n: {'bytes': (path / n).stat().st_size, 'sha256': digest(path / n)} for n in ['stdout.log', 'stderr.log']}
        save(path / 'process.json', receipt)
    save(root / 'COLLECTION.json', {'files': study.inventory(root, ['COLLECTION.json'])})
    supervisor = study.load(collected / 'SUPERVISOR.json')
    supervisor['collection_sha256'] = digest(root / 'COLLECTION.json')
    supervisor['controller_receipt_sha256'] = digest(collected / 'controller-process/process.json')
    save(collected / 'SUPERVISOR.json', supervisor)
    return digest(collected / 'SUPERVISOR.json')


class ControllerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(); cls.base = Path(cls.tmp.name)
        cls.prepared = cls.base / 'prepared'; cls.collected = cls.base / 'collected'
        study.prepare(cls.prepared)
        study.supervise(cls.prepared, cls.collected, cls.base / 'worker', 'opened')
        cls.result = checker.check(cls.prepared, cls.collected, digest(cls.collected / 'SUPERVISOR.json'), cls.base / 'checked')

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def altered(self, name):
        output = self.base / name; shutil.copytree(self.collected, output); return output

    def reject(self, path, pattern):
        expected = reseal(path)
        with self.assertRaisesRegex(ValueError, pattern):
            checker.check(self.prepared, path, expected, path.parent / (path.name + '-checked'))
        self.assertEqual(study.load(path.parent / (path.name + '-checked/CHECK.json'))['status'], 'failed')

    def mutate_predictions(self, collected, fn):
        for path in (collected / 'study/jobs').glob('*/PREDICTIONS.jsonl'):
            rows = json_lines(path)
            for row in rows: fn(row)
            write_lines(path, rows)

    def test_opened_run_keeps_all_results_and_style_failure(self):
        r = self.result
        self.assertEqual((r['cases'], r['jobs'], r['predictor_calls'], r['distinct_results'], r['fresh_predictor_calls']), (58, 9, 522, 174, 0))
        self.assertEqual(r['summary']['primary_decision'], 'opened_engineering')
        self.assertEqual(r['summary']['arms']['calculator_v2']['counts']['correct_numeric'], 21)
        self.assertEqual(r['summary']['arms']['calculator_v1']['counts']['correct_numeric'], 10)
        self.assertEqual(r['summary']['arms']['v2_operand_only']['counts']['correct_numeric'], 2)
        self.assertEqual(r['summary']['arms']['v2_operand_only']['counts']['wrong_numeric'], 19)
        self.assertTrue(r['summary']['all_required_abstentions_correct'])
        self.assertFalse(r['summary']['comparisons']['paraphrase/calculator_v1']['coverage_rule'])

    def test_schedule_preserves_cases_and_balances_arm_order(self):
        schedule = study.schedule('cloud', ['b', 'a'])
        self.assertEqual(schedule['ids'], ['a', 'b']); self.assertEqual(len(schedule['jobs']), 36)
        for arm in study.ARMS:
            for position in range(3): self.assertEqual(sum(j['arm'] == arm and j['index'] % 3 == position for j in schedule['jobs']), 4)

    def test_moved_collection_replays_from_saved_files(self):
        moved = self.altered('moved')
        result = checker.check(self.prepared, moved, digest(moved / 'SUPERVISOR.json'), self.base / 'moved-check')
        self.assertEqual(result['stable_rows_sha256'], self.result['stable_rows_sha256'])

    def test_preparation_uses_no_predictor_imports(self):
        with patch.dict(sys.modules, {'feral_evidence_calculator': None, 'feral_evidence_calculator_v2': None}):
            self.assertEqual(study.prepare(self.base / 'independent-preparation')['fresh_predictor_calls'], 0)

    def test_cloud_mode_requires_bound_execution_and_raw_reports(self):
        with self.assertRaisesRegex(ValueError, 'cloud execution record'): study.limits('cloud', None, self.prepared)
        execution = {'schema': 'ilxyr.feral_coverage_execution.v1', 'venue': 'cloud', 'run_id': 'fixture', 'package_sha256': '0' * 64,
            'prepared_bindings_sha256': digest(self.prepared / 'BINDINGS.json'), 'implementation': study.bindings(), 'worker_count': 1, 'limits': study.LIMITS}
        with self.assertRaisesRegex(ValueError, 'fixed report bytes'): study.limits('cloud', execution, self.prepared, check_host=False)

    def test_worker_rejects_target_fields_and_bad_input_identity(self):
        path = self.base / 'target-leak.jsonl'; rows = json_lines(self.prepared / 'opened/predictor/INPUTS.jsonl')
        rows[0]['target'] = '999'; write_lines(path, rows)
        with self.assertRaisesRegex(ValueError, 'extra fields'): worker.run(path, digest(path), 'calculator_v2', 0, self.base / 'leak-output', 100000)
        with self.assertRaisesRegex(ValueError, 'input identity'): worker.run(path, '0' * 64, 'calculator_v2', 0, self.base / 'hash-output', 100000)

    def test_worker_output_ceiling_retains_partial_lines(self):
        path = self.prepared / 'opened/predictor/INPUTS.jsonl'; output = self.base / 'small-output.jsonl'
        with self.assertRaisesRegex(ValueError, 'byte ceiling'): worker.run(path, digest(path), 'calculator_v2', 0, output, 1400)
        self.assertTrue(output.exists()); self.assertLessEqual(output.stat().st_size, 1400)
        for line in output.read_text().splitlines(): json.loads(line)

    def test_process_deadline_retains_output_and_terminal_receipt(self):
        command = [sys.executable, '-c', 'import time; print("started", flush=True); time.sleep(10)']
        output = self.base / 'deadline'
        result = run_process(command, self.base, output, time.monotonic() + 1, .1, max_log_bytes=1024)
        self.assertEqual(result['status'], 'failed'); self.assertEqual(result['stop_reason'], 'deadline')
        self.assertIn('started', (output / 'stdout.log').read_text()); self.assertTrue((output / 'process.json').exists())

    def test_controller_failure_preserves_zero_job_record(self):
        output = self.base / 'overlap'
        with self.assertRaisesRegex(ValueError, 'controller failed'):
            study.supervise(self.prepared, output, self.prepared, 'opened')
        self.assertEqual(study.load(output / 'SUPERVISOR.json')['status'], 'failed')
        self.assertEqual(study.load(output / 'study/ATTEMPT.json')['started_jobs'], 0)
        self.assertTrue((output / 'study/COLLECTION.json').is_file())

    def test_rewritten_prepared_target_is_rejected(self):
        output = self.base / 'prepared-forged'; shutil.copytree(self.prepared, output)
        path = output / 'opened/grader/TARGETS.jsonl'; rows = json_lines(path)
        next(r for r in rows if r['kind'] == 'numeric')['exact_value'] = '999'; write_lines(path, rows)
        record = study.load(output / 'BINDINGS.json'); record['files'] = study.inventory(output, ['BINDINGS.json']); save(output / 'BINDINGS.json', record)
        with self.assertRaisesRegex(ValueError, 'opened input or target'): study.validate_prepared(output)

    def test_changed_source_spans_are_rejected_after_resealing(self):
        output = self.altered('source-span')
        def change(row):
            if row['result']['operands']: row['result']['operands'][0]['span'][0] += 1
        self.mutate_predictions(output, change); self.reject(output, 'source span')

    def test_changed_source_value_is_rejected_after_resealing(self):
        output = self.altered('source-value')
        def change(row):
            if row['result']['operands']: row['result']['operands'][0]['value'] = '999'
        self.mutate_predictions(output, change); self.reject(output, 'source value')

    def test_changed_arithmetic_and_printed_result_are_rejected(self):
        for field in ['exact_result', 'prediction']:
            output = self.altered('wrong-' + field)
            def change(row):
                if row['result']['prediction'] is not None: row['result'][field] = '999'
            self.mutate_predictions(output, change); self.reject(output, 'arithmetic differs|printed answer')

    def test_changed_work_counts_are_rejected_even_when_all_passes_agree(self):
        for field in ['evidence_rows', 'parsed_cells', 'series_scored', 'arithmetic_operations']:
            output = self.altered('count-' + field)
            self.mutate_predictions(output, lambda row: row['result']['work'].__setitem__(field, row['result']['work'][field] + 1))
            self.reject(output, 'count differs|work differs')

    def test_selected_series_must_match_source_operands(self):
        output = self.altered('series-label')
        def change(row):
            r = row['result']
            if row['arm'] == 'calculator_v2' and r.get('route') == 'single_year' and r['reason'] == 'answered' and r['selected_series'] == ['operating income']:
                r['selected_series'] = ['net income']
        self.mutate_predictions(output, change)
        self.reject(output, 'selected series')

    def test_missing_prediction_and_extra_output_are_rejected(self):
        output = self.altered('missing-row'); path = output / 'study/jobs/0000/PREDICTIONS.jsonl'
        write_lines(path, json_lines(path)[:-1]); self.reject(output, 'prediction count')
        output = self.altered('extra-file'); (output / 'study/extra.json').write_text('{}\n'); self.reject(output, 'extra or missing')

    def test_repeat_drift_is_rejected(self):
        output = self.altered('repeat-drift'); path = output / 'study/jobs/0004/PREDICTIONS.jsonl'; rows = json_lines(path)
        r = next(r for r in rows if r['result']['prediction'] is None); r['result']['reason'] = 'changed_reason'
        write_lines(path, rows); self.reject(output, 'count differs|repeated prediction')

    def test_changed_process_scope_and_omitted_child_cost_are_rejected(self):
        output = self.altered('cost-scope'); path = output / 'study/jobs/0000/process.json'; r = study.load(path)
        r['resource_usage']['scope'] = 'self_only'; save(path, r); self.reject(output, 'cost scope')
        output = self.altered('cost-omitted'); path = output / 'controller-process/process.json'; r = study.load(path)
        r['resource_usage'].update(user_cpu_seconds=0, system_cpu_seconds=0); save(path, r); self.reject(output, 'excludes child work')

    def test_fixed_benefit_rule_requires_both_question_styles(self):
        s = self.result['summary']
        for reference in ['calculator_v1', 'v2_operand_only']:
            self.assertTrue(s['comparisons']['canonical/' + reference]['coverage_rule'])
            self.assertFalse(s['comparisons']['paraphrase/' + reference]['coverage_rule'])
        self.assertEqual(s['v2_canonical_paraphrase_pairs']['correct/wrong'], 21)


if __name__ == '__main__': unittest.main()
