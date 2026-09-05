"""Package and render the FERAL host bootstrap with fixed launch parameters."""

import argparse
import base64
import hashlib
import io
import json
from pathlib import Path
import re
import shlex
import subprocess
import tarfile
import time

BUCKET = 'ilxyr-feral-7b-calibration-022118847419-us-east-1'
BODY_PATH = 'scripts/aws/feral-comparison-user-data.sh'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encode(value):
    return (json.dumps(value,indent=2,sort_keys=True,allow_nan=False)+'\n').encode()


def build(repo, revision, execution_archive, output):
    if not re.fullmatch('[0-9a-f]{40}',revision):
        raise ValueError('a full committed revision is required')
    def committed(name):
        return subprocess.check_output(['git','-C',str(repo),'show',revision+':'+name],stderr=subprocess.PIPE)
    execution=json.loads(committed('experiments/research-step-14/ARCHIVE.json'))
    if execution_archive.stat().st_size!=execution['archive_bytes']:
        raise ValueError('execution archive size differs')
    raw=execution_archive.read_bytes()
    if len(raw)!=execution['archive_bytes'] or sha(raw)!=execution['archive_sha256']:
        raise ValueError('execution archive differs')
    body=committed(BODY_PATH)
    host={'schema':'ilxyr.feral_host_package.v1','source_commit':revision,
        'bootstrap_body_sha256':sha(body),'execution_archive_sha256':sha(raw),
        'execution_archive_bytes':len(raw),'execution_plan_sha256':execution['execution_plan_sha256'],
        'max_instance_seconds':3600,'max_infrastructure_usd':'3.00','bucket':BUCKET}
    files={'HOST-PACKAGE.json':encode(host),'execution.tar':raw,'user-data.sh':body}
    with tarfile.open(output,'x',format=tarfile.USTAR_FORMAT) as archive:
        for name,data in sorted(files.items()):
            member=tarfile.TarInfo(name); member.size=len(data); member.mode=0o644; member.mtime=0
            archive.addfile(member,io.BytesIO(data))
    return {'schema':'ilxyr.feral_host_archive.v1','source_commit':revision,
        'archive_sha256':sha(output.read_bytes()),'archive_bytes':output.stat().st_size,
        'bootstrap_body_sha256':sha(body),'execution_plan_sha256':host['execution_plan_sha256'],
        'execution_archive_sha256':host['execution_archive_sha256'],'execution_authorized':False}


def inspect_package(path, expected):
    if path.stat().st_size>8*1024*1024 or sha(path.read_bytes())!=expected:
        raise ValueError('host package digest or size differs')
    with tarfile.open(path,'r:') as archive:
        members=archive.getmembers()
        if len(members)!=3 or {m.name for m in members}!={'HOST-PACKAGE.json','execution.tar','user-data.sh'} or any(not m.isfile() for m in members):
            raise ValueError('host package roster differs')
        files={m.name:archive.extractfile(m).read() for m in members}
    host=json.loads(files['HOST-PACKAGE.json'])
    if sha(files['user-data.sh'])!=host['bootstrap_body_sha256'] or sha(files['execution.tar'])!=host['execution_archive_sha256'] or len(files['execution.tar'])!=host['execution_archive_bytes']:
        raise ValueError('host package file binding differs')
    if host['schema']!='ilxyr.feral_host_package.v1' or host['max_instance_seconds']!=3600 or host['max_infrastructure_usd']!='3.00' or host['bucket']!=BUCKET:
        raise ValueError('host scope or budget differs')
    return host,files['user-data.sh']


