import copy
from decimal import Decimal
import hashlib
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest

from feral_process import digest, run_process, save
from feral_execution_stage import partial_records, stage_model, grade, runtime_check
from run_feral_comparison import ROOT, STAGES, CONTROLLER_FILES, cost_estimate, extract_source, run_stages, validate_plan
from feral_comparison_worker import run_package


def plan_fixture():
    return {'schema':'ilxyr.feral_execution_plan.v1','arms':['base','calculator','operand_only'],
        'failure_policy':'retain_and_continue_remaining_arms_within_original_deadline',
        'controller_files':{name:{'sha256':digest(ROOT/name),'bytes':(ROOT/name).stat().st_size} for name in CONTROLLER_FILES},
        'source':{'archive_sha256':'a'*64,'package_manifest_sha256':'b'*64,'scope':'full_finqa_1147'},
        'provider':{'name':'aws_ec2','instance_type':'g6e.2xlarge','region':'us-east-1'},
        'runtime':{'image':'ghcr.io/atimics/feral-7b-sec-qwen@sha256:'+'c'*64,
                   'image_source_revision':'d'*40,'pyproject.toml_sha256':'e'*64,'uv.lock_sha256':'f'*64},
        'limits':{'max_instance_seconds':3600,'collection_reserve_seconds':300,'termination_grace_seconds':0.05,
                  'stage_seconds':{stage:0.3 for stage in STAGES}},
        'budget':{'hourly_compute_usd':'2.24208','other_infrastructure_reserve_usd':'0.75',
                  'max_infrastructure_usd':'3','price_evidence':{'status':'verified',
                    'record':{'price':'2.24208','Instance Type':'g6e.2xlarge','Operating System':'Linux','Location':'US East (N. Virginia)'}}}}


def command(script):
    return [sys.executable, '-u', '-c', script]


