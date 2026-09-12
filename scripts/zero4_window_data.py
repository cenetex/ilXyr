"""Select separate ZERO.4 replay and endpoint windows with complete decisions."""
import argparse
from array import array
from collections import Counter, defaultdict
import json
from pathlib import Path
import struct
import sys
import tempfile

import zero4_fresh_data as prior
from feral_process import digest, save

ROOT = Path(__file__).resolve().parents[1]
RECORD = ROOT / 'experiments/research-step-42'
MAGIC = b'Z4WIND1\0'
KINDS = {'text': 0, 'foundation': 1, 'channel': 2}
ROLES = {'replay': 1, 'endpoint': 2}


def load_tokens(path):
    data = array('H')
    data.frombytes(path.read_bytes())
    if sys.byteorder != 'little':
        data.byteswap()
    return data


def token_bytes(tokens):
    data = array('H', tokens)
    if sys.byteorder != 'little':
        data.byteswap()
    return data.tobytes()


def render(tokens):
    return ' '.join(''.join(chr(t) if 32 <= t < 127 else ' ' for t in tokens).lower().split())


def parts(tokens):
    text = render(tokens)
    return {text[i:i + 64] for i in range(len(text) - 63)}


def targets(tokens, channel):
    if not channel:
        return len(tokens) - 1
    active, count = False, 0
    for current, target in zip(tokens, tokens[1:]):
        if current == 6:
            active = True
        count += active
        if target in (4, 5):
            active = False
    return count


def fnv(tokens):
    value = 1469598103934665603
    for byte in token_bytes(tokens):
        value = ((value ^ byte) * 1099511628211) & ((1 << 64) - 1)
    return f'{value:016x}'


def pack(tokens, context, kind, role):
    prior.require(0 < len(tokens) <= 8192, 'pack window count')
    prior.require(all(len(row) == context + 1 for row in tokens), 'pack context length')
    return struct.pack('<8s4I', MAGIC, context, len(tokens), KINDS[kind], ROLES[role]) + b''.join(token_bytes(row) for row in tokens)


def unpack(data, context, kind, training=False):
    prior.require(len(data) >= 24, 'pack header truncated')
    magic, found_context, count, found_kind, role = struct.unpack_from('<8s4I', data)
    prior.require(magic == MAGIC and found_context == context and found_kind == KINDS[kind], 'pack identity')
    prior.require(0 < count <= 8192 and role in ROLES.values(), 'pack count or role')
    prior.require(not training or role == ROLES['replay'], 'endpoint pack used for training')
    prior.require(len(data) == 24 + count * (context + 1) * 2, 'pack byte count')
    tokens = array('H')
    tokens.frombytes(data[24:])
    if sys.byteorder != 'little':
        tokens.byteswap()
    return [tokens[i * (context + 1):(i + 1) * (context + 1)] for i in range(count)]


def capacity(plan, prepared):
    rows = []
    for name in plan['source_order']:
        count = (prepared / 'old/corpus' / (name + '.tok')).stat().st_size // 2
        required = (plan['endpoint_windows'][name] + plan['replay_windows'][name]) * plan['window_tokens']
        rows.append({'source': name, 'source_tokens': count, 'required_disjoint_tokens': required,
                     'length_feasible': required <= count})
    return rows


