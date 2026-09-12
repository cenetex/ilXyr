"""Rebuild the exact Reasoner source kit and prepared bytes for a small image check."""
import argparse
import json
from pathlib import Path
import shutil
import sys
from package_reasoner_study_cloud import PLAN, KIT, SOURCES, node_bytes, archive, require, sha, write_files


def prepare(repo, source, node, output):
    kit = json.loads((repo / KIT).read_bytes())
    raw = (repo / 'experiments/research-step-46/CONTROLLER-FILES.json').read_bytes()
    require(sha(raw) == kit['manifest_sha256'], 'source kit inventory differs')
    files = {'FILES.json': raw}
    for name, binding in json.loads(raw).items():
        original = source / name[7:] if name.startswith('source/') else repo / name
        value = original.read_bytes()
        require(binding == {'bytes': len(value), 'sha256': sha(value)}, 'runtime check source differs: ' + name)
        files[name] = value
    output.mkdir(parents=True, exist_ok=False)
    result = archive(files, output / 'controller.tar')
    require(result == {'sha256': kit['archive_sha256'], 'bytes': kit['archive_bytes']}, 'reconstructed source kit differs')
    write_files(files, output / 'controller')
    for name in SOURCES:
        p = output / name; p.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(repo / name, p)
    sys.path.insert(0, str(output.resolve() / 'controller/scripts'))
    from research_reasoner_study import prepare as prepare_inputs
    prepare_inputs(source.resolve(), output.resolve() / 'prepared')
    prepared = {str(p.relative_to(output / 'prepared')): p.read_bytes() for p in (output / 'prepared').rglob('*') if p.is_file()}
    result_inputs = archive(prepared, output / 'prepared.tar')
    plan = json.loads((output / PLAN).read_bytes())
    require(result_inputs == {k: plan['prepared'][k] for k in ['bytes', 'sha256']}, 'full prepared bytes differ')
    raw_node = node.read_bytes(); binary = node_bytes(raw_node, plan['node_binary'])
    (output / 'node.tar.xz').write_bytes(raw_node)
    write_files({'bin/node': binary}, output / 'runtime')
    (output / 'runtime/bin/node').chmod(0o755)
    return {'status': 'complete', 'source_kit': result, 'prepared': result_inputs, 'fresh_episode_visits': 0}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for n in ['repo', 'source', 'node', 'output']: p.add_argument('--' + n, type=Path, required=True)
    a = p.parse_args(); print(json.dumps(prepare(a.repo, a.source, a.node, a.output), sort_keys=True))
