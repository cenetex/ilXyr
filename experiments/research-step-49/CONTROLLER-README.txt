FERAL step 48 controller source kit

Verify the archive digest against KIT.json, then unpack it. FILES.json binds
every other member. Python 3 and Node.js 22 support the invented check:

python3 -B scripts/test_feral_coverage.py
python3 -B scripts/research_feral_coverage.py prepare --raw raw --out prepared
python3 -B scripts/research_feral_coverage.py opened --prepared prepared --out opened --work worker
python3 -B scripts/check_feral_coverage.py --prepared prepared --collected opened --supervisor-sha256 EXPECTED_SUPERVISOR_SHA256 --out checked

Use the SHA-256 of opened/SUPERVISOR.json for the checker argument. Each output
folder must be fresh. The opened workload uses two invented tables, 58 cases,
three arms and three passes. The full 228-case comparison needs its later
frozen cloud host package and exact package-and-budget approval.
