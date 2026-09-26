"""Check that collected science bytes stay bound to the exact run."""
import json
from pathlib import Path
import tempfile
import unittest

from feral_stage_a_model import MODEL, REVISION
from feral_stage_a_gpu_score import score_run, verify_collection
from feral_stage_a_selector import BASE, encode, sha


class GpuScoreBindingTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.launch = {"run_id": "synthetic", "instance_id": "i-00000000",
                       "source_sha256": "a" * 64, "source_version": "synthetic",
                       "user_data_sha256": "b" * 64}
        terminal = {"run_id": "synthetic", "instance_id": "i-00000000",
                    "source_archive_sha256": "a" * 64, "user_data_sha256": "b" * 64,
                    "status": "complete", "collection_complete": True}
        (self.root / "TERMINAL.json").write_bytes(encode(terminal))
        (self.root / "smoke").mkdir()
        (self.root / "full").mkdir()
        (self.root / "smoke/RAW.jsonl").write_bytes(b'{}\n')
        (self.root / "full/RAW.jsonl").write_bytes(b'{}\n')
        (self.root / "full/PREDICTIONS.json").write_bytes(b'{}\n')
        (self.root / "smoke/RECEIPT.json").write_bytes(encode({
            "model": MODEL, "revision": REVISION, "scope": "one_form_loader_smoke",
            "rows": 1, "raw_sha256": sha(b'{}\n')}))
        (self.root / "full/RECEIPT.json").write_bytes(encode({
            "model": MODEL, "revision": REVISION, "scope": "all_36_forms",
            "rows": 36, "raw_sha256": sha(b'{}\n')}))
        self.refresh_collection()

    def refresh_collection(self):
        objects = []
        for path in sorted(self.root.rglob("*")):
            if path.is_file() and path.name != "COLLECTION.json":
                raw = path.read_bytes()
                objects.append({"path": str(path.relative_to(self.root)),
                                "bytes": len(raw), "sha256": sha(raw),
                                "version_id": "synthetic"})
        self.collection = {"run_id": "synthetic", "instance_id": "i-00000000",
                           "instance_state": "terminated", "source_archive_sha256": "a" * 64,
                           "source_package_version": "synthetic", "user_data_sha256": "b" * 64,
                           "objects": objects}
        (self.root / "COLLECTION.json").write_bytes(encode(self.collection))

    def test_omitted_raw_object_fails(self):
        self.collection["objects"] = [row for row in self.collection["objects"]
                                      if row["path"] != "full/RAW.jsonl"]
        (self.root / "COLLECTION.json").write_bytes(encode(self.collection))
        with self.assertRaisesRegex(ValueError, "scientific object roster"):
            verify_collection(BASE, self.launch, self.root)

    def test_wrong_receipt_model_fails(self):
        path = self.root / "full/RECEIPT.json"
        receipt = json.loads(path.read_bytes())
        receipt["model"] = "wrong-model"
        path.write_bytes(encode(receipt))
        self.refresh_collection()
        with self.assertRaisesRegex(ValueError, "full model result roster"):
            score_run(BASE, self.launch, self.root)


if __name__ == "__main__":
    unittest.main()
