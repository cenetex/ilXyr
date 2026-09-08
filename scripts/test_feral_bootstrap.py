import base64
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest

from feral_cloud_package import BODY_PATH, BUCKET, dispatch, encode, launch_request, render_user_data, sha

ROOT=Path(__file__).resolve().parents[1]


def write_tar(path,files):
    with tarfile.open(path,'x',format=tarfile.USTAR_FORMAT) as archive:
        for name,raw in sorted(files.items()):
            member=tarfile.TarInfo(name); member.size=len(raw); archive.addfile(member,io.BytesIO(raw))


def fixture_host(root):
    body=(ROOT/BODY_PATH).read_bytes()
    plan={'limits':{'max_instance_seconds':3600},'budget':{'max_infrastructure_usd':'3.00'},
          'runtime':{'image':'ghcr.io/atimics/feral-7b-sec-qwen@sha256:'+'c'*64},
          'source':{'archive_sha256':'d'*64},'provider':{'name':'aws_ec2','instance_type':'g6e.2xlarge'}}
    files={'EXECUTION-PLAN.json':encode(plan),'scripts/run_feral_comparison.py':b'# controlled host fixture\n'}
    manifest={'execution_plan_sha256':sha(files['EXECUTION-PLAN.json']),
              'files':{name:{'bytes':len(raw),'sha256':sha(raw)} for name,raw in files.items()}}
    files['EXECUTION-PACKAGE.json']=encode(manifest)
    execution=root/'execution.tar';write_tar(execution,files)
    host={'schema':'ilxyr.feral_host_package.v1','bucket':BUCKET,'max_instance_seconds':3600,'max_infrastructure_usd':'3.00',
          'bootstrap_body_sha256':sha(body),'execution_archive_sha256':sha(execution.read_bytes()),
          'execution_archive_bytes':execution.stat().st_size,'execution_plan_sha256':manifest['execution_plan_sha256']}
    archive=root/'host.tar'; write_tar(archive,{'HOST-PACKAGE.json':encode(host),'execution.tar':execution.read_bytes(),'user-data.sh':body})
    binding={'run_id':'feral-finqa-20260905T000000Z','launch_epoch_seconds':int(time.time()),
             'host_package_sha256':sha(archive.read_bytes()),'host_package_version':'fixture-version','approval_reference':'fixture-approval'}
    return body,host,binding,archive


STUB=r'''import base64,hashlib,json,os,shutil,subprocess,sys
from pathlib import Path
name=Path(sys.argv[0]).name; args=sys.argv[1:]
with open(os.environ['FERAL_TEST_LOG'],'a') as f:f.write(json.dumps({'name':name,'args':args})+'\n')
mode=os.environ.get('FERAL_TEST_FAILURE','')
def option(flag):return args[args.index(flag)+1]
if name in ['shutdown','systemd-run','systemctl']:
    sys.exit(0)
if name=='timeout':
    index=next(i for i,a in enumerate(args) if not a.startswith('--'))
    result=subprocess.run(args[index+1:]);sys.exit(result.returncode)
if name=='curl':
    if mode=='metadata':sys.exit(13)
    suffix=args[-1].rsplit('/',1)[-1]
    print({'token':'fixture-token','instance-id':'i-123abc','instance-type':'g6e.2xlarge','ami-id':'ami-0d3378afe7683c867'}[suffix]);sys.exit(0)
if name=='docker':
    if args[0]=='pull':sys.exit(9 if mode=='image' else 0)
    if args[:2]==['image','inspect']:print('[]');sys.exit(0)
    if args[:2]==['rm','-f']:sys.exit(0)
    if args[0]=='run':
        mount=next(a for a in args if a.startswith('type=bind,src=') and a.endswith('dst=/work/output'))
        output=Path(mount.split(',src=',1)[1].split(',dst=',1)[0])
        for path,raw in [('run/model/weight.bin',b'fixture-model'),('run/source/grader/targets.jsonl',b'fixture-targets'),
                         ('run/arms/base/predictions.jsonl',b'{"id":"fixture"}\n'),('run/execution.json',b'{"status":"complete"}\n')]:
            p=output/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw)
        sys.exit(7 if mode=='controller' else 0)
if name=='aws':
    if args[:2]==['sts','get-caller-identity']:
        print('022118847419');sys.exit(0)
    if args[:2]==['ec2','run-instances']:
        assert json.loads(option('--cli-input-json'))['DryRun'] is False
        print('Injected response timeout',file=sys.stderr);sys.exit(255)
    if args[:2]==['s3api','get-object']:
        if mode=='package':sys.exit(11)
        destination=args[args.index('--version-id')+2]
        shutil.copyfile(os.environ['FERAL_TEST_PACKAGE'],destination);print('{}');sys.exit(0)
    if args[:2]==['s3api','put-object']:
        assert option('--if-none-match')=='*'
        assert option('--server-side-encryption')=='AES256'
        raw=Path(option('--body')).read_bytes()
        assert base64.b64encode(hashlib.sha256(raw).digest()).decode()==option('--checksum-sha256')
        key=option('--key')
        if mode=='collection' and key.endswith('predictions.jsonl'):sys.exit(12)
        path=Path(os.environ['FERAL_TEST_S3'])/key
        path.parent.mkdir(parents=True,exist_ok=True)
        try:
            with path.open('xb') as f:f.write(raw)
        except FileExistsError:
            print('PreconditionFailed',file=sys.stderr);sys.exit(14)
        print(json.dumps({'VersionId':'fixture-version','ChecksumSHA256':option('--checksum-sha256')}));sys.exit(0)
raise SystemExit('Unexpected fixture call: '+name+' '+str(args))
'''


