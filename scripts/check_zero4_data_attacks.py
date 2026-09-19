"""Alter saved data and its file hashes; require the selection replay to reject it."""
import argparse
import json
import os
from pathlib import Path
import shutil
import tempfile

import zero4_fresh_data as z


def replace(path, value):
    # Test copies share unchanged files. Replace each edited inode first.
    path.unlink()
    path.write_text(value)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepared', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=False)
    pristine = z.digest(args.prepared / 'MANIFEST.json')
    cases = []
    for name in ['removed_rejection', 'invented_rejection', 'altered_rank', 'altered_gold', 'altered_old_task', 'altered_binding']:
        with tempfile.TemporaryDirectory(prefix='zero4-data-attack-') as temporary:
            root = Path(temporary) / 'prepared'
            shutil.copytree(args.prepared, root, copy_function=os.link)
            if name in ['removed_rejection', 'invented_rejection', 'altered_rank']:
                file = root / 'fresh/task/decisions.jsonl'
                rows = z.jsonl(file)
                if name == 'removed_rejection':
                    index = next(i for i, row in enumerate(rows) if row['decision'] != 'accept')
                    del rows[index]
                elif name == 'invented_rejection':
                    rows.append({**rows[-1], 'decision': 'prior_key', 'attempt': 65535})
                else:
                    rows[0]['rank'] = '0' * 64
                replace(file, ''.join(z.packed(row) + '\n' for row in rows))
            elif name == 'altered_gold':
                file = root / 'fresh/task/all.tsv'
                lines = file.read_text().splitlines()
                row = lines[1].split('\t')
                row[6] = 'result 1234567'
                lines[1] = '\t'.join(row)
                replace(file, '\n'.join(lines) + '\n')
            elif name == 'altered_old_task':
                file = root / 'old/q26/quantity-request.jsonl'
                rows = z.jsonl(file)
                rows[0]['request'] = 'quantity.add 0 0'
                replace(file, ''.join(z.packed(row) + '\n' for row in rows))
            manifest_file = root / 'MANIFEST.json'
            manifest = json.loads(manifest_file.read_text())
            manifest['files'] = z.files(root)
            del manifest['files']['MANIFEST.json']
            if name == 'altered_binding':
                manifest['inputs_sha256'] = '0' * 64
            replace(manifest_file, json.dumps(manifest, indent=2, sort_keys=True) + '\n')
            try:
                z.check(root)
            except ValueError as error:
                result = {'case': name, 'status': 'rejected', 'reason': str(error),
                          'altered_manifest_sha256': z.digest(manifest_file)}
            else:
                result = {'case': name, 'status': 'accepted', 'altered_manifest_sha256': z.digest(manifest_file)}
            cases.append(result)
            z.save(args.out / 'RESULT.json', {'schema': 'ilxyr.zero4_data_failure_checks.v1',
                                            'original_manifest_sha256': pristine, 'cases': cases})
            z.require(result['status'] == 'rejected', 'altered data accepted: ' + name)
    z.require(z.digest(args.prepared / 'MANIFEST.json') == pristine, 'original manifest changed')
    z.check(args.prepared)
    print(json.dumps(cases, indent=2))


if __name__ == '__main__':
    main()
