"""Execute one fixed FERAL comparison stage inside the frozen GPU runtime."""

import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import sys
import tomllib

from feral_process import digest, save


def runtime_check(package, plan, output, environment=Path('/opt/sec-qwen')):
    runtime = plan['runtime']
    record = {'schema': 'ilxyr.feral_runtime_check.v1', 'status': 'running',
        'python': sys.version, 'platform': platform.platform(), 'dependencies': {},
        'runtime_sources': {}, 'image_identity_scope': 'outer_launch_receipt_and_image_environment'}
    try:
        for name in ['pyproject.toml', 'uv.lock']:
            record['runtime_sources'][name] = digest(environment / name)
            if record['runtime_sources'][name] != runtime[name + '_sha256']:
                raise ValueError('installed runtime source differs: ' + name)
        record['image_source_revision'] = os.environ.get('RUNNER_WATCH_REVISION')
        record['image_repository'] = os.environ.get('OCI_IMAGE_REPOSITORY')
        if record['image_source_revision'] != runtime['image_source_revision']:
            raise ValueError('image source revision differs')
        if record['image_repository'] != runtime['image'].split('@', 1)[0]:
            raise ValueError('image repository differs')
        dependencies = tomllib.loads((package / 'environment/pyproject.toml').read_text())['project']['dependencies']
        for declaration in dependencies:
            name, expected = declaration.split('==')
            record['dependencies'][name] = importlib.metadata.version(name)
            # PyTorch CUDA wheels can have a local build label.
            if record['dependencies'][name].split('+', 1)[0] != expected:
                raise ValueError('installed dependency differs: ' + name)
        if platform.system() != 'Linux' or platform.machine() != 'x86_64' or not (3, 11) <= sys.version_info[:2] < (3, 14):
            raise ValueError('runtime platform differs')
        import torch
        record['cuda_version'] = torch.version.cuda
        record['cuda_available'] = torch.cuda.is_available()
        record['cuda_device_count'] = torch.cuda.device_count()
        if not record['cuda_available'] or record['cuda_device_count'] != 1 or record['cuda_version'] != runtime['cuda_version']:
            raise ValueError('CUDA runtime or device count differs')
        device = torch.cuda.get_device_properties(0)
        record.update(gpu_name=device.name, device_total_memory_bytes=device.total_memory)
        if device.name != runtime['gpu_name'] or device.total_memory < runtime['minimum_device_bytes']:
            raise ValueError('GPU identity or memory differs')
        record['status'] = 'complete'
    except BaseException as error:
        record.update(status='failed', error=str(error))
        raise
    finally:
        save(output / 'runtime.json', record)


def stage_model(package, output, cache_root=None):
    inventory = json.loads((package / 'model/FILES.json').read_bytes())
    hub = Path(cache_root) if cache_root is not None else Path('/opt/sec-qwen/huggingface/hub')
    snapshot = hub / ('models--' + inventory['id'].replace('/', '--')) / 'snapshots' / inventory['revision']
    target = output / 'model'
    target.mkdir(exist_ok=False)
    record = {'schema': 'ilxyr.feral_model_staging.v1', 'status': 'running',
              'inventory_sha256': digest(package / 'model/FILES.json'), 'files': {}, 'failed_file': None}
    try:
        for name, binding in sorted(inventory['files'].items()):
            record['failed_file'] = name
            source = (snapshot / name).resolve()
            destination = target / name
            if not source.is_relative_to(hub.resolve()) or not destination.resolve().is_relative_to(target.resolve()):
                raise ValueError('model staging path differs')
            destination.parent.mkdir(parents=True, exist_ok=True)
            hashed, size = hashlib.sha256(), 0
            with source.open('rb') as incoming, destination.open('xb') as outgoing:
                for part in iter(lambda: incoming.read(1024 * 1024), b''):
                    outgoing.write(part)
                    hashed.update(part)
                    size += len(part)
                    if size > binding['bytes']:
                        raise ValueError('model file exceeds frozen size: ' + name)
            if size != binding['bytes'] or hashed.hexdigest() != binding['sha256']:
                raise ValueError('model file differs: ' + name)
            record['files'][name] = {'bytes': size, 'sha256': hashed.hexdigest()}
            save(output / 'model-staging.json', record)
        record.update(status='complete', failed_file=None)
    except BaseException as error:
        record.update(status='failed', error=str(error))
        raise
    finally:
        save(output / 'model-staging.json', record)


