"""Build and inspect example-derived point-role states for frozen Reasoner 3.9."""
import argparse
import hashlib
import json
import platform
import random
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path('/Users/ratimics/develop/zero-grounded-literary-lm')
REVISION = '3b917b6f54d151a43dd65e45f094606272d166c5'
ROLES = ('candidate', 'goal', 'subtract', 'absolute', 'multiply', 'nonzero')
SOURCE_FILES = ('reasoner0.c', 'reasoner0.h', 'reasoner310.c', 'reasoner310.h')
PAIRS = 16
DIMENSION = 64
LINES = (re.compile(r'^([a-z]+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)$'),
         re.compile(r'^([a-z]+)\[(-?\d+),(-?\d+)\]->(-?\d+)$'))


def parse_demo(line):
    for pattern in LINES:
        match = pattern.fullmatch(line)
        if match:
            return match[1], *(int(v) for v in match.groups()[1:])
    raise ValueError('malformed demonstration')


def render_demo(template, symbol, x, y, output):
    if template == 'held-bracket-arrow-v1':
        return f'{symbol}[{x},{y}]->{output}'
    return f'{symbol} {x} {y} {output}'


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def exact_source():
    files = {}
    for name in SOURCE_FILES:
        raw = subprocess.check_output(['git', '-C', str(SOURCE), 'show', REVISION + ':' + name])
        files[name] = raw
    return files


def build_capture(work, source_files=None):
    work.mkdir(parents=True, exist_ok=True)
    source = source_files if source_files is not None else exact_source()
    for name, raw in source.items():
        (work / name).write_bytes(raw)
    helper = ROOT / 'scripts/reasoner4_role_capture.c'
    (work / helper.name).write_bytes(helper.read_bytes())
    command = ['clang', '-O2', '-std=c11', '-Wall', '-Wextra', '-Werror',
               str(work / helper.name), str(work / 'reasoner0.c'), '-o', str(work / 'capture')]
    subprocess.run(command, check=True, capture_output=True)
    return work / 'capture', {name: digest(raw) for name, raw in source.items()}


def symbol(index, family, split, seed):
    alphabet = 'abcdefghjkmnpqrstuvwxyz'
    raw = hashlib.sha256(f'{seed}:{split}:{family}:{index}'.encode()).digest()
    return ''.join(alphabet[value % len(alphabet)] for value in raw[:8])


def pairs_for(seed, family, split):
    rng = random.Random((seed << 16) + family * 117 + {'fit': 1, 'eval': 2}[split])
    if split == 'fit':
        # Independent signed inputs with balanced zero and nonzero cases.
        return [(rng.choice((-4, -2, -1, 0, 1, 2, 4)),
                 rng.choice((-3, -1, 0, 1, 3))) for _ in range(PAIRS)]
    # Held-out families use a separate construction: opposing signs, then
    # zero boundaries. They share the six fixed source operators.
    return [(rng.randrange(1, 7), -rng.randrange(1, 7)) if i < PAIRS // 2
            else (0 if i % 2 else -rng.randrange(1, 7),
                  rng.randrange(1, 7) if i % 2 else 0)
            for i in range(PAIRS)]


def make_split(binary, split, families, templates, law_family, seed):
    rows, queries = [], []
    for family in range(families):
        inputs = pairs_for(seed, family, split)
        order = list(range(6))
        random.Random(seed * 1009 + family).shuffle(order)
        for template in templates:
            for role in order:
                queries.extend(f'{role + 1} {x} {y}' for x, y in inputs)
                rows.append({'family': f'{split}-{family:02d}',
                             'surface_template': template,
                             'law_family': law_family,
                             'symbol': symbol(role, family, split, seed),
                             'label': ROLES[role], 'pairs': inputs})
    result = subprocess.run([str(binary)], input='\n'.join(queries) + '\n', text=True,
                            capture_output=True, check=True).stdout.splitlines()
    assert len(result) == len(rows) * PAIRS
    for i, row in enumerate(rows):
        row['demonstrations'] = [render_demo(row['surface_template'], row['symbol'], x, y,
                                             result[i * PAIRS + j])
                                 for j, (x, y) in enumerate(row.pop('pairs'))]
    return {'schema': 'ilxyr.reasoner4_role_examples.v1', 'split': split,
            'source_revision': REVISION, 'rows': rows}


def capture(row):
    """Read observations only. Role labels and family metadata stay outside this path."""
    values = []
    for line in row['demonstrations']:
        symbol, x, y, output = parse_demo(line)
        if symbol != row['symbol']:
            raise ValueError('malformed demonstration')
        values.extend((x, y, output, abs(output)))
    if len(values) != DIMENSION:
        raise ValueError('wrong demonstration count')
    return values


