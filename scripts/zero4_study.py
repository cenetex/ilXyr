"""Prepare the ZERO.4 comparison and seal every choice before endpoint scoring."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import time

from build_zero4_study_source import build as build_native
from feral_process import digest, run_process, save
import zero4_study_scores as scores
import zero4_window_data as windows

ROOT = Path(__file__).resolve().parents[1]
PLAN_SHA = 'b538f826b010daedec222da11b3bb1881fcf16091f95c6fa2c44cd0ef38581a0'
ARMS = ['frozen', 'task_only', 'replay', 'replay_guard', 'replay_projection']
MODES = {'replay_guard': 'cumulative-backtracking', 'replay_projection': 'cumulative-tangent'}
THREAD_ENV = {'OMP_NUM_THREADS': '1', 'OPENBLAS_NUM_THREADS': '1', 'VECLIB_MAXIMUM_THREADS': '1',
              'MKL_NUM_THREADS': '1', 'LC_ALL': 'C'}
# The pinned evaluator uses POSIX process calls and the pinned exporter uses sprintf.
FLAGS = ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-Wno-unused-parameter',
         '-D_POSIX_C_SOURCE=200809L', '-D_DARWIN_C_SOURCE', '-Wno-deprecated-declarations']
IMPLEMENTATION = ['zero4_endpoint.py', 'zero4_study.py', 'zero4_study_scores.py', 'zero4_task_cases.c', 'zero4_native_gold.c',
                  'zero4_window_data.py', 'zero4_fresh_data.py', 'zero4_window_io.h',
                  'build_zero4_window_source.py', 'build_zero4_study_source.py', 'feral_process.py', 'check_zero4_study.py']
require = scores.require
load = scores.load


def plan():
    file = ROOT / 'experiments/research-step-44/PLAN.json'
    require(digest(file) == PLAN_SHA, 'study plan differs')
    return load(file)


def binding(path, root):
    return {'path': str(path.relative_to(root)), 'sha256': digest(path), 'bytes': path.stat().st_size}


def bound(item, root):
    path = root / item['path']
    require(not Path(item['path']).is_absolute() and path.resolve().is_relative_to(root.resolve()), 'binding leaves prepared root')
    require(not path.is_symlink() and path.is_file() and path.stat().st_size == item['bytes'] and digest(path) == item['sha256'],
            'binding differs: ' + item['path'])
    return path


def inventory(root, omit=()):
    files = {}
    for path in sorted(root.rglob('*')):
        require(not path.is_symlink(), 'symbolic link in evidence')
        if path.is_file() and str(path.relative_to(root)) not in omit:
            files[str(path.relative_to(root))] = binding(path, root)
    return files


def source_bindings():
    result = {}
    for step in [41, 42, 43]:
        record = load(ROOT / f'experiments/research-step-{step}/SOURCE-FILES.json')
        for name, meta in record['files'].items():
            require(name not in result or result[name] == meta, 'upstream source records disagree')
            result[name] = meta
    return result


def prepare_source(source, output, git=False):
    for name, expected in source_bindings().items():
        raw = subprocess.check_output(['git', '-C', str(source), 'show', plan()['source_commit'] + ':' + name], timeout=30) if git else (source / name).read_bytes()
        require(hashlib.sha256(raw).hexdigest() == expected['sha256'] and len(raw) == expected['bytes'], 'source differs: ' + name)
        path = output / 'source' / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)


def cp(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    with source.open('rb') as src, destination.open('xb') as dst:
        shutil.copyfileobj(src, dst)


def prepare(source, fresh, packed, teachers, output, git=False):
    output.mkdir(parents=True, exist_ok=False)
    record = {'status': 'failed', 'production_teacher_forward_calls': 0}
    try:
        prepare_source(source, output, git)
        p = plan()
        mappings = {'fresh/task/quantity-request.tok': 'train.tok', 'fresh/task/promotion.tsv': 'task.tsv',
                    'fresh/language/blimp.tsv': 'blimp.tsv', 'fresh/language/tinystories.tsv': 'tinystories.tsv'}
        for label, parent in [('fresh', fresh), ('windows', packed)]:
            require(digest(parent / 'MANIFEST.json') == p['input_manifests'][label], 'input manifest differs: ' + label)
            meta = load(parent / 'MANIFEST.json')
            cp(parent / 'MANIFEST.json', output / 'records' / (label + '.json'))
            names = mappings if label == 'fresh' else {f'{role}/{name}.z4w': f'{role}/{name}.z4w'
                                                     for role in ['replay', 'endpoint'] for name in p['source_order']}
            for name, dest in names.items():
                original = parent / name
                require(digest(original) == meta['files'][name]['sha256'] and original.stat().st_size == meta['files'][name]['bytes'],
                        'prepared input differs: ' + name)
                cp(original, output / 'data' / dest)
        for name, file in [('zero1', 'zero1-foundation.teacher'), ('zero2', 'zero2-literary.teacher'), ('zero3', 'zero3-balanced-final.teacher')]:
            require(digest(teachers / file) == p['teachers'][name], 'production teacher differs: ' + name)
            cp(teachers / file, output / 'data' / (name + '.teacher'))
        cp(output / 'source/corpus/literary.bpe', output / 'data/literary.bpe')
        manifest = make_manifest(output, 'cloud')
        validate(manifest, output)
        record.update(status='complete', input_bytes=sum(r['bytes'] for r in manifest['files'].values()))
    except BaseException as error:
        record['error'] = str(error)
        raise
    finally:
        save(output / 'PREPARE.json', record)
    return record


def make_manifest(root, mode):
    p = plan()
    config = {'seeds': p['seeds'], 'training': p['training'], 'training_cpu_us': p['selection']['training_cpu_us'],
              'context': 512, 'limits': p['limits'], 'counts': p['final_cases'], 'endpoint_workers': p['endpoint_workers']}
    if mode == 'opened':
        o = p['local_checks']
        config.update(seeds=o['seeds'], context=o['context'], training_cpu_us=o['training_cpu_us'], endpoint_workers=o['endpoint_workers'],
                      limits={**p['limits'], **{k: o[k] for k in ['total_seconds', 'child_seconds', 'max_output_bytes']}},
                      counts={'task': 5, 'blimp': 2, 'tinystories': 2, 'retention_windows': 12, 'retention_counts': [1, 2, 3, 1, 2, 3]},
                      training={**p['training'], 'attempts': o['attempts'], 'chunk_attempts': o['chunk_attempts'], 'batch': 1,
                                'learning_rate': 0.2, 'task_weight': 5, 'teacher_weights': [0.15], 'zero1_weight': 0,
                                'distill': [[0, 0.15, 0]] * 6})
    require(mode in ['cloud', 'opened'], 'study mode differs')
    manifest = {'schema': 'ilxyr.zero4_study_manifest.v1', 'mode': mode, 'plan_sha256': PLAN_SHA, 'config': config,
                'files': inventory(root, ['MANIFEST.json', 'PREPARE.json']),
                'implementation': {n: digest(ROOT / 'scripts' / n) for n in IMPLEMENTATION}}
    save(root / 'MANIFEST.json', manifest)
    return manifest


def validate(m, root):
    require(m['schema'] == 'ilxyr.zero4_study_manifest.v1' and m['plan_sha256'] == PLAN_SHA, 'manifest identity differs')
    require(m['implementation'] == {n: digest(ROOT / 'scripts' / n) for n in IMPLEMENTATION}, 'controller implementation differs')
    for name, item in m['files'].items():
        require(name == item['path'], 'manifest path key differs')
        bound(item, root)
    p, cfg = plan(), m['config']
    require(m['mode'] in ['cloud', 'opened'], 'manifest mode differs')
    if m['mode'] == 'cloud':
        require(cfg == {'seeds': p['seeds'], 'training': p['training'], 'training_cpu_us': p['selection']['training_cpu_us'],
                        'context': 512, 'limits': p['limits'], 'counts': p['final_cases'], 'endpoint_workers': p['endpoint_workers']}, 'full configuration differs')
        for name, sha in p['teachers'].items():
            require(m['files']['data/' + name + '.teacher']['sha256'] == sha, 'full teacher differs')
        for label in ['fresh', 'windows']:
            require(m['files']['records/' + label + '.json']['sha256'] == p['input_manifests'][label], 'input custody differs')
        fresh = load(root / 'records/fresh.json')['files']
        for name, dest in [('fresh/task/quantity-request.tok', 'train.tok'), ('fresh/task/promotion.tsv', 'task.tsv'),
                           ('fresh/language/blimp.tsv', 'blimp.tsv'), ('fresh/language/tinystories.tsv', 'tinystories.tsv')]:
            require(m['files']['data/' + dest]['sha256'] == fresh[name]['sha256'], 'fresh input identity differs')
        packs = load(root / 'records/windows.json')['files']
        for role in ['replay', 'endpoint']:
            for name in p['source_order']:
                key = f'{role}/{name}.z4w'
                require(m['files']['data/' + key]['sha256'] == packs[key]['sha256'], 'window input identity differs')
    else:
        require(cfg['seeds'] == [71] and cfg['context'] == 16 and cfg['endpoint_workers'] == 2 and cfg['training']['attempts'] == 4 and
                cfg['training']['chunk_attempts'] == 2 and cfg['training']['batch'] == 1 and
                0 < cfg['training_cpu_us'] <= 20000000 and cfg['limits']['total_seconds'] <= 240 and
                cfg['limits']['child_seconds'] <= 60 and cfg['limits']['max_output_bytes'] <= 67108864,
                'opened model or workload limits differ')
    for name, expected in source_bindings().items():
        require(m['files']['source/' + name]['sha256'] == expected['sha256'], 'upstream source identity differs')
    raw = (root / 'data/zero3.teacher').read_bytes()
    require(raw[:8] == b'ZEROTCH1' and len(raw) >= 64, 'initial model format differs')
    header = struct.unpack_from('<9I', raw, 8)
    require(header[0] == 1 and header[1] == 128 and header[2] == cfg['context'] and header[8] & 1, 'initial model configuration differs')
    if m['mode'] == 'opened':
        require(header[3:7] == (8, 2, 1, 16), 'opened teacher dimensions differ')
        require(m['files']['data/zero3.teacher']['sha256'] != p['initial_teacher_sha256'], 'production teacher used by opened check')
    for role in ['replay', 'endpoint']:
        for i, name in enumerate(p['source_order']):
            data = (root / f'data/{role}/{name}.z4w').read_bytes()
            kind = 'foundation' if i == 0 else 'channel' if i == 5 else 'text'
            rows = windows.unpack(data, cfg['context'], kind, role == 'replay')
            require(struct.unpack_from('<I', data, 20)[0] == windows.ROLES[role], 'window role differs')
            require(all(all(0 <= t < 128 for t in row) and windows.targets(row, i == 5) > 0 for row in rows), 'invalid packed tokens')
            if role == 'endpoint':
                require(len(rows) == cfg['counts']['retention_counts'][i], 'endpoint quota differs')
    for name in ['task', 'blimp', 'tinystories']:
        require(len(scores.tsv(root / ('data/' + name + '.tsv'))) == cfg['counts'][name], 'final case quota differs')
    return cfg


class Processes:
    def __init__(self, output, limits):
        self.output, self.limits = output, limits
        self.deadline = time.monotonic() + limits['total_seconds']
        self.rows = []

    def run(self, command, cwd, owner, stage):
        folder = self.output / 'processes' / f'{len(self.rows):04d}-{owner}-{stage}'
        command = ['env', *[key + '=' + value for key, value in THREAD_ENV.items()], *map(str, command)]
        row = {'ordinal': len(self.rows), 'owner': owner, 'stage': stage, 'path': str(folder.relative_to(self.output)),
               'status': 'running', 'selection_sha256': digest(self.output / 'SELECTION.json') if (self.output / 'SELECTION.json').exists() else None}
        self.rows.append(row)
        save(self.output / 'PROCESSES.json', self.rows)
        try:
            require(sum(p.stat().st_size for p in self.output.rglob('*') if p.is_file()) < self.limits['max_output_bytes'], 'study output allowance reached')
            receipt = run_process(command, cwd, folder, min(self.deadline, time.monotonic() + self.limits['child_seconds']),
                                  self.limits['grace_seconds'], max_log_bytes=self.limits['max_log_bytes'])
            row.update(status=receipt['status'], receipt_sha256=digest(folder / 'process.json'))
            require(receipt['status'] == 'complete', 'native process failed: ' + row['path'])
            return receipt
        except BaseException as error:
            row.update(status='failed', error=str(error))
            raise
        finally:
            save(self.output / 'PROCESSES.json', self.rows)

    def cpu(self, owner, stage=None):
        total = 0
        for row in self.rows:
            if row['owner'] == owner and (stage is None or row['stage'] == stage):
                file = self.output / row['path'] / 'process.json'
                if file.exists():
                    usage = load(file).get('resource_usage')
                    if usage:
                        total += round(1000000 * (usage['user_cpu_seconds'] + usage['system_cpu_seconds']))
        return total


def compile_binaries(prepared, output, processes, cc='cc', sanitize=False):
    source = prepared / 'source'
    target = output / 'bin'
    target.mkdir()
    build_native(source, target / 'windows.c')
    flags = FLAGS + ['-I', str(source), '-I', str(ROOT / 'scripts')]
    if sanitize:
        flags += ['-O1', '-fsanitize=address,undefined', '-fno-omit-frame-pointer']
    commands = {
        'lm': [target / 'windows.c'], 'export': [source / 'export_literary.c'],
        'task': ['-DLITERARY_INFER_NO_MAIN', '-DFACULTY_CONTROLLER_NO_MAIN', ROOT / 'scripts/zero4_task_cases.c',
                 source / 'literary_infer.c', source / 'faculty_controller.c', source / 'quantity_oracle.c'],
        'language': ['-DLITERARY_INFER_NO_MAIN', source / 'external_eval.c', source / 'literary_infer.c'],
        'gold': [ROOT / 'scripts/zero4_native_gold.c', source / 'quantity_oracle.c']}
    for name, inputs in commands.items():
        processes.run([cc, *flags, *inputs, '-o', target / name, '-lm'], source, 'setup', 'compile-' + name)
    save(output / 'BINARIES.json', {name: binding(target / name, output) for name in commands})
    return {name: target / name for name in commands}


def checkpoint(path):
    with path.open('rb') as stream:
        data = stream.read(80)
    require(len(data) == 80 and data[:8] == b'ZEROLM2\0' and struct.unpack_from('<I', data, 8)[0] == 4, 'checkpoint format differs')
    return {'committed': struct.unpack_from('<Q', data, 48)[0], 'rng': struct.unpack_from('<Q', data, 56)[0],
            'attempts': struct.unpack_from('<Q', data, 64)[0], 'rejections': struct.unpack_from('<I', data, 72)[0],
            'mode': struct.unpack_from('<I', data, 76)[0]}


def data_args(prepared, role, cfg):
    result = []
    for i, name in enumerate(plan()['source_order']):
        kind = 'foundation' if i == 0 else 'channel' if i == 5 else 'text'
        result += ['--' + kind, str(prepared / f'data/{role}/{name}.z4w'), '--fixed-windows', '--sample-weight', '1']
        if role == 'replay':
            result += ['--distill', ','.join(map(str, cfg['training']['distill'][i]))]
    return result


def training_args(prepared, binary, cfg, state, folder):
    t = cfg['training']
    command = [binary, '--resume' if state['attempts'] else '--init',
               folder / 'active.ckpt' if state['attempts'] else prepared / 'data/zero3.teacher',
               '--tokenizer', prepared / 'data/literary.bpe', '--zero1-weight', '0']
    if state['arm'] != 'task_only':
        teachers = ['zero2', 'zero3'] if len(t['teacher_weights']) == 2 else ['zero3']
        for name, weight in zip(teachers, t['teacher_weights']):
            command += ['--teacher', prepared / ('data/' + name + '.teacher'), '--teacher-weight', str(weight)]
        if t['zero1_weight']:
            command += ['--zero1-teacher', prepared / 'data/zero1.teacher', '--zero1-weight', str(t['zero1_weight'])]
        command += data_args(prepared, 'replay', cfg)
    command += ['--hard-channel', prepared / 'data/train.tok', '--sample-weight', str(t['task_weight']),
                '--steps', str(t['chunk_attempts']), '--batch', str(t['batch']), '--lr', str(t['learning_rate']),
                '--warmup', '0', '--dropout', '0', '--patience', '0', '--report', '1000000',
                '--validation', str(t['validation_batches']), '--seed', str(state['seed']), '--save', folder / 'active.ckpt',
                '--tokens', '0', '--training-samples', folder / 'samples.jsonl']
    if not t['automatic_validation']:
        command += ['--controller-no-validation']
    if state['arm'] in MODES:
        command += ['--transaction-mode', MODES[state['arm']], '--transaction-log', folder / 'attempts.jsonl',
                    '--transaction-phase', 'acquisition', '--transaction-probe', '1', '--transaction-budget', str(t['guard_budget']),
                    '--transaction-max-rejections', str(t['max_rejections'])]
    return command


def verify_samples(folder, state, cfg, prepared):
    rows = scores.jsonl(folder / 'samples.jsonl')
    require([(r['attempt'], r['batch']) for r in rows] == [(a, b) for a in range(1, state['attempts'] + 1)
                                                        for b in range(cfg['training']['batch'])], 'training sample coverage differs')
    packed, offset = {}, 0
    if state['arm'] != 'task_only':
        for i, name in enumerate(plan()['source_order']):
            kind = 'foundation' if i == 0 else 'channel' if i == 5 else 'text'
            pack = windows.unpack((prepared / f'data/replay/{name}.z4w').read_bytes(), cfg['context'], kind, True)
            offset += 2 if i else 0
            for j, tokens in enumerate(pack):
                packed[i, offset + j * (cfg['context'] + 1)] = windows.fnv(tokens)
            offset += len(pack) * (cfg['context'] + 1)
        offset += 2
    task = windows.load_tokens(prepared / 'data/train.tok')
    starts = [i for i, token in enumerate(task) if token == 1]
    split = len(starts) * 95 // 100
    train_count = sum(start + cfg['context'] + 1 <= starts[split] for start in starts[:split])
    allowed = {offset + start: windows.fnv(task[start:start + cfg['context'] + 1])
               for start in starts[:train_count] if start + cfg['context'] < len(task)}
    task_index = 0 if state['arm'] == 'task_only' else 6
    for r in rows:
        require(r['context'] == cfg['context'], 'training sample context differs')
        expected = allowed.get(r['start']) if r['range'] == task_index else packed.get((r['range'], r['start']))
        require(expected == r['tokens_hash'], 'training sample input differs')
    return rows


def eligible(candidates, budget):
    return max((c for c in candidates if c['training_cpu_us'] <= budget), key=lambda c: c['attempts'])


def train(prepared, output, cfg, binaries, processes):
    states = []
    for index, seed in enumerate(cfg['seeds']):
        order = ARMS[index % 5:] + ARMS[:index % 5]
        current = []
        for arm in order:
            folder = output / f'seed-{seed}-{arm}'
            folder.mkdir()
            initial = {'attempts': 0, 'model': binding(prepared / 'data/zero3.teacher', prepared), 'initial': True, 'training_cpu_us': 0}
            state = {'arm': arm, 'seed': seed, 'owner': folder.name, 'attempts': 0, 'controller_cpu_us': 0,
                     'candidates': [initial], 'status': 'complete' if arm == 'frozen' else 'training'}
            states.append(state)
            current.append(state)
        for _ in range(0, cfg['training']['attempts'], cfg['training']['chunk_attempts']):
            for state in current:
                if state['status'] != 'training':
                    continue
                folder = output / state['owner']
                started = time.process_time_ns()
                candidate = None
                try:
                    processes.run(training_args(prepared, binaries['lm'], cfg, state, folder), prepared, state['owner'], 'training')
                    progress = checkpoint(folder / 'active.ckpt')
                    require(state['attempts'] < progress['attempts'] <= state['attempts'] + cfg['training']['chunk_attempts'], 'checkpoint attempt count differs')
                    state['attempts'] = progress['attempts']
                    verify_samples(folder, state, cfg, prepared)
                    file = folder / f'checkpoint-{state["attempts"]:06d}.ckpt'
                    cp(folder / 'active.ckpt', file)
                    candidate = {'attempts': state['attempts'], 'initial': False, 'model': binding(file, output), 'checkpoint': progress}
                    if progress['rejections'] >= cfg['training']['max_rejections']:
                        state['status'] = 'guard_exhausted'
                    elif state['attempts'] == cfg['training']['attempts']:
                        state['status'] = 'complete'
                except Exception as error:
                    state.update(status='failed', error=str(error))
                finally:
                    state['controller_cpu_us'] += round((time.process_time_ns() - started) / 1000)
                if candidate:
                    candidate.update(training_child_cpu_us=processes.cpu(state['owner'], 'training'),
                                     controller_cpu_us=state['controller_cpu_us'], process_ordinal=len(processes.rows) - 1)
                    candidate['training_cpu_us'] = candidate['training_child_cpu_us'] + candidate['controller_cpu_us']
                    state['candidates'].append(candidate)
                    if candidate['training_cpu_us'] > cfg['training_cpu_us']:
                        state['status'] = 'training_budget_reached'
                save(output / 'TRAINING.json', states)
        for state in current:
            if state['status'] == 'training':
                state.update(status='failed', error='training loop ended before stop condition')
            state['selected'] = eligible(state['candidates'], cfg['training_cpu_us'])
        logs = [scores.jsonl(output / s['owner'] / 'samples.jsonl') for s in current
                if s['arm'] in ARMS[2:] and (output / s['owner'] / 'samples.jsonl').exists()]
        common = min(map(len, logs), default=0)
        require(all(rows[:common] == logs[0][:common] for rows in logs), 'paired replay samples differ')
    save(output / 'TRAINING.json', states)
    seal = {'schema': 'ilxyr.zero4_selection.v1', 'manifest_sha256': digest(prepared / 'MANIFEST.json'),
            'paths_sha256': digest(output / 'PATHS.json'),
            'training_sha256': digest(output / 'TRAINING.json'), 'training_cpu_us': cfg['training_cpu_us'],
            'processes_before_seal': len(processes.rows), 'choices': [{k: s[k] for k in ['arm', 'seed', 'owner', 'status', 'selected']} for s in states]}
    save(output / 'SELECTION.json', seal)
    return states


def endpoint_args(prepared, binaries, cfg, folder, name):
    kind = 'task' if name == 'task' else 'language'
    return [sys.executable, ROOT / 'scripts/zero4_endpoint.py', '--kind', kind, '--native', binaries[kind],
            '--model', folder / 'selected.litq8', '--cases', prepared / ('data/' + name + '.tsv'),
            '--jobs', str(cfg['endpoint_workers']), '--out', folder / (name + '-workers'),
            '--seconds', str(cfg['limits']['child_seconds'] - 5)]


def evaluate(prepared, output, cfg, binaries, state, processes):
    started = time.process_time_ns()
    folder = output / state['owner']
    selected = state['selected']
    model = bound(selected['model'], prepared if selected['initial'] else output)
    seal_sha = digest(output / 'SELECTION.json')
    processes.run([binaries['export'], model, folder / 'selected.litq8'], prepared, state['owner'], 'export')
    processes.run([binaries['lm'], '--init' if selected['initial'] else '--resume', model, '--eval-only', '--tokens', '0',
                   '--tokenizer', prepared / 'data/literary.bpe', '--validation', '6', '--evaluation-json', folder / 'retention.json',
                   *data_args(prepared, 'endpoint', cfg)], prepared, state['owner'], 'retention')
    for name in ['task', 'blimp', 'tinystories']:
        processes.run(endpoint_args(prepared, binaries, cfg, folder, name), prepared, state['owner'], name)
        cp(folder / (name + '-workers/ROWS.jsonl'), folder / (name + '.jsonl'))
    require(digest(model) == selected['model']['sha256'] and digest(output / 'SELECTION.json') == seal_sha, 'sealed selection changed')
    record = {'model_sha256': digest(model), 'quantized': binding(folder / 'selected.litq8', output), 'selection_sha256': seal_sha,
              'controller_cpu_us': round((time.process_time_ns() - started) / 1000)}
    save(folder / 'ENDPOINT.json', record)
    return record


def run_study(prepared, output, cc='cc', sanitize=False, cloud_adapter=False):
    prepared, output = prepared.resolve(), output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    save(output / 'PATHS.json', {'prepared': str(prepared), 'output': str(output), 'implementation': str(ROOT.resolve()), 'python': sys.executable})
    started_cpu, started_wall = time.process_time_ns(), time.monotonic_ns()
    result = {'schema': 'ilxyr.zero4_study_result.v1', 'status': 'failed', 'performance_evidence': False, 'errors': []}
    processes = None
    try:
        manifest = load(prepared / 'MANIFEST.json')
        cfg = validate(manifest, prepared)
        require(manifest['mode'] == 'opened' or cloud_adapter, 'full execution requires the frozen cloud adapter')
        result['mode'] = manifest['mode']
        processes = Processes(output, cfg['limits'])
        binaries = compile_binaries(prepared, output, processes, cc, sanitize)
        result['setup_controller_cpu_us'] = round((time.process_time_ns() - started_cpu) / 1000)
        states = train(prepared, output, cfg, binaries, processes)
        result['training_statuses'] = [{k: s[k] for k in ['owner', 'status']} for s in states]
        for state in states:
            try:
                evaluate(prepared, output, cfg, binaries, state, processes)
            except Exception as error:
                result['errors'].append({'owner': state['owner'], 'phase': 'endpoint', 'error': str(error)})
        try:
            processes.run([binaries['gold'], prepared / 'data/task.tsv'], prepared, 'reference', 'exact-parser')
        except Exception as error:
            result['errors'].append({'owner': 'reference', 'phase': 'exact-parser', 'error': str(error)})
        result['status'] = 'complete' if not result['errors'] and all(s['status'] != 'failed' for s in states) else 'failed'
    except BaseException as error:
        result['errors'].append({'phase': 'controller', 'error': str(error)})
        raise
    finally:
        result['controller_cpu_us'] = round((time.process_time_ns() - started_cpu) / 1000)
        result['controller_wall_ns'] = time.monotonic_ns() - started_wall
        result['process_count'] = len(processes.rows) if processes else 0
        save(output / 'RESULT.json', result)
    # A separate replay checks the seal, all rows, stop rules and cost sums.
    from check_zero4_study import check
    check(prepared, output)
    return load(output / 'RESULT.json')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    prepare_parser = sub.add_parser('prepare')
    for name in ['source', 'fresh', 'windows', 'teachers', 'out']:
        prepare_parser.add_argument('--' + name, type=Path, required=True)
    prepare_parser.add_argument('--git', action='store_true')
    runner = sub.add_parser('run-opened')
    runner.add_argument('--prepared', type=Path, required=True)
    runner.add_argument('--out', type=Path, required=True)
    runner.add_argument('--cc', default='cc')
    args = parser.parse_args()
    if args.action == 'prepare':
        result = prepare(args.source.resolve(), args.fresh.resolve(), args.windows.resolve(), args.teachers.resolve(), args.out.resolve(), args.git)
    else:
        require(load(args.prepared / 'MANIFEST.json')['mode'] == 'opened', 'opened execution needs opened inputs')
        result = run_study(args.prepared.resolve(), args.out.resolve(), args.cc)
    print(json.dumps({'status': result['status']}))


if __name__ == '__main__':
    main()
