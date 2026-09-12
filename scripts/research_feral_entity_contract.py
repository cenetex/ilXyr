"""Run the small development diagnostic for explicit FERAL requests."""

import argparse
import hashlib
import json
from pathlib import Path
import platform
import sys

from feral_evidence_calculator import predict as v1, words
from feral_evidence_calculator_v2 import predict as v2
from feral_evidence_calculator_v3 import predict as v3, verify_result
from test_feral_evidence_calculator_v3 import cases, evidence

ROOT = Path(__file__).resolve().parents[1]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def run():
    traces = []; counts = {}; calls = 0
    methods = {'calculator_v1': lambda q,e:v1(q,e), 'calculator_v2':lambda q,e:v2(q,e),
               'calculator_v3':lambda q,e:v3(q,e), 'v3_operand_only':lambda q,e:v3(q,e,'operand_only')}
    for method, predict in methods.items():
        count = {'canonical_correct':0,'paraphrase_correct':0,'wrong_numeric':0,'abstained':0}
        for index, (_, canonical, paraphrase, exact, unit, facts) in enumerate(cases()):
            for style, question in [('canonical',canonical),('paraphrase',paraphrase)]:
                result = predict(question,evidence()); calls += 1
                correct = result['exact_result']==exact and result['unit']==unit
                count[style+'_correct'] += int(correct)
                count['wrong_numeric'] += int(result['prediction'] is not None and not correct)
                count['abstained'] += int(result['prediction'] is None)
                traces.append({'scope':'invented','case':index,'style':style,'arm':method,'question':question,
                               'expected':{'exact':exact,'unit':unit,'evidence_ids':facts},'result':result})
        counts[method]=count
    old_path=ROOT/'experiments/research-step-8/RESULT.json'; old=json.loads(old_path.read_bytes())
    targets={v['id']:v for v in old['targets']}; older={}
    for method,predict in methods.items():
        rows=[]; numeric=abstained=0
        for row in old['inputs']:
            context=json.loads(row['messages'][1]['content']); result=predict(context['question'],context['retrieved_evidence']); calls += 1
            target=targets[row['id']]
            correct = (result['prediction'] is None if target['kind']=='abstention' else
                       result['exact_result']==target['expected_rational'] and result['unit']==target['unit'])
            numeric += int(correct and target['kind']=='numeric');abstained += int(correct and target['kind']=='abstention')
            rows.append({'id':row['id'],'kind':target['kind'],'correct':correct,'reason':result['reason'],'prediction':result['prediction']})
            traces.append({'scope':'five_old_development_cases','id':row['id'],'arm':method,'result':result})
        older[method]={'numeric_correct':numeric,'numeric_cases':3,'correct_abstentions':abstained,'abstention_cases':2,'rows':rows}
    failure_path=ROOT/'experiments/research-step-51/FERAL-DIAGNOSTIC.json'
    failure=json.loads(failure_path.read_bytes())['required_abstention_error']; row=failure['input']
    before=v2(row['question'],row['retrieved_evidence']);after=v3(row['question'],row['retrieved_evidence']);calls+=2
    assert before==failure['prediction']['result']
    assert after['reason']=='missing_requested_entity' and after['prediction'] is None
    verify_result(row['question'],row['retrieved_evidence'],after);calls+=1
    unequal=[t for t in traces if t.get('scope')=='invented' and t.get('case')==10 and t.get('style')=='canonical' and t['arm'] in ['calculator_v2','calculator_v3']]
    assert counts['calculator_v3']=={'canonical_correct':11,'paraphrase_correct':11,'wrong_numeric':0,'abstained':0}
    assert older['calculator_v3']['numeric_correct']==0 and older['calculator_v2']['numeric_correct']==3
    result={'schema':'ilxyr.feral_entity_contract_diagnostic.v1','status':'complete_development_coverage_hold',
            'scope':'22 invented numeric questions, five old development cases, and one opened failure from the completed comparison.',
            'fresh_evaluation_calls':0,'development_predictor_calls_including_one_replay':calls,
            'promotion_evidence':False,'invented':{'cases':22,'arms':counts},'older_development':older,
            'opened_index_failure':{'source_sha256':digest(failure_path.read_bytes()),'old_entity_words':sorted(words('S&P 500 Index')),
                                    'before':before,'after':after},
            'unequal_return_baselines':{'expected_percentage_points':'90','source_facts':evidence(),'traces':unequal},
            'previous_development_source_sha256':digest(old_path.read_bytes()),
            'decision':'Keep v3 as an explicit-request control. Its loss of all three older numeric answers keeps replacement on hold.',
            'next':'Test context-supported question-to-fact mapping with source spans, entity-confusion controls, and independent fresh wording.',
            'traces_sha256':digest(encode(traces))}
    return result,traces


def encode(value):
    return (json.dumps(value,indent=2,sort_keys=True,allow_nan=False)+'\n').encode()


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=False)
    result,traces=run();(args.output/'RESULT.json').write_bytes(encode(result));(args.output/'TRACES.json').write_bytes(encode(traces))
    sources=['feral_evidence_calculator.py','feral_evidence_calculator_v2.py','feral_evidence_calculator_v3.py',
             'test_feral_evidence_calculator_v3.py','research_feral_entity_contract.py','feral_comparison_worker.py']
    (args.output/'RUNTIME.json').write_bytes(encode({'python':sys.version,'platform':platform.platform(),
        'sources':{name:digest((ROOT/'scripts'/name).read_bytes()) for name in sources}}))
    print(json.dumps({'status':result['status'],'development_calls':result['development_predictor_calls_including_one_replay'],'fresh_evaluation_calls':0}))
