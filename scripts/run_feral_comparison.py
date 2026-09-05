"""Control a frozen FERAL comparison inside an already launched cloud instance."""

import argparse
from decimal import Decimal, ROUND_CEILING
import json
import math
from pathlib import Path, PurePosixPath
import re
import signal
import sys
import tarfile
import tempfile
import time

from feral_process import digest, run_process, save

ROOT = Path(__file__).resolve().parent
STAGES = ('runtime', 'model', 'base', 'calculator', 'operand_only', 'grade')
CONTROLLER_FILES = ('feral_process.py', 'feral_execution_stage.py', 'run_feral_comparison.py')


def finite_positive(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        raise ValueError(name + ' must be finite and positive')
    return value


def validate_plan(plan):
    if plan.get('schema') != 'ilxyr.feral_execution_plan.v1':
        raise ValueError('execution plan schema differs')
    if plan['arms'] != ['base', 'calculator', 'operand_only']:
        raise ValueError('fixed arm order differs')
    if plan['failure_policy'] != 'retain_and_continue_remaining_arms_within_original_deadline':
        raise ValueError('failure policy differs')
    limits = plan['limits']
    for key in ['max_instance_seconds', 'collection_reserve_seconds', 'termination_grace_seconds']:
        finite_positive(limits[key], key)
    if limits['max_instance_seconds'] < 60 or limits['collection_reserve_seconds'] <= limits['termination_grace_seconds']:
        raise ValueError('instance minimum or collection reserve differs')
    if limits['collection_reserve_seconds'] >= limits['max_instance_seconds']:
        raise ValueError('collection reserve exhausts the instance limit')
    if set(limits['stage_seconds']) != set(STAGES):
        raise ValueError('stage limits differ')
    for stage, seconds in limits['stage_seconds'].items():
        finite_positive(seconds, stage)
    budget = plan['budget']
    rate, reserve, ceiling = [Decimal(budget[k]) for k in ['hourly_compute_usd', 'other_infrastructure_reserve_usd', 'max_infrastructure_usd']]
    if any(not value.is_finite() for value in [rate, reserve, ceiling]) or rate <= 0 or reserve < 0 or ceiling <= 0:
        raise ValueError('budget amounts differ')
    maximum = rate * Decimal(str(limits['max_instance_seconds'])) / 3600 + reserve
    if maximum > ceiling:
        raise ValueError('maximum instance cost exceeds the frozen ceiling')
    for binding in [plan['source']['archive_sha256'], plan['source']['package_manifest_sha256'],
                    plan['runtime']['pyproject.toml_sha256'], plan['runtime']['uv.lock_sha256']]:
        if not isinstance(binding, str) or not re.fullmatch('[0-9a-f]{64}', binding):
            raise ValueError('source or runtime digest differs')
    if not re.fullmatch(r'ghcr.io/atimics/feral-7b-sec-qwen@sha256:[0-9a-f]{64}', plan['runtime']['image']):
        raise ValueError('image must use the frozen repository and digest')
    if not re.fullmatch('[0-9a-f]{40}', plan['runtime']['image_source_revision']):
        raise ValueError('image source revision differs')
    if plan['provider']['name'] != 'aws_ec2' or plan['source']['scope'] != 'full_finqa_1147':
        raise ValueError('provider or full comparison scope differs')
    if plan['budget']['price_evidence']['status'] != 'verified':
        raise ValueError('price evidence needs verification before execution')
    quote = plan['budget']['price_evidence']['record']
    if Decimal(quote['price']) != rate or quote['Instance Type'] != plan['provider']['instance_type'] or quote['Operating System'] != 'Linux' or quote['Location'] != 'US East (N. Virginia)' or plan['provider']['region'] != 'us-east-1':
        raise ValueError('price record and planned machine differ')
    verify_controller(plan)
    return plan


def verify_controller(plan):
    if set(plan['controller_files']) != set(CONTROLLER_FILES):
        raise ValueError('controller source roster differs')
    for name, binding in plan['controller_files'].items():
        if digest(ROOT / name) != binding['sha256'] or (ROOT / name).stat().st_size != binding['bytes']:
            raise ValueError('controller source differs: ' + name)


def extract_source(archive_path, destination, source):
    if not archive_path.is_file() or archive_path.stat().st_size != source['archive_bytes'] or source['archive_bytes'] > 32 * 1024 * 1024:
        raise ValueError('source archive size differs')
    if digest(archive_path) != source['archive_sha256']:
        raise ValueError('source archive digest differs')
    with tarfile.open(archive_path, 'r:') as archive:
        members = archive.getmembers()
        names = [member.name for member in members]
        if len(names) != len(set(names)) or 'PACKAGE.json' not in names:
            raise ValueError('archive roster differs')
        for member in members:
            path = PurePosixPath(member.name)
            if not member.isfile() or path.is_absolute() or '..' in path.parts or str(path) != member.name or member.size > source['archive_bytes']:
                raise ValueError('archive member path or type differs')
        manifest_raw = archive.extractfile('PACKAGE.json').read()
        import hashlib
        if hashlib.sha256(manifest_raw).hexdigest() != source['package_manifest_sha256']:
            raise ValueError('source package manifest differs')
        manifest = json.loads(manifest_raw)
        if set(names) != set(manifest['files']) | {'PACKAGE.json'} or manifest['scope'] != source['scope']:
            raise ValueError('source file roster or scope differs')
        if len(manifest['ordered_ids']) != 1147 or len(set(manifest['ordered_ids'])) != 1147:
            raise ValueError('full input roster differs')
        destination.mkdir(exist_ok=False)
        for member in members:
            raw = archive.extractfile(member).read()
            if member.name != 'PACKAGE.json':
                expected = manifest['files'][member.name]
                if len(raw) != expected['bytes'] or hashlib.sha256(raw).hexdigest() != expected['sha256']:
                    raise ValueError('source file digest differs: ' + member.name)
            path = destination / member.name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(raw)
    return manifest


def validate_launch(receipt, plan, plan_digest):
    if receipt['schema'] != 'ilxyr.feral_comparison_launch.v1' or receipt['execution_plan_sha256'] != plan_digest or receipt['source_archive_sha256'] != plan['source']['archive_sha256']:
        raise ValueError('launch package binding differs')
    if receipt['provider'] != plan['provider'] or receipt['image'] != plan['runtime']['image']:
        raise ValueError('launch machine or image differs')
    if receipt['max_instance_seconds'] != plan['limits']['max_instance_seconds'] or receipt['max_infrastructure_usd'] != plan['budget']['max_infrastructure_usd']:
        raise ValueError('launch budget differs')
    if not isinstance(receipt['approval_reference'], str) or not receipt['approval_reference'].strip():
        raise ValueError('launch approval reference is missing')
    if not re.fullmatch(r'i-[0-9a-f]+', receipt['instance_id']):
        raise ValueError('instance identity differs')
    finite_positive(receipt['launch_epoch_seconds'], 'launch time')
    elapsed = time.time() - receipt['launch_epoch_seconds']
    if elapsed < 0:
        raise ValueError('launch time is in the future')
    return elapsed


def cost_estimate(plan, elapsed_seconds):
    billable = max(Decimal(60), Decimal(str(elapsed_seconds)).to_integral_value(rounding=ROUND_CEILING))
    return {'scope': 'estimate_through_controller_end_before_collection_and_shutdown',
            'observed_instance_seconds': elapsed_seconds, 'billable_compute_seconds': int(billable),
            'estimated_compute_usd': str(billable * Decimal(plan['budget']['hourly_compute_usd']) / 3600),
            'other_infrastructure_reserve_usd': plan['budget']['other_infrastructure_reserve_usd'],
            'actual_billed_usd': None, 'instance_termination_verified': False}


def run_stages(command_for, cwd, output, limits, deadline, cancelled):
    records = {}
    for stage in STAGES:
        try:
            receipt = run_process(command_for(stage), cwd, output / 'processes' / stage,
                min(deadline, time.monotonic() + limits['stage_seconds'][stage]),
                limits['termination_grace_seconds'], cancelled)
        except Exception as error:
            path = output / 'processes' / stage / 'process.json'
            receipt = json.loads(path.read_bytes()) if path.exists() else {
                'schema': 'ilxyr.feral_process.v1', 'status': 'failed', 'pid': None,
                'stop_reason': 'dispatch_error', 'error': str(error), 'resource_usage': None}
        records[stage] = receipt
        save(output / 'phases.json', records)
        if stage in ['runtime', 'model'] and receipt['status'] != 'complete':
            break
        if cancelled() is not None:
            break
    return records


def run_controller(plan_path, plan_digest, source_archive, launch_path, output):
    started, cpu = time.monotonic_ns(), time.process_time_ns()
    output.mkdir(parents=True, exist_ok=False)
    result = {'schema': 'ilxyr.feral_execution.v1', 'status': 'failed', 'phase': 'preflight',
              'execution_plan_sha256': plan_digest, 'performance_evidence': False,
              'controller_source_sha256': digest(Path(__file__)), 'phases': {}}
    plan, elapsed, elapsed_observed_ns = None, None, None
    cancelled = {'signal': None}
    previous = {}
    def stop(number, _frame):
        cancelled['signal'] = number
    for number in [signal.SIGTERM, signal.SIGINT]:
        previous[number] = signal.signal(number, stop)
    try:
        if digest(plan_path) != plan_digest:
            raise ValueError('execution plan digest differs')
        plan = validate_plan(json.loads(plan_path.read_bytes()))
        receipt = json.loads(launch_path.read_bytes())
        elapsed = validate_launch(receipt, plan, plan_digest)
        elapsed_observed_ns = time.monotonic_ns()
        remaining = plan['limits']['max_instance_seconds'] - plan['limits']['collection_reserve_seconds'] - plan['limits']['termination_grace_seconds'] - elapsed
        if remaining <= 0:
            raise ValueError('work deadline elapsed before controller start')
        deadline = time.monotonic() + remaining
        save(output / 'execution-plan.json', plan)
        save(output / 'launch-receipt.json', receipt)
        package = output / 'source'
        manifest = extract_source(source_archive, package, plan['source'])
        for name in ['pyproject.toml', 'uv.lock']:
            if manifest['files']['environment/' + name]['sha256'] != plan['runtime'][name + '_sha256']:
                raise ValueError('runtime lock differs from source package')
        def command_for(stage):
            verify_controller(plan)
            return [sys.executable, str(ROOT / 'feral_execution_stage.py'), stage,
                '--package', str(package), '--plan', str(output / 'execution-plan.json'),
                '--plan-sha256', plan_digest, '--out', str(output)]
        # Preserve exact input bytes: the supplied plan hash also binds each child invocation.
        (output / 'execution-plan.json').write_bytes(plan_path.read_bytes())
        result['phase'] = 'stages'
        records = run_stages(command_for, package, output, plan['limits'], deadline, lambda: cancelled['signal'])
        result['phases'] = records
        comparison_path = output / 'comparison.json'
        comparison = json.loads(comparison_path.read_bytes()) if comparison_path.exists() else None
        result['status'] = 'complete' if len(records) == len(STAGES) and all(r['status'] == 'complete' for r in records.values()) and comparison is not None and comparison['status'] == 'complete' else 'incomplete'
        result['phase'] = 'finished'
        result['first_failed_phase'] = next((name for name, record in records.items() if record['status'] != 'complete'), None)
        return result
    except BaseException as error:
        result['error'] = str(error)
        raise
    finally:
        result.update(controller_wall_ns=time.monotonic_ns() - started,
                      controller_cpu_ns=time.process_time_ns() - cpu, cancelled_signal=cancelled['signal'])
        if (output / 'phases.json').exists():
            result['phases'] = json.loads((output / 'phases.json').read_bytes())
        if plan is not None and elapsed is not None:
            result['cost'] = cost_estimate(plan, elapsed + (time.monotonic_ns() - elapsed_observed_ns) / 1e9)
        result['output_index'] = {}
        for file in sorted(output.rglob('*')):
            relative = file.relative_to(output)
            if relative.parts[0] in ['source', 'model'] or not file.is_file():
                continue
            result['output_index'][relative.as_posix()] = {'bytes': file.stat().st_size, 'sha256': digest(file)}
        save(output / 'execution.json', result)
        for number, handler in previous.items():
            signal.signal(number, handler)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--plan-sha256', required=True)
    parser.add_argument('--source-archive', type=Path, required=True)
    parser.add_argument('--launch-receipt', type=Path)
    parser.add_argument('--out', type=Path)
    parser.add_argument('--check-plan', action='store_true')
    args = parser.parse_args()
    if args.check_plan:
        if digest(args.plan) != args.plan_sha256:
            raise ValueError('execution plan digest differs')
        plan = validate_plan(json.loads(args.plan.read_bytes()))
        with tempfile.TemporaryDirectory(prefix='feral-source-check-') as temporary:
            manifest = extract_source(args.source_archive, Path(temporary) / 'source', plan['source'])
            for name in ['pyproject.toml', 'uv.lock']:
                if manifest['files']['environment/' + name]['sha256'] != plan['runtime'][name + '_sha256']:
                    raise ValueError('runtime source differs')
        print(json.dumps({'status': 'source_and_plan_verified', 'rows': len(manifest['ordered_ids']),
                          'max_infrastructure_usd': plan['budget']['max_infrastructure_usd'],
                          'cloud_processes_started': 0}))
        return
    if args.launch_receipt is None or args.out is None:
        parser.error('execution requires --launch-receipt and --out')
    result = run_controller(args.plan.resolve(), args.plan_sha256, args.source_archive.resolve(),
                            args.launch_receipt.resolve(), args.out.resolve())
    print(json.dumps({'status': result['status'], 'phases': list(result['phases'])}))
    raise SystemExit(0 if result['status'] == 'complete' else 1)


if __name__ == '__main__':
    main()