def run_arm(package, plan, output, arm):
    from feral_comparison_worker import BaseGenerator, run_package
    metrics = {'schema': 'ilxyr.feral_device_memory.v1', 'status': 'unknown',
               'scope': 'pytorch_cuda_allocator', 'whole_device_peak_bytes': None}
    torch = None
    def factory():
        nonlocal torch
        import torch as loaded
        torch = loaded
        torch.cuda.reset_peak_memory_stats(0)
        inventory = json.loads((package / 'model/FILES.json').read_bytes())
        return BaseGenerator(output / 'model', inventory)
    destination = output / 'arms' / arm
    try:
        run_package(package, plan['source']['package_manifest_sha256'], arm, destination,
                    output / 'model', factory if arm == 'base' else None)
    finally:
        if arm == 'base' and destination.exists():
            if torch is not None:
                try:
                    metrics.update(status='observed', allocated_peak_bytes=torch.cuda.max_memory_allocated(0),
                                   reserved_peak_bytes=torch.cuda.max_memory_reserved(0))
                except BaseException as error:
                    metrics['error'] = str(error)
            save(destination / 'device-memory.json', metrics)


def partial_records(path):
    if not path.exists():
        return {'complete_rows': 0, 'trailing_bytes': 0, 'sha256': None}
    raw = path.read_bytes()
    prefix, separator, tail = raw.rpartition(b'\n')
    complete = (prefix + separator).splitlines() if separator else []
    rows = []
    for line in complete:
        try:
            row = json.loads(line)
            if not isinstance(row, dict) or not isinstance(row.get('id'), str):
                raise ValueError('prediction identity is missing')
        except (ValueError, TypeError) as error:
            return {'complete_rows': len(rows), 'malformed_complete_line': len(rows) + 1,
                    'error': str(error), 'sha256': digest(path), 'primary_metrics': None}
        rows.append(row)
    return {'scope': 'raw_complete_json_lines', 'complete_rows': len(rows), 'ordered_ids': [row['id'] for row in rows],
            'trailing_bytes': len(tail), 'sha256': digest(path)}


def grade(package, plan, output):
    from feral_comparison_worker import verify_package
    from feral_targets_v2 import read_rows
    from score_feral_comparison import score_arm
    manifest = verify_package(package, plan['source']['package_manifest_sha256'], include_grading=True)
    targets = read_rows((package / 'grader/targets.jsonl').read_bytes())
    if [row['id'] for row in targets] != manifest['ordered_ids']:
        raise ValueError('grading roster differs')
    bindings = {'package_manifest_sha256': plan['source']['package_manifest_sha256'],
                'inputs_sha256': manifest['files']['inputs/model-inputs.jsonl']['sha256'],
                'model_inventory_sha256': manifest['files']['model/FILES.json']['sha256']}
    records = json.loads((output / 'phases.json').read_bytes())
    results = {}
    for arm in ['base', 'calculator', 'operand_only']:
        process = records.get(arm)
        folder = output / 'arms' / arm
        if process is None or process['status'] != 'complete':
            results[arm] = {'status': 'incomplete', 'expected_rows': len(targets), 'primary_metrics': None,
                'process': process, 'prefix': partial_records(folder / 'predictions.jsonl')}
        else:
            results[arm] = score_arm(folder, targets, arm, bindings)
            results[arm]['process'] = process
    save(output / 'comparison.json', {'schema': 'ilxyr.feral_cloud_comparison.v1',
        'scope': manifest['scope'], 'package_manifest_sha256': plan['source']['package_manifest_sha256'],
        'status': 'complete' if all(r['status'] == 'complete' for r in results.values()) else 'incomplete',
        'arms': results})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', choices=['runtime', 'model', 'base', 'calculator', 'operand_only', 'grade'])
    parser.add_argument('--package', type=Path, required=True)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--plan-sha256', required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    if digest(args.plan) != args.plan_sha256:
        raise ValueError('execution plan digest differs')
    plan = json.loads(args.plan.read_bytes())
    sys.path.insert(0, str(args.package / 'scripts'))
    from feral_comparison_worker import verify_package
    verify_package(args.package, plan['source']['package_manifest_sha256'])
    if args.stage == 'runtime':
        runtime_check(args.package, plan, args.out)
    elif args.stage == 'model':
        stage_model(args.package, args.out)
    elif args.stage == 'grade':
        grade(args.package, plan, args.out)
    else:
        run_arm(args.package, plan, args.out, args.stage)


if __name__ == '__main__':
    main()
