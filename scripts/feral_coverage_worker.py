"""Run one fixed calculator on a bounded input file and retain complete output lines."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys


def require(ok, message):
    if not ok:
        raise ValueError(message)


def run(inputs, expected_sha, arm, pass_index, output, byte_limit):
    require(arm in ['calculator_v1', 'calculator_v2', 'v2_operand_only'], 'control arm differs')
    require(type(pass_index) is int and 0 <= pass_index < 12, 'pass index differs')
    require(type(byte_limit) is int and 0 < byte_limit <= 64 * 1024 * 1024, 'output ceiling differs')
    require(inputs.stat().st_size <= 2 * 1024 * 1024, 'input byte ceiling exceeded')
    raw = inputs.read_bytes()
    require(hashlib.sha256(raw).hexdigest() == expected_sha, 'input identity differs')
    rows = [json.loads(line) for line in raw.splitlines()]
    require(0 < len(rows) <= 228, 'case count differs')
    ids = []
    for row in rows:
        require(set(row) == {'schema', 'id', 'question', 'retrieved_evidence'}, 'predictor input has extra fields')
        require(row['schema'] == 'ilxyr.feral_fresh_input.v1', 'input schema differs')
        require(isinstance(row['id'], str) and 0 < len(row['id']) <= 80, 'case identity differs')
        ids.append(row['id'])
    require(ids == sorted(set(ids)), 'case order or uniqueness differs')
    # The worker directory contains these two fixed controls and the input file.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    if arm == 'calculator_v1':
        from feral_evidence_calculator import predict
    else:
        from feral_evidence_calculator_v2 import predict
    written = 0
    with output.open('x', buffering=1) as stream:
        for row in rows:
            result = predict(row['question'], row['retrieved_evidence'], 'operand_only' if arm == 'v2_operand_only' else 'calculator')
            record = {'id': row['id'], 'arm': arm, 'pass': pass_index, 'result': result}
            line = json.dumps(record, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n'
            written += len(line.encode())
            require(written <= byte_limit, 'prediction byte ceiling exceeded')
            stream.write(line)
        stream.flush()
        os.fsync(stream.fileno())
    return {'status': 'complete', 'arm': arm, 'pass': pass_index, 'cases': len(rows),
            'input_sha256': expected_sha, 'output_sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'output_bytes': written}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input', type=Path, required=True); p.add_argument('--input-sha256', required=True)
    p.add_argument('--arm', required=True); p.add_argument('--pass-index', type=int, required=True)
    p.add_argument('--output', type=Path, required=True); p.add_argument('--byte-limit', type=int, required=True)
    a = p.parse_args()
    print(json.dumps(run(a.input, a.input_sha256, a.arm, a.pass_index, a.output, a.byte_limit), sort_keys=True))
