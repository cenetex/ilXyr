"""Small checks for capacity, exact window boundaries, and input roles."""
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

import zero4_window_data as w
import check_zero4_window_roster as independent


class WindowTests(unittest.TestCase):
    def test_capacity_preserves_failed_blake_quota(self):
        old = json.loads((w.RECORD / 'PLAN.json').read_text())
        new = json.loads((w.RECORD / 'PLAN-v2.json').read_text())
        self.assertGreater((old['endpoint_windows']['blake'] + old['replay_windows']['blake']) * 513, 65811)
        self.assertLessEqual((new['endpoint_windows']['blake'] + new['replay_windows']['blake']) * 513, 65811)
        self.assertEqual(old['endpoint_windows'], new['endpoint_windows'])
        self.assertEqual(old['seed'], new['seed'])

    def test_header_bytes_and_window_boundaries(self):
        rows = [[1, 255, 256], [257, 65535, 0]]
        data = w.pack(rows, 2, 'text', 'replay')
        self.assertEqual(data[:24], b'Z4WIND1\0' + struct.pack('<4I', 2, 2, 0, 1))
        self.assertEqual(data[24:], b'\x01\0\xff\0\0\x01\x01\x01\xff\xff\0\0')
        self.assertEqual([list(row) for row in w.unpack(data, 2, 'text', True)], rows)

    def test_endpoint_is_rejected_for_training(self):
        data = w.pack([[97] * 17], 16, 'foundation', 'endpoint')
        with self.assertRaisesRegex(ValueError, 'endpoint pack used for training'):
            w.unpack(data, 16, 'foundation', True)

    def test_truncated_and_extra_payloads_are_rejected(self):
        data = w.pack([[97] * 17], 16, 'text', 'endpoint')
        for malformed in [data[:12], data[:-1], data + b'0']:
            with self.assertRaises(ValueError):
                w.unpack(malformed, 16, 'text')
        for context, kind in [(32, 'text'), (16, 'channel')]:
            with self.assertRaises(ValueError):
                w.unpack(data, context, kind)

    def test_channel_target_span_includes_its_end_marker(self):
        self.assertEqual(w.targets([1, 81, 6, 97, 98, 4, 5], True), 3)
        self.assertEqual(w.targets([1, 81, 6, 97, 98], True), 2)
        self.assertEqual(w.targets([1, 81, 97, 4, 5], True), 0)
        self.assertEqual(w.targets([65] * 513, False), 512)

    def test_text_overlap_crosses_case_and_control_tokens(self):
        text = [65] * 64
        self.assertTrue(w.parts(text) & w.parts([1, 2, 3] + [97] * 64 + [4]))
        self.assertEqual(w.render([65, 1, 10, 32, 66]), 'a b')

    def test_fnv_uses_little_endian_token_bytes(self):
        value = 1469598103934665603
        for byte in b'\x01\x00\x00\x01':
            value = ((value ^ byte) * 1099511628211) % (1 << 64)
        self.assertEqual(w.fnv([1, 256]), format(value, '016x'))

    def test_independent_origin_check_rejects_changed_boundaries_and_roles(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            record = root / 'experiments/research-step-42'
            record.mkdir(parents=True)
            prior_record = root / 'experiments/research-step-41'
            prior_record.mkdir()
            prior_record.joinpath('PLAN.json').write_text(json.dumps({'task': {'counts': {'train': 1, 'validation': 1}}}))
            data, windows = root / 'prepared', root / 'windows'
            data.mkdir(); windows.mkdir()
            names = ['zero-foundation', 'shakespeare', 'blake', 'crowley', 'bible-kjv', 'literary-dialogue']
            inputs, ranges, rows, raw = {}, {}, [], {}
            for name in names:
                text = ''.join(w.prior.sha(f'{name}:{i}') for i in range(64))
                raw[name] = w.token_bytes(list(text.encode()))
                inputs['old/corpus/' + name + '.tok'] = raw[name]
                ranges[name + '.tok'] = {'sampled_starts': [3000], 'validation_start': 3000}
            inputs['RETENTION.json'] = json.dumps({'q26_default_sampler_union': ranges}).encode()
            inputs['fresh/task/quantity-request.tok'] = w.token_bytes([1, 65, 6, 66, 4, 5] * 2)
            for name, payload in inputs.items():
                file = data / name; file.parent.mkdir(parents=True, exist_ok=True); file.write_bytes(payload)
            metadata = {'files': {name: {'sha256': w.prior.sha(payload)} for name, payload in inputs.items()}}
            data.joinpath('MANIFEST.json').write_text(json.dumps(metadata))
            record.joinpath('PLAN-v2.json').write_text(json.dumps({'source_order': names,
                'input_preparation_manifest_sha256': w.digest(data / 'MANIFEST.json'),
                'endpoint_windows': dict.fromkeys(names, 1), 'replay_windows': dict.fromkeys(names, 1)}))
            for role, start in [('endpoint', 0), ('replay', 1000)]:
                (windows / role).mkdir()
                for name in names:
                    kind = 'foundation' if name == names[0] else 'channel' if name == names[-1] else 'text'
                    payload = raw[name][start * 2:(start + 513) * 2]
                    tokens = struct.unpack('<513H', payload)
                    (windows / role / (name + '.z4w')).write_bytes(w.pack([tokens], 512, kind, role))
                    rows.append({'source': name, 'role': role, 'start': start, 'end': start + 513, 'tokens_sha256': w.prior.sha(payload)})
            w.prior.write_rows(windows / 'ROSTER.jsonl', rows)
            windows.joinpath('MANIFEST.json').write_text('{}')
            with patch.object(independent, '__file__', str(root / 'scripts/checker.py')):
                self.assertEqual(independent.check(data, windows)['origin_windows_checked'], 12)
                saved = dict(rows[0])
                rows[0].update(start=3000, end=3513, tokens_sha256=w.prior.sha(raw[names[0]][6000:7026]))
                w.prior.write_rows(windows / 'ROSTER.jsonl', rows)
                with self.assertRaisesRegex(ValueError, 'old validation partition'):
                    independent.check(data, windows)
                rows[0] = saved
                w.prior.write_rows(windows / 'ROSTER.jsonl', rows)
                file = windows / 'replay/zero-foundation.z4w'
                changed = bytearray(file.read_bytes()); struct.pack_into('<I', changed, 20, 2); file.write_bytes(changed)
                with self.assertRaisesRegex(ValueError, 'pack differs'):
                    independent.check(data, windows)


if __name__ == '__main__':
    unittest.main()
