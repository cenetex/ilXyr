"""Exercise Triton's actual cache and native loader in the frozen container."""

import argparse
import errno
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path


SOURCE = r'''
#include <Python.h>
static PyObject *answer(PyObject *self, PyObject *args) { return PyLong_FromLong(5); }
static PyMethodDef methods[] = {{"answer", answer, METH_NOARGS, NULL}, {NULL, NULL, 0, NULL}};
static struct PyModuleDef module = {PyModuleDef_HEAD_INIT, "feral_cache_probe", NULL, -1, methods};
PyMODINIT_FUNC PyInit_feral_cache_probe(void) { return PyModule_Create(&module); }
'''


STAGE_A_CACHE_PATHS = {
    'TRITON_CACHE_DIR': '/tmp/feral-triton',
    'TORCHINDUCTOR_CACHE_DIR': '/tmp/feral-inductor',
    'TORCH_EXTENSIONS_DIR': '/tmp/feral-extensions',
    'TORCH_HOME': '/tmp/feral-torch',
    'HF_HOME': '/tmp/feral-hf',
    'XDG_CACHE_HOME': '/tmp/feral-xdg',
}


def check(expect_failure, stage_a=False):
    from triton.runtime.build import compile_module_from_src
    record = {'schema': 'ilxyr.feral_runtime_cache_smoke.v1',
              'triton_version': importlib.metadata.version('triton'),
              'cache_directory': os.environ.get('TRITON_CACHE_DIR'),
              'gpu_generation_tested': False, 'scored_rows': 0}
    assert record['triton_version'] == '3.7.1'
    try:
        module = compile_module_from_src(SOURCE, 'feral_cache_probe')
    except OSError as error:
        if not expect_failure or error.errno != errno.EROFS or '/root/.triton' not in str(error):
            raise
        record.update(status='expected_read_only_failure', error=str(error))
        return record
    assert not expect_failure, 'default cache unexpectedly succeeded'
    assert record['cache_directory'] == '/tmp/feral-triton'
    if stage_a:
        for name, expected in STAGE_A_CACHE_PATHS.items():
            assert os.environ.get(name) == expected, f'{name} differs'
            directory = Path(expected)
            directory.mkdir(parents=True, exist_ok=True)
            probe = directory / 'feral-stage-a-cache-probe'
            probe.write_bytes(b'feral-stage-a')
            assert probe.read_bytes() == b'feral-stage-a'
        record['stage_a_cache_paths_checked'] = sorted(STAGE_A_CACHE_PATHS)
    path = Path(module.__file__)
    assert path.is_relative_to(record['cache_directory']) and module.answer() == 5
    original = path.read_bytes(), path.stat().st_mtime_ns
    again = compile_module_from_src(SOURCE, 'feral_cache_probe')
    assert again.answer() == 5 and (path.read_bytes(), path.stat().st_mtime_ns) == original
    record.update(status='complete', native_module_loaded=True, cached_module_reused=True,
                  module_sha256=hashlib.sha256(original[0]).hexdigest())
    return record


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expect-read-only-failure', action='store_true')
    parser.add_argument('--check-stage-a-caches', action='store_true')
    args = parser.parse_args()
    print(json.dumps(check(args.expect_read_only_failure, args.check_stage_a_caches), indent=2, sort_keys=True))
