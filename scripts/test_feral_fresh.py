"""Probe source binding, evidence faults, target isolation and the independent arithmetic check."""
import copy
from fractions import Fraction
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from feral_fresh_sources import encode, sha, tables, read_family
from prepare_feral_fresh import evidence, family_cases, build, validate, rounded

ROOT = Path(__file__).resolve().parents[1]
RECORDS = ROOT / 'experiments/research-step-47'


def family():
    values = {'a': {2025: '10', 2024: '8'}, 'b': {2025: '4', 2024: '3'}, 'c': {2025: '7', 2024: '6'}}
    return {'id': 'fixture-income', 'company': 'Invented', 'report_key': 'FIXTURE/2025', 'kind': 'income', 'unit': 'usd_million',
            'facts': [{'id': f'fixture-{role}-{year}', 'role': role, 'year': year, 'label': {'a':'Operating income','b':'Net income','c':'Pretax income'}[role], 'value': value, 'unit':'usd_million'} for role, years in values.items() for year, value in years.items()]}


class PreparationTests(unittest.TestCase):
    def test_nested_tables_keep_row_cells_and_original_locations(self):
        raw=b'<table><tr><td>outer<table><tr><td>inner</td></tr></table> tail</td></tr></table>'
        result=tables(raw)
        self.assertEqual(result[0]['rows'], [['outer tail']]);self.assertEqual(result[1]['rows'], [['inner']])
        for table in result:
            start,end=table['source_span'];self.assertEqual(sha(raw[start:end]),table['html_sha256'])

    def test_source_hash_header_and_transcribed_number_are_bound(self):
        raw=b'USD millions<table><tr><td>Year</td><td>2025</td><td>2024</td></tr><tr><td>Income</td><td>10</td><td>8</td></tr></table>'
        t=tables(raw)[0];source={'id':'fixture','company':'Invented','report_key':'FIXTURE/2025','sha256':sha(raw),'bytes':len(raw)}
        spec={'id':'fixture-income','kind':'income','unit':'usd_million','table_index':0,'table_html_sha256':t['html_sha256'],'header_row':0,'header_cells':t['rows'][0], 'years':[2025,2024],'unit_source':{'span':[0,12],'raw':'USD millions'},'series':[{'role':'a','row':1,'label':'Income','values':{'2025':'10','2024':'8'}}]}
        self.assertEqual(len(read_family(raw,source,spec)['facts']),2)
        with self.assertRaisesRegex(ValueError,'source bytes'):read_family(raw+b' ',source,spec)
        changed=copy.deepcopy(spec);changed['series'][0]['values']['2025']='11'
        with self.assertRaisesRegex(ValueError,'transcribed'):read_family(raw,source,changed)
        changed=copy.deepcopy(spec);changed['header_cells'][1]='2026'
        with self.assertRaisesRegex(ValueError,'header'):read_family(raw,source,changed)

    def test_targets_use_independent_rationals_and_rounding(self):
        cases={c['form']:c['target'] for c in family_cases(family()) if c['style']=='canonical'}
        for form,value in [('excess','6'),('single_year_ratio','5/2'),('percent_of','40'),('year_percent_change','25'),('year_average','9')]:self.assertEqual(cases[form]['exact_value'],value)
        self.assertEqual(rounded(Fraction(1,200)),'0.01');self.assertEqual(rounded(Fraction(-1,200)),'-0.01')
        self.assertEqual(rounded(Fraction(-1,300)),'0')

    def test_retrieval_faults_preserve_explicit_fact_mapping(self):
        f=family();intact,_=evidence(f)
        missing,mapping=evidence(f,'missing_year');self.assertEqual(len(missing),len(intact)-1)
        self.assertFalse(any(m['fact_id']=='fixture-a-2025' for m in mapping))
        conflict,mapping=evidence(f,'conflicting_year');self.assertEqual(len(conflict),len(intact)+1)
        self.assertEqual(mapping[-1],{'evidence_id':'e06','fact_id':'fixture-a-2024','presented_year':2025,'transformation':'prior_year_relabelled_as_requested_year'})
        with self.assertRaisesRegex(ValueError,'unknown evidence'):evidence(f,'invent-values')

    def test_preparation_works_with_both_predictors_unavailable(self):
        with patch.dict(sys.modules,{'feral_evidence_calculator':None,'feral_evidence_calculator_v2':None}):
            bundle=build([family()],{'fingerprints':[],'document_keys':[]})
            result=validate(bundle,[family()],{'fingerprints':[],'document_keys':[]})
            self.assertEqual(result['fresh_predictor_calls'],0);self.assertEqual(result['cases'],28)

    def test_opened_overlap_and_target_leak_are_rejected(self):
        f=family();opened={'fingerprints':[],'document_keys':[]};bundle=build([f],opened)
        with self.assertRaisesRegex(ValueError,'document'):build([f],{'fingerprints':[],'document_keys':['FIXTURE/2025']})
        with self.assertRaisesRegex(ValueError,'duplicate an opened'):build([f],{'fingerprints':[{'sha256':bundle['roster'][0]['input_sha256']}],'document_keys':[]})
        bundle['inputs'][0]['target']='10'
        with self.assertRaisesRegex(ValueError,'differs'):validate(bundle,[f],opened)

    def test_changed_input_mapping_or_target_is_rejected(self):
        opened={'fingerprints':[],'document_keys':[]};original=build([family()],opened)
        for kind in ['inputs','targets','roster']:
            changed=copy.deepcopy(original);changed[kind][0]['id']='changed'
            with self.subTest(kind=kind),self.assertRaisesRegex(ValueError,'differs'):validate(changed,[family()],opened)

    def test_source_precision_and_fault_preconditions_are_checked(self):
        f=family();f['facts'][0]['value']='1/1000'
        with self.assertRaisesRegex(ValueError,'source value would change'):evidence(f)
        f=family();f['facts'][0]['value']='8'
        with self.assertRaisesRegex(ValueError,'distinct possible values'):family_cases(f)

    def test_published_bundle_and_independent_checker_reject_wrong_math(self):
        source=RECORDS/'data'
        if not source.exists():self.fail('publish the frozen bundle before running the schema check')
        expected=sha((source/'PREPARE.json').read_bytes())
        command=['node',str(ROOT/'scripts/check_feral_fresh.mjs'),str(source),expected]
        result=subprocess.run(command,capture_output=True,text=True,timeout=15)
        self.assertEqual(result.returncode,0,result.stderr)
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'data';shutil.copytree(source,root)
            targets=[json.loads(line) for line in (root/'grader/TARGETS.jsonl').read_text().splitlines()]
            target=next(t for t in targets if t['kind']=='numeric');target['exact_value']='999';target['rounded_value']='999'
            p=root/'grader/TARGETS.jsonl';p.write_bytes(b''.join((json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode() for v in targets))
            manifest=json.loads((root/'PREPARE.json').read_bytes());manifest['files']['grader/TARGETS.jsonl']={'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())};(root/'PREPARE.json').write_bytes(encode(manifest))
            # Even a rewritten inventory cannot turn an incorrect rational target into a valid one.
            result=subprocess.run(['node',str(ROOT/'scripts/check_feral_fresh.mjs'),str(root),sha((root/'PREPARE.json').read_bytes())],capture_output=True,text=True,timeout=15)
            self.assertNotEqual(result.returncode,0);self.assertIn('AssertionError',result.stderr)


if __name__=='__main__':unittest.main()
