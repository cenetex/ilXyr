"""Check source separation, fixed selection, isolated work and retained failures."""

import json
from pathlib import Path
import tempfile
import unittest

import research_solomon_roster as roster
import research_solomon_confidence as confidence


class RosterTests(unittest.TestCase):
    def test_exact_body_and_ambiguous_markers(self):
        text = b"credits\r\n*** START OF THE PROJECT GUTENBERG EBOOK SAMPLE ***\r\nA\r\nB\n*** END OF THE PROJECT GUTENBERG EBOOK SAMPLE ***\r\nlicense"
        body, start, stop = roster.body_bytes(text)
        self.assertEqual(body, b"A\r\nB\n")
        self.assertEqual(text[start:stop], body)
        with self.assertRaises(ValueError):
            roster.body_bytes(text + text)
        with self.assertRaises(UnicodeDecodeError):
            roster.body_bytes(text + b"\xff")

    def test_layout_failure_and_smallest_forward_shift(self):
        body = bytearray(b"abcdefghijklmnopqrstuvwxyz " * 20)
        anchor = (len(body) - 65) // 2
        body[anchor:anchor + 50] = b" " * 50
        with self.assertRaisesRegex(ValueError, "too short"):
            roster.windows(body, count=1)
        row = roster.windows(body, count=1, max_forward_shift=1024)[0]
        self.assertGreater(row["forward_shift"], 0)
        for start in range(anchor, row["body_start"]):
            self.assertLess(len(roster.normalize(body[start:start + 64])), 32)
        self.assertEqual(bytes.fromhex(row["context_hex"]), body[row["body_start"]:row["body_start"] + 64])
        self.assertEqual(row["target"], body[row["body_start"] + 64])
        with self.assertRaises(ValueError):
            roster.windows(body, count=1, max_forward_shift=row["forward_shift"] - 1)

    def test_normalization_keeps_raw_windows_and_records_utf8_edges(self):
        self.assertEqual(roster.normalize(" Ａ\tB\nStraße ".encode()), b"a b strasse")
        body = ("aébc defgh ijklmnopqrstuvwxyz " * 200).encode()
        rows = roster.windows(body)
        self.assertEqual(len(rows), 32)
        for row in rows:
            raw = body[row["body_start"]:row["body_start"] + 64]
            self.assertEqual(bytes.fromhex(row["context_hex"]), raw)
            clean = raw.decode("utf-8", errors="ignore").encode()
            self.assertEqual(row["utf8_edge_bytes_removed"], len(raw) - len(clean))

    @staticmethod
    def document(fill, context, extra=b""):
        context = context[:64]
        assert len(context) == 64
        return {"body": fill * 2000 + context + b"!" + extra + fill * 2000,
                "windows": [{"index": 0, "context_hex": context.hex(), "target": 33,
                             "normalized_context_hex": roster.normalize(context).hex()}]}

    def shared_docs(self):
        shared = b"the repeal of the american stamp"
        a = self.document(b"a", b"alpha start " + shared + b" alpha ending words here")
        b = self.document(b"b", b"other unique paragraph with distinct words and a separate ending here", shared)
        return {"a": a, "b": b}

    def test_shared_phrase_is_retained_in_one_document_group(self):
        docs = self.shared_docs()
        old = roster.overlap(docs, {"train": b"unrelated memory"})
        self.assertEqual(old["status"], "failed")
        new = roster.overlap(docs, {"train": b"unrelated memory"}, True)
        self.assertEqual(new["status"], "passed")
        self.assertEqual(new["document_groups"], [["a", "b"]])
        self.assertTrue(new["cross_document_shared_phrases"])

    def test_training_overlap_and_whole_context_still_fail(self):
        docs = self.shared_docs()
        training = b"the repeal of the american stamp"
        checked = roster.overlap(docs, {"train": training}, True)
        self.assertEqual(checked["status"], "failed")
        self.assertTrue(any(f["reference"] == "train" for f in checked["failures"]))
        docs["b"]["body"] += bytes.fromhex(docs["a"]["windows"][0]["context_hex"])
        checked = roster.overlap(docs, {}, True)
        self.assertTrue(any(f["kind"] == "whole_normalized_context_overlap" for f in checked["failures"]))

    def test_duplicate_documents_and_sampling_detect_reuse(self):
        docs = self.shared_docs()
        docs["b"]["body"] = docs["a"]["body"]
        checked = roster.overlap(docs, {}, True)
        kinds = {f["kind"] for f in checked["failures"]}
        self.assertIn("document_duplicate_or_containment", kinds)
        self.assertIn("sampled_document_overlap", kinds)
        self.assertIn("exact_context_target_overlap", kinds)


