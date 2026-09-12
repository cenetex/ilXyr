"""Explicit arithmetic requests with complete label and period matching."""

from fractions import Fraction
import hashlib
import json
import re

from feral_evidence_calculator import extract_cells, render

VERSION = 'ilxyr.feral_evidence_calculator.v3'
YEAR = r'((?:19|20)\d{2})'


def label_key(text):
    return ' '.join(text.casefold().split()).rstrip('.')


def request(question):
    """Read one supported question into ordered fact requirements."""
    text = label_key(question).rstrip(' ?.'); candidates = []

    def add(pattern, operation, terms, separator=None):
        match = re.fullmatch(pattern, text)
        if match:
            values = match.groups()
            facts = terms(values)
            if any(not label_key(label) or not 1900 <= int(year) <= 2099 for label, year in facts):
                return
            if separator and any(re.search(r'\b' + separator + r'\b', label) for label, _ in facts):
                return
            candidates.append({'operation': operation, 'facts': [
                {'label': label_key(label), 'year': int(year)} for label, year in facts]})

    add(r'what (?:was|is) the value of (.+) in ' + YEAR, 'lookup', lambda g: [(g[0], g[1])])
    add(r'give the ' + YEAR + r' amount for (.+)', 'lookup', lambda g: [(g[1], g[0])])
    add(r'what (?:was|is) the ratio of (.+?) to (.+?) in ' + YEAR, 'ratio', lambda g: [(g[0], g[2]), (g[1], g[2])], 'to')
    add(r'for ' + YEAR + r', divide (.+?) by (.+)', 'ratio', lambda g: [(g[1], g[0]), (g[2], g[0])], 'by')
    add(r'what percentage of (.+?) (?:was|is) (.+?) in ' + YEAR, 'percent_of', lambda g: [(g[1], g[2]), (g[0], g[2])])
    add(r'express (.+?) as a percentage of (.+?) for ' + YEAR, 'percent_of', lambda g: [(g[0], g[2]), (g[1], g[2])])
    add(r'what (?:was|is) the excess of (.+?) over (.+?) in ' + YEAR, 'difference', lambda g: [(g[0], g[2]), (g[1], g[2])], 'over')
    add(r'subtract (.+?) from (.+?) for ' + YEAR, 'difference', lambda g: [(g[1], g[2]), (g[0], g[2])], 'from')
    add(r'what (?:was|is) the (?:sum|combined amount) of (.+?) and (.+?) in ' + YEAR, 'sum', lambda g: [(g[0], g[2]), (g[1], g[2])], 'and')
    add(r'add the ' + YEAR + r' amounts for (.+?) and (.+)', 'sum', lambda g: [(g[1], g[0]), (g[2], g[0])], 'and')
    add(r'what (?:was|is) the sum of (.+?) in ' + YEAR + r' and ' + YEAR, 'sum', lambda g: [(g[0], g[1]), (g[0], g[2])])
    add(r'add (.+?) across ' + YEAR + r' and ' + YEAR, 'sum', lambda g: [(g[0], g[1]), (g[0], g[2])])
    add(r'what (?:was|is) the average (.+?) in ' + YEAR + r' and ' + YEAR, 'average', lambda g: [(g[0], g[1]), (g[0], g[2])])
    add(r'for (.+?), add ' + YEAR + r' and ' + YEAR + r' and divide by two', 'average', lambda g: [(g[0], g[1]), (g[0], g[2])])
    add(r'what (?:was|is) the ratio of (.+?) in ' + YEAR + r' to ' + YEAR, 'ratio', lambda g: [(g[0], g[1]), (g[0], g[2])])
    add(r'divide the ' + YEAR + r' (.+?) by its ' + YEAR + r' amount', 'ratio', lambda g: [(g[1], g[0]), (g[1], g[2])])
    add(r'what (?:was|is) the change in (.+?) from ' + YEAR + r' to ' + YEAR, 'change', lambda g: [(g[0], g[1]), (g[0], g[2])])
    add(r'subtract the ' + YEAR + r' (.+?) from its ' + YEAR + r' amount', 'change', lambda g: [(g[1], g[0]), (g[1], g[2])])
    add(r'what (?:was|is) the (?:percentage|percent) change in (.+?) from ' + YEAR + r' to ' + YEAR, 'percent_change', lambda g: [(g[0], g[1]), (g[0], g[2])])
    add(r'express the ' + YEAR + r' change in (.+?) as a percentage of its ' + YEAR + r' amount', 'percent_change', lambda g: [(g[1], g[2]), (g[1], g[0])])
    add(r'what (?:was|is) the difference in percentage cumulative total shareholder return on (.+?) versus (.+?) for the five year period ended ' + YEAR,
        'return_difference', lambda g: [(g[0], g[2]), (g[0], int(g[2])-5), (g[1], g[2]), (g[1], int(g[2])-5)])
    match = re.fullmatch(r'for the five-year period ending in ' + YEAR + r', how many percentage points separated the total shareholder returns of (.+?) and (.+?), taking (.+?) minus (.+)', text)
    if match:
        year, left, right, numerator, denominator = match.groups()
        if left == numerator and right == denominator and int(year) >= 1905:
            candidates.append({'operation': 'return_difference', 'facts': [
                {'label': label_key(label), 'year': int(period)} for label, period in
                [(left, year), (left, int(year)-5), (right, year), (right, int(year)-5)]]})
    if len(candidates) != 1:
        return None
    return {'schema': 'ilxyr.feral_arithmetic_request.v1',
            'question_sha256': hashlib.sha256(question.encode()).hexdigest(), **candidates[0]}


