"""Fetch exact public filing bytes for the frozen FERAL source audit."""
import argparse
import json
from pathlib import Path
import urllib.request
from feral_fresh_sources import encode, require, sha

ROOT=Path(__file__).resolve().parents[1]

def fetch(output):
    output.mkdir(parents=True,exist_ok=False)
    records=[]
    for source in json.loads((ROOT/'experiments/research-step-47/SOURCES.json').read_bytes())['sources']:
        record={'id':source['id'],'url':source['url'],'status':'failed'}
        try:
            request=urllib.request.Request(source['url'],headers={'User-Agent':'ilXyr public research source audit'})
            with urllib.request.urlopen(request,timeout=30) as response:
                raw=response.read(8*1024**2+1);record['resolved_url']=response.url
            record.update(bytes=len(raw),sha256=sha(raw))
            require(record['bytes']==source['bytes'] and record['sha256']==source['sha256'],'frozen filing bytes differ')
            (output/(source['id']+'.html')).write_bytes(raw);record['status']='verified'
        except Exception as error:
            record['error']=str(error);raise
        finally:
            records.append(record);(output/'FETCH.json').write_bytes(encode({'sources':records,'fresh_predictor_calls':0}))
    return {'status':'verified','source_files':len(records),'fresh_predictor_calls':0}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True)
    print(json.dumps(fetch(p.parse_args().output),sort_keys=True))