def archive_fixture(root, extra=None):
    files={'environment/uv.lock':b'fixture-lock'}
    manifest={'scope':'full_finqa_1147','ordered_ids':[f'fixture-{i}' for i in range(1147)],
              'files':{name:{'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()} for name,raw in files.items()}}
    manifest_raw=json.dumps(manifest).encode()
    files['PACKAGE.json']=manifest_raw
    path=root/'source.tar'
    with tarfile.open(path,'x') as archive:
        for name,raw in files.items():
            item=tarfile.TarInfo(name); item.size=len(raw); archive.addfile(item,io.BytesIO(raw))
        if extra is not None:
            archive.addfile(extra)
    return path,{'archive_bytes':path.stat().st_size,'archive_sha256':digest(path),
                 'package_manifest_sha256':hashlib.sha256(manifest_raw).hexdigest(),'scope':'full_finqa_1147'}


class ExecutionTests(unittest.TestCase):
    def test_process_stdout_stderr_cpu_and_peak_memory(self):
        with tempfile.TemporaryDirectory() as name:
            out=Path(name)/'process'
            result=run_process(command("import sys; x=bytearray(2*1024*1024); print('answer'); print('diagnostic',file=sys.stderr)"),
                               name,out,time.monotonic()+5,0.1)
            self.assertEqual(result['status'],'complete')
            self.assertEqual((out/'stdout.log').read_text(),'answer\n')
            self.assertEqual((out/'stderr.log').read_text(),'diagnostic\n')
            self.assertGreater(result['resource_usage']['max_rss_bytes'],2*1024*1024)
            self.assertGreater(result['resource_usage']['user_cpu_seconds'],0)
            self.assertEqual(result['outputs']['stdout.log']['sha256'],digest(out/'stdout.log'))
            with self.assertRaises(FileExistsError):
                run_process(command('pass'),name,out,time.monotonic()+5,0.1)

    def test_deadline_kills_ignoring_process_and_keeps_prefix(self):
        with tempfile.TemporaryDirectory() as name:
            result=run_process(command("import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); print('completed-prefix',flush=True); time.sleep(30)"),
                               name,Path(name)/'process',time.monotonic()+0.25,0.05)
            self.assertEqual(result['status'],'failed')
            self.assertEqual(result['stop_reason'],'deadline')
            self.assertEqual(result['signals'],['TERM','KILL'])
            self.assertEqual(result['exit_code'],-signal.SIGKILL)
            self.assertEqual((Path(name)/'process/stdout.log').read_text(),'completed-prefix\n')
            self.assertGreater(result['total_wall_ns'],250_000_000)
            self.assertLess(result['total_wall_ns'],3_000_000_000)
            with self.assertRaises(ProcessLookupError):
                os.kill(result['pid'],0)

    def test_leader_exit_cleans_its_child_group(self):
        with tempfile.TemporaryDirectory() as name:
            script="import subprocess,sys,time; p=subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)']); print(p.pid,flush=True)"
            result=run_process(command(script),name,Path(name)/'process',time.monotonic()+5,0.1)
            self.assertEqual(result['status'],'failed')
            self.assertTrue(result['descendant_cleanup'])
            self.assertEqual(result['stop_reason'],'descendants_after_leader_exit')
            child=int((Path(name)/'process/stdout.log').read_text())
            # A reparented zombie can remain visible until init reaps it.
            observed=subprocess.check_output(['ps','-o','stat=','-p',str(child)],text=True).strip() if subprocess.run(['kill','-0',str(child)],capture_output=True).returncode==0 else ''
            self.assertTrue(not observed or observed.startswith('Z'),observed)

    def test_expired_deadline_starts_zero_processes(self):
        with tempfile.TemporaryDirectory() as name:
            marker=Path(name)/'should-not-exist'
            result=run_process(command(f"from pathlib import Path; Path({str(marker)!r}).write_text('started')"),
                               name,Path(name)/'process',time.monotonic()-1,0.1)
            self.assertEqual(result['status'],'skipped')
            self.assertIsNone(result['pid'])
            self.assertFalse(marker.exists())

    def test_log_limit_preserves_output_and_marks_failure(self):
        with tempfile.TemporaryDirectory() as name:
            result=run_process(command("import sys,time; sys.stdout.write('x'*65536); sys.stdout.flush(); time.sleep(30)"),
                               name,Path(name)/'process',time.monotonic()+5,0.05,max_log_bytes=1024)
            self.assertEqual(result['stop_reason'],'log_size_limit')
            self.assertEqual(result['status'],'failed')
            self.assertEqual(result['signals'],['KILL'])
            self.assertEqual(result['outputs']['stdout.log']['bytes'],65536)

    def test_missing_executable_leaves_failure_receipt(self):
        with tempfile.TemporaryDirectory() as name:
            out=Path(name)/'process'
            with self.assertRaises(FileNotFoundError):
                run_process([str(Path(name)/'missing')],name,out,time.monotonic()+5,0.1)
            result=json.loads((out/'process.json').read_bytes())
            self.assertEqual(result['status'],'failed')
            self.assertIsNone(result['pid'])
            self.assertIn('error',result)

    def test_cancellation_uses_the_same_cleanup_and_receipt(self):
        with tempfile.TemporaryDirectory() as name:
            cancel_at=time.monotonic()+0.15
            result=run_process(command("import time; print('prefix',flush=True); time.sleep(30)"),name,Path(name)/'process',
                               time.monotonic()+5,0.05,lambda:signal.SIGTERM if time.monotonic()>=cancel_at else None)
            self.assertEqual(result['stop_reason'],'cancelled')
            self.assertEqual(result['status'],'failed')
            self.assertIn('TERM',result['signals'])

    def test_failed_arm_retains_later_controls_and_original_deadline(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name)
            limits=plan_fixture()['limits']
            limits['stage_seconds']={stage:5 for stage in STAGES}
            def commands(stage):
                return command("import sys; print('"+stage+"'); sys.exit("+('7' if stage=='base' else '0')+")")
            records=run_stages(commands,root,root,limits,time.monotonic()+5,lambda:None)
            self.assertEqual(list(records),list(STAGES))
            self.assertEqual(records['base']['exit_code'],7)
            self.assertEqual(records['calculator']['status'],'complete')
            self.assertEqual(records['grade']['status'],'complete')
            self.assertEqual(json.loads((root/'phases.json').read_bytes())['base']['exit_code'],7)

    def test_failed_setup_stops_before_any_arm(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name)
            records=run_stages(lambda stage:command('raise SystemExit(8)'),root,root,plan_fixture()['limits'],time.monotonic()+5,lambda:None)
            self.assertEqual(list(records),['runtime'])
            self.assertFalse((root/'processes/base').exists())

    def test_failed_process_launch_stays_in_the_stage_index(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name)
            records=run_stages(lambda stage:[str(root/'missing-executable')],root,root,
                               plan_fixture()['limits'],time.monotonic()+5,lambda:None)
            self.assertEqual(list(records),['runtime'])
            self.assertIsNone(records['runtime']['pid'])
            self.assertEqual(records['runtime']['status'],'failed')
            self.assertIn('error',json.loads((root/'phases.json').read_bytes())['runtime'])

    def test_global_deadline_keeps_later_stages_skipped(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name)
            limits=plan_fixture()['limits']
            limits['stage_seconds']={stage:5 for stage in STAGES}
            def commands(stage):
                return command('import time; time.sleep(30)' if stage=='base' else 'pass')
            records=run_stages(commands,root,root,limits,time.monotonic()+0.3,lambda:None)
            self.assertEqual(records['base']['stop_reason'],'deadline')
            for stage in ['calculator','operand_only','grade']:
                self.assertEqual(records[stage]['status'],'skipped')
                self.assertIsNone(records[stage]['pid'])

    def test_budget_and_source_changes_fail_before_execution(self):
        valid=plan_fixture()
        validate_plan(valid)
        for change in [lambda p:p['budget'].update(max_infrastructure_usd='2'),
                       lambda p:p['budget'].update(hourly_compute_usd='NaN'),
                       lambda p:p['limits'].update(collection_reserve_seconds=3600),
                       lambda p:p['limits']['stage_seconds'].update(base=float('inf')),
                       lambda p:p['controller_files']['feral_process.py'].update(sha256='0'*64),
                       lambda p:p.update(arms=['calculator','base','operand_only'])]:
            changed=copy.deepcopy(valid); change(changed)
            with self.assertRaises(ValueError):
                validate_plan(changed)
        estimate=cost_estimate(valid,1.5)
        self.assertEqual(estimate['billable_compute_seconds'],60)
        self.assertEqual(Decimal(estimate['estimated_compute_usd']),Decimal('2.24208')/60)
        self.assertIsNone(estimate['actual_billed_usd'])
        self.assertEqual(cost_estimate(valid,60.01)['billable_compute_seconds'],61)

    def test_source_archive_bindings_and_path_rejection(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name)
            archive,source=archive_fixture(root)
            extracted=extract_source(archive,root/'source',source)
            self.assertEqual(len(extracted['ordered_ids']),1147)
            self.assertEqual((root/'source/environment/uv.lock').read_bytes(),b'fixture-lock')
            changed=copy.deepcopy(source); changed['archive_sha256']='0'*64
            with self.assertRaisesRegex(ValueError,'archive digest'):
                extract_source(archive,root/'changed',changed)
            changed=copy.deepcopy(source); changed['package_manifest_sha256']='0'*64
            with self.assertRaisesRegex(ValueError,'package manifest'):
                extract_source(archive,root/'manifest-changed',changed)
            self.assertFalse((root/'manifest-changed').exists())
        for kind in ['parent','link']:
            with tempfile.TemporaryDirectory() as name:
                root=Path(name)
                extra=tarfile.TarInfo('../outside' if kind=='parent' else 'link')
                if kind=='link':
                    extra.type=tarfile.SYMTYPE; extra.linkname='/tmp/outside'
                archive,source=archive_fixture(root,extra)
                with self.assertRaisesRegex(ValueError,'member path or type'):
                    extract_source(archive,root/'source',source)
                self.assertFalse((root/'source').exists())

    def test_model_staging_copies_pinned_bytes_and_keeps_failed_file(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name); package=root/'package'; (package/'model').mkdir(parents=True)
            hub=root/'hub'; snapshot=hub/'models--fixture--model'/'snapshots'/'revision'
            snapshot.mkdir(parents=True)
            files={}
            for item,raw in [('a',b'first'),('b',b'second')]:
                (snapshot/item).write_bytes(raw)
                files[item]={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
            save(package/'model/FILES.json',{'id':'fixture/model','revision':'revision','files':files})
            out=root/'complete'; out.mkdir()
            stage_model(package,out,hub)
            self.assertEqual((out/'model/a').read_bytes(),b'first')
            self.assertEqual(json.loads((out/'model-staging.json').read_bytes())['status'],'complete')
            (snapshot/'b').write_bytes(b'broken')
            failed=root/'failed'; failed.mkdir()
            with self.assertRaisesRegex(ValueError,'model file differs'):
                stage_model(package,failed,hub)
            record=json.loads((failed/'model-staging.json').read_bytes())
            self.assertEqual(record['status'],'failed')
            self.assertEqual(list(record['files']),['a'])
            self.assertEqual(record['failed_file'],'b')
            self.assertEqual((failed/'model/a').read_bytes(),b'first')

    def test_runtime_failure_records_the_observed_source_digest(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name); environment=root/'environment'; environment.mkdir()
            (environment/'pyproject.toml').write_bytes(b'changed runtime')
            output=root/'out'; output.mkdir()
            with self.assertRaisesRegex(ValueError,'installed runtime source differs'):
                runtime_check(root,plan_fixture(),output,environment)
            record=json.loads((output/'runtime.json').read_bytes())
            self.assertEqual(record['status'],'failed')
            self.assertEqual(record['runtime_sources']['pyproject.toml'],digest(environment/'pyproject.toml'))

    def test_partial_line_is_preserved_and_primary_score_stays_absent(self):
        with tempfile.TemporaryDirectory() as name:
            path=Path(name)/'predictions.jsonl'
            path.write_bytes(b'{"id":"first","prediction":30}\n{"id":"second"')
            prefix=partial_records(path)
            self.assertEqual(prefix['complete_rows'],1)
            self.assertEqual(prefix['ordered_ids'],['first'])
            self.assertEqual(prefix['trailing_bytes'],14)
            self.assertEqual(prefix['sha256'],digest(path))

    def test_grader_keeps_failed_base_prefix_and_scores_completed_controls(self):
        from test_feral_comparison import row
        from feral_targets_v2 import ndjson
        with tempfile.TemporaryDirectory() as name:
            root=Path(name); package=root/'package'; output=root/'output'; output.mkdir()
            files={'inputs/model-inputs.jsonl':ndjson([row()]),'model/FILES.json':b'{"files":{}}',
                   'grader/targets.jsonl':ndjson([{'id':'fixture','kind':'legacy_exact','original_answer':'30'}])}
            bindings={}
            for filename,raw in files.items():
                path=package/filename; path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(raw)
                bindings[filename]={'bytes':len(raw),'sha256':digest(path),
                                    'phase':'grading' if filename.startswith('grader/') else 'prediction'}
            save(package/'PACKAGE.json',{'files':bindings,'ordered_ids':['fixture'],'scope':'controlled_fixture'})
            manifest_digest=digest(package/'PACKAGE.json')
            for arm in ['calculator','operand_only']:
                run_package(package,manifest_digest,arm,output/'arms'/arm)
            base=output/'arms/base'; base.mkdir()
            (base/'predictions.jsonl').write_bytes(b'{"id":"fixture","prediction":30}\n{"id":')
            save(output/'phases.json',{'base':{'status':'failed','stop_reason':'deadline','exit_code':-9},
                                      'calculator':{'status':'complete'},'operand_only':{'status':'complete'}})
            grade(package,{'source':{'package_manifest_sha256':manifest_digest}},output)
            result=json.loads((output/'comparison.json').read_bytes())
            self.assertEqual(result['status'],'incomplete')
            self.assertIsNone(result['arms']['base']['primary_metrics'])
            self.assertEqual(result['arms']['base']['prefix']['complete_rows'],1)
            self.assertGreater(result['arms']['base']['prefix']['trailing_bytes'],0)
            self.assertEqual(result['arms']['calculator']['primary_metrics']['v2_correct'],1)
            self.assertEqual(result['arms']['operand_only']['primary_metrics']['v2_correct'],0)


if __name__=='__main__':
    unittest.main()
