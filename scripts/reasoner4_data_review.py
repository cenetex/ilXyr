"""Review the opened Reasoner role examples after the frozen audit decision."""

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

from reasoner4_representation_audit import PAIRS, REVISION, ROLES, capture, parse_demo

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'experiments/reasoner4-representation-audit/v1'


def outputs(role, pairs):
    functions = {
        'candidate': lambda x, y: x,
        'goal': lambda x, y: y,
        'subtract': lambda x, y: x - y,
        'absolute': lambda x, y: abs(x),
        'multiply': lambda x, y: x * y,
        'nonzero': lambda x, y: int(x != 0),
    }
    return tuple(functions[role](x, y) for x, y in pairs)


def review_row(row):
    observations = [parse_demo(line) for line in row['demonstrations']]
    if len(observations) != PAIRS:
        raise ValueError('demonstration count differs')
    if any(symbol != row['symbol'] for symbol, _, _, _ in observations):
        raise ValueError('demonstration symbol differs')
    pairs = [(x, y) for _, x, y, _ in observations]
    observed = tuple(value for _, _, _, value in observations)
    signatures = {role: outputs(role, pairs) for role in ROLES}
    matches = [role for role, signature in signatures.items() if signature == observed]
    witnesses = {role: sum(actual != expected for actual, expected in zip(observed, signature))
                 for role, signature in signatures.items() if role != row['label']}
    return {'matches': matches, 'declared_label_matches': row['label'] in matches,
            'nearest_wrong_role_witnesses': min(witnesses.values())}


def review_split(path, name):
    raw = path.read_bytes()
    source = json.loads(raw)
    if source['source_revision'] != REVISION:
        raise ValueError('source revision differs')
    rows = source['rows']
    details = [review_row(row) for row in rows]
    paired = {}
    for row in rows:
        paired.setdefault((row['family'], row['label']), []).append(tuple(capture(row)))
    expected_surfaces = 2 if name == 'held' else 1
    role_counts = Counter(row['label'] for row in rows)
    return {
        'sha256': hashlib.sha256(raw).hexdigest(),
        'rows': len(rows),
        'role_counts': {role: role_counts[role] for role in ROLES},
        'unique_exact_role_rows': sum(item['matches'] == [row['label']]
                                      for item, row in zip(details, rows)),
        'declared_label_mismatches': sum(not item['declared_label_matches'] for item in details),
        'ambiguous_rows': sum(len(item['matches']) != 1 for item in details),
        'minimum_wrong_role_witnesses': min(item['nearest_wrong_role_witnesses']
                                             for item in details),
        'surface_pair_count_mismatches': sum(len(states) != expected_surfaces
                                             for states in paired.values()),
        'surface_pair_capture_mismatches': sum(len(set(states)) != 1
                                               for states in paired.values()),
    }


def build_review(data):
    return {
        'schema': 'ilxyr.reasoner4_opened_data_review.v1',
        'scope': 'opened fit and held role examples after the frozen v8 decision',
        'source_revision': REVISION,
        'splits': {name: review_split(data / (name + '.json'), name)
                   for name in ('fit', 'held')},
        'interpretation': 'Exact declared-operation signatures test example identifiability. '
                          'They are an explicit symbolic reference, not a learned model score.',
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', type=Path, default=DATA)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    result = build_review(args.data)
    encoded = (json.dumps(result, indent=2) + '\n').encode()
    if args.output:
        args.output.write_bytes(encoded)
    else:
        print(encoded.decode(), end='')


if __name__ == '__main__':
    main()
