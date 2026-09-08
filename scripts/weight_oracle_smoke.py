"""Build frozen native oracle sources and check three known answers on Linux."""
import argparse
import json
import os
from pathlib import Path
import time
from feral_process import run_process, save
from weight_source_kit import PLAN, check_binding, expand_lie, sha


def smoke(repo, inputs, output):
    repo, inputs, output = repo.resolve(), inputs.resolve(), output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    plan = json.loads((repo / PLAN).read_text())
    result = {'schema': 'ilxyr.weight_oracle_build_smoke.v1', 'status': 'failed',
              'scope': 'build_reproducibility_and_small_correctness', 'fresh_corpus_rows': 0}
    deadline = time.monotonic() + 240
    def run(label, command, cwd=output):
        receipt = run_process(command, cwd, output / 'logs' / label, deadline, 2)
        if receipt['status'] != 'complete':
            raise RuntimeError(label + ': ' + str(receipt['stop_reason'] or receipt['exit_code']))
        return (output / 'logs' / label / 'stdout.log').read_text()
    try:
        for name, key in [('lie-2.2.2.tar.gz', 'lie'), ('bison.deb', 'bison')]:
            check_binding((inputs / name).read_bytes(), plan['inputs'][key], key)
        zero = output / 'zero'
        zero.mkdir()
        for name, expected in plan['zero_files'].items():
            raw = (inputs / 'zero' / name).read_bytes()
            if sha(raw) != expected:
                raise ValueError('Zero source differs: ' + name)
            (zero / name).write_bytes(raw)
        tools = output / 'tools'
        run('unpack-bison', ['dpkg-deb', '-x', str(inputs / 'bison.deb'), str(tools)])
        os.environ['PATH'] = str(tools / 'usr/bin') + ':' + os.environ['PATH']
        os.environ['BISON_PKGDATADIR'] = str(tools / 'usr/share/bison')
        os.environ['SOURCE_DATE_EPOCH'] = str(plan['source_date_epoch'])
        os.environ['LC_ALL'] = 'C'
        runtime = {'node': run('node-version', ['node', '-p', 'process.versions.node']).strip(),
                   'gcc': run('gcc-version', ['/usr/bin/gcc', '-dumpfullversion']).strip(),
                   'bison': run('bison-version', ['bison', '--version']).splitlines()[0],
                   'python': run('python-version', ['python3', '--version']).strip()}
        result['runtime'] = runtime
        if runtime['node'] != plan['node_version'] or runtime['gcc'] != plan['compiler_version']:
            raise ValueError('fixed runtime version differs')
        if runtime['bison'] != 'bison (GNU Bison) ' + plan['bison_version']:
            raise ValueError('fixed Bison version differs')
        source_raw = (inputs / 'lie-2.2.2.tar.gz').read_bytes()
        hashes = []
        for index in [1, 2]:
            base = output / ('lie-' + str(index))
            expand_lie(source_raw, base)
            directory = base / 'LiE'
            run('build-lie-' + str(index), ['make', 'noreadline', 'CC=/usr/bin/gcc', 'CFLAGS=' + plan['lie_cflags']], directory)
            hashes.append(sha((directory / 'Lie.exe').read_bytes()))
        result['lie_executable_sha256'] = hashes
        if hashes[0] != hashes[1]:
            raise ValueError('independent LiE builds differ')
        run('build-zero', ['make', 'weight_multiplicity', 'CC=/usr/bin/gcc', 'CFLAGS=' + plan['zero_cflags']], zero)
        result['zero_executable_sha256'] = sha((zero / 'weight_multiplicity').read_bytes())
        run('zero-self-test', [str(zero / 'weight_multiplicity'), '--self-test'])
        run('oracle-fixtures', ['node', str(repo / 'scripts/weight_oracle_smoke.mjs'),
            str(output / 'lie-1/LiE/Lie.exe'), str(zero / 'weight_multiplicity'), str(output / 'FIXTURES.json')])
        result['fixtures'] = json.loads((output / 'FIXTURES.json').read_text())
        result['status'] = 'pass'
    except Exception as error:
        result['error'] = str(error)
        raise
    finally:
        save(output / 'RESULT.json', result)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['repo', 'inputs', 'output']:
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(smoke(args.repo, args.inputs, args.output), sort_keys=True))
