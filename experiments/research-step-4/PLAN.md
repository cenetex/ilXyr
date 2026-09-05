# Research step 4: identify the useful mechanism

Date: 2026-09-05

This is an audit of existing public evidence at Zero revision
`9e147326c9cd1e6dcc26591ff5d73e16bff9e17e`.

For Reasoner 5.5, compare the learned task guide with the lexical guide,
the guide with its prior feature removed, and source-free search. Pair all
four settings within each family. Use the geometric mean of `(checks + 1)`
ratios and recorded CPU ratios. Preserve each cell and all 128 family
comparisons. Bind the recorded result and timing hashes. Include the later
5.8 and 5.9a development failures when selecting the next comparison.

For ZERO.4, audit the three Q2.6 optimizer traces. Count projected and
unprojected trials, accepted updates, backtracking, and rejected attempts.
Compare these counts with each result's guard diagnostics. Report how much
of each update the projection removes, using the recorded per-trial values.
Preserve the distinction between direction changes and direct replay checks.

Use these findings to specify the next controls. Reasoner should run each
semantic and source-removal control through the same optimized search path.
ZERO.4 should compare a frozen reference, task-only continuation, ordinary
replay, and replay with projection and direct checks on a fresh task. Count
all computation and rejected updates. Keep the existing results fixed.
