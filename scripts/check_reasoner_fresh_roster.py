"""Build and cross-check the fixed fresh roster, with bounded process receipts."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
from feral_process import run_process, save

ROOT = Path(__file__).resolve().parents[1]
FROZEN = ROOT / 'experiments/research-step-39'
COMMIT = '0c5253604593acb3b9294fcc00c90f59b7dbbd3c'
def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def require(ok, message):
    if not ok: raise ValueError(message)

def run(source, output, git=False):
    output.mkdir(parents=True, exist_ok=False); deadline = time.monotonic() + 240
    status = {'schema':'ilxyr.reasoner_roster_validation.v1','status':'failed','phase':'source','fresh_family_scoring':0}
    try:
        work = output / 'source'; work.mkdir()
        bindings = json.loads((FROZEN / 'SOURCE-FILES.json').read_bytes())
        for name, expected in bindings.items():
            raw = subprocess.check_output(['git','-C',str(source),'show',COMMIT+':'+name], timeout=30) if git else (source / name).read_bytes()
            require(hashlib.sha256(raw).hexdigest() == expected, 'source differs: '+name)
            p = work / name; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(raw)
        status['source_files'] = len(bindings)
        def child(name, command):
            status['phase'] = name
            receipt = run_process(command, work, output / name, min(deadline, time.monotonic()+60), 2, max_log_bytes=1024*1024)
            require(receipt['status']=='complete', 'process failed; retained '+name)
        script = str(ROOT / 'scripts/reasoner_fresh_roster.mjs')
        child('generate', ['node',script,'generate',str(work),str(FROZEN/'ROSTER-PLAN.json'),str(FROZEN/'EXCLUSIONS.json'),str(output/'roster')])
        child('embed', ['make','-f','Makefile.reasoner55-eligible','build/reasoner55_eligible_matched.h'])
        cc = os.environ.get('CC','cc'); child('compiler',[cc,'--version'])
        child('build',[cc,'-std=c11','-O2','-Wall','-Wextra','-Werror','-I'+str(work),'-I'+str(output/'roster'),'-DR55FAST_HASH=0','-DR55FAST_SORT=0',str(ROOT/'scripts/reasoner_fresh_roster.c'),'-lm','-o',str(output/'native')])
        child('native-guards',[str(output/'native'),'--self-test'])
        child('native-replay',[str(output/'native'),'replay-roster'])
        child('check',['node',script,'check',str(work),str(FROZEN/'ROSTER-PLAN.json'),str(FROZEN/'EXCLUSIONS.json'),str(output/'roster'),str(output/'native-replay/stdout.log'),str(output/'CHECK.json')])
        child('tamper-checks',['node',str(ROOT/'scripts/test_reasoner_fresh_roster.mjs'),str(work),str(output/'roster'),str(output/'native-replay/stdout.log')])
        for name in ['ROSTER.json','DECISIONS.json','SOURCE-SYNTAX.json','GENERATION.json']:
            require((output/'roster'/name).read_bytes()==(FROZEN/name).read_bytes(),'frozen roster differs: '+name)
        status.update(status='passed',phase='complete',native_sha256=digest(output/'native'),check=json.loads((output/'CHECK.json').read_bytes()),
            source_commit=COMMIT,implementation={n:digest(ROOT/'scripts'/n) for n in ['reasoner_fresh_roster.mjs','reasoner_fresh_roster.c','check_reasoner_fresh_roster.py','test_reasoner_fresh_roster.mjs','feral_process.py']})
    except BaseException as error:
        status['error'] = str(error); raise
    finally: save(output/'TERMINAL.json',status)
    return status

if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--git',action='store_true');a=p.parse_args()
    print(json.dumps(run(a.source.resolve(),a.output.resolve(),a.git),sort_keys=True))
