"""Check source overlay boundaries and the controller's memory stop."""
import copy
import io
import json
from pathlib import Path
import tarfile
import tempfile
import subprocess
import sys
import unittest
from unittest.mock import patch
from weight_pilot_package import OVERLAY, PLAN, payload, verify, archive
from weight_source_kit import encode, sha
from weight_pilot_controller import MemoryGuard, commands


def tar_bytes(files):
    output=io.BytesIO()
    with tarfile.open(fileobj=output,mode='w') as tar:
        for name,raw in files.items():
            entry=tarfile.TarInfo(name);entry.size=len(raw);tar.addfile(entry,io.BytesIO(raw))
    return output.getvalue()


def fixture():
    base=tar_bytes({'original.json':b'{}'})
    plan={'source_kit':{'bytes':len(base),'sha256':sha(base)},'input_hashes':{'original.json':sha(b'{}')}}
    files={name:b'fixed source' for name in OVERLAY};files[PLAN]=encode(plan);files['SOURCE-KIT.tar']=base
    seal(files);return files


def seal(files):
    files['PILOT-KIT.json']=encode({'schema':'ilxyr.weight_pilot_source_kit.v1','source_commit':'a'*40,
        'execution_authorized':False,'files':{n:{'bytes':len(raw),'sha256':sha(raw)} for n,raw in files.items() if n!='PILOT-KIT.json'}})


