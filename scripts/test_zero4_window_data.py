"""Small checks for capacity, exact window boundaries, and input roles."""
import json
from pathlib import Path
import struct
import tempfile
import unittest

import zero4_window_data as w


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


if __name__ == '__main__':
    unittest.main()