def select(plan, prepared, output):
    output.mkdir(parents=True, exist_ok=False)
    checks = capacity(plan, prepared)
    save(output / 'CAPACITY.json', checks)
    prior.require(all(row['length_feasible'] for row in checks), 'source capacity exceeded')
    native_ranges = json.loads((prepared / 'RETENTION.json').read_text())['q26_default_sampler_union']
    old = {Path(name).stem: row for name, row in native_ranges.items()}
    corpora, positions, kinds = {}, {}, {}
    old_parts = set()
    for name in plan['source_order']:
        data = load_tokens(prepared / 'old/corpus' / (name + '.tok'))
        corpora[name] = data
        kinds[name] = 'foundation' if name == 'zero-foundation' else 'channel' if name == 'literary-dialogue' else 'text'
        if kinds[name] == 'channel':
            positions[name] = [i for i, token in enumerate(data) if token == 1 and i + plan['window_tokens'] <= len(data)]
        for start in old[name]['sampled_starts']:
            old_parts.update(parts(data[start:start + plan['window_tokens']]))
    for row in prior.jsonl(prepared / 'fresh/task/records.jsonl'):
        if row['split'] == 'train':
            tokens = array('H')
            tokens.frombytes(prior.encode(row))
            if sys.byteorder != 'little':
                tokens.byteswap()
            old_parts.update(parts(tokens))
    used_intervals, used_parts = defaultdict(list), set()
    roster, decisions, windows = [], [], defaultdict(list)
    try:
        for role in ['endpoint', 'replay']:
            for name in plan['source_order']:
                source = corpora[name]
                limit = old[name]['validation_start'] if role == 'endpoint' else len(source)
                choices = ([i for i in positions[name] if i + plan['window_tokens'] <= limit]
                           if name in positions else range(limit - plan['window_tokens'] + 1))
                prior.require(len(choices) > 0, 'empty start roster: ' + name)
                seen = set()
                quota = plan[role + '_windows'][name]
                for candidate in range(plan['maximum_candidates_per_source_and_role']):
                    rank = prior.sha('\0'.join([plan['seed'], role, name, str(candidate)]))
                    start = choices[int(rank, 16) % len(choices)]
                    end = start + plan['window_tokens']
                    row = source[start:end]
                    text_parts = parts(row)
                    target_count = targets(row, kinds[name] == 'channel')
                    decision = ('repeated_start' if start in seen else 'zero_targets' if target_count == 0
                                else 'shared_source_tokens' if any(start < b and a < end for a, b in used_intervals[name])
                                else 'earlier_evaluation_text' if role == 'endpoint' and text_parts & old_parts
                                else 'shared_selected_text' if text_parts & used_parts else 'accept')
                    seen.add(start)
                    decisions.append({'role': role, 'source': name, 'candidate': candidate, 'rank': rank,
                                      'start': start, 'end': end, 'decision': decision})
                    if decision == 'accept':
                        identifier = f'{role}/{name}/{len(windows[role, name]):04d}'
                        roster.append({'id': identifier, 'role': role, 'source': name, 'kind': kinds[name],
                                       'start': start, 'end': end, 'target_count': target_count,
                                       'tokens_sha256': prior.sha(token_bytes(row)), 'tokens_fnv64': fnv(row),
                                       'content_sha256': prior.sha(render(row))})
                        windows[role, name].append(row)
                        used_intervals[name].append((start, end))
                        used_parts.update(text_parts)
                        if len(windows[role, name]) == quota:
                            break
                prior.require(len(windows[role, name]) == quota, f'quota exhausted: {role}/{name}')
        for (role, name), rows in windows.items():
            file = output / role / (name + '.z4w')
            file.parent.mkdir(exist_ok=True)
            file.write_bytes(pack(rows, plan['context_tokens'], kinds[name], role))
            prior.require([token_bytes(row) for row in unpack(file.read_bytes(), plan['context_tokens'], kinds[name])]
                          == [token_bytes(row) for row in rows], 'pack round trip')
        result = {'schema': 'ilxyr.zero4_window_selection.v1', 'status': 'complete', 'context_tokens': plan['context_tokens'],
                  'counts': {role: {name: len(windows[role, name]) for name in plan['source_order']} for role in ['endpoint', 'replay']},
                  'decisions': len(decisions), 'decision_counts': dict(sorted(Counter(row['decision'] for row in decisions).items())),
                  'production_model_calls': 0, 'paid_instances': 0}
        save(output / 'RESULT.json', result)
        return result
    except BaseException as error:
        save(output / 'FAILURE.json', {'error': str(error), 'accepted_windows': len(roster), 'decisions': len(decisions)})
        raise
    finally:
        prior.write_rows(output / 'ROSTER.jsonl', roster)
        prior.write_rows(output / 'DECISIONS.jsonl', decisions)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['prepare', 'check'])
    parser.add_argument('--prepared', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--plan', type=Path, default=RECORD / 'PLAN-v2.json')
    args = parser.parse_args()
    plan = json.loads(args.plan.read_text())
    prior.require(digest(args.prepared / 'MANIFEST.json') == plan['input_preparation_manifest_sha256'], 'step41 input identity')
    prior.check(args.prepared)
    if args.mode == 'prepare':
        result = select(plan, args.prepared, args.out)
        save(args.out / 'MANIFEST.json', {'schema': 'ilxyr.zero4_window_manifest.v1', 'plan_sha256': digest(args.plan),
                                        'files': prior.files(args.out)})
        print(json.dumps(result, indent=2))
    else:
        manifest = json.loads((args.out / 'MANIFEST.json').read_text())
        prior.require(manifest['plan_sha256'] == digest(args.plan), 'window plan identity')
        actual = prior.files(args.out)
        del actual['MANIFEST.json']
        prior.require(actual == manifest['files'], 'window saved files differ')
        with tempfile.TemporaryDirectory(prefix='zero4-window-replay-') as directory:
            dest = Path(directory) / 'replay'
            select(plan, args.prepared, dest)
            prior.require(prior.files(dest) == manifest['files'], 'window selection replay differs')
        print(json.dumps({'status': 'verified', 'manifest_sha256': digest(args.out / 'MANIFEST.json'), 'files': len(actual)}))


if __name__ == '__main__':
    main()