def validate_input(question, evidence, arm):
    if arm not in ['calculator', 'operand_only']:
        raise ValueError('unknown control arm')
    if not isinstance(question, str) or len(question) > 10000:
        raise ValueError('question must be bounded text')
    if not isinstance(evidence, list) or len(evidence) > 100:
        raise ValueError('evidence must be a bounded list')
    names = set()
    for row in evidence:
        if not isinstance(row, (list, tuple)) or len(row) != 2 or not all(isinstance(v, str) for v in row):
            raise ValueError('evidence needs identifier and text pairs')
        name, text = row
        if not name or name in names or len(text) > 100000:
            raise ValueError('evidence identifiers must be unique and text bounded')
        names.add(name)


def arithmetic(operation, values, unit, arm):
    if arm == 'operand_only':
        return values[-1], unit, 0
    if operation == 'lookup': return values[0], unit, 0
    if operation in ['ratio', 'percent_of']:
        answer = values[0] / values[1]
        return (answer * 100, 'percent', 2) if operation == 'percent_of' else (answer, 'ratio', 1)
    if operation == 'difference': return values[0] - values[1], unit, 1
    if operation == 'change': return values[1] - values[0], unit, 1
    if operation == 'percent_change': return (values[1] - values[0]) / values[0] * 100, 'percent', 3
    if operation == 'sum': return sum(values), unit, len(values)-1
    if operation == 'average': return sum(values) / len(values), unit, len(values)
    if operation == 'return_difference':
        return (values[0] / values[1] - values[2] / values[3]) * 100, 'percentage_points', 4
    raise ValueError('unknown request operation')


def predict(question, evidence, arm='calculator'):
    validate_input(question, evidence, arm)
    parsed = request(question)
    result = {'schema': VERSION, 'arm': arm, 'request': parsed, 'prediction': None,
              'reason': None, 'operation': None if parsed is None else parsed['operation'],
              'operands': [], 'exact_result': None, 'unit': None,
              'work': {'evidence_rows': len(evidence), 'parsed_cells': 0,
                       'fact_lookups': 0, 'arithmetic_operations': 0}}

    def abstain(reason):
        result['reason'] = reason
        return result

    if parsed is None: return abstain('unsupported_or_ambiguous_request')
    cells = extract_cells(evidence); result['work']['parsed_cells'] = len(cells)
    index = {}; labels = set()
    for cell in cells:
        label = label_key(cell['label']); labels.add(label)
        index.setdefault((label, cell['year']), []).append(cell)
    for fact in parsed['facts']:
        result['work']['fact_lookups'] += 1
        if fact['label'] not in labels: return abstain('missing_requested_entity')
        matches = index.get((fact['label'], fact['year']), [])
        if not matches: return abstain('missing_requested_year')
        if len({(cell['value'], cell['unit']) for cell in matches}) != 1:
            return abstain('conflicting_values')
        result['operands'].append(min(matches, key=lambda cell: (cell['evidence_id'], cell['span'])))
    units = {cell['unit'] for cell in result['operands']}
    if len(units) != 1: return abstain('incompatible_units')
    unit = next(iter(units)); values = [Fraction(cell['value']) for cell in result['operands']]
    operation = parsed['operation']
    if operation == 'return_difference' and unit not in ['usd', 'usd_million', 'usd_billion', 'usd_thousand']:
        return abstain('return_requires_wealth_values')
    denominators = {'ratio': [1], 'percent_of': [1], 'percent_change': [0], 'return_difference': [1, 3]}
    if any(values[index] == 0 for index in denominators.get(operation, [])):
        return abstain('zero_denominator')
    try:
        answer, unit, operations = arithmetic(operation, values, unit, arm)
    except ZeroDivisionError:
        return abstain('zero_denominator')
    result['work']['arithmetic_operations'] = operations
    result.update(prediction=render(answer, unit), exact_result=str(answer), unit=unit, reason='answered')
    return result


def verify_result(question, evidence, result):
    """Replay the question contract, source choices and exact calculation."""
    expected = predict(question, evidence, result.get('arm'))
    if result != expected:
        raise ValueError('request, source fact, arithmetic or work record differs')
    return {'status': 'verified', 'scope': 'same implementation replay'}


def predict_row(row, arm='calculator'):
    from feral_comparison_worker import validate_input as validate_row
    validate_row(row)
    context = json.loads(row['messages'][1]['content'])
    return {'id': row['id'], **predict(context['question'], context['retrieved_evidence'], arm)}