def render_user_data(body, host, binding, work_root='/opt/feral-comparison', user_data_file='/var/lib/cloud/instance/user-data.txt'):
    patterns={'run_id':r'feral-finqa-[0-9]{8}T[0-9]{6}Z','host_package_sha256':r'[0-9a-f]{64}',
              'host_package_version':r'[A-Za-z0-9._+/=-]{1,256}',
              'approval_reference':r'[A-Za-z0-9._-]{1,100}'}
    for name,pattern in patterns.items():
        if not isinstance(binding[name],str) or not re.fullmatch(pattern,binding[name]):
            raise ValueError('launch binding differs: '+name)
    if type(binding['launch_epoch_seconds']) is not int or binding['launch_epoch_seconds']<=0:
        raise ValueError('launch time differs')
    if sha(body)!=host['bootstrap_body_sha256']:
        raise ValueError('bootstrap body differs')
    values={'FERAL_RUN_ID':binding['run_id'],'FERAL_LAUNCH_EPOCH':str(binding['launch_epoch_seconds']),
        'FERAL_BUCKET':BUCKET,'FERAL_HOST_PACKAGE_SHA256':binding['host_package_sha256'],
        'FERAL_HOST_PACKAGE_KEY':'packages/feral-comparison/'+binding['host_package_sha256']+'.tar',
        'FERAL_HOST_PACKAGE_VERSION':binding['host_package_version'],
        'FERAL_EXECUTION_PLAN_SHA256':host['execution_plan_sha256'],
        'FERAL_BOOTSTRAP_BODY_SHA256':host['bootstrap_body_sha256'],
        'FERAL_APPROVAL_REFERENCE':binding['approval_reference'],'FERAL_WORK_ROOT':str(work_root),
        'FERAL_CONTAINER_NAME':binding['run_id'],'FERAL_USER_DATA_FILE':str(user_data_file)}
    prefix='#!/bin/bash\n'+''.join(name+'='+shlex.quote(value)+'\n' for name,value in values.items())
    return (prefix+'\n# FERAL_BOOTSTRAP_BODY\n').encode()+body


def launch_request(user_data, binding, network):
    for name,pattern in [('subnet_id',r'subnet-[0-9a-f]+'),('security_group_id',r'sg-[0-9a-f]+')]:
        if not isinstance(network[name],str) or not re.fullmatch(pattern,network[name]):
            raise ValueError('network identity differs: '+name)
    return {'DryRun':True,'ImageId':'ami-0d3378afe7683c867','InstanceType':'g6e.2xlarge',
        'MinCount':1,'MaxCount':1,'ClientToken':binding['run_id'],
        'IamInstanceProfile':{'Name':'ilxyr-feral-7b-calibration-ec2'},
        'NetworkInterfaces':[{'DeviceIndex':0,'SubnetId':network['subnet_id'],
            'Groups':[network['security_group_id']],'AssociatePublicIpAddress':True,'DeleteOnTermination':True}],
        'InstanceInitiatedShutdownBehavior':'terminate',
        'MetadataOptions':{'HttpTokens':'required','HttpEndpoint':'enabled'},
        'BlockDeviceMappings':[{'DeviceName':'/dev/xvda','Ebs':{'VolumeSize':150,'VolumeType':'gp3','DeleteOnTermination':True,'Encrypted':True}}],
        'UserData':base64.b64encode(user_data).decode(),
        'TagSpecifications':[{'ResourceType':kind,'Tags':[{'Key':'Project','Value':'feral-7b'},
            {'Key':'RunId','Value':binding['run_id']},{'Key':'HostPackageSha256','Value':binding['host_package_sha256']}]} for kind in ['instance','volume']]}


