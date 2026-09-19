import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareFrontiers } from "./prepare-weight-multiplicity-memory-audit.mjs";
import { assertOracleExecutable, controllerRevision, sha256 } from "./run-weight-multiplicity-phase05.mjs";

const limit = 2147483648;
const measurement = (rss, extras = {}) => ({
  representation: { id: "A8:small", type: "A8", representation_dimension: "10" },
  boundary: { memory_pass: rss === null ? null : rss <= limit },
  binding: {
    memory_bytes: { incremental_from_ready: rss, maximum_memo_entries: 10 },
    memo_configuration: { entry_bytes: 164 },
    ...extras,
  },
});
const frontier = (m) => ({
  oracle_executable_sha256: "a".repeat(64),
  plan_sha256: "b".repeat(64),
  measurements: [m],
});

test("a complete presized observation can move the measured boundary", () => {
  const result = compareFrontiers(frontier(measurement(limit + 1)), frontier(measurement(100)));
  assert.equal(result.summary.boundaries_moved, 1);
  assert.equal(result.summary.unknown_memory_comparisons, 0);
});

test("missing and interrupted memory observations stay unknown", () => {
  for (const m of [measurement(null), measurement(100, { hard_timeout: {} }),
    measurement(100, { oracle_error: "worker failed" })]) {
    const result = compareFrontiers(frontier(measurement(limit + 1)), frontier(m));
    assert.equal(result.cells[0].presized.rss_bytes, null);
    assert.equal(result.cells[0].memory_boundary_moved, null);
    assert.equal(result.summary.boundaries_moved, 0);
    assert.equal(result.summary.unknown_memory_comparisons, 1);
  }
});

test("comparisons require the same oracle and plan", () => {
  for (const field of ["oracle_executable_sha256", "plan_sha256"]) {
    const baseline = frontier(measurement(limit + 1));
    const changed = frontier(measurement(100));
    changed[field] = "c".repeat(64);
    assert.throws(() => compareFrontiers(baseline, changed), /matching/);
    delete baseline[field];
    delete changed[field];
    assert.throws(() => compareFrontiers(baseline, changed), /matching/);
  }
});

test("the comparison retains every selected cell", () => {
  const baseline = frontier(measurement(limit + 1));
  const partial = frontier(measurement(100));
  partial.measurements = [];
  assert.throws(() => compareFrontiers(baseline, partial), /complete frozen/);
  partial.measurements = [measurement(100), measurement(100)];
  assert.throws(() => compareFrontiers(baseline, partial), /complete frozen/);
});

test("changing executable bytes fails the frozen digest check", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ilxyr-oracle-digest-"));
  try {
    const executable = join(directory, "oracle");
    await writeFile(executable, "original oracle bytes");
    const digest = sha256("original oracle bytes");
    await assertOracleExecutable(executable, digest, "before cell");
    await writeFile(executable, "changed oracle bytes");
    await assert.rejects(assertOracleExecutable(executable, digest, "after cell"), /drifted/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("packaged execution accepts a full bound revision and rejects malformed values", () => {
  const previous = process.env.ILXYR_CONTROLLER_REVISION;
  try {
    process.env.ILXYR_CONTROLLER_REVISION = "a".repeat(40);
    assert.equal(controllerRevision(), "a".repeat(40));
    process.env.ILXYR_CONTROLLER_REVISION = "main";
    assert.throws(controllerRevision, /full Git commit/);
  } finally {
    if (previous === undefined) delete process.env.ILXYR_CONTROLLER_REVISION;
    else process.env.ILXYR_CONTROLLER_REVISION = previous;
  }
});
