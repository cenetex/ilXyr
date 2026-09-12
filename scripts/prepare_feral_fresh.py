"""Freeze report-derived FERAL questions and independent targets before prediction."""
import argparse
from decimal import Decimal, ROUND_HALF_UP, localcontext
from fractions import Fraction
import json
from pathlib import Path
from feral_fresh_sources import encode, sha, require, read_family, fingerprint

ROOT = Path(__file__).resolve().parents[1]
RECORDS = ROOT / 'experiments/research-step-47'


def rounded(value):
    with localcontext() as ctx:
        ctx.prec = 80
        v = (Decimal(value.numerator) / Decimal(value.denominator)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    return format(v, 'f').rstrip('0').rstrip('.') if v else '0'


def evidence(family, mutation='intact'):
    require(mutation in ['intact', 'missing_year', 'missing_series', 'ambiguous_label', 'conflicting_year'], 'unknown evidence mutation')
    facts = family['facts']; selected = []; mapping = []
    for fact in facts:
        if mutation == 'missing_year' and fact['role'] == 'a' and fact['year'] == 2025: continue
        if mutation == 'missing_series' and fact['role'] == 'b': continue
        selected.append((fact, fact['year']))
    if mutation == 'conflicting_year':
        selected.append((next(f for f in facts if f['role'] == 'a' and f['year'] == 2024), 2025))
    result = []
    for index, (fact, presented_year) in enumerate(selected):
        # Each cell is a separate evidence string. Values retain the table's stated scale.
        value = rounded(Fraction(fact['value']))
        require(Fraction(value) == Fraction(fact['value']), 'source value would change during normalization')
        suffix = ' million' if fact['unit'] == 'usd_million' else ''
        text = f"the {fact['label']} of {presented_year} is ${value}{suffix}"
        name = f'e{index:02d}'; result.append([name, text])
        mapping.append({'evidence_id': name, 'fact_id': fact['id'], 'presented_year': presented_year,
                        'transformation': 'prior_year_relabelled_as_requested_year' if presented_year != fact['year'] else 'source_cell_to_sentence'})
    return result, mapping


def family_cases(family):
    facts = {(f['role'], f['year']): f for f in family['facts']}
    a, b = facts['a', 2025]['label'], facts['b', 2025]['label']
    x, y, old = [Fraction(facts[key]['value']) for key in [('a', 2025), ('b', 2025), ('a', 2024)]]
    require(x != 0 and y != 0 and old != 0, 'numeric question requires a nonzero divisor')
    require(x != old and x != y, 'retrieval probes require distinct possible values')
    unit = family['unit']
    specs = [
        ('lookup', f'What was the value of {a} in 2025?', f'Give the 2025 amount for {a}.', x, unit, ['a:2025']),
        ('single_year_ratio', f'What was the ratio of {a} to {b} in 2025?', f'For 2025, divide {a} by {b}.', x / y, 'ratio', ['a:2025', 'b:2025']),
        ('percent_of', f'What percentage of {a} was {b} in 2025?', f'Express {b} as a percentage of {a} for 2025.', y / x * 100, 'percent', ['b:2025', 'a:2025']),
        ('excess', f'What was the excess of {a} over {b} in 2025?', f'Subtract {b} from {a} for 2025.', x - y, unit, ['a:2025', 'b:2025']),
        ('single_year_sum', f'What was the combined amount of {a} and {b} in 2025?', f'Add the 2025 amounts for {a} and {b}.', x + y, unit, ['a:2025', 'b:2025']),
        ('year_sum', f'What was the sum of {a} in 2024 and 2025?', f'Add {a} across 2024 and 2025.', old + x, unit, ['a:2024', 'a:2025']),
        ('year_average', f'What was the average {a} in 2024 and 2025?', f'For {a}, add 2024 and 2025 and divide by two.', (old + x) / 2, unit, ['a:2024', 'a:2025']),
        ('year_ratio', f'What was the ratio of {a} in 2025 to 2024?', f'Divide the 2025 {a} by its 2024 amount.', x / old, 'ratio', ['a:2025', 'a:2024']),
        ('year_change', f'What was the change in {a} from 2024 to 2025?', f'Subtract the 2024 {a} from its 2025 amount.', x - old, unit, ['a:2024', 'a:2025']),
        ('year_percent_change', f'What was the percentage change in {a} from 2024 to 2025?', f'Express the 2025 change in {a} as a percentage of its 2024 amount.', (x - old) / old * 100, 'percent', ['a:2024', 'a:2025']),
    ]
    if family['kind'] == 'shareholder':
        a0, b0 = [Fraction(facts[role, 2020]['value']) for role in ['a', 'b']]
        specs.append(('cumulative_return_difference', f'What was the difference in percentage cumulative total shareholder return on {a} versus {b} for the five year period ended 2025?', f'For the five-year period ending in 2025, how many percentage points separated the total shareholder returns of {a} and {b}, taking {a} minus {b}?', (x / a0 - y / b0) * 100, 'percentage_points', ['a:2025', 'a:2020', 'b:2025', 'b:2020']))
    result = []
    for form, canonical, paraphrase, value, result_unit, refs in specs:
        for style, question in [('canonical', canonical), ('paraphrase', paraphrase)]:
            result.append({'form': form, 'style': style, 'question': question, 'mutation': 'intact',
                           'target': {'kind': 'numeric', 'exact_value': str(value), 'rounded_value': rounded(value), 'unit': result_unit,
                                      'source_fact_ids': [facts[role, int(year)]['id'] for role, year in (ref.split(':') for ref in refs)]}})
    probes = [
        ('missing_year', f'What was the value of {a} in 2025?', f'Give the 2025 amount for {a}.', 'requested_cell_omitted'),
        ('missing_series', f'What was the ratio of {a} to {b} in 2025?', f'For 2025, divide {a} by {b}.', 'requested_series_omitted'),
        ('ambiguous_label', 'What was the value of the selected measure in 2025?', 'What was its 2025 amount?', 'question_leaves_multiple_series_eligible'),
        ('conflicting_year', f'What was the value of {a} in 2025?', f'Give the 2025 amount for {a}.', 'conflicting_values_for_one_series_and_year'),
    ]
    for mutation, canonical, paraphrase, reason in probes:
        for style, question in [('canonical', canonical), ('paraphrase', paraphrase)]:
            result.append({'form': mutation, 'style': style, 'question': question, 'mutation': mutation,
                           'target': {'kind': 'abstention', 'reason': reason}})
    return result


def build(families, opened):
    inputs, targets, roster = [], [], []
    old = {v['sha256'] for v in opened['fingerprints']}
    old_docs = set(opened['document_keys'])
    for family in families:
        require(family['report_key'] not in old_docs, 'fresh report overlaps opened document')
        for case in family_cases(family):
            rows, mapping = evidence(family, case['mutation'])
            key = fingerprint(case['question'], rows)
            require(key not in old, 'question and evidence duplicate an opened input')
            identity = 'feral47-' + key[:24]
            inputs.append({'schema': 'ilxyr.feral_fresh_input.v1', 'id': identity,
                           'question': case['question'], 'retrieved_evidence': rows})
            targets.append({'id': identity, **case['target']})
            roster.append({'id': identity, 'family': family['id'], 'company': family['company'], 'table_kind': family['kind'],
                           'form': case['form'], 'style': case['style'], 'input_sha256': key, 'mutation': case['mutation'],
                           'source_mapping': mapping, 'target_sha256': sha(encode(targets[-1]))})
    require(len({r['id'] for r in inputs}) == len(inputs), 'duplicate fresh input')
    order = sorted(range(len(inputs)), key=lambda i: inputs[i]['id'])
    return {'inputs': [inputs[i] for i in order], 'targets': [targets[i] for i in order], 'roster': [roster[i] for i in order]}


def validate(bundle, families, opened):
    # Rebuild every question, mutation and target from verified source facts.
    # Neither comparison implementation is imported by preparation or validation.
    require(bundle == build(families, opened), 'fresh question, evidence, target or roster differs')
    for row in bundle['inputs']:
        require(set(row) == {'schema', 'id', 'question', 'retrieved_evidence'}, 'predictor input contains extra fields')
    return {'status': 'verified', 'cases': len(bundle['inputs']), 'fresh_predictor_calls': 0}


def prepare(source_dir, output):
    manifest = json.loads((RECORDS / 'SOURCES.json').read_bytes())
    plan = json.loads((RECORDS / 'PLAN.json').read_bytes())
    for name, expected in plan['frozen_predictor_sources'].items(): require(sha((ROOT / name).read_bytes()) == expected, 'frozen predictor source differs')
    sources = {s['id']: s for s in manifest['sources']}
    families = [read_family((source_dir / (s['source_id'] + '.html')).read_bytes(), sources[s['source_id']], s) for s in manifest['families']]
    opened = json.loads((RECORDS / 'OPENED-AUDIT.json').read_bytes())
    require(sha(encode(opened)) == plan['opened_audit_sha256'], 'opened identity audit differs')
    bundle = build(families, opened); check = validate(bundle, families, opened)
    require(len(bundle['inputs']) == plan['cases'] and len(families) == plan['families'], 'frozen coverage differs')
    require(sum(v['kind'] == 'numeric' for v in bundle['targets']) == plan['numeric_cases'], 'frozen numeric coverage differs')
    output.mkdir(parents=True, exist_ok=False)
    (output / 'predictor').mkdir(); (output / 'grader').mkdir()
    paths = {'predictor/INPUTS.jsonl': b''.join((json.dumps(v, sort_keys=True, separators=(',', ':')) + '\n').encode() for v in bundle['inputs']),
             'grader/TARGETS.jsonl': b''.join((json.dumps(v, sort_keys=True, separators=(',', ':')) + '\n').encode() for v in bundle['targets']),
             'ROSTER.json': encode(bundle['roster']), 'FAMILIES.json': encode(families)}
    for name, raw in paths.items(): (output / name).write_bytes(raw)
    receipt = {**check, 'schema': 'ilxyr.feral_fresh_preparation.v1', 'source_sha256': sha((RECORDS / 'SOURCES.json').read_bytes()),
               'plan_sha256': sha((RECORDS / 'PLAN.json').read_bytes()), 'opened_audit_sha256': plan['opened_audit_sha256'],
               'files': {n: {'bytes': len(raw), 'sha256': sha(raw)} for n, raw in paths.items()},
               'source_facts': sum(len(f['facts']) for f in families), 'families': len(families),
               'implementation': {n: sha((ROOT / 'scripts' / n).read_bytes()) for n in ['feral_fresh_sources.py', 'prepare_feral_fresh.py', 'check_feral_fresh.mjs']},
               'source_document_overlap': [], 'opened_input_overlap': [],
               'company_overlap': sorted({s['report_key'].split('/')[0] for s in sources.values()} & {key.split('/')[0] for key in opened['document_keys']})}
    (output / 'PREPARE.json').write_bytes(encode(receipt)); return receipt


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--source-dir', type=Path, required=True); p.add_argument('--output', type=Path, required=True)
    a = p.parse_args(); print(json.dumps(prepare(a.source_dir, a.output), sort_keys=True))
