# Research step 3: preserve the cost of failed oracle calls

Date: 2026-09-05

Implement exact cumulative p99 accounting for the proposed weight-multiplicity
resource clause. Keep the frozen 50 ms final p99, 30,000 ms hard timeout,
2,430,387 calls, 8,474,852 ms query time, and 2,119 second wall limit.

The component records every completed attempt, including errors and values
outside the corpus range. It retains the first resource failure and the top
fifty queries. Group summaries cover type, representation, depth, multiplicity
bit length, label range, and status. Early cumulative p99 is a progress value;
the distribution gate uses the complete call set.

Use synthetic boundary tests and an independent sorted reference for exact
percentiles. If the original 26,624-call calibration trace is available,
verify its pinned hash and check its recorded p99, tail membership, and range
counts. This rechecks existing measurements. It leaves execution authorization
with the later frozen package and cost decision.

The component and trace check are the next weight-multiplicity delivery.
Controller integration will then cover scheduling, complete attempt records,
worker timeouts, memory checks, and artifact sealing before a launch package.
