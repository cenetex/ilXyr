"""Rebuild the published FERAL source and prepared archives for a fixed-image check."""
import argparse
import json
from pathlib import Path
import shutil

from package_feral_coverage_cloud import PLAN, KIT, SOURCES, archive, encode, node_bytes, require, sha, write_files
import research_feral_coverage as study


def prepare(repo, raw, node, output):
    repo, raw, output = repo.resolve(), raw.resolve(), output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    plan = json.loads((repo / PLAN).read_bytes()); kit = json.loads((repo / KIT).read_bytes())
    recipe = repo / 'experiments/research-step-49/CONTROLLER-SOURCE.json'
    source = json.loads(recipe.read_bytes())
    files = {name: (repo / name).read_bytes() for name in source['repository_files']}
    for name in ['msft', 'aapl', 'cost']: files['raw/' + name + '.html'] = (raw / (name + '.html')).read_bytes()
    files['SOURCE.json'] = recipe.read_bytes()
    files['README.txt'] = (repo / 'experiments/research-step-49/CONTROLLER-README.txt').read_bytes()
    files['FILES.json'] = encode({n: {'bytes': len(b), 'sha256': sha(b)} for n, b in files.items()})
    require(sha(files['FILES.json']) == kit['manifest_sha256'], 'published source manifest differs')
    controller = archive(files, output / 'controller.tar')
    require(controller == {'bytes': kit['archive_bytes'], 'sha256': kit['archive_sha256']}, 'published source archive differs')
    write_files(files, output / 'controller')
    study.prepare(output / 'prepared', raw)
    prepared = {str(p.relative_to(output / 'prepared')): p.read_bytes() for p in (output / 'prepared').rglob('*') if p.is_file()}
    binding = archive(prepared, output / 'prepared.tar')
    require(binding == {k: plan['prepared'][k] for k in ['bytes', 'sha256']}, 'published prepared archive differs')
    binary = node_bytes(node.read_bytes(), plan['node_binary'])
    for name in SOURCES:
        target = output / name; target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(repo / name, target)
    shutil.copyfile(node, output / 'node.tar.xz')
    write_files({'bin/node': binary}, output / 'runtime'); (output / 'runtime/bin/node').chmod(0o755)
    return {'status': 'verified', 'controller': controller, 'prepared': binding, 'fresh_predictor_calls': 0}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['repo', 'raw', 'node', 'output']: p.add_argument('--' + name, type=Path, required=True)
    a = p.parse_args(); print(json.dumps(prepare(a.repo, a.raw, a.node, a.output), sort_keys=True))
