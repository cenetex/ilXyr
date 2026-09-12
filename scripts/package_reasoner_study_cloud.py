"""Bind Reasoner's fixed four-method study, complete inputs and cloud host."""
import argparse
from decimal import Decimal, ROUND_CEILING
import json
from pathlib import Path
import subprocess
from package_solomon_cloud import archive, encode, read_archive, require, sha, write_files, manifest_check

PLAN = 'experiments/research-step-46/EXECUTION-PLAN.json'
BODY = 'scripts/aws/reasoner-46-user-data.sh'
KIT = 'experiments/research-step-40/KIT.json'
SOURCES = [PLAN, BODY, KIT, 'scripts/package_reasoner_study_cloud.py', 'scripts/package_solomon_cloud.py',
           'scripts/reasoner_study_cloud_runtime.py', 'scripts/reasoner_study_cloud_collect.py',
           'scripts/reasoner_study_cloud_launch.py', 'scripts/reasoner_study_cloud_preflight.py', 'scripts/feral_cloud_package.py', 'scripts/feral_process.py']
MAX_BYTES = 128 * 1024 * 1024


def check_budget(plan):
    p, b, s, limit = plan['provider'], plan['budget'], plan['storage'], plan['limits']
    hours = Decimal(limit['max_instance_seconds']) / 3600
    gigabytes = Decimal(b['billable_storage_and_download_gb_ceiling'])
    require(gigabytes * 10**9 >= s['max_archive_bytes'] + 128 * 1024**2 + s['max_host_log_bytes'], 'billable bytes omit package or results')
    costs = {'compute': hours * Decimal(b['compute_usd_per_hour']),
             'disk': hours / 720 * p['disk_gib'] * Decimal(b['disk_usd_per_gb_month']),
             'ipv4': hours * Decimal(b['ipv4_usd_per_hour']),
             'download': gigabytes * s['maximum_downloads'] * Decimal(b['download_usd_per_gb']),
             'storage': gigabytes * Decimal(s['budget_storage_days']) / 30 * Decimal(b['s3_usd_per_gb_month'])}
    costs = {k: v.quantize(Decimal('.000001'), rounding=ROUND_CEILING) for k, v in costs.items()}
    for name, value in costs.items():
        require(value == Decimal(b[name + '_ceiling_usd']), 'cost arithmetic differs: ' + name)
    total = sum(costs.values()) + Decimal(b['request_allowance_usd'])
    require(total == Decimal(b['calculated_ceiling_usd']) and total + Decimal(b['margin_usd']) == Decimal(b['maximum_before_tax_usd']), 'total cost ceiling differs')
    require(0 < limit['setup_deadline_seconds'] < limit['controller_deadline_seconds'] < limit['collection_deadline_seconds'] <
            limit['shutdown_at_seconds'] < limit['max_instance_seconds'], 'host deadline order differs')
    require(limit['setup_deadline_seconds'] + plan['study_limits']['total_seconds'] + plan['checker_seconds'] + 30 <= limit['controller_deadline_seconds'], 'controller time allowance differs')
    require(s['archive_chunk_bytes'] <= 4 * 1024**3 and s['max_archive_bytes'] <= s['archive_chunk_bytes'] * s['max_archive_chunks']
            and s['max_archive_chunks'] + 3 <= s['max_cloud_objects_per_run'], 'archive object limits differ')


def inspect(package, expected):
    require(package.stat().st_size <= MAX_BYTES, 'host package byte ceiling')
    raw = package.read_bytes(); require(sha(raw) == expected, 'host package digest differs')
    files = read_archive(raw); manifest = json.loads(files['HOST.json'])
    require(set(files) == set(SOURCES) | {'controller.tar', 'prepared.tar', 'HOST.json'}, 'host roster differs')
    require(manifest['files'] == {n: {'bytes': len(b), 'sha256': sha(b)} for n, b in files.items() if n != 'HOST.json'}, 'host member binding differs')
    plan = json.loads(files[PLAN]); require(manifest['plan_sha256'] == sha(files[PLAN]), 'plan digest differs')
    check_budget(plan)
    kit = json.loads(files[KIT]); controller = read_archive(files['controller.tar'])
    require(sha(files['controller.tar']) == kit['archive_sha256'] == plan['controller_sha256'] and
            len(files['controller.tar']) == kit['archive_bytes'] == plan['controller_bytes'], 'controller archive differs')
    require(sha(controller['FILES.json']) == kit['manifest_sha256'], 'controller file roster differs')
    manifest_check(controller, 'FILES.json')
    require(len(files['prepared.tar']) == plan['prepared']['bytes'] and sha(files['prepared.tar']) == plan['prepared']['sha256'], 'prepared archive differs')
    prepared = read_archive(files['prepared.tar']); m = json.loads(prepared['BINDINGS.json'])
    require(sha(prepared['BINDINGS.json']) == plan['prepared']['bindings_sha256'] and m['plan_sha256'] == plan['study_plan_sha256'], 'prepared bindings differ')
    require(m['implementation'] == plan['implementation'] == kit['implementation'], 'full prepared implementation differs')
    require(set(prepared) == {'source/' + n for n in m['source']} | {'BINDINGS.json', 'PREPARE.json', 'PLAN.json', 'ROSTER.json', 'OPENED.jsonl', 'opened-SCHEDULE.json', 'cloud-SCHEDULE.json'}, 'prepared file roster differs')
    for n, expected in m['source'].items(): require(sha(prepared['source/' + n]) == expected == sha(controller['source/' + n]), 'prepared source differs: ' + n)
    for n, key in [('PLAN.json', 'plan_sha256'), ('ROSTER.json', 'roster_sha256'), ('OPENED.jsonl', 'opened_sha256')]:
        require(sha(prepared[n]) == m[key], 'prepared input differs: ' + n)
    require(all(sha(controller['scripts/' + n]) == h for n, h in plan['implementation'].items()), 'prepared implementation binding differs')
    require(json.loads(prepared['PREPARE.json'])['status'] == 'complete', 'complete input preparation required')
    return files, manifest, plan


def build(repo, revision, controller, prepared, output):
    commit = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', revision + '^{commit}'], text=True).strip()
    files = {n: subprocess.check_output(['git', '-C', str(repo), 'show', commit + ':' + n]) for n in SOURCES}
    files.update({'controller.tar': controller.read_bytes(), 'prepared.tar': prepared.read_bytes()})
    files['HOST.json'] = encode({'schema': 'ilxyr.reasoner_host_package.v1', 'source_commit': commit,
        'plan_sha256': sha(files[PLAN]), 'files': {n: {'bytes': len(b), 'sha256': sha(b)} for n, b in files.items()}})
    result = archive(files, output); inspect(output, result['sha256'])
    return {**result, 'source_commit': commit, 'plan_sha256': sha(files[PLAN])}


def unpack(package, expected, output):
    files, manifest, _ = inspect(package, expected)
    write_files(files, output)
    write_files(read_archive(files['controller.tar']), output / 'controller')
    write_files(read_archive(files['prepared.tar']), output / 'prepared')
    return manifest


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('mode', choices=['build', 'verify', 'unpack'])
    for n in ['repo', 'controller', 'prepared', 'package', 'output']: p.add_argument('--' + n, type=Path)
    p.add_argument('--revision'); p.add_argument('--expected-sha256'); a = p.parse_args()
    if a.mode == 'build': result = build(a.repo, a.revision, a.controller, a.prepared, a.output)
    elif a.mode == 'unpack': result = unpack(a.package, a.expected_sha256, a.output)
    else: result = inspect(a.package, a.expected_sha256)[1]
    print(json.dumps(result, sort_keys=True))
