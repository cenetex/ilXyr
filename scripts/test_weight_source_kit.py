import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from weight_source_kit import EXTRA, INPUT_NAMES, PLAN, encode, expand_lie, read_archive, sha, unpack, verify_payload


def archive(files):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w', format=tarfile.USTAR_FORMAT) as writer:
        for name, data in files:
            entry = tarfile.TarInfo(name)
            entry.size = len(data)
            writer.addfile(entry, io.BytesIO(data))
    return stream.getvalue()


def refresh_manifest(files):
    files['KIT.json'] = encode({'schema': 'ilxyr.weight_source_kit.v1', 'files': {
        name: {'bytes': len(raw), 'sha256': sha(raw)} for name, raw in files.items() if name != 'KIT.json'}})


def fixture():
    files = {name: b'fixed code\n' for name in EXTRA}
    files['scripts/policy-module.mjs'] = b'frozen policy module\n'
    policy = encode({'source_bindings': {'scripts/policy-module.mjs': sha(files['scripts/policy-module.mjs'])}})
    files['policy.json'] = policy
    files.update({name: b'fixed input\n' for name in INPUT_NAMES.values()})
    files[INPUT_NAMES['lie']] = archive([('LiE/README', b'original source\n')])
    files['zero/source.c'] = b'fixed C\n'
    files[PLAN] = encode({'resource_policy_path': 'policy.json', 'resource_policy_sha256': sha(policy),
        'inputs': {key: {'sha256': sha(files[name]), 'bytes': len(files[name])} for key, name in INPUT_NAMES.items()},
        'zero_files': {'source.c': sha(files['zero/source.c'])}})
    refresh_manifest(files)
    return files


class KitTests(unittest.TestCase):
    def test_complete_kit_round_trip_preserves_bytes_and_existing_directory(self):
        files = fixture()
        raw = archive(files.items())
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); package = root / 'kit.tar'; package.write_bytes(raw)
            unpack(package, sha(raw), root / 'out')
            for name, data in files.items():
                self.assertEqual((root / 'out' / name).read_bytes(), data)
            with self.assertRaises(FileExistsError):
                unpack(package, sha(raw), root / 'out')
            self.assertEqual((root / 'out' / 'KIT.json').read_bytes(), files['KIT.json'])

    def test_original_build_script_keeps_execute_mode(self):
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode='w') as writer:
            entry = tarfile.TarInfo('LiE/make_lie'); entry.mode = 0o755; entry.size = 3
            writer.addfile(entry, io.BytesIO(b'run'))
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'sources'
            expand_lie(stream.getvalue(), output)
            self.assertEqual((output / 'LiE/make_lie').stat().st_mode & 0o777, 0o755)

    def test_wrong_outer_digest_fails_before_output(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); package = root / 'kit.tar'; package.write_bytes(archive(fixture().items()))
            with self.assertRaisesRegex(ValueError, 'package digest'):
                unpack(package, '0' * 64, root / 'out')
            self.assertFalse((root / 'out').exists())

    def test_changed_file_fails_before_output(self):
        files = fixture(); files['zero/source.c'] = b'changed'
        raw = archive(files.items())
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); package = root / 'kit.tar'; package.write_bytes(raw)
            with self.assertRaisesRegex(ValueError, 'input binding'):
                unpack(package, sha(raw), root / 'out')
            self.assertFalse((root / 'out').exists())

    def test_policy_bound_module_drift_survives_outer_manifest_refresh(self):
        files = fixture(); files['scripts/policy-module.mjs'] = b'changed'; refresh_manifest(files)
        with self.assertRaisesRegex(ValueError, 'policy source'):
            verify_payload(files)

    def test_required_scientific_input_cannot_be_omitted(self):
        files = fixture(); del files['zero/source.c']; refresh_manifest(files)
        with self.assertRaisesRegex(ValueError, 'scientific input roster'):
            verify_payload(files)

    def test_trace_and_build_tool_are_bound_to_plan(self):
        for key in ['trace', 'bison']:
            files = fixture(); files[INPUT_NAMES[key]] = b'changed'; refresh_manifest(files)
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'input binding'):
                verify_payload(files)

    def test_unsafe_paths_duplicates_and_links_fail(self):
        for names in [['a', 'a'], ['.'], ['a', 'a/b'], ['/outside'], ['../outside'], ['a/../outside'], ['a\\outside'], ['./a']]:
            with self.subTest(names=names), self.assertRaises(ValueError):
                read_archive(archive([(name, b'') for name in names]))
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode='w') as writer:
            entry = tarfile.TarInfo('link'); entry.type = tarfile.SYMTYPE; entry.linkname = '/outside'; writer.addfile(entry)
        with self.assertRaisesRegex(ValueError, 'type or size'):
            read_archive(stream.getvalue())

    def test_selected_sources_must_all_exist_and_respect_expansion_limit(self):
        raw = archive([('source.c', b'abc')])
        self.assertEqual(read_archive(raw, selected=['source.c']), {'source.c': b'abc'})
        with self.assertRaisesRegex(ValueError, 'selected source roster'):
            read_archive(raw, selected=['missing.c'])
        with self.assertRaisesRegex(ValueError, 'expanded archive'):
            read_archive(raw, expanded_limit=2)


if __name__ == '__main__':
    unittest.main()
