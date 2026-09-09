"""Prepare bounded ZERO.4 data, with replayable exclusions and native gold checks."""

import argparse
from array import array
from collections import Counter, defaultdict
from fractions import Fraction
import hashlib
import json
import math
from pathlib import Path
import shutil
import struct
import sys
import tempfile
import time
import zipfile

from feral_process import digest, run_process, save

ROOT = Path(__file__).resolve().parents[1]
RECORD = ROOT / 'experiments/research-step-41'
HEADER = 'id\tdomain\tprevious_summary\tinput\tmodel_request\trequest\tartifact\tsummary'
RAW = {
    'blimp_zip.zip': '172a1a714d72e72a89e8384dd531483f3d0f8a9aee3d33dccaf7992d8cecbb73',
    'tinystories_validation.txt': '94e431816c4cce81ff71e4408ff8d3bda9a42e8d2663986697c3954288cb38b4',
    'kjv-raw.txt': 'dfed950e8e6719a2536a9e70a171a4addb3093e024acc1cfc0c7d3bdc7ed9d76',
}
# Input hashes come from the pinned upstream contracts, before new selection.
OLD_LANGUAGE = {
    'blimp.tsv': 'b69d5f829d23c648dbf7cfbfd64ba9d7b3cc9f1650e8041ada06c7e0e67da55c',
    'tinystories.tsv': '75e522b8c1e942eb0198be98b494dcefdec92f18f5e2e47fc14fdcfb66eb8b54',
    'old-blimp-screen.tsv': '06ffc0ee2832b193ff6ce895828bbe4a69befe2b1f30cfec19027b83692187a3',
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(value):
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()


def packed(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def jsonl(path):
    return [json.loads(line) for line in path.read_text().splitlines()]


def write_rows(path, rows):
    path.write_text(''.join(packed(row) + '\n' for row in rows))


def key(request):
    op, *args = request.split()
    if op in ('quantity.add', 'quantity.multiply'):
        require(len(args) == 2, 'integer operand count')
        args = sorted(map(int, args))
    elif op == 'quantity.add-rational':
        require(len(args) == 2, 'rational operand count')
        args = sorted(str(Fraction(x)) for x in args)
    elif op == 'quantity.solve-linear':
        require(len(args) == 3, 'linear operand count')
        a, b, c = map(int, args)
        require(a > 0, 'linear coefficient must be positive')
        divisor = math.gcd(math.gcd(a, b), c)
        args = [a // divisor, b // divisor, c // divisor]
    elif op == 'quantity.convert':
        require(len(args) == 2 and args[1] in ('m-to-cm', 'cm-to-mm', 'kg-to-g'), 'conversion operands')
        args = [int(args[0]), args[1]]
    else:
        raise ValueError('unknown operation')
    return packed([op, args])


def candidate(seed, split, op, index, attempt):
    rank = sha('\0'.join(map(str, [seed, split, op, index, attempt])))
    draws = 0

    def integer(low, high):
        nonlocal draws
        value = int(sha(rank + '\0' + str(draws)), 16) % (high - low + 1) + low
        draws += 1
        return value

    if op in ('add', 'multiply'):
        bound = 999 if op == 'add' else 99
        a, b = integer(-bound, bound), integer(-bound, bound)
        request = f'quantity.{op} {a} {b}'
        text = f'{op} {a} {b}'
        artifact = f'result {a + b if op == "add" else a * b}'
    elif op == 'add-rational':
        a, b, c, d = integer(-24, 24), integer(1, 24), integer(-24, 24), integer(1, 24)
        value = Fraction(a, b) + Fraction(c, d)
        request = f'quantity.{op} {a}/{b} {c}/{d}'
        text = f'{op} {a}/{b} {c}/{d}'
        artifact = f'result {value}'
    elif op == 'convert':
        value, unit = integer(1, 999), integer(0, 2)
        conversion, factor, suffix = [('m-to-cm', 100, 'cm'), ('cm-to-mm', 10, 'mm'), ('kg-to-g', 1000, 'g')][unit]
        request = f'quantity.convert {value} {conversion}'
        text = f'convert {value} {conversion}'
        artifact = f'result {value * factor} {suffix}'
    else:
        require(op == 'solve-linear', 'unknown candidate operation')
        a, x, b = integer(1, 24), integer(-99, 99), integer(-99, 99)
        c = a * x + b
        request = f'quantity.solve-linear {a} {b} {c}'
        text = f'solve {a}*x+{b}={c}'
        artifact = f'x {x}'
    return rank, {'id': f'zero4-step41/{split}/{op}/{index:06d}', 'domain': 'quantity',
                  'split': split, 'previous_summary': 'quantity channel has no prior committed result',
                  'input': text, 'model_request': 'quantity.' + op, 'request': request,
                  'artifact': artifact, 'summary': 'kernel committed ' + artifact}


def encode(record):
    text = lambda s: list(s.encode('ascii'))
    tokens = [1, ord('Q'), 7, *text(record['previous_summary']), 4, 2, ord('U'),
              *text(record['input']), 4, 2, ord('Z'), 3, ord('U'), 6,
              *text('@request ' + record['model_request'] + ' @close'), 4, 5]
    require(len(tokens) <= 500, 'record exceeds the historical context limit')
    return struct.pack('<' + 'H' * len(tokens), *tokens)


def tsv(path, rows):
    fields = HEADER.split('\t')
    path.write_text(HEADER + '\n' + ''.join('\t'.join(row[f] for f in fields) + '\n' for row in rows))


def old_task_audit(priors):
    groups = defaultdict(list)
    for source, rows in priors.items():
        for row in rows:
            groups[key(row['request'])].append({'source': source, 'id': row['id'], 'split': row['split']})
    repeats = [{'key': k, 'rows': rows} for k, rows in sorted(groups.items()) if len(rows) > 1]
    cross = [row for row in repeats if len({r['split'] for r in row['rows']}) > 1]
    return {'rows': sum(map(len, priors.values())), 'unique_keys': len(groups),
            'repeated_keys': len(repeats), 'duplicate_rows': sum(len(row['rows']) - 1 for row in repeats),
            'cross_split_keys': len(cross)}, groups, repeats


def tasks(plan, old, out):
    out.mkdir()
    priors = {spec['name']: jsonl(old / spec['name'] / 'quantity-request.jsonl')
              for spec in plan['prior_generators']}
    audit, prior_keys, repeats = old_task_audit(priors)
    audit['by_source'] = {name: old_task_audit({name: rows})[0] for name, rows in priors.items()}
    write_rows(out / 'prior-repeated-keys.jsonl', repeats)
    accepted, decisions, seen = [], [], set()
    # Explicit split order matters for the fixed 95 percent native record split.
    for split in ['train', 'validation', 'promotion']:
        count = plan['counts'][split]
        require(count % len(plan['operations']) == 0, 'operation balance')
        for index in range(count // len(plan['operations'])):
            for op in plan['operations']:
                for attempt in range(plan['maximum_attempts_per_slot']):
                    rank, row = candidate(plan['seed'], split, op, index, attempt)
                    canonical = key(row['request'])
                    decision = 'prior_key' if canonical in prior_keys else 'new_key' if canonical in seen else 'accept'
                    decisions.append({'id': row['id'], 'attempt': attempt, 'rank': rank,
                                      'key': canonical, 'decision': decision})
                    if decision == 'accept':
                        accepted.append(row)
                        seen.add(canonical)
                        break
                else:
                    write_rows(out / 'decisions.jsonl', decisions)
                    raise ValueError('candidate exhaustion; original quota retained')
    write_rows(out / 'records.jsonl', accepted)
    write_rows(out / 'decisions.jsonl', decisions)
    tsv(out / 'all.tsv', accepted)
    for split in ['train', 'validation', 'promotion']:
        tsv(out / (split + '.tsv'), [r for r in accepted if r['split'] == split])
    (out / 'quantity-request.tok').write_bytes(b''.join(encode(r) for r in accepted if r['split'] != 'promotion'))
    return {'prior': audit, 'accepted': len(accepted), 'splits': plan['counts'],
            'decisions': len(decisions), 'decision_counts': dict(sorted(Counter(d['decision'] for d in decisions).items())),
            'cross_split_keys': 0, 'prior_shared_keys': 0}


def text_key(text):
    return ' '.join(text.lower().split())


def shingles(text):
    text = text_key(text)
    return {text[i:i + 64] for i in range(len(text) - 63)}


def read_tsv(path):
    lines = path.read_text().splitlines()
    rows = [line.split('\t') for line in lines[1:]]
    require(all(len(r) == 10 for r in rows), 'language TSV field count')
    return lines[0], rows


def language(plan, old, out):
    out.mkdir()
    for name, expected in OLD_LANGUAGE.items():
        require(digest(old / name) == expected, 'historical language hash mismatch: ' + name)
    header, blimp = read_tsv(old / 'blimp.tsv')
    _, prior_blimp = read_tsv(old / 'old-blimp-screen.tsv')
    calibration = [blimp[i * (len(blimp) - 1) // 63] for i in range(64)]
    prior_blimp += calibration
    old_ids = {r[0] for r in prior_blimp}
    old_text = {text_key(t) for r in prior_blimp for t in r[6:8]}
    seen_text, chosen, decisions = set(), [], []
    groups = sorted({r[2] for r in blimp})
    require(len(groups) == plan['blimp_paradigms'], 'BLiMP group count')
    for group in groups:
        count = 0
        ranked = sorted((sha(plan['seed'] + '\0' + r[0] + '\0' + '\t'.join(r)), r)
                        for r in blimp if r[2] == group)
        for rank, row in ranked:
            texts = {text_key(t) for t in row[6:8]}
            decision = ('prior_id' if row[0] in old_ids else 'prior_text' if texts & old_text
                        else 'new_text' if texts & seen_text else 'accept')
            decisions.append({'id': row[0], 'rank': rank, 'decision': decision})
            if decision == 'accept':
                chosen.append(row)
                seen_text.update(texts)
                count += 1
                if count == plan['blimp_per_paradigm']:
                    break
        require(count == plan['blimp_per_paradigm'], 'BLiMP quota exhausted: ' + group)
    (out / 'blimp.tsv').write_text(header + '\n' + ''.join('\t'.join(r) + '\n' for r in chosen))
    write_rows(out / 'blimp-decisions.jsonl', decisions)
    write_rows(out / 'blimp-roster.jsonl', [{'id': r[0], 'group': r[2], 'row_sha256': sha('\t'.join(r))} for r in chosen])
    result = {'blimp': {'accepted': len(chosen), 'prior_ids': len(old_ids),
                        'decision_counts': dict(sorted(Counter(d['decision'] for d in decisions).items()))}}
    stories = jsonl(old / 'stories.jsonl')
    _, prior_tiny = read_tsv(old / 'tinystories.tsv')
    old_ids = {int(r[0].split('/')[1]) for r in prior_tiny}
    old_stories = {sha(text_key(r['story'])) for r in stories if r['index'] in old_ids}
    old_shingles = set().union(*(shingles(r[6]) for r in prior_tiny))
    seen_stories, seen_shingles, chosen, decisions, roster = set(), set(), [], [], []
    ranked = sorted((sha(plan['seed'] + '\0' + str(r['index']) + '\0' + r['story']), r['index'], r['story']) for r in stories)
    for rank, index, story in ranked:
        maximum = max(0, len(story) - plan['window_bytes'])
        offset = int(rank[:12], 16) % (maximum + 1)
        window = story[offset:offset + plan['window_bytes']]
        story_hash, parts = sha(text_key(story)), shingles(window)
        decision = ('prior_id' if index in old_ids else 'prior_story' if story_hash in old_stories
                    else 'prior_window_overlap' if parts & old_shingles
                    else 'new_story' if story_hash in seen_stories
                    else 'new_window_overlap' if parts & seen_shingles else 'accept')
        identifier = f'tinystories/{index}/{offset}'
        decisions.append({'id': identifier, 'rank': rank, 'decision': decision})
        if decision == 'accept':
            row = [identifier, 'tinystories', 'validation', 'rolling', '0', '', window, '', '', '']
            chosen.append(row)
            roster.append({'id': identifier, 'story_sha256': story_hash, 'window_sha256': sha(window),
                           'row_sha256': sha('\t'.join(row)), 'window_bytes': len(window)})
            seen_stories.add(story_hash)
            seen_shingles.update(parts)
            if len(chosen) == plan['tinystories_cases']:
                break
    write_rows(out / 'tinystories-decisions.jsonl', decisions)
    require(len(chosen) == plan['tinystories_cases'], 'TinyStories quota exhausted')
    (out / 'tinystories.tsv').write_text(header + '\n' + ''.join('\t'.join(r) + '\n' for r in chosen))
    write_rows(out / 'tinystories-roster.jsonl', roster)
    result['tinystories'] = {'accepted': len(chosen), 'prior_story_ids': len(old_ids),
                             'decision_counts': dict(sorted(Counter(d['decision'] for d in decisions).items()))}
    return result


def retention_coverage(data, channel=False, context=512, samples=4):
    require(len(data) >= 2 * (context + 1), 'source too short for native sampler')
    if channel:
        records = [i for i, token in enumerate(data) if token == 1]
        require(len(records) >= 20, 'channel record count')
        split = len(records) * 95 // 100
        start = records[split]
        choices = [i for i in records[split:] if i + context + 1 <= len(data)]
    else:
        start = len(data) - max(len(data) // 20, context + 1)
        choices = range(start, len(data) - context)
    require(len(choices) > 0, 'validation start count')
    counts = [samples] if isinstance(samples, int) else samples
    require(all(isinstance(s, int) and s > 0 for s in counts), 'sample counts must be positive')
    exposed = set()
    for count in counts:
        exposed.update(choices[i * (len(choices) - 1) // (count - 1)] for i in range(count)) if count > 1 else exposed.add(choices[0])
    disjoint = sum(all(abs(i - e) > context for e in exposed) for i in choices)
    return {'tokens': len(data), 'validation_start': start, 'validation_tokens': len(data) - start,
            'possible_validation_starts': len(choices), 'sampled_starts': sorted(exposed),
            'unused_start_positions': len(choices) - len(exposed),
            'unused_windows_disjoint_from_sampled_tokens': disjoint,
            'two_disjoint_native_size_files_possible_by_length': len(data) >= 4 * (context + 1),
            'coverage_scope': 'Positions within the pinned source; equal text elsewhere and prior teacher training require separate checks.'}


def command(args, cwd, out, name):
    result = run_process([str(x) for x in args], cwd, out / name, time.monotonic() + 120, 2)
    require(result['status'] == 'complete', 'process failed; retained receipt: ' + name)
    return result


def reconstruct(source, raw, out, cc):
    binding = json.loads((RECORD / 'SOURCE-FILES.json').read_text())
    for name, expected in binding['files'].items():
        require(digest(source / name) == expected['sha256'], 'source hash mismatch: ' + name)
    for name, expected in RAW.items():
        require(digest(raw / name) == expected, 'raw hash mismatch: ' + name)
    receipts = out / 'processes'
    receipts.mkdir()
    old = out / 'old'
    old.mkdir()
    plan = json.loads((RECORD / 'PLAN.json').read_text())
    for spec in plan['task']['prior_generators']:
        command(['node', source / 'scripts/generate_zero4_q2.mjs', '--out', old / spec['name'],
                 '--quantity', spec['quantity'], '--seed', spec['seed'], '--request-mode', 'operation'],
                source, receipts, 'prior-' + spec['name'])
    contract = json.loads((source / 'benchmarks/zero4-q26-v1/contract.json').read_text())
    for key_name, file in [('manifest', 'manifest.json'), ('tokens', 'quantity-request.tok'),
                           ('sentinel', 'quantity-request.sentinel.tsv'), ('public', 'quantity-request.public.tsv'),
                           ('promotion', 'quantity-request.promotion.tsv')]:
        require(digest(old / 'q26' / file) == contract['quantity_corpus'][key_name + '_sha256'], 'old quantity hash: ' + file)
    lang = old / 'language'
    lang.mkdir()
    extracted = lang / 'blimp-source'
    extracted.mkdir()
    with zipfile.ZipFile(raw / 'blimp_zip.zip') as archive:
        for item in archive.infolist():
            if item.filename.endswith('.jsonl') and not item.filename.startswith('__MACOSX/'):
                require(item.file_size <= 1024 * 1024, 'BLiMP member limit')
                dest = extracted / Path(item.filename).name
                require(not dest.exists(), 'duplicate BLiMP member')
                dest.write_bytes(archive.read(item))
    command(['node', ROOT / 'scripts/zero4_language_inputs.mjs', source, raw, lang], source, receipts, 'old-language')
    for name, expected in OLD_LANGUAGE.items():
        require(digest(lang / name) == expected, 'historical language hash: ' + name)
    corp = old / 'corpus'
    corp.mkdir()
    shutil.copyfile(source / 'corpus/literary.bpe', corp / 'literary.bpe')
    command(['sh', source / 'scripts/prepare_kjv.sh', raw / 'kjv-raw.txt', corp / 'bible-kjv.txt'], source, receipts, 'normalize-kjv')
    require(digest(corp / 'bible-kjv.txt') == 'ffa65bc44f1772165f50d572b04a6afdd66eabda2f7ee31ddacc67644f5b1d7f', 'KJV body hash')
    for name in ['bpe_tokenizer', 'channel_corpus']:
        command([cc, '-std=c11', '-O2', '-Wall', '-Wextra', source / (name + '.c'), '-o', corp / name], source, receipts, 'build-' + name)
    args = [corp / 'bpe_tokenizer', '--vocab', corp / 'literary.bpe']
    for name in ['zero-foundation', 'shakespeare', 'blake', 'crowley', 'bible-kjv']:
        text = (corp if name == 'bible-kjv' else source / 'corpus') / (name + '.txt')
        args += ['--text', text, '--out', corp / (name + '.tok')]
    command(args, source, receipts, 'encode-replay')
    command([corp / 'channel_corpus', '--play', 'S', corp / 'shakespeare.tok', '--play', 'C', corp / 'crowley.tok',
             '--verse', 'B', corp / 'blake.tok', '--out', corp / 'literary-dialogue.tok', '--preview', corp / 'dialogue-preview.txt'],
            source, receipts, 'build-channel')
    coverage, q26_coverage = {}, {}
    for name, expected in contract['replay_corpus'].items():
        file = corp / Path(name).name
        require(digest(file) == expected, 'native replay hash: ' + name)
        if file.suffix == '.tok':
            data = array('H')
            data.frombytes(file.read_bytes())
            if sys.byteorder != 'little':
                data.byteswap()
            coverage[name] = retention_coverage(data, 'channel/' in name, plan['retention']['context_tokens'], plan['retention']['prior_eval_samples'])
            q26_coverage[name] = retention_coverage(data, 'channel/' in name, plan['retention']['context_tokens'], (1, 2, 8))
    save(out / 'RETENTION.json', {'schema': 'ilxyr.zero4_retention_coverage.v1', 'sources': coverage,
                                'q26_default_sampler_union': q26_coverage,
                                'q26_default_sample_counts': [1, 2, 8],
                                'samples_per_source': plan['retention']['prior_eval_samples'],
                                'sampling_scope': 'The fixed four-window diagnostic and Q2.6 default sampler union. The Q2.6 sentinel uses 12 batches across six sources, full evaluation uses 48, and training reports use 56 across seven sources. Older lineages and any non-default schedules need a separate exposure audit.'})
    return old, receipts


def selected(plan, old, out):
    out.mkdir()
    result = {'schema': 'ilxyr.zero4_fresh_selection.v1',
              'task': tasks(plan['task'], old, out / 'task'),
              'language': language(plan['language'], old / 'language', out / 'language'),
              'model_calls': 0}
    save(out / 'RESULT.json', result)
    return result


def files(directory):
    return {p.relative_to(directory).as_posix(): {'sha256': digest(p), 'bytes': p.stat().st_size}
            for p in sorted(directory.rglob('*')) if p.is_file()}


def check_old_inputs(old):
    binding = json.loads((RECORD / 'INPUTS.json').read_text())
    for name, expected in binding['old_files'].items():
        require((old / name).stat().st_size == expected['bytes'] and digest(old / name) == expected['sha256'],
                'bound historical input differs: ' + name)


def check(prepared):
    manifest = json.loads((prepared / 'MANIFEST.json').read_text())
    require(manifest['plan_sha256'] == digest(RECORD / 'PLAN.json'), 'plan identity')
    require(manifest['source_files_sha256'] == digest(RECORD / 'SOURCE-FILES.json'), 'source binding identity')
    require(manifest['inputs_sha256'] == digest(RECORD / 'INPUTS.json'), 'input binding identity')
    actual = files(prepared)
    del actual['MANIFEST.json']
    require(actual == manifest['files'], 'saved file set or hash changed')
    check_old_inputs(prepared / 'old')
    plan = json.loads((RECORD / 'PLAN.json').read_text())
    with tempfile.TemporaryDirectory(prefix='zero4-selection-replay-') as directory:
        dest = Path(directory) / 'fresh'
        selected(plan, prepared / 'old', dest)
        require(files(dest) == files(prepared / 'fresh'), 'selection decision replay differs')
    rows = jsonl(prepared / 'fresh/task/records.jsonl')
    require(len({key(r['request']) for r in rows}) == len(rows), 'duplicate fresh task keys')
    require(Counter(r['split'] for r in rows) == plan['task']['counts'], 'split counts differ')
    return {'schema': 'ilxyr.zero4_fresh_data_check.v1', 'files': len(actual),
            'selection_replay': 'all rows, ranks, rejections and tokens match', 'manifest_sha256': digest(prepared / 'MANIFEST.json')}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['prepare', 'check'])
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--source', type=Path)
    parser.add_argument('--raw', type=Path)
    parser.add_argument('--cc', default='cc')
    args = parser.parse_args()
    if args.mode == 'check':
        print(json.dumps(check(args.out), indent=2))
        return
    require(args.source is not None and args.raw is not None, 'source and raw folders required')
    args.out.mkdir(parents=True, exist_ok=False)
    try:
        old, receipts = reconstruct(args.source.resolve(), args.raw.resolve(), args.out, args.cc)
        check_old_inputs(old)
        plan = json.loads((RECORD / 'PLAN.json').read_text())
        result = selected(plan, old, args.out / 'fresh')
        native = args.out / 'native-gold'
        command([args.cc, '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-I', args.source,
                 ROOT / 'scripts/zero4_native_gold.c', args.source / 'quantity_oracle.c', '-o', native],
                args.source, receipts, 'build-native-gold')
        command([native, args.out / 'fresh/task/all.tsv'], args.source, receipts, 'native-gold')
        result['native_gold'] = json.loads((receipts / 'native-gold/stdout.log').read_text())
        save(args.out / 'RESULT.json', result)
        manifest = {'schema': 'ilxyr.zero4_fresh_data_manifest.v1', 'plan_sha256': digest(RECORD / 'PLAN.json'),
                    'inputs_sha256': digest(RECORD / 'INPUTS.json'),
                    'source_files_sha256': digest(RECORD / 'SOURCE-FILES.json'), 'files': files(args.out)}
        require(sum(x['bytes'] for x in manifest['files'].values()) < plan['local_limits']['total_data_bytes'], 'output data limit')
        save(args.out / 'MANIFEST.json', manifest)
        print(json.dumps(result, indent=2))
    except BaseException as error:
        save(args.out / 'FAILURE.json', {'error': str(error), 'files': files(args.out)})
        raise


if __name__ == '__main__':
    main()
