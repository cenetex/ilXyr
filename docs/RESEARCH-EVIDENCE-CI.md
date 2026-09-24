# Fast research evidence checks

Required CI runs `npm run test:schemas`, which calls `test:evidence:fast`. The
runner keeps the prior schema/research chain intact, adds the five previously
omitted offline weight checks, and reports each command as `pass`, `fail`, or
`not_checked` with the exact source commit. It reports worktree edits locally.
`node scripts/run-evidence-fast.mjs --check` prints the live script inventory;
`--self-test` proves an unclassified new test is rejected and a changed sealed
erratum fails its real evidence verifier. A new root `test:*` script must be
placed in the required chain, the fast additions, or a verified separate
workflow. The runner stops on the first failure and marks later checks
`not_checked`.

The inventory also scans `scripts/test_*.py`, `scripts/test-*.mjs`, and their
JavaScript equivalents. It accounts for the direct weight host test in
`.github/workflows/weight-cloud-host.yml` and the constraint test imported by
`scripts/constraint-diff.mjs`. A newly added test file needs a checked command
or an explicit workflow binding.

The inventory currently has 48 checks in the prior required chain, five new
fast additions, and two checks in separate workflow paths. The separate
checks are Pages publication validation and AWS bootstrap secret hygiene.
The fast suite needs Node 22, Python 3, the checked-in npm dependencies, and
the local shell tools used by the existing host fixtures. It uses checked-in
fixtures and creates no cloud resource. The FERAL host fixture needs access to
`/dev/fd`; a restricted local sandbox can block that shell feature.

| Evidence set | Bound source and result material | Required checks |
| --- | --- | --- |
| Protocol and registry | `schemas/`, `docs/lab-registry.json`, `docs/research-pathways.json`, fixed fixtures | Existing schema, registry, import, and research-profile commands |
| Reasoner | `experiments/research-step-*` source packages, rosters, results, and launch bindings | Existing source, cost, roster, study, cloud, and replay commands |
| FERAL | Fixed target, calculator, comparison, coverage, and host packages under `experiments/research-step-*` | Existing target, calculator, comparison, bootstrap, coverage, and cloud commands |
| Solomon | Fixed suffix, document, study, cloud, and result records under `experiments/research-step-*` | Existing suffix, ownership, fresh confidence, study, and cloud commands |
| ZERO.4 | Fixed data windows, controller, host package, and result records under `experiments/research-step-*` | Existing fresh-data, windows, study, endpoint, and cloud commands |
| Weight phase 0 | `experiments/weight-multiplicity/phase0/`, including compressed runs, summaries, plan digests, and sealed erratum | Frontier self-test and sealed evidence checker added here; existing resource checks remain |
| Weight phase 0.5/0.6 | `experiments/weight-multiplicity/phase05/`, including cold replay, session frontiers, corrective audit, and phase 0.6 preflight | Phase 0.6 self-tests and sealed evidence checker added here; existing phase 0.5 and cloud self-tests remain |
| Weight phase 1 | `experiments/research-step-12/RESOURCE-POLICY.json`, source plans, query rules, and corpus controls | Root-system and corpus self-tests added here; existing resource and batch checks run once |

These checks verify the named checked-in sources and result bytes at the tested
commit. Private model bytes, external cloud objects, provider billing, paid
measurements, and independently retained public ledger anchors are separate
evidence states. Their status is `not_checked` by this suite. Full workload
commands under `run:*` and `prepare:*` remain outside the fast command
inventory; cloud execution follows `docs/CLOUD-EXECUTION.md`.