def run_fixture(root, failure='', expired=False, tamper=False):
    body,host,binding,archive=fixture_host(root)
    if expired:binding['launch_epoch_seconds']-=4000
    bin_dir=root/'bin';bin_dir.mkdir()
    for name in ['aws','curl','docker','systemd-run','systemctl','shutdown','timeout']:
        path=bin_dir/name;path.write_text('#!'+sys.executable+'\n'+STUB);path.chmod(0o755)
    script=root/'user-data.sh'
    script.write_bytes(render_user_data(body,host,binding,root/'work',script)+(b':\n' if tamper else b''))
    log=root/'calls.jsonl';s3=root/'s3';s3.mkdir()
    env={**os.environ,'PATH':str(bin_dir)+os.pathsep+os.environ['PATH'],'FERAL_TEST_LOG':str(log),
         'FERAL_TEST_PACKAGE':str(archive),'FERAL_TEST_S3':str(s3),'FERAL_TEST_FAILURE':failure}
    completed=subprocess.run(['bash',str(script)],env=env,text=True,capture_output=True,timeout=15)
    calls=[json.loads(line) for line in log.read_text().splitlines()]
    status=root/'work/host-terminal.json'
    return completed,calls,json.loads(status.read_bytes()) if status.exists() else None,binding


class BootstrapTests(unittest.TestCase):
    def test_success_collects_predictions_excludes_bulk_files_and_shuts_down(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name);process,calls,status,binding=run_fixture(root)
            self.assertEqual(process.returncode,0,process.stderr+process.stdout)
            self.assertEqual(status['status'],'complete')
            self.assertEqual(status['instance_id'],'i-123abc')
            self.assertEqual(status['user_data_sha256'],sha((root/'user-data.sh').read_bytes()))
            self.assertTrue(status['collection_complete'])
            self.assertEqual(calls[0]['name'],'systemd-run')
            self.assertEqual(calls[-1]['name'],'shutdown')
            timer=calls[0]['args'];self.assertIn('/usr/sbin/shutdown',timer)
            seconds=int(next(a.split('=',1)[1] for a in timer if a.startswith('--on-active=')))
            self.assertTrue(3500<=seconds<=3570)
            keys=[c['args'][c['args'].index('--key')+1] for c in calls if c['name']=='aws' and c['args'][:2]==['s3api','put-object']]
            self.assertTrue(any(k.endswith('predictions.jsonl') for k in keys))
            self.assertFalse(any('/model/' in k or '/source/' in k for k in keys))
            terminal=root/'s3'/'runs'/binding['run_id']/'host-terminal.json'
            self.assertEqual(json.loads(terminal.read_bytes())['status'],'complete')
            docker=next(c['args'] for c in calls if c['name']=='docker' and c['args'][0]=='run')
            for flag in ['--network','none','--memory','56g','--cpus','8','--read-only','--entrypoint']:
                self.assertIn(flag,docker)

    def test_setup_failures_keep_cause_and_shutdown(self):
        for mode,phase in [('metadata','metadata'),('package','package'),('image','image')]:
            with self.subTest(mode=mode),tempfile.TemporaryDirectory() as name:
                process,calls,status,_=run_fixture(Path(name),mode)
                self.assertNotEqual(process.returncode,0)
                self.assertEqual(status['status'],'failed')
                self.assertEqual(status['failed_phase'],phase)
                self.assertEqual(calls[0]['name'],'systemd-run')
                self.assertEqual(calls[-1]['name'],'shutdown')
                self.assertFalse(any(c['name']=='docker' and c['args'][0]=='run' for c in calls))

    def test_controller_failure_collects_prefix_and_cleans_container(self):
        with tempfile.TemporaryDirectory() as name:
            process,calls,status,_=run_fixture(Path(name),'controller')
            self.assertEqual(process.returncode,7)
            self.assertEqual(status['failed_phase'],'controller')
            self.assertTrue(any(c['name']=='docker' and c['args'][:2]==['rm','-f'] for c in calls))
            self.assertTrue(any(c['name']=='aws' and c['args'][:2]==['s3api','put-object'] and any(a.endswith('predictions.jsonl') for a in c['args']) for c in calls))
            self.assertEqual(calls[-1]['name'],'shutdown')

    def test_collection_failure_marks_the_host_failed(self):
        with tempfile.TemporaryDirectory() as name:
            process,calls,status,_=run_fixture(Path(name),'collection')
            self.assertEqual(process.returncode,1)
            self.assertFalse(status['collection_complete'])
            self.assertEqual(status['failed_phase'],'collect')
            self.assertEqual(status['status'],'failed')
            self.assertEqual(calls[-1]['name'],'shutdown')

    def test_expired_launch_stops_before_cloud_or_package_work(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name);process,calls,status,_=run_fixture(root,expired=True)
            self.assertNotEqual(process.returncode,0)
            self.assertEqual([c['name'] for c in calls],['shutdown'])
            self.assertFalse((root/'work').exists())
            self.assertIsNone(status)

    def test_changed_bootstrap_body_stops_before_metadata(self):
        with tempfile.TemporaryDirectory() as name:
            process,calls,status,_=run_fixture(Path(name),tamper=True)
            self.assertNotEqual(process.returncode,0)
            self.assertEqual(status['failed_phase'],'bootstrap')
            self.assertFalse(any(c['name']=='curl' for c in calls))
            self.assertEqual(calls[-1]['name'],'shutdown')

    def test_rendered_request_uses_dry_run_and_stable_identity(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name);body,host,binding,_=fixture_host(root)
            user_data=render_user_data(body,host,binding)
            request=launch_request(user_data,binding,{'subnet_id':'subnet-123abc','security_group_id':'sg-123abc'})
            self.assertTrue(request['DryRun'])
            self.assertEqual(request['ClientToken'],binding['run_id'])
            self.assertEqual(request['MinCount'],1);self.assertEqual(request['MaxCount'],1)
            self.assertEqual(request['InstanceInitiatedShutdownBehavior'],'terminate')
            self.assertEqual(request['UserData'].encode('utf-8'),user_data)
            self.assertEqual(render_user_data(body,host,binding),user_data)
            for key in ['run_id','host_package_version','approval_reference']:
                changed=copy.deepcopy(binding);changed[key]='value; $(touch /tmp/unwanted)'
                with self.assertRaises(ValueError):render_user_data(body,host,changed)

    def test_dispatch_checks_approval_before_the_fake_aws_call(self):
        with tempfile.TemporaryDirectory() as name:
            body,host,binding,_=fixture_host(Path(name))
            request=launch_request(render_user_data(body,host,binding),binding,{'subnet_id':'subnet-abc','security_group_id':'sg-abc'})
            seen=[]
            def aws(args,**_kwargs):
                if args[1]=='sts': return subprocess.CompletedProcess(args,0,'022118847419\n','')
                value=json.loads(args[args.index('--cli-input-json')+1]);seen.append(value)
                return subprocess.CompletedProcess(args,255,'','DryRunOperation') if value['DryRun'] else subprocess.CompletedProcess(args,0,'{"Instances":[{"InstanceId":"i-abc"}]}','')
            self.assertEqual(dispatch(request,host,binding,'fixture',runner=aws)['status'],'dry_run_passed')
            with self.assertRaises(ValueError):dispatch(request,host,binding,'fixture',{},runner=aws)
            self.assertEqual(len(seen),1)
            approval={'host_package_sha256':binding['host_package_sha256'],'execution_plan_sha256':host['execution_plan_sha256'],
                      'max_instance_seconds':3600,'max_infrastructure_usd':'3.00','approval_reference':binding['approval_reference']}
            result=dispatch(request,host,binding,'fixture',approval,runner=aws)
            self.assertEqual(result['status'],'launched')
            self.assertFalse(seen[-1]['DryRun'])
            self.assertEqual(result['instance_id'],'i-abc')
            self.assertEqual(result['user_data_sha256'],sha(render_user_data(body,host,binding)))

    def test_wrong_account_stops_before_instance_request(self):
        with tempfile.TemporaryDirectory() as name:
            body,host,binding,_=fixture_host(Path(name))
            request=launch_request(render_user_data(body,host,binding),binding,{'subnet_id':'subnet-abc','security_group_id':'sg-abc'})
            calls=[]
            def aws(args,**_kwargs):
                calls.append(args)
                return subprocess.CompletedProcess(args,0,'111111111111\n','')
            with self.assertRaisesRegex(RuntimeError,'account preflight'):
                dispatch(request,host,binding,'fixture',runner=aws)
            self.assertEqual(len(calls),1)
            self.assertEqual(calls[0][1],'sts')

    def test_uncertain_launch_preserves_the_submitted_request(self):
        with tempfile.TemporaryDirectory() as name:
            body,host,binding,_=fixture_host(Path(name))
            request=launch_request(render_user_data(body,host,binding),binding,{'subnet_id':'subnet-abc','security_group_id':'sg-abc'})
            approval={'host_package_sha256':binding['host_package_sha256'],'execution_plan_sha256':host['execution_plan_sha256'],
                      'max_instance_seconds':3600,'max_infrastructure_usd':'3.00','approval_reference':binding['approval_reference']}
            submitted=[]
            def aws(args,**_kwargs):
                if args[1]=='sts':return subprocess.CompletedProcess(args,0,'022118847419\n','')
                raise subprocess.TimeoutExpired(args,45)
            with self.assertRaises(subprocess.TimeoutExpired):
                dispatch(request,host,binding,'fixture',approval,runner=aws,on_submit=lambda value:submitted.append(copy.deepcopy(value)))
            self.assertEqual(len(submitted),1)
            self.assertFalse(submitted[0]['DryRun'])
            self.assertEqual(submitted[0]['ClientToken'],binding['run_id'])

    def test_cli_records_an_unknown_launch_outcome(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name);body,host,binding,archive=fixture_host(root)
            approval={'host_package_sha256':binding['host_package_sha256'],'execution_plan_sha256':host['execution_plan_sha256'],
                      'max_instance_seconds':3600,'max_infrastructure_usd':'3.00','approval_reference':binding['approval_reference']}
            for filename,value in [('binding.json',binding),('approval.json',approval),
                                   ('network.json',{'subnet_id':'subnet-abc','security_group_id':'sg-abc'})]:
                (root/filename).write_bytes(encode(value))
            bin_dir=root/'bin';bin_dir.mkdir();aws=bin_dir/'aws'
            aws.write_text('#!'+sys.executable+'\n'+STUB);aws.chmod(0o755)
            env={**os.environ,'PATH':str(bin_dir)+os.pathsep+os.environ['PATH'],'FERAL_TEST_LOG':str(root/'calls.jsonl')}
            command=[sys.executable,str(ROOT/'scripts/feral_cloud_package.py'),'launch',
                     '--host-package',str(archive),'--host-package-sha256',binding['host_package_sha256'],
                     '--binding',str(root/'binding.json'),'--network',str(root/'network.json'),
                     '--approval',str(root/'approval.json'),'--profile','fixture','--out',str(root/'request')]
            completed=subprocess.run(command,env=env,capture_output=True,text=True,timeout=15)
            self.assertNotEqual(completed.returncode,0)
            receipt=json.loads((root/'request/receipt.json').read_bytes())
            self.assertEqual(receipt['status'],'launch_outcome_unknown')
            self.assertEqual(receipt['client_token'],binding['run_id'])
            submitted=(root/'request/submitted-request.json').read_bytes()
            self.assertEqual(receipt['submitted_request_sha256'],sha(submitted))
            self.assertFalse(json.loads(submitted)['DryRun'])
            self.assertEqual(len((root/'calls.jsonl').read_text().splitlines()),2)


if __name__=='__main__':unittest.main()
