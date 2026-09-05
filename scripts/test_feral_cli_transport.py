"""Check the real AWS CLI request against an unsigned local HTTP fixture."""

import base64
import http.server
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import unittest
import urllib.parse

from feral_cloud_package import launch_request


class CliTransportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.aws = shutil.which('aws')
        if cls.aws is None:
            raise RuntimeError('Install the AWS CLI to run the transport check')

    def test_cli_preserves_script_bytes_in_both_binary_modes(self):
        script = b'#!/bin/bash\nprintf "transport fixture\\n"\n'
        binding = {'run_id': 'feral-finqa-20260905T000000Z',
                   'host_package_sha256': 'a' * 64}
        request = launch_request(script, binding,
                                 {'subnet_id': 'subnet-abc', 'security_group_id': 'sg-abc'})
        observed = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_POST(self):
                raw = self.rfile.read(int(self.headers['Content-Length']))
                observed.append(urllib.parse.parse_qs(raw.decode()))
                body = (b'<Response><Errors><Error><Code>DryRunOperation</Code>'
                        b'<Message>local fixture</Message></Error></Errors>'
                        b'<RequestID>fixture</RequestID></Response>')
                self.send_response(400)
                self.send_header('Content-Type', 'text/xml')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'config'
            config.write_text('')
            env = {key: value for key, value in os.environ.items()
                   if not key.startswith('AWS_')}
            env.update(AWS_CONFIG_FILE=str(config), AWS_SHARED_CREDENTIALS_FILE=str(config),
                       AWS_EC2_METADATA_DISABLED='true', AWS_MAX_ATTEMPTS='1')
            server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                for mode in ['base64', 'raw-in-base64-out']:
                    with self.subTest(mode=mode):
                        observed.clear()
                        result = subprocess.run([
                            self.aws, 'ec2', 'run-instances', '--cli-input-json', json.dumps(request),
                            '--cli-binary-format', mode, '--region', 'us-east-1',
                            '--endpoint-url', 'http://127.0.0.1:' + str(server.server_port),
                            '--no-sign-request', '--no-cli-pager', '--no-cli-auto-prompt',
                            '--cli-connect-timeout', '2', '--cli-read-timeout', '2'],
                            env=env, capture_output=True, text=True, timeout=15)
                        self.assertNotEqual(result.returncode, 0)
                        self.assertIn('DryRunOperation', result.stderr)
                        self.assertEqual(len(observed), 1)
                        fields = observed[0]
                        self.assertEqual(fields['Action'], ['RunInstances'])
                        self.assertEqual(fields['DryRun'], ['true'])
                        self.assertEqual(fields['ClientToken'], [binding['run_id']])
                        self.assertEqual(base64.b64decode(fields['UserData'][0], validate=True), script)
            finally:
                server.shutdown()
                server.server_close()
                thread.join()


if __name__ == '__main__':
    unittest.main()