def dispatch(request, host, binding, profile, approval=None, runner=subprocess.run, on_submit=lambda request: None):
    request=dict(request)
    if request.get('DryRun') is not True:
        raise ValueError('reviewed request must begin in dry-run mode')
    if approval is not None:
        expected={'host_package_sha256':binding['host_package_sha256'],
            'execution_plan_sha256':host['execution_plan_sha256'],'max_instance_seconds':3600,
            'max_infrastructure_usd':'3.00','approval_reference':binding['approval_reference']}
        if approval!=expected or binding['approval_reference']=='pending-user':
            raise ValueError('launch approval and package differ')
        if not 0<=time.time()-binding['launch_epoch_seconds']<=60:
            raise ValueError('render a fresh launch time after approval')
        request['DryRun']=False
    identity=runner(['aws','sts','get-caller-identity','--profile',profile,'--query','Account','--output','text','--no-cli-pager'],capture_output=True,text=True,timeout=20)
    if identity.returncode!=0 or identity.stdout.strip()!='022118847419':
        raise RuntimeError('AWS account preflight failed: '+identity.stderr.strip())
    on_submit(request)
    result=runner(['aws','ec2','run-instances','--profile',profile,'--region','us-east-1',
        '--cli-input-json',json.dumps(request,separators=(',',':')),'--no-cli-pager'],capture_output=True,text=True,timeout=45)
    if approval is None:
        if result.returncode==0 or 'DryRunOperation' not in result.stderr:
            raise RuntimeError('AWS dry run failed: '+result.stderr.strip())
        return {'status':'dry_run_passed','instances_created':0}
    if result.returncode!=0:
        raise RuntimeError('AWS launch response needs inspection with the same client token: '+result.stderr.strip())
    value=json.loads(result.stdout)
    instances=value['Instances']
    if len(instances)!=1 or not re.fullmatch(r'i-[0-9a-f]+',instances[0]['InstanceId']):
        raise ValueError('launch response identity differs')
    return {'status':'launched','instance_id':instances[0]['InstanceId'],
        'client_token':binding['run_id'],'request_sha256':sha(encode(request)),
        'user_data_sha256':sha(base64.b64decode(request['UserData'])),
        'host_package_sha256':binding['host_package_sha256'],'execution_plan_sha256':host['execution_plan_sha256'],
        'max_instance_seconds':3600,'max_infrastructure_usd':'3.00'}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='mode',required=True)
    package=sub.add_parser('build')
    for name in ['repo','execution-archive','out']: package.add_argument('--'+name,type=Path,required=True)
    package.add_argument('--revision',required=True)
    for mode in ['render','dry-run','launch']:
        item=sub.add_parser(mode)
        for name in ['host-package','binding','network','out']: item.add_argument('--'+name,type=Path,required=True)
        item.add_argument('--host-package-sha256',required=True)
        item.add_argument('--profile',default='default')
        if mode=='launch': item.add_argument('--approval',type=Path,required=True)
    args=parser.parse_args()
    if args.mode=='build':
        print(json.dumps(build(args.repo,args.revision,args.execution_archive,args.out)))
        return
    host,body=inspect_package(args.host_package,args.host_package_sha256)
    binding=json.loads(args.binding.read_bytes())
    if binding['host_package_sha256']!=args.host_package_sha256:
        raise ValueError('launch host package binding differs')
    user_data=render_user_data(body,host,binding)
    request=launch_request(user_data,binding,json.loads(args.network.read_bytes()))
    args.out.mkdir(parents=True,exist_ok=False)
    (args.out/'user-data.sh').write_bytes(user_data)
    (args.out/'run-instances.json').write_bytes(encode(request))
    receipt={'status':'rendered','host_package_sha256':args.host_package_sha256,
             'user_data_sha256':sha(user_data),'request_sha256':sha(encode(request)),
             'client_token':binding['run_id']}
    try:
        if args.mode!='render':
            approval=json.loads(args.approval.read_bytes()) if args.mode=='launch' else None
            receipt=dispatch(request,host,binding,args.profile,approval,
                             on_submit=lambda submitted:(args.out/'submitted-request.json').write_bytes(encode(submitted)))
    except BaseException as error:
        submitted=args.out/'submitted-request.json'
        uncertain=args.mode=='launch' and submitted.exists()
        receipt.update(status='launch_outcome_unknown' if uncertain else 'failed',error=str(error))
        if submitted.exists(): receipt['submitted_request_sha256']=sha(submitted.read_bytes())
        raise
    finally:
        (args.out/'receipt.json').write_bytes(encode(receipt))
    print(json.dumps(receipt))


if __name__=='__main__':
    main()
