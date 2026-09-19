"""Rebuild the checked source kit for a small fixed-image runtime check."""
import argparse
import json
from pathlib import Path
import shutil
from package_zero4_cloud import PLAN, KIT, SOURCES, archive, require, sha, write_files


def prepare(repo, source, output):
    kit = json.loads((repo / KIT).read_bytes()); files = {}
    for name, binding in kit['files'].items():
        original = source / name[7:] if name.startswith('source/') else repo / name
        if name == 'README.md': original = repo / 'experiments/research-step-45/CONTROLLER-README.md'
        raw = original.read_bytes()
        require(binding == {'path': name, 'bytes': len(raw), 'sha256': sha(raw)}, 'runtime check source differs: ' + name)
        files[name] = raw
    output.mkdir(parents=True, exist_ok=False)
    result = archive(files, output / 'controller.tar')
    require(result == {'sha256': kit['sha256'], 'bytes': kit['bytes']}, 'reconstructed source kit differs')
    write_files(files, output / 'controller')
    for name in SOURCES:
        p = output / name; p.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(repo / name, p)
    (output / 'prepared').mkdir()
    # The opened controller makes its own tiny synthetic inputs; this binds only the full manifest metadata.
    shutil.copyfile(repo / 'experiments/research-step-44/PREPARED.json', output / 'prepared/MANIFEST.json')
    plan = json.loads((output / PLAN).read_bytes())
    require(sha((output / 'prepared/MANIFEST.json').read_bytes()) == plan['prepared']['manifest_sha256'], 'runtime check full manifest differs')
    return {'status': 'complete', 'source_kit': result, 'production_input_bytes_loaded': 0, 'production_teacher_forward_calls': 0}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for n in ['repo', 'source', 'output']: p.add_argument('--' + n, type=Path, required=True)
    a = p.parse_args(); print(json.dumps(prepare(a.repo, a.source, a.output), sort_keys=True))
