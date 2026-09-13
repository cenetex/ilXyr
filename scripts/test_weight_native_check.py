"""Reject forged native identities, answers, order and differential coverage."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from weight_native_check import NativeCalls

CONTRACT={'coordinate_mapping':{'F4':[3,2,1,0]},'hard_query_timeout_ms':10000,'differential_sample_every':100}


def pair(oracle, phase, key, number, value='1', status='ok'):
    kind,high,target=key.split('\t')
    command='dom_char(['+high+'],['+target+'],'+kind+')' if oracle=='lie' else ['query',kind,high,target]
    return [{'kind':'start','oracle':oracle,'phase':phase,'query_key':key,'source_query_sequence':number,'input':command,
             **({'slice_id':'1|dominant'} if phase=='workload' else {})},
            {'kind':'finish','status':status,'multiplicity':value,'elapsed_ms':1.0}]


def record():
    return pair('lie','setup','A1\t1\t1',0)+pair('lie','workload','A1\t8\t8',1)+pair('zero','workload','A1\t8\t8',1)


class NativeCheckTests(unittest.TestCase):
    def checked(self, rows, event=None):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'native.jsonl'; call=0
            for i,row in enumerate(rows):
                row['sequence']=i+1
                if row['kind']=='start':
                    call+=1
                row['call_id']=call
            path.write_text(''.join(json.dumps(r)+'\n' for r in rows))
            checker=NativeCalls(path,CONTRACT)
            checker.evaluation(event or {'source_query_sequence':1,'slice_id':'1|dominant','status':'ok','multiplicity':'1'},
                {'query_key':'A1\t8\t8','canonical_type':'A1'})
            return checker.finish()

    def test_exact_pair(self):
        self.assertEqual(self.checked(record())['calls'],3)

    def test_primary_answer(self):
        rows=record(); rows[3]['multiplicity']='2'; rows[5]['multiplicity']='2'
        with self.assertRaisesRegex(ValueError,'native value'):
            self.checked(rows)

    def test_mapping(self):
        rows=record(); rows[2]['input']='dom_char([8],[6],A1)'
        with self.assertRaisesRegex(ValueError,'input mapping'):
            self.checked(rows)

    def test_missing_differential(self):
        with self.assertRaisesRegex(ValueError,'selected differential'):
            self.checked(record()[:-2])

    def test_differential_failure_and_disagreement(self):
        for status,value,reason in [('ok','2','differential_oracle_disagreement'),('process_failure',None,'differential_oracle_failure')]:
            rows=record(); rows[5].update(status=status,multiplicity=value)
            with self.assertRaisesRegex(ValueError,'native failure'):
                self.checked(copy.deepcopy(rows))
            self.assertEqual(self.checked(rows,{'source_query_sequence':1,'slice_id':'1|dominant','status':'failed','reason':reason})['calls'],3)

    def test_primary_failure(self):
        rows=record()[:-2]; rows[3].update(status='hard_timeout',multiplicity=None,elapsed_ms=10002)
        self.assertEqual(self.checked(rows,{'source_query_sequence':1,'slice_id':'1|dominant','status':'failed','reason':'primary_oracle_failure'})['calls'],2)

    def test_pending_call(self):
        with self.assertRaisesRegex(ValueError,'still pending'):
            self.checked(record()[:-1])

    def test_finish_cannot_replace_identity(self):
        rows=record(); rows[3]['query_key']='A1\t8\t6'
        with self.assertRaisesRegex(ValueError,'finish fields'):
            self.checked(rows)

    def test_warmup_order(self):
        rows=record(); rows=rows[2:4]+rows[:2]+rows[4:]
        with self.assertRaisesRegex(ValueError,'warmup order'):
            self.checked(rows)

    def test_source_and_secondary_order(self):
        rows=record(); rows[4]['source_query_sequence']=2
        with self.assertRaisesRegex(ValueError,'differential call order'):
            self.checked(rows)
        rows=record(); rows[2]['source_query_sequence']=2
        with self.assertRaises(ValueError):
            self.checked(rows)

    def test_timeout_and_invalid_label(self):
        for change in [{'elapsed_ms':10000},{'elapsed_ms':float('nan')},{'multiplicity':'01'},{'multiplicity':9007199254740993}]:
            rows=record(); rows[3].update(change)
            with self.assertRaises(ValueError):
                self.checked(rows)

    def test_extra_and_failed_secondary(self):
        rows=record()+pair('zero','workload','A1\t8\t8',1)
        with self.assertRaisesRegex(ValueError,'differential call order'):
            self.checked(rows)
        rows=record(); rows[3].update(status='failure',multiplicity=None)
        with self.assertRaisesRegex(ValueError,'native call coverage'):
            self.checked(rows,{'source_query_sequence':1,'slice_id':'1|dominant','status':'failed','reason':'primary_oracle_failure'})


if __name__=='__main__':
    unittest.main()
