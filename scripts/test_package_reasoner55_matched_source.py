import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

from package_reasoner55_matched_source import SMOKE, REPORT, package_sources, sha


class SourcePackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.git("init", "-q")
        (self.repo / "model.hex").write_bytes(b"fixed model bytes\n")
        (self.repo / REPORT).parent.mkdir(parents=True)
        (self.repo / REPORT).write_text("synthetic package fixture\n")
        self.smoke = {"schema": "zero.reasoner55_matched_smoke.v1", "timing_evidence": False,
                      "source_bindings": {"model.hex": sha(b"fixed model bytes\n")}}
        self.revision = self.commit()

    def tearDown(self):
        self.temp.cleanup()

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.repo), *args], stderr=subprocess.PIPE)

    def commit(self):
        (self.repo / SMOKE).write_text(json.dumps(self.smoke) + "\n")
        self.git("add", ".")
        self.git("-c", "user.name=Package test", "-c", "user.email=package-test@example.invalid",
                 "commit", "-qm", "fixture")
        return self.git("rev-parse", "HEAD").decode().strip()

    def test_reproduces_committed_bytes_with_dirty_checkout(self):
        first, second = self.root / "a.tar", self.root / "b.tar"
        package_sources(self.repo, self.revision, first)
        (self.repo / "model.hex").write_bytes(b"later local edit\n")
        package_sources(self.repo, self.revision, second)
        self.assertEqual(first.read_bytes(), second.read_bytes())
        with tarfile.open(fileobj=io.BytesIO(second.read_bytes())) as archive:
            self.assertEqual(archive.extractfile("model.hex").read(), b"fixed model bytes\n")
            identity = json.load(archive.extractfile("SOURCE-IDENTITY.json"))
            self.assertEqual(identity["source_commit"], self.revision)
            for path, digest in identity["files"].items():
                self.assertEqual(sha(archive.extractfile(path).read()), digest)
        with self.assertRaises(FileExistsError):
            package_sources(self.repo, self.revision, second)

    def test_rejects_changed_binding_and_non_commit_ref(self):
        output = self.root / "bad.tar"
        self.smoke["source_bindings"]["model.hex"] = "0" * 64
        changed = self.commit()
        with self.assertRaisesRegex(ValueError, "digest differs"):
            package_sources(self.repo, changed, output)
        self.assertFalse(output.exists())
        with self.assertRaisesRegex(ValueError, "full source commit"):
            package_sources(self.repo, "HEAD", output)

    def test_rejects_archive_escape(self):
        self.smoke["source_bindings"]["../outside"] = "0" * 64
        changed = self.commit()
        with self.assertRaisesRegex(ValueError, "stay in the archive"):
            package_sources(self.repo, changed, self.root / "bad.tar")


if __name__ == "__main__":
    unittest.main()
