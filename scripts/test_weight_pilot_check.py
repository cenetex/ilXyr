"""Independent accounting rejects altered draw, cache, selection and limit records."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from weight_pilot_check import load, replay

ROOT = Path(__file__).resolve().parent.parent


class PilotCheckTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(); cls.fixtures = Path(cls.temporary.name)/'fixtures'
        subprocess.run(['node','scripts/weight_pilot_fixtures.mjs',str(cls.fixtures)],cwd=ROOT,check=True,capture_output=True,timeout=30)
        cls.reps = {r['canonical_id']:r for r in load(ROOT/'examples/weight-multiplicity/phase06-reduced-corpus-manifest-v1.json')['representations']}
        cls.systems = load(ROOT/'examples/weight-multiplicity/phase1-root-systems-v1.json')['systems']

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def case(self, name='reuse'):
        p = self.fixtures/name
        return ([json.loads(line) for line in (p/'events.jsonl').read_text().splitlines()],load(p/'result.json'),load(p/'config.json'))

    def verify(self, events, result, config):
        return replay(events,result,config,self.reps,self.systems)

    def test_all_twelve_saved_cases(self):
        for path in self.fixtures.iterdir():
            with self.subTest(path.name):
                self.assertEqual(self.verify(*self.case(path.name))['status'],'verified_selection_and_accounting')

    def test_cache_value_and_provenance(self):
        for field,value in [('source_query_sequence',99),('multiplicity','1')]:
            events,result,config=self.case()
            next(e for e in events if e['kind']=='evaluation' and e['source']=='cache')[field]=value
            with self.assertRaisesRegex(ValueError,'cache provenance'):self.verify(events,result,config)

    def test_orbit_geometry_and_query_identity(self):
        for field,value in [('dominant_target_key','8'),('query_key','A1\t8\t8'),('highest_weight',[6])]:
            events,result,config=self.case();events[0]['candidate'][field]=value
            with self.assertRaises(ValueError):self.verify(events,result,config)

    def test_skip_or_reorder_an_evaluation(self):
        events,result,config=self.case('quota_overflow')
        positions=[i for i,e in enumerate(events) if e['kind']=='evaluation'];a,b=positions
        events[a],events[b]=events[b],events[a]
        for i,e in enumerate(events):e['sequence']=i+1
        with self.assertRaisesRegex(ValueError,'evaluation order'):self.verify(events,result,config)

    def test_false_duplicate_exclusion(self):
        events,result,config=self.case();events[0]['outcome']='query_exclusions'
        with self.assertRaisesRegex(ValueError,'exclusion lacks'):self.verify(events,result,config)

    def test_altered_checkpoint_cost_and_projection(self):
        for field,value in [('oracle_calls',19),('calls_for_remaining_at_block_rate',19),('accepted',19)]:
            events,result,config=self.case()
            next(e for e in events if e['kind']=='checkpoint')['slices'][0][field]=value
            with self.assertRaises(ValueError):self.verify(events,result,config)

    def test_false_stop_reason_and_raised_limit(self):
        events,result,config=self.case('batch_limit')
        next(e for e in events if e['kind']=='hold')['reason']='oracle_call_limit';result['hold']='oracle_call_limit'
        with self.assertRaisesRegex(ValueError,'limiting condition'):self.verify(events,result,config)
        events,result,config=self.case();result['limits']['maxOracleCalls']+=1
        with self.assertRaisesRegex(ValueError,'frozen pilot limits'):self.verify(events,result,config)

    def test_selection_decision_and_retained_rows(self):
        events,result,config=self.case();next(e for e in events if e['kind']=='selection')['outcome']='accepted'
        with self.assertRaisesRegex(ValueError,'selection decision'):self.verify(events,result,config)
        events,result,config=self.case();result['accepted'][0]['target_weight']=[4]
        with self.assertRaisesRegex(ValueError,'retained rows'):self.verify(events,result,config)

    def test_missing_occupancy_decision_reproduces_initial_failure(self):
        events,result,config=self.case('occupancy');events=[e for e in events if e.get('outcome')!='occupancy_limit']
        for i,e in enumerate(events):e['sequence']=i+1
        with self.assertRaisesRegex(ValueError,'checkpoint cost counters'):self.verify(events,result,config)

    def test_cache_capacity_and_buffer_claims(self):
        events,result,config=self.case('capacity');config['cache_limits']['maxEntries']=2;result['cache']['max_entries']=2
        with self.assertRaisesRegex(ValueError,'limiting condition'):self.verify(events,result,config)
        events,result,config=self.case();result['cache']['allocated_buffer_bytes']+=1
        with self.assertRaisesRegex(ValueError,'cache storage counters'):self.verify(events,result,config)

    def test_oracle_identity_and_support_claim(self):
        events,result,config=self.case();result['oracle_sha256']='b'*64
        with self.assertRaisesRegex(ValueError,'oracle contract'):self.verify(events,result,config)
        events,result,config=self.case();result['candidate_support']['status']='complete'
        with self.assertRaisesRegex(ValueError,'support claim'):self.verify(events,result,config)

    def test_incomplete_rollback(self):
        events,result,config=self.case('worker_failure');events=[e for e in events if e['kind']!='release']
        for i,e in enumerate(events):e['sequence']=i+1
        with self.assertRaisesRegex(ValueError,'checkpoint has pending'):self.verify(events,result,config)


if __name__ == '__main__':
    unittest.main()
