"""Opened native checks for explicit windows, old-path parity and invalid packs."""
import argparse
from collections import defaultdict
import json
import math
from pathlib import Path
import struct
import time

from build_zero4_window_source import build
from feral_process import digest, run_process, save
import zero4_window_data as w


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def run(args, root, name, cwd, success=True):
    receipt = run_process([str(x) for x in args], cwd, root / 'processes' / name, time.monotonic() + 60, 2)
    require(receipt['status'] == 'complete' if success else receipt['status'] == 'failed', name + ': unexpected process status')
    return receipt


def model_args(context=16):
    return ['--preset', 'literary', '--context', str(context), '--dim', '8', '--heads', '2', '--layers', '1', '--ff', '16', '--tokens', '0']


def input_args(paths, fixed):
    args = []
    for i, path in enumerate(paths):
        kind = 'foundation' if i == 0 else 'channel' if i == 5 else 'text'
        args += ['--' + kind, str(path)]
        if fixed:
            args += ['--fixed-windows']
        args += ['--sample-weight', '1']
    return args


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--cc', default='cc')
    parser.add_argument('--fresh', type=Path)
    args = parser.parse_args()
    source, root = args.source.resolve(), args.out.resolve()
    root.mkdir(parents=True, exist_ok=False)
    (root / 'processes').mkdir()
    result = {'schema': 'ilxyr.zero4_window_native_checks.v1', 'status': 'in_progress', 'production_teacher_forwards': 0}
    try:
        new_c, old_c = root / 'windows.c', root / 'legacy.c'
        result['derived_source_sha256'] = build(source, new_c)
        run(['patch', '-s', '-o', old_c, source / 'literary_lm.c', source / 'scripts/zero4_retention.patch'], root, 'old-source', source)
        flags = ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-Wno-unused-parameter', '-I', str(source), '-I', str(w.ROOT / 'scripts')]
        native, legacy, freeze = root / 'windows', root / 'legacy', root / 'freeze'
        for name, file, executable in [('new', new_c, native), ('legacy', old_c, legacy), ('freeze', source / 'freeze_literary_teacher.c', freeze)]:
            run([args.cc, *flags, file, '-o', executable, '-lm'], root, 'compile-' + name, source)
        result['compiler_flags'] = flags[:6]
        data = root / 'data'
        data.mkdir()
        raw_paths, replay, endpoint, expected = [], [], [], {}
        for i in range(6):
            kind = 'foundation' if i == 0 else 'channel' if i == 5 else 'text'
            channel = [1, 81, 7, 97, 4, 2, 85, 120, 4, 2, 90, 3, 85, 6, 121, 4, 5]
            rows = [channel[:] if i == 5 else [97 + (i + j + t) % 26 for t in range(17)] for j in range(1 + i % 3)]
            for role, paths in [('replay', replay), ('endpoint', endpoint)]:
                windows = [[(token + 1 if role == 'endpoint' and 97 <= token < 122 else token) for token in row] for row in rows]
                path = data / f'{role}-{i}.z4w'
                path.write_bytes(w.pack(windows, 16, kind, role))
                paths.append(path)
                expected[role, i] = windows
            path = data / f'legacy-{i}.tok'
            # The native legacy channel split needs at least twenty full records.
            path.write_bytes(w.token_bytes((channel * 40) if i == 5 else ([97 + i, 32, 98, 10] * 300)))
            raw_paths.append(path)
        task = data / 'task.tok'
        task.write_bytes(w.token_bytes([1, 81, 7, 97, 4, 2, 85, 120, 4, 2, 90, 3, 85, 6, 121, 4, 5] * 40))
        initial, teacher = root / 'initial.ckpt', root / 'initial.teacher'
        run([legacy, *model_args(), '--tokenizer', source / 'corpus/literary.bpe', '--text', raw_paths[0], '--steps', '1',
             '--dropout', '0', '--warmup', '0', '--seed', '5', '--report', '1', '--validation', '1', '--save', initial], root, 'initial', source)
        run([freeze, initial, teacher], root, 'freeze', source)
        teacher_hash = digest(teacher)
        modes = {'frozen': None, 'task_only': None, 'replay': None,
                 'replay_guard': 'cumulative-backtracking', 'replay_projection': 'cumulative-tangent'}
        states, parity, samples = {}, {}, {}
        for arm, mode in modes.items():
            if arm == 'frozen':
                states[arm] = teacher
                continue
            for version, exe, fixed, paths in [('fixed', native, True, replay), ('old', legacy, False, raw_paths), ('compatibility', native, False, raw_paths)]:
                folder = root / f'{version}-{arm}'
                folder.mkdir()
                command = [exe, '--init', teacher, '--tokenizer', source / 'corpus/literary.bpe', '--zero1-weight', '0']
                if arm != 'task_only':
                    command += ['--teacher', teacher, '--teacher-weight', '0.15', *input_args(paths, fixed)]
                command += ['--hard-channel', task, '--sample-weight', '5', '--steps', '4', '--batch', '1', '--lr', '0.2',
                            '--warmup', '0', '--dropout', '0', '--patience', '0', '--report', '1000000', '--validation', '6',
                            '--seed', '71', '--save', folder / 'model.ckpt', '--tokens', '0', '--training-samples', folder / 'samples.jsonl']
                if mode:
                    command += ['--transaction-mode', mode, '--transaction-log', folder / 'attempts.jsonl', '--transaction-phase', 'acquisition',
                                '--transaction-probe', '1', '--transaction-budget', '0.015', '--transaction-max-rejections', '8']
                run(command, root, f'{version}-{arm}', source)
                if fixed:
                    states[arm] = folder / 'model.ckpt'
                    samples[arm] = w.prior.jsonl(folder / 'samples.jsonl')
            require(digest(root / f'old-{arm}/model.ckpt') == digest(root / f'compatibility-{arm}/model.ckpt'), 'legacy checkpoint bytes differ: ' + arm)
            require((root / f'old-{arm}/samples.jsonl').read_bytes() == (root / f'compatibility-{arm}/samples.jsonl').read_bytes(), 'legacy sampling differs: ' + arm)
            parity[arm] = digest(root / f'old-{arm}/model.ckpt')
        require(samples['replay'] == samples['replay_guard'] == samples['replay_projection'], 'paired replay samples differ')
        result['legacy_checkpoint_parity'] = parity
        result['paired_replay_samples'] = len(samples['replay'])
        # Check every sampled pack window against its expected offset and input hash.
        start, valid_starts = 0, {}
        for i in range(6):
            if i:
                start += 2
            for index, row in enumerate(expected['replay', i]):
                valid_starts[i, start + index * 17] = w.fnv(row)
            start += len(expected['replay', i]) * 17
        pack_samples = 0
        for row in samples['replay']:
            if row['range'] < 6:
                require(valid_starts.get((row['range'], row['start'])) == row['tokens_hash'], 'training sampled outside a packed window')
                pack_samples += 1
        require(pack_samples > 0, 'opened replay samples missed every pack')
        result['checked_pack_training_samples'] = pack_samples
        evaluations = {}
        for arm, model in states.items():
            output = root / f'eval-{arm}.json'
            # Teacher files use --init; committed checkpoints use --resume.
            option = '--init' if arm == 'frozen' else '--resume'
            run([native, option, model, '--eval-only', '--tokens', '0', '--validation', '6', '--evaluation-json', output,
                 *input_args(endpoint, True)], root, 'evaluate-' + arm, source)
            summary = json.loads(output.read_text())
            rows = w.prior.jsonl(Path(str(output) + '.windows.jsonl'))
            require(summary['schema'] == 'zero.literary_eval.v3', 'fixed evaluation schema')
            require(summary['learned_state_before'] == summary['learned_state_after'], 'evaluation changed learned state')
            require(summary['evaluated_windows'] == len(rows) == 12, 'evaluation window coverage')
            for i, group in enumerate(summary['ranges']):
                found = [r for r in rows if r['range'] == i]
                require(len(found) == len(expected['endpoint', i]) == group['windows'], 'source window coverage')
                require(math.isclose(sum(r['loss'] for r in found) / len(found), group['loss'], rel_tol=2e-7), 'source mean differs')
                for row, tokens in zip(found, expected['endpoint', i]):
                    require(row['tokens_hash'] == w.fnv(tokens) and row['targets'] == w.targets(tokens, i == 5), 'window loss input binding')
            require(math.isclose(sum(g['loss'] for g in summary['ranges']) / 6, summary['loss'], rel_tol=2e-7), 'equal source mean differs')
            evaluations[arm] = {'loss': summary['loss'], 'windows': len(rows), 'learned_state': summary['learned_state_before']}
        result['opened_evaluations'] = evaluations
        require(digest(teacher) == teacher_hash, 'teacher bytes changed')
        # Each endpoint window must agree with the original evaluator on identical tokens.
        native_losses = w.prior.jsonl(root / 'eval-frozen.json.windows.jsonl')
        for i in range(6):
            for j, tokens in enumerate(expected['endpoint', i]):
                file = data / f'single-{i}-{j}.tok'
                file.write_bytes(w.token_bytes(tokens * (20 if i == 5 else 2)))
                output = root / f'single-{i}-{j}.json'
                run([legacy, '--init', teacher, '--tokenizer', source / 'corpus/literary.bpe', '--channel' if i == 5 else '--text', file,
                     '--eval-only', '--tokens', '0', '--validation', '1', '--evaluation-json', output], root, f'single-{i}-{j}', source)
                old_loss = json.loads(output.read_text())['loss']
                new_loss = next(row['loss'] for row in native_losses if row['range'] == i and row['window'] == j)
                require(old_loss == new_loss, f'original window loss differs: {i}/{j}')
        result['individual_legacy_losses_matched'] = 12
        valid = endpoint[1].read_bytes()
        alterations = {'bad_magic': b'BADMAGIC' + valid[8:], 'short_header': valid[:12], 'short_payload': valid[:-1], 'extra_payload': valid + b'0'}
        for name, offset, value in [('wrong_context', 8, 32), ('zero_count', 12, 0), ('large_count', 12, 8193),
                                    ('wrong_kind', 16, 1), ('wrong_role', 20, 3), ('outside_vocab', 24, 65535)]:
            modified = bytearray(valid)
            struct.pack_into('<I' if offset < 24 else '<H', modified, offset, value)
            alterations[name] = bytes(modified)
        failures = []
        for name, data_bytes in alterations.items():
            file = data / (name + '.z4w')
            file.write_bytes(data_bytes)
            receipt = run([native, *model_args(), '--steps', '0', '--text', file, '--fixed-windows', '--window-audit', root / (name + '.jsonl')], root, name, source, False)
            failures.append({'case': name, 'exit_code': receipt['exit_code']})
        for name, row in [('missing_channel_start', [65] * 14 + [6, 65, 4]), ('zero_channel_targets', [1] + [65] * 16)]:
            file = data / (name + '.z4w')
            file.write_bytes(w.pack([row], 16, 'channel', 'endpoint'))
            receipt = run([native, *model_args(), '--steps', '0', '--channel', file, '--fixed-windows', '--window-audit', root / (name + '.jsonl')], root, name, source, False)
            failures.append({'case': name, 'exit_code': receipt['exit_code']})
        receipt = run([native, *model_args(), '--steps', '1', '--text', endpoint[1], '--fixed-windows'], root, 'endpoint-training', source, False)
        failures.append({'case': 'endpoint_training', 'exit_code': receipt['exit_code']})
        result['invalid_pack_rejections'] = failures
        if args.fresh:
            roster = w.prior.jsonl(args.fresh / 'ROSTER.jsonl')
            plan = json.loads((w.RECORD / 'PLAN-v2.json').read_text())
            result['fresh_input_audits'] = {}
            for role in ['endpoint', 'replay']:
                paths = [args.fresh / role / (name + '.z4w') for name in plan['source_order']]
                audit = root / (role + '-audit.jsonl')
                run([native, *model_args(512), '--steps', '0', '--window-audit', audit, *input_args(paths, True)], root, role + '-audit', source)
                rows = w.prior.jsonl(audit)
                expected_rows = [row for row in roster if row['role'] == role]
                require(len(rows) == len(expected_rows), 'fresh audit row count')
                for row, expected_row in zip(rows, expected_rows):
                    require(row['tokens_hash'] == expected_row['tokens_fnv64'] and row['targets'] == expected_row['target_count'], 'fresh input audit differs')
                result['fresh_input_audits'][role] = len(rows)
        result['status'] = 'passed'
        print(json.dumps(result, indent=2))
    except BaseException as error:
        result.update(status='failed', error=str(error))
        raise
    finally:
        save(root / 'RESULT.json', result)


if __name__ == '__main__':
    main()
