import copy
import json
from fractions import Fraction
from pathlib import Path
import unittest

from feral_evidence_calculator import amount, predict as legacy
from feral_evidence_calculator_v2 import predict, predict_row


def evidence(a='120', b='80'):
    return [['a', f'the revenue of 2020 is {a} ;'], ['b', f'the expense of 2020 is {b} ;']]


class SingleYearTests(unittest.TestCase):
    def test_explicit_operations_and_operand_control(self):
        cases = [('What is the ratio of revenue to expense in 2020?', '1.5'),
                 ('What percentage of revenue is expense in 2020?', '66.67%'),
                 ('What is the excess of revenue over expense in 2020?', '40'),
                 ('What is the sum of revenue and expense in 2020?', '200'),
                 ('What is the value of revenue in 2020?', '120')]
        for question, answer in cases:
            with self.subTest(question=question):
                full = predict(question, evidence()); control = predict(question, evidence(), 'operand_only')
                self.assertEqual(full['prediction'], answer)
                self.assertEqual(full['operands'], control['operands'])
                self.assertEqual(control['work']['arithmetic_operations'], 0)
                self.assertIsNone(legacy(question, evidence())['prediction'])

    def test_counterfactual_values_and_operand_order(self):
        q = 'What is the ratio of revenue to expense in 2020?'
        self.assertEqual(predict(q, evidence(a='160'))['prediction'], '2')
        self.assertEqual(predict(q.replace('revenue to expense','expense to revenue'), evidence())['prediction'], '0.67')
        q = 'What is the excess of expense over revenue in 2020?'
        self.assertEqual(predict(q, evidence())['prediction'], '-40')
        self.assertEqual(predict(q, evidence(a='80'))['prediction'], '0')

    def test_ambiguity_missing_year_conflicts_units_and_zero(self):
        q = 'What is the ratio of revenue to expense in 2020?'
        cases = [(evidence()+[['c','the domestic revenue of 2020 is 50 ;'],['d','the foreign revenue of 2020 is 60 ;']], 'answered'),
                 ([['a','the domestic revenue of 2020 is 120 ;'],['c','the foreign revenue of 2020 is 60 ;'], evidence()[1]], 'ambiguous_series'),
                 (evidence()+[['c','the revenue of 2020 is 121 ;']], 'conflicting_values'),
                 (evidence(a='$ 120', b='80%'), 'incompatible_units'),
                 (evidence(b='0'), 'zero_denominator'),
                 ([['a','the revenue of 2019 is 120 ;'], evidence()[1]], 'missing_requested_year')]
        for data, reason in cases:
            with self.subTest(reason=reason):self.assertEqual(predict(q, data)['reason'], reason)
        self.assertEqual(predict(q.replace('expense','revenue'),evidence())['reason'], 'same_series')

    def test_evidence_spans_and_order_replay_exact_arithmetic(self):
        q='What is the excess of revenue over expense in 2020?';data=evidence(a='$ 120.25',b='$ 80.50')
        result=predict(q,data);self.assertEqual(result,predict(q,list(reversed(data))))
        values=[]
        for cell in result['operands']:
            start,end=cell['span'];raw=dict(data)[cell['evidence_id']][start:end]
            self.assertEqual(raw,cell['text']);values.append(amount(raw)[0])
        self.assertEqual(values[0]-values[1],Fraction(result['exact_result']))

    def test_known_cross_series_failure_remains_a_development_case(self):
        root=Path(__file__).resolve().parents[1]
        old=json.loads((root/'experiments/research-step-8/RESULT.json').read_bytes())
        row=next(r for r in old['inputs'] if r['id'].startswith('MAS/'))
        result=predict_row(row,'calculator')
        self.assertEqual(result['prediction'],'111.97')
        self.assertEqual(result['unit'],'percentage_points')

    def test_target_fields_and_adjustments_are_rejected(self):
        row={'schema':'ilxyr.feral_model_input.v2','task':'finqa','id':'example','messages':[
            {'role':'system','content':'Use supplied evidence.'},
            {'role':'user','content':json.dumps({'question':'What is the value of revenue in 2020?','retrieved_evidence':evidence()})}]}
        first=predict_row(row,'calculator');changed=copy.deepcopy(row);changed['id']='answer-999'
        self.assertEqual(first['prediction'],predict_row(changed,'calculator')['prediction'])
        changed['answer']='999'
        with self.assertRaises(ValueError):predict_row(changed,'calculator')
        for q in ['What is the value of adjusted revenue in 2020?',
                  'What is the value of revenue per share in 2020?',
                  'What is the difference between revenue and expense in 2020?']:
            self.assertIsNone(predict(q,evidence())['prediction'])

    def test_legacy_supported_cases_keep_original_predictions_and_traces(self):
        q='What was the percentage change in revenue from 2014 to 2015?'
        data=[['a','the revenue of 2014 is 80 ; the revenue of 2015 is 100 ;']]
        for arm in ['calculator','operand_only']:
            result=predict(q,data,arm);result.pop('route');result['schema']='ilxyr.feral_evidence_calculator.v1'
            self.assertEqual(result,legacy(q,data,arm))


if __name__=='__main__':unittest.main()
