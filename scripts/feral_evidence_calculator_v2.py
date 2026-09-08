"""Version 2 adds explicit single-year arithmetic to the frozen calculator."""

from fractions import Fraction
import re

from feral_evidence_calculator import YEAR, extract_cells, predict as legacy_predict, render, words

VERSION = 'ilxyr.feral_evidence_calculator.v2'


def request(question):
    text = ' '.join(question.lower().split()).rstrip(' ?')
    if len(YEAR.findall(text)) != 1:
        return None
    year = r'((?:19|20)\d{2})'
    rules = [
        ('ratio', r'what (?:was|is) the ratio of (.+?) to (.+?) in ' + year),
        ('percent_of', r'what percentage of (.+?) (?:was|is) (.+?) in ' + year),
        ('difference', r'what (?:was|is) the excess of (.+?) over (.+?) in ' + year),
        ('difference', r'what (?:was|is) the difference in percentage cumulative total shareholder return on (.+?) versus (.+?) for the five year period ended ' + year),
        ('sum', r'what (?:was|is) the (?:sum|combined amount) of (.+?) and (.+?) in ' + year),
        ('lookup', r'what (?:was|is) the value of (.+?) in ' + year),
    ]
    for kind, pattern in rules:
        match = re.fullmatch(pattern, text)
        if match:
            selectors = list(match.groups()[:-1])
            if any(re.search(r'\b(?:excluding|without|adjusted|change|growth|increase|decrease|ratio|difference|average|percent|percentage|per)\b', s) for s in selectors):
                return None
            if kind == 'percent_of': selectors.reverse()
            return kind, selectors, int(match.groups()[-1])
    return None


def predict(question, evidence, arm='calculator'):
    legacy = legacy_predict(question, evidence, arm)
    legacy.update(schema=VERSION, route='legacy')
    if legacy['reason'] not in ['question_needs_distinct_years', 'unsupported_question_shape']:
        return legacy
    parsed = request(question)
    if parsed is None:
        return legacy
    kind, selectors, year = parsed
    result = {'schema': VERSION, 'arm': arm, 'route': 'single_year', 'prediction': None,
              'reason': None, 'operation': kind, 'operands': [], 'selected_series': [],
              'exact_result': None, 'unit': None,
              'work': {'evidence_rows': len(evidence), 'parsed_cells': 0,
                       'series_scored': 0, 'arithmetic_operations': 0}}
    def abstain(reason):
        result['reason'] = reason
        return result
    cells = extract_cells(evidence)
    result['work']['parsed_cells'] = len(cells)
    series = {}
    for cell in cells:
        series.setdefault(' '.join(cell['label'].lower().split()), []).append(cell)
    for selector in selectors:
        ranked = []
        for label, entries in series.items():
            label_words = words(label); shared = len(label_words & words(selector))
            result['work']['series_scored'] += 1
            if shared: ranked.append(((shared, Fraction(shared, len(label_words))), label, entries))
        if not ranked: return abstain('missing_matching_series')
        ranked.sort(key=lambda item: item[:2], reverse=True)
        if len(ranked) > 1 and ranked[0][0] == ranked[1][0]: return abstain('ambiguous_series')
        _, label, entries = ranked[0]
        if label in result['selected_series']: return abstain('same_series')
        result['selected_series'].append(label)
        matches = [c for c in entries if c['year'] == year]
        if not matches: return abstain('missing_requested_year')
        if len({(c['value'], c['unit']) for c in matches}) != 1: return abstain('conflicting_values')
        result['operands'].append(min(matches, key=lambda c: (c['evidence_id'], c['span'])))
    units = {c['unit'] for c in result['operands']}
    if len(units) != 1: return abstain('incompatible_units')
    unit = next(iter(units)); values = [Fraction(c['value']) for c in result['operands']]
    if arm == 'operand_only':
        answer = values[-1]
    elif kind in ['ratio', 'percent_of']:
        if values[1] == 0: return abstain('zero_denominator')
        answer = values[0] / values[1]; unit = 'ratio'; result['work']['arithmetic_operations'] = 1
        if kind == 'percent_of':
            answer *= 100; unit = 'percent'; result['work']['arithmetic_operations'] += 1
    elif kind == 'difference':
        answer = values[0] - values[1]; result['work']['arithmetic_operations'] = 1
        if 'difference in percentage cumulative total shareholder return' in question.lower(): unit = 'percentage_points'
    elif kind == 'sum':
        answer = sum(values); result['work']['arithmetic_operations'] = len(values) - 1
    else: answer = values[0]
    result.update(prediction=render(answer, unit), exact_result=str(answer), unit=unit, reason='answered')
    return result


def predict_row(row, arm):
    import json
    from feral_comparison_worker import validate_input
    validate_input(row)
    context = json.loads(row['messages'][1]['content'])
    return {'id': row['id'], **predict(context['question'], context['retrieved_evidence'], arm)}
