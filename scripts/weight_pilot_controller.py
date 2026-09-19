"""Prepare or run the fixed native pilot with bounded work and retained failures."""
import argparse
import json
import os
from pathlib import Path
import platform
import shutil
import sys
import time
from feral_process import run_process, save
from weight_process_tree import adopt_children, stop_adopted_children
from weight_pilot_package import PLAN, unpack
from weight_pilot_check import load, require, sha


class MemoryGuard:
    """Sample summed live descendant RSS; exact peak memory remains unknown."""
    def __init__(self, limit, period, reader=None, clock=time.monotonic):
        self.limit=limit;self.period=period;self.reader=reader or self.read;self.clock=clock
        self.last=None;self.peak=0;self.samples=0;self.reason=None

    @staticmethod
    def read():
        rows={}
        for path in Path('/proc').glob('[0-9]*/stat'):
            try:
                fields=path.read_text().rsplit(')',1)[1].split()
                rows[int(path.parent.name)]=(int(fields[1]),max(0,int(fields[21]))*os.sysconf('SC_PAGE_SIZE'))
            except (FileNotFoundError,ProcessLookupError):
                continue
        descendants={os.getpid()}; changed=True
        while changed:
            found={pid for pid,(parent,_) in rows.items() if parent in descendants}
            changed=bool(found-descendants);descendants|=found
        return sum(rss for pid,(_,rss) in rows.items() if pid in descendants and pid!=os.getpid())

    def __call__(self):
        now=self.clock()
        if self.reason is not None:
            return self.reason
        if self.last is None or now-self.last>=self.period:
            self.last=now
            try:
                value=self.reader(); require(type(value) is int and value>=0,'memory sample differs')
                self.samples+=1;self.peak=max(self.peak,value)
                if value>self.limit:
                    self.reason='descendant_rss_limit'
            except Exception as error:
                self.reason='memory_observation_failure: '+str(error)
        return self.reason

    def report(self):
        return {'sampled_descendant_rss_peak_bytes':self.peak,'samples':self.samples,
            'target_sample_period_seconds':self.period,'limit_bytes':self.limit,'stop_reason':self.reason,
            'exact_peak_memory_bytes':None,'scope':'sum of live descendant RSS at observations; shared pages may repeat'}


def commands(repo, output, plan):
    lie=str(output/'build/lie-1/LiE/Lie.exe');zero=str(output/'build/zero/weight_multiplicity')
    jobs=[]
    for job in plan['ordered_jobs']:
        destination=output/'jobs'/job['id']
        jobs.append({'id':job['id'],'directory':str(destination),
            'run':['node',str(repo/'scripts/weight_pilot_job.mjs'),job['id'],lie,zero,str(destination)],
            'check':[sys.executable,'-B',str(repo/'scripts/weight_native_check.py'),'--directory',str(destination),
                     '--repo',str(repo),'--output',str(destination/'CHECK.json')],
            'replay':['node',str(repo/'scripts/weight_pilot_replay.mjs'),str(destination)]})
    return {'build':[sys.executable,'-B',str(repo/'scripts/weight_oracle_smoke.py'),'--repo',str(repo),
                     '--inputs',str(output/'build-inputs'),'--output',str(output/'build')],'jobs':jobs}


def prepare(package, expected, output):
    output=output.resolve();output.mkdir(parents=True,exist_ok=False);repo=output/'runtime'
    manifest=unpack(package,expected,repo);plan=load(repo/PLAN)
    limits=plan['execution_limits']
    require(plan['schema']=='ilxyr.weight_native_pilot_plan.v1' and len(plan['ordered_jobs'])==16,'controller plan differs')
    require(0<limits['maximum_controller_seconds']<=3900 and 0<limits['job_seconds']<=180 and
            0<limits['build_seconds']<=260 and 0<limits['verification_seconds']<=300 and
            0<limits['collection_seconds']<=300 and limits['memory_sample_ms']==20 and
            0<limits['max_descendant_rss_bytes']<=2*1024**3,'controller bounds differ')
    require(len({j['id'] for j in plan['ordered_jobs']})==16 and all('/' not in j['id'] and '\\' not in j['id'] and j['id'] not in ('.','..') for j in plan['ordered_jobs']),'controller job paths differ')
    inputs=output/'build-inputs';inputs.mkdir()
    for name in ['lie-2.2.2.tar.gz','bison.deb']:
        shutil.copyfile(repo/'inputs'/name,inputs/name)
    shutil.copytree(repo/'zero',inputs/'zero');(output/'jobs').mkdir()
    record={'schema':'ilxyr.weight_pilot_preparation.v1','status':'prepared','package_sha256':expected,
        'source_commit':manifest['source_commit'],'plan_sha256':sha(repo/PLAN),'oracle_starts':0,
        'commands':commands(repo,output,plan),'execution_limits':limits,
        'external_gate':'fixed host and image, price, preflight and exact package approval'}
    save(output/'PREPARE.json',record)
    return record


