"""Freeze the FERAL execution controller around the step 13 source archive."""

import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile

CONTROLLER_FILES = ('feral_process.py', 'feral_execution_stage.py', 'run_feral_comparison.py')


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encode(value):
    return (json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + '\n').encode()


def build(repo, revision, source_archive, output):
    if not re.fullmatch('[0-9a-f]{40}', revision):
        raise ValueError('a full committed revision is required')
    def committed(name):
        return subprocess.check_output(['git', '-C', str(repo), 'show', revision + ':' + name], stderr=subprocess.PIPE)
    source = json.loads(committed('experiments/research-step-13/RESULT.json'))['smoke']['archives']['full']
    if source_archive.stat().st_size != source['archive_bytes'] or sha(source_archive.read_bytes()) != source['archive_sha256']:
        raise ValueError('comparison source archive differs')
    runtime = json.loads(committed('experiments/research-step-14/RUNTIME-SOURCES.json'))
    price = json.loads(committed('experiments/research-step-14/PRICE.json'))
    files = {'scripts/' + name: committed('scripts/' + name) for name in CONTROLLER_FILES}
    plan = {'schema': 'ilxyr.feral_execution_plan.v1', 'id': 'feral.finqa-base-calculator.v1',
        'execution_authorized': False, 'controller_source_commit': revision,
        'arms': ['base', 'calculator', 'operand_only'],
        'failure_policy': 'retain_and_continue_remaining_arms_within_original_deadline',
        'controller_files': {name: {'bytes': len(files['scripts/' + name]), 'sha256': sha(files['scripts/' + name])}
                             for name in CONTROLLER_FILES},
        'source': source,
        'runtime': {'image': runtime['image'], 'image_source_revision': runtime['image_source_revision'],
            'pyproject.toml_sha256': runtime['byte_identical_files']['pyproject.toml']['sha256'],
            'uv.lock_sha256': runtime['byte_identical_files']['uv.lock']['sha256'],
            'cuda_version': '13.0', 'gpu_name': 'NVIDIA L40S', 'minimum_device_bytes': 40 * 1024**3},
        'provider': {'name': 'aws_ec2', 'region': 'us-east-1', 'instance_type': 'g6e.2xlarge',
            'architecture': 'x86_64', 'ami_id': 'ami-0d3378afe7683c867',
            'root_volume_gib': 150, 'root_volume_type': 'gp3', 'root_volume_encrypted': True},
        'preflight_state': 'pending_live_verification',
        'limits': {'max_instance_seconds': 3600, 'collection_reserve_seconds': 300,
            'termination_grace_seconds': 30,
            'stage_seconds': {'runtime': 120, 'model': 600, 'base': 2400, 'calculator': 120, 'operand_only': 120, 'grade': 120}},
        'budget': {'hourly_compute_usd': price['record']['price'], 'other_infrastructure_reserve_usd': '0.75',
            'max_infrastructure_usd': '3.00', 'tax_scope': 'before_tax',
            'price_evidence': {'status': 'verified', **price}},
        'outer_requirements': ['launch-relative instance shutdown watchdog armed before setup',
            'verified image digest and runtime resource limits', 'new execution identity and immutable output location',
            'launch receipt matching this plan and the authorized budget', 'collect failed and complete output before shutdown',
            'verify instance termination and import the full cost receipt']}
    files['EXECUTION-PLAN.json'] = encode(plan)
    files['comparison-source.tar'] = source_archive.read_bytes()
    files['PRICE.json'] = encode(price)
    files['RUNTIME-SOURCES.json'] = encode(runtime)
    manifest = {'schema': 'ilxyr.feral_execution_package.v1', 'source_commit': revision,
        'execution_plan_sha256': sha(files['EXECUTION-PLAN.json']),
        'files': {name: {'sha256': sha(raw), 'bytes': len(raw)} for name, raw in sorted(files.items())}}
    files['EXECUTION-PACKAGE.json'] = encode(manifest)
    with tarfile.open(output, 'x', format=tarfile.USTAR_FORMAT) as archive:
        for name, raw in sorted(files.items()):
            item = tarfile.TarInfo(name)
            item.size, item.mode, item.mtime = len(raw), 0o644, 0
            archive.addfile(item, io.BytesIO(raw))
    return {'schema': 'ilxyr.feral_execution_archive.v1', 'source_commit': revision,
            'archive_bytes': output.stat().st_size, 'archive_sha256': sha(output.read_bytes()),
            'execution_manifest_sha256': sha(files['EXECUTION-PACKAGE.json']),
            'execution_plan_sha256': manifest['execution_plan_sha256'], 'files': len(files),
            'execution_authorized': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--source-archive', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.repo, args.revision, args.source_archive, args.out)))
