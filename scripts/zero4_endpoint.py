"""Score fixed case shards, retain each process and restore original case order."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import csv
import json
from pathlib import Path
import signal
import threading
import time

from feral_process import digest, run_process, save


def require(ok, message):
    if not ok:
        raise ValueError(message)


def command(kind, native, model, cases, rows, index, count):
    result = [str(native), str(model), str(cases)]
    if kind == 'language':
        result += ['--jsonl']
    return result + [str(rows), '--shard-index', str(index), '--shard-count', str(count)]


def cpu(receipt):
    usage = receipt.get('resource_usage')
    return round(1000000 * (usage['user_cpu_seconds'] + usage['system_cpu_seconds'])) if usage else 0


def read_cases(path):
    with path.open() as stream:
        rows = list(csv.DictReader(stream, delimiter='\t'))
    require(rows and len({r['id'] for r in rows}) == len(rows), 'endpoint input ids differ')
    return rows


def merge_rows(root, inputs, jobs):
    by_ordinal = {}
    for index in range(jobs):
        expected = list(range(index, len(inputs), jobs))
        rows = [json.loads(line) for line in (root / f'worker-{index:02d}.jsonl').read_text().splitlines()]
        require([r['ordinal'] for r in rows] == expected, 'endpoint shard coverage differs')
        for row in rows:
            ordinal = row['ordinal']
            require(type(ordinal) is int and ordinal not in by_ordinal and row['id'] == inputs[ordinal]['id'], 'endpoint shard identity differs')
            by_ordinal[ordinal] = row
    require(sorted(by_ordinal) == list(range(len(inputs))), 'endpoint coverage differs')
    return [by_ordinal[i] for i in range(len(inputs))]


def run(kind, native, model, cases, jobs, output, seconds, max_log_bytes=4194304):
    native, model, cases, output = [Path(p).resolve() for p in [native, model, cases, output]]
    require(kind in ['task', 'language'] and type(jobs) is int and 1 <= jobs <= 32, 'endpoint kind or workers differ')
    require(type(seconds) in [int, float] and 0 < seconds <= 1800, 'endpoint deadline differs')
    output.mkdir(parents=True, exist_ok=False)
    started, started_cpu = time.monotonic(), time.process_time_ns()
    deadline = started + seconds
    cancel = threading.Event()
    result = {'schema': 'ilxyr.zero4_endpoint_workers.v1', 'status': 'failed', 'kind': kind,
              'seconds': seconds, 'max_log_bytes': max_log_bytes, 'workers': [], 'errors': []}
    previous = {}

    def stop(number, _frame):
        result['signal'] = number
        cancel.set()

    def worker(index, count):
        folder = output / f'worker-{index:02d}'
        args = command(kind, native, model, cases, output / f'worker-{index:02d}.jsonl', index, count)
        try:
            receipt = run_process(args, cases.parent, folder, deadline, 1,
                                  cancelled=lambda: 'worker_cancelled' if cancel.is_set() else None,
                                  max_log_bytes=max_log_bytes)
            if receipt['status'] != 'complete':
                cancel.set()
            return {'index': index, 'status': receipt['status'], 'receipt_sha256': digest(folder / 'process.json')}
        except Exception as error:
            cancel.set()
            return {'index': index, 'status': 'failed', 'error': str(error),
                    'receipt_sha256': digest(folder / 'process.json') if (folder / 'process.json').exists() else None}

    try:
        inputs = read_cases(cases)
        jobs = min(jobs, len(inputs))
        result.update(jobs=jobs, cases=len(inputs), native_sha256=digest(native), model_sha256=digest(model), cases_sha256=digest(cases))
        for number in [signal.SIGTERM, signal.SIGINT]:
            previous[number] = signal.signal(number, stop)
        with ThreadPoolExecutor(max_workers=jobs) as pool:
            futures = [pool.submit(worker, i, jobs) for i in range(jobs)]
            for future in as_completed(futures):
                result['workers'].append(future.result())
                save(output / 'WORKERS.json', result)
        result['workers'].sort(key=lambda r: r['index'])
        require(all(r['status'] == 'complete' for r in result['workers']), 'endpoint worker failed; partial rows retained')
        require(not cancel.is_set(), 'endpoint was cancelled')
        rows = merge_rows(output, inputs, jobs)
        with (output / 'ROWS.jsonl').open('x') as stream:
            for row in rows:
                stream.write(json.dumps(row, sort_keys=True, allow_nan=False) + '\n')
        require(digest(native) == result['native_sha256'] and digest(model) == result['model_sha256'] and
                digest(cases) == result['cases_sha256'], 'endpoint inputs changed')
        result.update(status='complete', rows_sha256=digest(output / 'ROWS.jsonl'))
    except BaseException as error:
        result['errors'].append(str(error))
        raise
    finally:
        cancel.set()
        for number, handler in previous.items():
            signal.signal(number, handler)
        result['workers'].sort(key=lambda r: r['index'])
        result['controller_cpu_us'] = round((time.process_time_ns() - started_cpu) / 1000)
        result['wall_ns'] = round((time.monotonic() - started) * 1000000000)
        result['worker_cpu_us'] = sum(cpu(json.loads((output / f'worker-{r["index"]:02d}/process.json').read_bytes()))
                                      for r in result['workers'] if r['receipt_sha256'])
        save(output / 'WORKERS.json', result)
    return result


def check(root, kind, native, model, cases, jobs, parent_cpu_us, recorded_command=lambda args: args):
    root, native, model, cases = [Path(p).resolve() for p in [root, native, model, cases]]
    result = json.loads((root / 'WORKERS.json').read_bytes())
    inputs = read_cases(cases)
    jobs = min(jobs, len(inputs))
    require(result['status'] == 'complete' and result['kind'] == kind and result['jobs'] == jobs and result['cases'] == len(inputs),
            'endpoint worker summary differs')
    require(result['native_sha256'] == digest(native) and result['model_sha256'] == digest(model) and result['cases_sha256'] == digest(cases),
            'endpoint worker input binding differs')
    require([r['index'] for r in result['workers']] == list(range(jobs)), 'endpoint worker roster differs')
    total = 0
    for r in result['workers']:
        folder = root / f'worker-{r["index"]:02d}'
        file = folder / 'process.json'
        require(digest(file) == r['receipt_sha256'], 'endpoint worker receipt differs')
        receipt = json.loads(file.read_bytes())
        require(receipt['status'] == r['status'] == 'complete' and receipt['stop_reason'] is None and
                receipt['descendant_cleanup'] is False and receipt['exit_code'] == 0, 'endpoint worker completion differs')
        require(receipt['command'] == recorded_command(command(kind, native, model, cases, root / f'worker-{r["index"]:02d}.jsonl', r['index'], jobs)),
                'endpoint worker command differs')
        for name, meta in receipt['outputs'].items():
            require(digest(folder / name) == meta['sha256'] and (folder / name).stat().st_size == meta['bytes'], 'endpoint worker log differs')
        total += cpu(receipt)
    rows = merge_rows(root, inputs, jobs)
    final = [json.loads(line) for line in (root / 'ROWS.jsonl').read_text().splitlines()]
    require(rows == final and result['rows_sha256'] == digest(root / 'ROWS.jsonl'), 'endpoint merged rows differ')
    require(result['worker_cpu_us'] == total, 'endpoint worker CPU sum differs')
    # wait4 on the supervisor includes all children it waited for. This is a breakdown.
    require(parent_cpu_us + jobs >= total, 'parent CPU omits waited workers')
    return {'workers': jobs, 'cases': len(rows), 'worker_cpu_us': total, 'parent_cpu_us': parent_cpu_us,
            'parent_minus_worker_cpu_us': parent_cpu_us - total, 'counted_in_total': 'parent_only'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--kind', choices=['task', 'language'], required=True)
    for name in ['native', 'model', 'cases', 'out']:
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--jobs', type=int, required=True)
    parser.add_argument('--seconds', type=float, required=True)
    args = parser.parse_args()
    result = run(args.kind, args.native.resolve(), args.model.resolve(), args.cases.resolve(), args.jobs, args.out.resolve(), args.seconds)
    print(json.dumps({'status': result['status'], 'cases': result['cases'], 'workers': result['jobs']}))