def execute(package,expected,output):
    started=time.monotonic();prepared=prepare(package,expected,output);output=output.resolve();repo=output/'runtime'
    plan=load(repo/PLAN);limits=plan['execution_limits'];deadline=started+limits['maximum_controller_seconds']
    record={'schema':'ilxyr.weight_pilot_controller.v1','status':'failed','package_sha256':expected,
        'source_commit':prepared['source_commit'],'plan_sha256':prepared['plan_sha256'],'jobs':[],
        'host_image_identity':'requires_external_frozen_host_receipt','execution_limits':limits}
    verify_remaining=limits['verification_seconds']; scientific_stop=None
    adopt_children()
    def bounded(label,command,seconds):
        guard=MemoryGuard(limits['max_descendant_rss_bytes'],limits['memory_sample_ms']/1000)
        receipt=None;path=output/'logs'/label
        try:
            receipt=run_process(command,repo,path,min(time.monotonic()+seconds,deadline-limits['collection_seconds']),
                3,cancelled=guard,max_log_bytes=limits['max_log_bytes_per_process'])
            return receipt
        finally:
            cleanup=stop_adopted_children()
            if receipt is not None:
                receipt['memory_observations']=guard.report();receipt['adopted_cleanup']=cleanup
                if cleanup['adopted_pids'] or guard.reason:
                    receipt['status']='failed';receipt['stop_reason']=guard.reason or 'adopted_descendants_after_exit'
                save(path/'process.json',receipt)
    try:
        require(platform.system()=='Linux' and platform.machine()=='x86_64','controller runtime differs')
        record['build']=bounded('build',prepared['commands']['build'],limits['build_seconds'])
        require(record['build']['status']=='complete','native build failed')
        built=load(output/'build/RESULT.json')
        require(built['status']=='pass' and built['lie_executable_sha256']==[plan['runtime']['lie_sha256']]*2 and
                built['zero_executable_sha256']==plan['runtime']['zero_sha256'],'native build identity differs')
        for job in prepared['commands']['jobs']:
            entry={'id':job['id'],'status':'skipped'};record['jobs'].append(entry)
            if scientific_stop or time.monotonic()+limits['job_seconds']+verify_remaining+limits['collection_seconds']+3>deadline:
                entry['reason']=scientific_stop or 'controller_reserve';continue
            entry['process']=bounded(job['id'],job['run'],limits['job_seconds'])
            if entry['process']['status']!='complete':
                entry.update(status='failed',reason=entry['process']['stop_reason'] or 'job_process_failure')
                scientific_stop=entry['reason'];continue
            directory=Path(job['directory']);entry['run_sha256']=sha(directory/'RUN.json')
            for kind in ['check','replay']:
                began=time.monotonic()
                if verify_remaining<=0:
                    entry.update(status='failed',reason='verification_budget');break
                entry[kind]=bounded(job['id']+'-'+kind,job[kind],verify_remaining)
                verify_remaining-=time.monotonic()-began
                if entry[kind]['status']!='complete':
                    entry.update(status='failed',reason=kind+'_failed');break
            else:
                result=load(directory/'RESULT.json');entry.update(status='verified',hold=result['hold'],totals=result['totals'])
            if entry['status']=='failed':
                scientific_stop=entry['reason']
            save(output/'RESULT.json',record)
        record['status']='complete_record' if all(j['status']=='verified' for j in record['jobs']) else 'partial_record'
    except Exception as error:
        record['error']=str(error)
    finally:
        present={j['id'] for j in record['jobs']}
        for job in plan['ordered_jobs']:
            if job['id'] not in present:
                record['jobs'].append({'id':job['id'],'status':'skipped','reason':record.get('error','controller_stopped')})
        record['cleanup']=stop_adopted_children();record['elapsed_seconds']=time.monotonic()-started
        record['verification_seconds_remaining']=max(0,verify_remaining);save(output/'RESULT.json',record)
    return record


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('mode',choices=['prepare','run'])
    for name in ['package','output']:
        parser.add_argument('--'+name,type=Path,required=True)
    parser.add_argument('--expected-sha256',required=True);args=parser.parse_args()
    result=(prepare if args.mode=='prepare' else execute)(args.package,args.expected_sha256,args.output)
    print(json.dumps({'status':result['status'],'package_sha256':result['package_sha256']},sort_keys=True))
    if result['status'] not in ('prepared','complete_record'):
        sys.exit(1)