def verify_firewall(fit, held, scrambled):
    sources = {item['source_revision'] for item in (fit, held, scrambled)}
    if sources != {REVISION}:
        raise ValueError('source revision differs')
    for a, b in ((fit, held), (fit, scrambled)):
        for key in ('family', 'surface_template', 'law_family'):
            if {r[key] for r in a['rows']} & {r[key] for r in b['rows']}:
                raise ValueError(f'{key} crosses fit firewall')
    if [r['label'] for r in held['rows']] != [r['label'] for r in scrambled['rows']]:
        raise ValueError('scrambled pair labels differ')
    if any(r['demonstrations'] == s['demonstrations'] for r, s in zip(held['rows'], scrambled['rows'])):
        raise ValueError('scrambled demonstration is unchanged')


def scramble(held):
    result = json.loads(json.dumps(held))
    result['split'] = 'scrambled'
    for row in result['rows']:
        row['family'] = row['family'].replace('eval-', 'scrambled-')
        row['surface_template'] = 'scrambled-three-column-v1'
        row['law_family'] = 'scrambled-observation-v1'
    for offset in range(0, len(result['rows']), 6):
        group = result['rows'][offset:offset + 6]
        for demonstration in range(PAIRS):
            outputs = [parse_demo(r['demonstrations'][demonstration])[3] for r in group]
            for i, row in enumerate(group):
                _, x, y, _ = parse_demo(row['demonstrations'][demonstration])
                row['demonstrations'][demonstration] = render_demo(
                    'scrambled-three-column-v1', row['symbol'], x, y,
                    outputs[(i + demonstration + 1) % 6])
    return result


def prepare(output):
    if output.exists():
        raise ValueError('output already exists')
    output.mkdir(parents=True)
    with tempfile.TemporaryDirectory(prefix='reasoner4-capture-') as directory:
        binary, source_hashes = build_capture(Path(directory))
        fit = make_split(binary, 'fit', 10, ('fit-four-column-v1',), 'mixed-small-integer-v1', 39)
        held = make_split(binary, 'eval', 5,
                          ('held-four-column-v2', 'held-bracket-arrow-v1'),
                          'wider-signed-integer-v1', 20260926)
    control = scramble(held)
    verify_firewall(fit, held, control)
    bindings = {'schema': 'ilxyr.reasoner4_source_bindings.v1',
                'source_revision': REVISION, 'source_files': source_hashes,
                'capture_sha256': digest((ROOT / 'scripts/reasoner4_role_capture.c').read_bytes()),
                'generator_sha256': digest(Path(__file__).read_bytes()),
                'role_vocabulary': list(ROLES), 'dimension': DIMENSION,
                'source_access': 'git show at pinned commit; public point evaluator only',
                'sealed_access': False}
    for name, value in [('fit.json', fit), ('held.json', held),
                        ('scrambled.json', control), ('bindings.json', bindings)]:
        (output / name).write_bytes(encoded(value))
    print(json.dumps({name: digest((output / name).read_bytes())
                      for name in ('fit.json', 'held.json', 'scrambled.json', 'bindings.json')}, indent=2))


def smoke(folder):
    fit, held, scrambled = (json.loads((folder / name).read_bytes())
                            for name in ('fit.json', 'held.json', 'scrambled.json'))
    verify_firewall(fit, held, scrambled)
    rows = fit['rows'][:6] + held['rows'][:6] + scrambled['rows'][:6]
    states = [capture(row) for row in rows]
    assert all(len(v) == DIMENSION for v in states)
    assert all(states[i] != states[i + 12] for i in range(6))
    print(json.dumps({'status': 'smoke_passed', 'rows': len(rows),
                      'role_labels': [r['label'] for r in rows],
                      'state_sha256': digest(encoded(states)),
                      'python': platform.python_version(), 'cpu': platform.processor(),
                      'verifier_evaluations': len(rows) * PAIRS}))


def capture_artifact(folder):
    splits = {name: json.loads((folder / (name + '.json')).read_bytes())
              for name in ('fit', 'held', 'scrambled')}
    verify_firewall(splits['fit'], splits['held'], splits['scrambled'])
    states = {'schema': 'ilxyr.reasoner4_role_states.v1', 'dimension': DIMENSION,
              'source_revision': REVISION,
              'splits': {name: [capture(row) for row in value['rows']]
                         for name, value in splits.items()}}
    path = folder / 'states.json'
    if path.exists():
        raise ValueError('capture artifact already exists')
    path.write_bytes(encoded(states))
    print(json.dumps({'states_sha256': digest(path.read_bytes()),
                      'rows': {name: len(values) for name, values in states['splits'].items()}}))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=('prepare', 'smoke', 'capture'))
    parser.add_argument('folder', type=Path)
    args = parser.parse_args()
    {'prepare': prepare, 'smoke': smoke, 'capture': capture_artifact}[args.command](args.folder)


if __name__ == '__main__':
    main()
