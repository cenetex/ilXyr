"""Freeze and verify the native pilot overlay with its original source kit."""
import argparse
import io
import json
from pathlib import Path
import subprocess
import tarfile
from weight_source_kit import check_binding, check_path, encode, read_archive, sha, verify_payload, MAX_PACKAGE

PLAN='experiments/research-step-56/PILOT-PLAN.json'
OVERLAY=[PLAN,'scripts/weight_pilot_package.py','scripts/weight_pilot_controller.py',
    'scripts/weight_pilot_job.mjs','scripts/weight_pilot_replay.mjs','scripts/weight_pilot_check.py',
    'scripts/weight_native_check.py','scripts/weight_process_tree.py',
    'scripts/lib/weight-selection-pilot.mjs','scripts/lib/weight-query-cache.mjs','scripts/lib/weight-candidates-v2.mjs']


def payload(files):
    manifest=json.loads(files['PILOT-KIT.json'])
    if manifest['schema']!='ilxyr.weight_pilot_source_kit.v1' or set(files)!=set(OVERLAY)|{'SOURCE-KIT.tar','PILOT-KIT.json'}:
        raise ValueError('pilot archive roster differs')
    if set(manifest['files'])!=set(files)-{'PILOT-KIT.json'}:
        raise ValueError('pilot manifest roster differs')
    commit=manifest['source_commit']
    if not isinstance(commit,str) or len(commit)!=40 or any(c not in '0123456789abcdef' for c in commit):
        raise ValueError('pilot source commit differs')
    for name,binding in manifest['files'].items():
        check_binding(files[name],binding,name)
    plan=json.loads(files[PLAN]); check_binding(files['SOURCE-KIT.tar'],plan['source_kit'],'original source kit')
    base=read_archive(files['SOURCE-KIT.tar']); verify_payload(base)
    for name in OVERLAY:
        if name in base and files[name]!=base[name]:
            raise ValueError('overlay changes original source: '+name)
    for name,expected in plan['input_hashes'].items():
        if sha(base[name])!=expected:
            raise ValueError('pilot input differs: '+name)
    return manifest,base


def archive(files,output):
    with tarfile.open(output,'x',format=tarfile.USTAR_FORMAT) as tar:
        for name,raw in sorted(files.items()):
            check_path(name); entry=tarfile.TarInfo(name)
            entry.size=len(raw);entry.mode=0o644;entry.mtime=0
            tar.addfile(entry,io.BytesIO(raw))


def build(repo,revision,base,output):
    commit=subprocess.check_output(['git','-C',str(repo),'rev-parse',revision+'^{commit}'],text=True).strip()
    if base.stat().st_size>MAX_PACKAGE:
        raise ValueError('base archive size limit')
    files={name:subprocess.check_output(['git','-C',str(repo),'show',commit+':'+name]) for name in OVERLAY}
    files['SOURCE-KIT.tar']=base.read_bytes()
    manifest={'schema':'ilxyr.weight_pilot_source_kit.v1','source_commit':commit,
        'scope':'frozen_native_selection_pilot_sources','execution_authorized':False,
        'files':{n:{'bytes':len(b),'sha256':sha(b)} for n,b in sorted(files.items())}}
    files['PILOT-KIT.json']=encode(manifest);payload(files);archive(files,output)
    expected=sha(output.read_bytes());verify(output,expected)
    return {'sha256':expected,'bytes':output.stat().st_size,'source_commit':commit,'files':len(files)}


def verify(package,expected):
    if package.stat().st_size>MAX_PACKAGE:
        raise ValueError('pilot archive size limit')
    raw=package.read_bytes()
    if sha(raw)!=expected:
        raise ValueError('pilot archive digest differs')
    files=read_archive(raw);manifest,base=payload(files)
    return files,manifest,base


def unpack(package,expected,output):
    files,manifest,base=verify(package,expected)
    output.mkdir(parents=True,exist_ok=False)
    combined=base|{name:files[name] for name in OVERLAY}|{'PILOT-KIT.json':files['PILOT-KIT.json']}
    for name,raw in combined.items():
        target=output/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw)
    return manifest


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='mode',required=True)
    child=sub.add_parser('build')
    for name in ['repo','base','output']:
        child.add_argument('--'+name,type=Path,required=True)
    child.add_argument('--revision',required=True)
    for mode in ['verify','unpack']:
        child=sub.add_parser(mode);child.add_argument('--package',type=Path,required=True);child.add_argument('--expected-sha256',required=True)
        if mode=='unpack':
            child.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    if args.mode=='build':
        result=build(args.repo,args.revision,args.base,args.output)
    elif args.mode=='unpack':
        result=unpack(args.package,args.expected_sha256,args.output)
    else:
        result=verify(args.package,args.expected_sha256)[1]
    print(json.dumps(result,sort_keys=True))