class WorkerTests(unittest.TestCase):
    def test_schedule_charges_every_arm_separately_and_balances_order(self):
        docs = [f"d{i}" for i in range(12)]
        jobs = confidence.process_schedule(docs)
        self.assertEqual(len(jobs), 300)
        for doc in docs:
            for arm in confidence.ARMS:
                selected = [j for j in jobs if j["document"] == doc and j["arm"] == arm]
                self.assertEqual(sorted(j["pass"] for j in selected), list(range(5)))
                self.assertEqual(sorted(j["index"] % 5 for j in selected), list(range(5)))
        with self.assertRaises(ValueError):
            confidence.process_schedule(docs[:-1] + docs[:1])

    def test_fixed_probabilities_and_independent_count_check(self):
        point = confidence.fixed_mass("point_mass", 9)
        self.assertEqual(point[9], 32767)
        self.assertEqual(sum(point), 32767)
        smooth = confidence.fixed_mass("smoothed_point_mass", 9)
        self.assertEqual((smooth[9], smooth[0], smooth[255], sum(smooth)), (29491, 13, 12, 32767))
        context = b"?" * 63 + b"x"
        # The longest available suffix is x; its continuations are A, A and B.
        vector = [0] * 256
        vector[65], vector[66] = 2, 1
        rows = [{"predicted": 65, "masses": vector}]
        confidence.verify_vectors("suffix_empirical", rows, context, b"xAxAxB")
        rows[0]["masses"][66] = 2
        with self.assertRaisesRegex(ValueError, "count probability"):
            confidence.verify_vectors("suffix_empirical", rows, context, b"xAxAxB")

    def test_probability_rows_reject_missing_reordered_and_invalid_values(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "rows.tsv"
            vector = [0] * 256
            vector[7] = 32767
            line = "0\t7\t" + ",".join(map(str, vector)) + "\n"
            header = "index\tpredicted\tmasses\n"
            path.write_text(header + line)
            self.assertEqual(confidence.read_vectors(path, 1)[0]["predicted"], 7)
            for malformed in [header, header + line + line, header + line.replace("0\t7", "1\t7"),
                              header + line.replace("32767", "-1"), header + line.replace("32767", "nan"),
                              header + line.replace("0\t7", "0\t8")]:
                path.write_text(malformed)
                with self.assertRaises(ValueError):
                    confidence.read_vectors(path, 1)

    def test_failed_smoke_retained_and_output_directory_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            out = root / "failed"
            with self.assertRaises(FileNotFoundError):
                confidence.smoke(root / "missing", out)
            record = (out / "ATTEMPT.json").read_bytes()
            self.assertEqual(json.loads(record)["status"], "failed")
            self.assertEqual(json.loads(record)["fresh_model_calls"], 0)
            with self.assertRaises(FileExistsError):
                confidence.smoke(root / "missing", out)
            self.assertEqual((out / "ATTEMPT.json").read_bytes(), record)

    def test_prepared_tamper_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            content = b"fixed contexts"
            (root / "contexts.bin").write_bytes(content)
            bindings = {"contexts.bin": {"bytes": len(content), "sha256": confidence.sha(content)}}
            confidence.save(root / "BINDINGS.json", bindings)
            confidence.save(root / "PREPARE-ATTEMPT.json", {"status": "complete", "bindings_sha256": confidence.sha((root / "BINDINGS.json").read_bytes())})
            (root / "contexts.bin").write_bytes(b"altered inputs")
            with self.assertRaisesRegex(ValueError, "prepared bytes"):
                confidence.check_prepared(root)


if __name__ == "__main__":
    unittest.main()