class PackageTests(unittest.TestCase):
    # Base kit verification has its own real-source tests; these cases isolate the overlay.
    def setUp(self):
        self.patcher=patch('weight_pilot_package.verify_payload',return_value={});self.patcher.start();self.addCleanup(self.patcher.stop)

    def test_round_trip_and_wrong_digest(self):
        files=fixture()
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'pilot.tar';archive(files,path)
            self.assertEqual(verify(path,sha(path.read_bytes()))[0],files)
            with self.assertRaisesRegex(ValueError,'digest'):
                verify(path,'0'*64)

    def test_changed_source_and_roster(self):
        files=fixture();files[OVERLAY[1]]=b'changed'
        with self.assertRaisesRegex(ValueError,'binding'):
            payload(files)
        files=fixture();files['unexpected']=b'new';seal(files)
        with self.assertRaisesRegex(ValueError,'roster'):
            payload(files)

    def test_base_kit_binding(self):
        files=fixture();files['SOURCE-KIT.tar']=tar_bytes({'original.json':b'changed'});seal(files)
        with self.assertRaisesRegex(ValueError,'original source kit'):
            payload(files)

    def test_original_source_overlap(self):
        files=fixture();base=tar_bytes({'original.json':b'{}',OVERLAY[1]:b'old source'})
        files['SOURCE-KIT.tar']=base;plan=json.loads(files[PLAN]);plan['source_kit']={'bytes':len(base),'sha256':sha(base)};files[PLAN]=encode(plan);seal(files)
        with self.assertRaisesRegex(ValueError,'changes original'):
            payload(files)

    def test_preserved_input_binding(self):
        files=fixture();plan=json.loads(files[PLAN]);plan['input_hashes']['original.json']='0'*64;files[PLAN]=encode(plan);seal(files)
        with self.assertRaisesRegex(ValueError,'input differs'):
            payload(files)

    def test_source_identity(self):
        files=fixture();manifest=json.loads(files['PILOT-KIT.json']);manifest['source_commit']='main';files['PILOT-KIT.json']=encode(manifest)
        with self.assertRaisesRegex(ValueError,'source commit'):
            payload(files)

    def test_link_member(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'pilot.tar'
            with tarfile.open(path,'w') as tar:
                entry=tarfile.TarInfo('escape');entry.type=tarfile.SYMTYPE;entry.linkname='/tmp';tar.addfile(entry)
            with self.assertRaisesRegex(ValueError,'member type'):
                verify(path,sha(path.read_bytes()))

    def test_memory_stop_is_latched(self):
        values=iter([0,99,101,0]);clock=iter([0,0.02,0.04,0.06])
        guard=MemoryGuard(100,0.02,reader=lambda:next(values),clock=lambda:next(clock))
        self.assertIsNone(guard());self.assertIsNone(guard());self.assertEqual(guard(),'descendant_rss_limit')
        self.assertEqual(guard(),'descendant_rss_limit');self.assertEqual(guard.report()['samples'],3)
        self.assertIsNone(guard.report()['exact_peak_memory_bytes'])

    def test_memory_observation_failure_stops(self):
        def failure():
            raise PermissionError('test denied')
        guard=MemoryGuard(100,0.02,reader=failure)
        self.assertIn('memory_observation_failure',guard())

    def test_memory_sampling_period(self):
        times=iter([0,0.001,0.021]);reads=[]
        guard=MemoryGuard(100,0.02,reader=lambda:reads.append(1) or 3,clock=lambda:next(times))
        guard();guard();guard();self.assertEqual(len(reads),2)

    @unittest.skipUnless(sys.platform=='linux','Linux process observations')
    def test_live_descendant_memory(self):
        child=subprocess.Popen([sys.executable,'-c','import time; b=bytearray(2*1024*1024); print("ready",flush=True); time.sleep(10)'],stdout=subprocess.PIPE,text=True)
        try:
            self.assertEqual(child.stdout.readline().strip(),'ready')
            self.assertGreater(MemoryGuard.read(),2*1024*1024)
        finally:
            child.kill();child.wait(timeout=3);child.stdout.close()

    def test_frozen_control_order(self):
        plan=json.loads((Path(__file__).resolve().parents[1]/PLAN).read_bytes())
        roster=commands(Path('/runtime'),Path('/output'),plan)['jobs']
        self.assertEqual([r['id'] for r in roster],[r['id'] for r in plan['ordered_jobs']])
        self.assertEqual(len({tuple(r['run']) for r in roster}),16)
        for r in roster:
            self.assertEqual(r['run'][2],r['id']);self.assertIn(r['directory'],r['check']);self.assertEqual(r['replay'][-1],r['directory'])


class ControllerTests(unittest.TestCase):
    def run_controller(self, fail=None, controller_seconds=None):
        from contextlib import ExitStack
        from weight_pilot_controller import execute
        plan=json.loads((Path(__file__).resolve().parents[1]/PLAN).read_bytes())
        if controller_seconds is not None:
            plan['execution_limits']['maximum_controller_seconds']=controller_seconds
        invoked=[];cleanup_calls=[]
        with tempfile.TemporaryDirectory() as tmp, ExitStack() as stack:
            output=Path(tmp)/'output';output.mkdir();runtime=output/'runtime';runtime.mkdir()
            roster=commands(runtime,output,plan)
            prepared={'source_commit':'a'*40,'plan_sha256':'b'*64,'commands':roster}
            def fake_load(path):
                path=Path(path)
                if path.name=='PILOT-PLAN.json':
                    return plan
                if path.parent.name=='build':
                    return {'status':'pass','lie_executable_sha256':[plan['runtime']['lie_sha256']]*2,'zero_executable_sha256':plan['runtime']['zero_sha256']}
                return {'hold':'oracle_call_limit','totals':{'oracle_calls':20}}
            def fake_process(command,cwd,path,deadline,grace,**kwargs):
                path.mkdir(parents=True);invoked.append(path.name)
                return {'status':'failed' if path.name==fail else 'complete','stop_reason':'invented_process_failure' if path.name==fail else None}
            def cleanup():
                cleanup_calls.append(1);return {'adopted_pids':[],'remaining_pids':[]}
            for name,value in [('prepare',lambda *a:prepared),('load',fake_load),('sha',lambda p:'c'*64),
                               ('run_process',fake_process),('adopt_children',lambda:None),('stop_adopted_children',cleanup)]:
                stack.enter_context(patch('weight_pilot_controller.'+name,value))
            stack.enter_context(patch('weight_pilot_controller.platform.system',return_value='Linux'))
            stack.enter_context(patch('weight_pilot_controller.platform.machine',return_value='x86_64'))
            result=execute(Path(tmp)/'package','d'*64,output)
            saved=json.loads((output/'RESULT.json').read_bytes());self.assertEqual(saved,result)
        self.assertEqual(len(cleanup_calls),len(invoked)+1)
        return result,invoked

    def test_all_jobs_keep_saved_holds(self):
        result,invoked=self.run_controller()
        self.assertEqual(result['status'],'complete_record');self.assertEqual(len(invoked),49)
        self.assertEqual(len(result['jobs']),16)
        self.assertTrue(all(j['status']=='verified' and j['hold']=='oracle_call_limit' for j in result['jobs']))

    def test_job_failure_preserves_and_skips_remaining(self):
        result,invoked=self.run_controller('0-uncached_fixed')
        self.assertEqual(invoked,['build','0-uncached_fixed']);self.assertEqual(result['status'],'partial_record')
        self.assertEqual(result['jobs'][0]['status'],'failed');self.assertEqual(sum(j['status']=='skipped' for j in result['jobs']),15)

    def test_checker_failure_stops_future_jobs(self):
        result,invoked=self.run_controller('0-uncached_fixed-check')
        self.assertEqual(invoked,['build','0-uncached_fixed','0-uncached_fixed-check'])
        self.assertEqual(result['jobs'][0]['reason'],'check_failed');self.assertEqual(sum(j['status']=='skipped' for j in result['jobs']),15)

    def test_controller_reserves_collection_and_verification(self):
        result,invoked=self.run_controller(controller_seconds=700)
        self.assertEqual(invoked,['build']);self.assertEqual(result['status'],'partial_record')
        self.assertTrue(all(j['reason']=='controller_reserve' for j in result['jobs']))

    def test_build_failure_keeps_full_skipped_roster(self):
        result,invoked=self.run_controller('build')
        self.assertEqual(invoked,['build']);self.assertEqual(result['status'],'failed')
        self.assertTrue(all(j['status']=='skipped' for j in result['jobs']));self.assertEqual(len(result['jobs']),16)


if __name__=='__main__':
    unittest.main()
