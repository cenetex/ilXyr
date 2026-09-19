// Three fixed correctness fixtures for the frozen native oracles.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { PersistentLie } from './run-weight-multiplicity-phase1-corpus.mjs';
const [lie, zero, output] = process.argv.slice(2);
assert(lie && zero && output && process.argv.length === 5);
const fixtures = [
  {type: 'A1', highest: [1], target: [1], expected: '1'},
  {type: 'A1', highest: [2], target: [0], expected: '1'},
  {type: 'A2', highest: [1, 1], target: [0, 0], expected: '2'},
];
const worker = new PersistentLie({id: 'correctness-smoke', executable: lie,
  stdbuf: '/usr/bin/stdbuf', hardTimeoutMs: 5000});
const result = {schema: 'ilxyr.weight_oracle_correctness_smoke.v1', status: 'failed',
  scope: 'small_known_query_correctness', fixtures: [], fresh_corpus_rows: 0};
try {
  await worker.start();
  for (const fixture of fixtures) {
    const primary = await worker.query(`dom_char([${fixture.highest}],[${fixture.target}],${fixture.type})`);
    assert.equal(primary.status, 'ok');
    const child = spawnSync(zero, ['query', fixture.type, fixture.highest.join(','), fixture.target.join(',')],
      {encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024});
    assert.equal(child.status, 0, child.stderr || child.error?.message);
    const differential = String(JSON.parse(child.stdout).multiplicity);
    result.fixtures.push({...fixture, lie: primary.multiplicity, zero: differential});
    assert.equal(primary.multiplicity, fixture.expected);
    assert.equal(differential, fixture.expected);
  }
  result.status = 'pass';
} finally {
  await worker.close();
  await writeFile(output, JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
}
