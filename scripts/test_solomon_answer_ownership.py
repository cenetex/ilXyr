"""Check the independent memory reader and native evidence rejection paths."""

from copy import deepcopy
import hashlib
import struct
import unittest
from unittest.mock import patch

import research_solomon_answer_ownership as audit


class OwnershipTests(unittest.TestCase):
    def test_longest_suffix_and_byte_ties(self):
        memory = b"abcaabdxabcaabdy"
        self.assertEqual(audit.suffix_answer(memory, b"zzabc"), (ord("a"), 3))
        self.assertEqual(audit.suffix_answer(memory, b"zzabd"), (ord("x"), 3))
        self.assertEqual(audit.suffix_answer(memory, b"qqqq"), (ord("a"), 0))
        self.assertEqual(audit.suffix_answer(b"zxzy", b"z"), (ord("x"), 1))

    def test_context_and_frequency_are_separate(self):
        memory = b"aaaaaaaaazxzy"
        self.assertEqual(audit.suffix_answer(memory, b"z"), (ord("x"), 1))
        self.assertEqual(audit.suffix_answer(memory, b"q"), (ord("a"), 0))
        with self.assertRaisesRegex(ValueError, "must contain"):
            audit.suffix_answer(b"", b"context")

    def test_each_order_has_opposite_targets(self):
        memory = b"abcdefghijklmnopqrst"
        rows = audit.probe_inputs(memory)
        self.assertEqual(len(rows), 14)
        for index, order in enumerate((*audit.ORDERS, 0)):
            left, right = rows[index * 2:index * 2 + 2]
            self.assertEqual(left["context"], right["context"])
            self.assertEqual((left["target"], right["target"]), (0, 255))
            self.assertEqual(left["suffix_order"], order)
        with self.assertRaisesRegex(ValueError, "absent padding"):
            audit.probe_inputs(memory + b"\xff")

    @staticmethod
    def model_fixture():
        memory = b"aabbccddee"
        counts = (32768, 8192, 32768, 32768, 32768, 32768, 65536, 65536, 65536, 32768)
        header = b"NSRLMT5\n" + struct.pack("<5I10Q8Q", 256, 128, 8, 256, 64, *counts, *([0] * 8))
        packed = b"NSRLSM1\0" + struct.pack("<I", len(memory)) + b"\0" * 4 + memory
        model = header + bytes(2 * counts[0]) + packed + bytes(2 * counts[1] - len(packed)) + bytes(sum(counts[2:]))
        return model, memory

    def test_memory_reader_and_bound_source(self):
        model, memory = self.model_fixture()
        with patch.object(audit, "MODEL_SHA", hashlib.sha256(model).hexdigest()):
            self.assertEqual(audit.memory_bytes(model, memory), memory)
            with self.assertRaisesRegex(ValueError, "training prefix"):
                audit.memory_bytes(model, b"changed")
            with self.assertRaisesRegex(ValueError, "candidate digest"):
                audit.memory_bytes(model[:-1], memory)

    def test_memory_length_and_marker(self):
        model, memory = self.model_fixture()
        for offset, change, message in [(65708, b"X", "marker"),
                                        (65716, struct.pack("<I", 0), "length"),
                                        (65716, struct.pack("<I", 100000), "length")]:
            modified = model[:offset] + change + model[offset + len(change):]
            with patch.object(audit, "MODEL_SHA", hashlib.sha256(modified).hexdigest()):
                with self.assertRaisesRegex(ValueError, message):
                    audit.memory_bytes(modified, memory)

    def test_rms_tail_is_counted(self):
        model, memory = self.model_fixture()
        with_rms = model + bytes(1024)
        with patch.object(audit, "MODEL_SHA", hashlib.sha256(with_rms).hexdigest()):
            self.assertEqual(audit.memory_bytes(with_rms, memory), memory)
        wrong_tail = model + bytes(1023)
        with patch.object(audit, "MODEL_SHA", hashlib.sha256(wrong_tail).hexdigest()):
            with self.assertRaisesRegex(ValueError, "byte roster"):
                audit.memory_bytes(wrong_tail, memory)

    @staticmethod
    def native_fixture():
        memory = b"abcaabdxabcaabdy"
        tokens = b"\xff" * 61 + b"abc" + b"a"
        logits = [-123] * 256
        logits[ord("a")] = 1
        row = {"start": "0", "end": "64", "target": "97", "predicted": "97", "predicted_logit_q8": "1"}
        trace = {"data": {"windows": 1, "token_count": 65},
                 "model": {"hash": "0x6ffd37de48a3121b", "seq_len": 64, "d_model": 128,
                           "heads": 8, "hidden_dim": 256, "attention_kind": "linear", "position": "nope"},
                 "evaluation": {"invalid_forward_count": 0, "mistakes": 0}}
        return tokens, [0], [row], struct.pack("<256i", *logits), trace, memory

    def test_native_row_rejection(self):
        args = self.native_fixture()
        checked = audit.check_native(*args)
        self.assertEqual(checked[0]["suffix_order"], 3)
        for field, value in [("start", "1"), ("end", "63"), ("target", "0"),
                             ("predicted", "98"), ("predicted_logit_q8", "2")]:
            altered = deepcopy(args)
            altered[2][0][field] = value
            with self.assertRaises(ValueError):
                audit.check_native(*altered)

    def test_partial_output_and_failed_forward_rejected(self):
        args = list(self.native_fixture())
        for rows, logits in [([], args[3]), (args[2], args[3][:-1]), (args[2] * 2, args[3])]:
            with self.assertRaises(ValueError):
                audit.check_native(args[0], args[1], rows, logits, args[4], args[5])
        for field, value in [("invalid_forward_count", 1), ("mistakes", 1)]:
            changed = deepcopy(args)
            changed[4]["evaluation"][field] = value
            with self.assertRaises(ValueError):
                audit.check_native(*changed)

    def test_tied_or_out_of_range_logits_rejected(self):
        args = list(self.native_fixture())
        for other_logit in (1, 32768, -32769):
            values = list(struct.unpack("<256i", args[3]))
            values[0] = other_logit
            changed = args.copy()
            changed[3] = struct.pack("<256i", *values)
            with self.assertRaises(ValueError):
                audit.check_native(*changed)

    def test_wrong_model_or_mode_rejected(self):
        for field, value in [("hash", "changed"), ("position", "learned_absolute"),
                             ("attention_kind", "base2_softmax")]:
            args = deepcopy(self.native_fixture())
            args[4]["model"][field] = value
            with self.assertRaisesRegex(ValueError, "forward mode"):
                audit.check_native(*args)


if __name__ == "__main__":
    unittest.main()
