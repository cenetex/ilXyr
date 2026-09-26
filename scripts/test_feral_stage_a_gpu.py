import unittest
import io
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

import feral_stage_a_gpu as gpu


class GpuPackageTest(unittest.TestCase):
    def test_source_archive_stays_small_and_bound(self):
        raw = gpu.verify_local_package()
        self.assertLess(len(raw), 8 * 1024 * 1024)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with tarfile.open(fileobj=io.BytesIO(raw)) as source:
                source.extractall(root, filter="data")
            worker = root / "scripts/feral_stage_a_model.py"
            result = subprocess.run([sys.executable, str(worker), "--help"],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("--smoke-only", result.stdout)

    def test_user_data_and_instance_limits(self):
        binding = {"run_id": "feral-stage-a-20260926T000000Z", "source_sha256": "a" * 64,
                   "host_package_sha256": "a" * 64, "source_version": "v1",
                   "launch_epoch_seconds": 1}
        data = gpu.render(binding)
        self.assertLess(len(data), 16 * 1024)
        self.assertIn(b"systemd-run --unit=feral-stage-a-deadline", data)
        self.assertLess(data.index(b"trap 'shutdown -h now' EXIT"),
                        data.index(b"systemd-run --unit=feral-stage-a-deadline"))
        self.assertIn(b"--network none", data)
        request = gpu.launch_request(data, binding, {"subnet_id": "subnet-6d16a437",
                                                     "security_group_id": "sg-02b40b678ab46e5f4"})
        self.assertTrue(request["DryRun"])
        self.assertEqual(request["InstanceType"], "g6e.2xlarge")
        self.assertEqual(request["BlockDeviceMappings"][0]["Ebs"]["VolumeSize"], 150)
        self.assertTrue(request["BlockDeviceMappings"][0]["Ebs"]["DeleteOnTermination"])
        self.assertEqual(request["InstanceInitiatedShutdownBehavior"], "terminate")

    def test_launch_binding_rejects_shell_text(self):
        binding = {"run_id": "x; touch /tmp/oops", "source_sha256": "a" * 64,
                   "source_version": "v1", "launch_epoch_seconds": 1}
        with self.assertRaises(ValueError):
            gpu.render(binding)


if __name__ == "__main__":
    unittest.main()
