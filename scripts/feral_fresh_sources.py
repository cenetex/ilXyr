"""Read fixed filing tables and retain the source location of every selected cell."""
from html.parser import HTMLParser
from pathlib import Path
from fractions import Fraction
import hashlib
import json
import re


def encode(value): return (json.dumps(value, indent=2, sort_keys=True) + '\n').encode()
def sha(raw): return hashlib.sha256(raw).hexdigest()
def require(ok, message):
    if not ok: raise ValueError(message)
def decode(raw): return raw.decode('utf-8').replace('\r\n', '\n').replace('\r', '\n')


class Tables(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.tables, self.stack, self.lines = [], [], [0]
        self.lines += [m.end() for m in re.finditer('\n', text)]
        self.feed(text)
        require(not self.stack, 'unclosed source table')

    def position(self):
        line, column = self.getpos(); return self.lines[line - 1] + column

    def handle_starttag(self, tag, attrs):
        if tag == 'table':
            table = {'index': len(self.tables), 'start': self.position(), 'rows': [], 'row': None, 'cell': None}
            self.tables.append(table); self.stack.append(table)
        if not self.stack: return
        table = self.stack[-1]
        if tag == 'tr': table['row'] = []; table['rows'].append(table['row'])
        if tag in ['td', 'th'] and table['row'] is not None:
            table['cell'] = []; table['row'].append(table['cell'])
        if tag == 'br' and table['cell'] is not None: table['cell'].append(' ')

    def handle_endtag(self, tag):
        if not self.stack: return
        table = self.stack[-1]
        if tag in ['td', 'th']: table['cell'] = None
        if tag == 'tr': table['row'] = None
        if tag == 'table': table['end'] = self.position() + len('</table>'); self.stack.pop()

    def handle_data(self, data):
        if self.stack and self.stack[-1]['cell'] is not None: self.stack[-1]['cell'].append(data)


def tables(raw):
    text = decode(raw); result = []
    for table in Tables(text).tables:
        rows = [[' '.join(''.join(cell).split()) for cell in row] for row in table['rows']]
        result.append({'index': table['index'], 'source_span': [table['start'], table['end']],
                       'html_sha256': sha(text[table['start']:table['end']].encode()), 'rows': rows})
    return result


NUMBER = re.compile(r'\$?\s*\(?-?\d[\d,]*(?:\.\d+)?\)?')
def number(cell):
    require(bool(NUMBER.fullmatch(cell)), 'unsupported source number: ' + cell)
    value = cell.replace('$', '').replace(',', '').strip()
    if value.startswith('(') and value.endswith(')'): value = '-' + value[1:-1]
    return Fraction(value)


def read_family(raw, source, spec):
    require(sha(raw) == source['sha256'] and len(raw) == source['bytes'], 'source bytes differ: ' + source['id'])
    ts = tables(raw); table = ts[spec['table_index']]
    require(table['html_sha256'] == spec['table_html_sha256'], 'selected source table differs')
    require(table['rows'][spec['header_row']] == spec['header_cells'], 'period header differs')
    # Currency and scale come from the fixed table heading or the adjacent filing text.
    text = decode(raw); unit = spec['unit_source']
    require(text[unit['span'][0]:unit['span'][1]] == unit['raw'], 'source unit evidence differs')
    result = {'id': spec['id'], 'company': source['company'], 'report_key': source['report_key'],
              'source_id': source['id'], 'source_sha256': source['sha256'], 'kind': spec['kind'],
              'unit': spec['unit'], 'unit_source': unit, 'table_index': table['index'],
              'table_html_sha256': table['html_sha256'], 'table_source_span': table['source_span'],
              'header_cells': spec['header_cells'], 'facts': []}
    for item in spec['series']:
        row = table['rows'][item['row']]
        require(row[0] == item['label'], 'selected row label differs')
        values = [(column, cell) for column, cell in enumerate(row[1:], 1) if cell and cell != '$']
        require(len(values) == len(spec['years']), 'source numeric column count differs')
        for year, (column, cell) in zip(spec['years'], values):
            value = str(number(cell)); require(value == item['values'][str(year)], 'transcribed source value differs')
            result['facts'].append({'id': spec['id'] + '-' + item['role'] + '-' + str(year), 'role': item['role'],
                'label': item['label'], 'year': year, 'value': value, 'unit': spec['unit'],
                'table_row': item['row'], 'table_column': column, 'source_cell': cell})
    require(len({f['id'] for f in result['facts']}) == len(result['facts']), 'duplicate source fact')
    if spec['kind'] == 'shareholder':
        require(all(next(f['value'] for f in result['facts'] if f['role'] == role and f['year'] == 2020) == '100' for role in ['a', 'b']), 'shared 100-dollar return base required')
    return result


def fingerprint(question, evidence):
    normalize = lambda value: ' '.join(value.lower().split())
    return sha(encode({'question': normalize(question), 'evidence': [normalize(text) for _name, text in evidence]}))


def opened_audit(raw):
    require(sha(raw) == '308a7b50bf9d2e018e36dab68f5238d26246f79c2f7672a176be7017f750eb8a', 'opened comparison input bytes differ')
    rows = [json.loads(line) for line in raw.splitlines()]
    require(len(rows) == 1147 and len({r['id'] for r in rows}) == 1147, 'opened roster differs')
    documents, fingerprints = set(), []
    for row in rows:
        documents.add('/'.join(row['id'].split('/')[:2]))
        context = json.loads(row['messages'][1]['content'])
        fingerprints.append({'id': row['id'], 'sha256': fingerprint(context['question'], context['retrieved_evidence'])})
    return {'schema': 'ilxyr.feral_opened_identity_audit.v1', 'input_sha256': sha(raw), 'rows': len(rows),
            'document_keys': sorted(documents), 'fingerprints': fingerprints}
