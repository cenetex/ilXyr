"""Check window origins, pack contents and overlap without running the selector."""
import argparse
from array import array
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import struct
import sys


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def grams(data):
    tokens = array('H')
    tokens.frombytes(data)
    if sys.byteorder != 'little':
        tokens.byteswap()
    text = ' '.join(''.join(chr(x) if 32 <= x < 127 else ' ' for x in tokens).lower().split())
    return {text[i:i + 64] for i in range(len(text) - 63)}


def check(prepared, windows):
    root = Path(__file__).resolve().parents[1]
    plan = json.loads((root / 'experiments/research-step-42/PLAN-v2.json').read_text())
    require(sha((prepared / 'MANIFEST.json').read_bytes()) == plan['input_preparation_manifest_sha256'], 'input manifest differs')
    manifest = json.loads((prepared / 'MANIFEST.json').read_text())

    def bound(name):
        data = (prepared / name).read_bytes()
        require(sha(data) == manifest['files'][name]['sha256'], 'input file differs: ' + name)
        return data

    sources = {name: bound('old/corpus/' + name + '.tok') for name in plan['source_order']}
    ranges = {Path(name).stem: row for name, row in json.loads(bound('RETENTION.json'))['q26_default_sampler_union'].items()}
    old_text = set()
    for name, data in sources.items():
        for start in ranges[name]['sampled_starts']:
            old_text.update(grams(data[start * 2:(start + 513) * 2]))
    task_data = bound('fresh/task/quantity-request.tok')
    task_tokens = array('H')
    task_tokens.frombytes(task_data)
    if sys.byteorder != 'little':
        task_tokens.byteswap()
    starts = [i for i, token in enumerate(task_tokens) if token == 1]
    task_plan = json.loads((root / 'experiments/research-step-41/PLAN.json').read_text())['task']['counts']
    require(len(starts) == task_plan['train'] + task_plan['validation'], 'task record count')
    for i in range(task_plan['train']):
        old_text.update(grams(task_data[starts[i] * 2:starts[i + 1] * 2]))
    rows = [json.loads(line) for line in (windows / 'ROSTER.jsonl').read_text().splitlines()]
    groups, intervals, selected_text = defaultdict(list), defaultdict(list), set()
    for row in rows:
        name, role = row['source'], row['role']
        require(name in sources and role in ('endpoint', 'replay'), 'unknown source or role')
        require(type(row['start']) is int and row['start'] >= 0 and row['end'] == row['start'] + 513, 'window boundary')
        data = sources[name][row['start'] * 2:row['end'] * 2]
        require(len(data) == 1026 and sha(data) == row['tokens_sha256'], 'window source content differs')
        text_parts = grams(data)
        require(not (text_parts & selected_text), 'selected windows share a 64-character span')
        selected_text.update(text_parts)
        if role == 'endpoint':
            require(row['end'] <= ranges[name]['validation_start'], 'endpoint uses the old validation partition')
            require(not (text_parts & old_text), 'endpoint shares old evaluated text or task training text')
        groups[role, name].append(data)
        intervals[name].append((row['start'], row['end']))
    for name, spans in intervals.items():
        spans.sort()
        require(all(a[1] <= b[0] for a, b in zip(spans, spans[1:])), 'source intervals overlap: ' + name)
    for role in ['endpoint', 'replay']:
        for name in plan['source_order']:
            data = (windows / role / (name + '.z4w')).read_bytes()
            kind = 1 if name == 'zero-foundation' else 2 if name == 'literary-dialogue' else 0
            expected_count = plan[role + '_windows'][name]
            require(len(groups[role, name]) == expected_count, 'source quota differs')
            expected = struct.pack('<8s4I', b'Z4WIND1\0', 512, expected_count, kind, 2 if role == 'endpoint' else 1)
            require(data == expected + b''.join(groups[role, name]), 'pack differs from source windows')
    return {'schema': 'ilxyr.zero4_window_independent_check.v1', 'origin_windows_checked': len(rows),
            'source_interval_overlap_pairs': 0, 'cross_window_64_character_matches': 0,
            'endpoint_old_evaluation_or_task_training_matches': 0,
            'manifest_sha256': sha((windows / 'MANIFEST.json').read_bytes())}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepared', type=Path, required=True)
    parser.add_argument('--windows', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    result = check(args.prepared, args.windows)
    with args.out.open('x') as stream:
        stream.write(json.dumps(result, indent=2, sort_keys=True) + '\n')
    print(json.dumps(result))
