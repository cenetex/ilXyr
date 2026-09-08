import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const [bundle, output, mode] = process.argv.slice(2);
assert.ok(bundle && output && ['smoke', 'run'].includes(mode));
const plan = JSON.parse(readFileSync(resolve(bundle, 'EXECUTION-PLAN.json')));
const sha = data => createHash('sha256').update(data).digest('hex');
const save = (name, value) => writeFileSync(resolve(output, name), JSON.stringify(value, null, 2) + '\n');
mkdirSync(output, { recursive: true });
const source = resolve(output, 'source');
const started = Date.now();
const deadline = started + (mode === 'smoke' ? 300 : 3240) * 1000;
let phase = 'identity';
const processes = [];

function run(label, executable, args, limit) {
  const stdout = openSync(resolve(output, label + '.stdout.log'), 'wx');
  const stderr = openSync(resolve(output, label + '.stderr.log'), 'wx');
  const began = Date.now();
  let result;
  try {
    const remaining = Math.min(limit, deadline - began);
    assert.ok(remaining > 0, 'runtime deadline reached');
    result = spawnSync(executable, args, { cwd: source, stdio: ['ignore', stdout, stderr],
      timeout: remaining, killSignal: 'SIGKILL', env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' } });
  } finally { closeSync(stdout); closeSync(stderr); }
  const record = { label, executable, args, exit_code: result.status, signal: result.signal,
    error: result.error ? String(result.error) : null, elapsed_ms: Date.now() - began };
  processes.push(record); save('processes.json', processes);
  assert.equal(result.status, 0, `${label}: ${record.error ?? result.signal ?? result.status}`);
}

try {
  assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64');
  assert.equal(process.versions.node, plan.node_version);
  cpSync(resolve(bundle, 'source'), source, { recursive: true, errorOnExist: true, force: false });
  const identity = JSON.parse(readFileSync(resolve(source, 'SOURCE-IDENTITY.json')));
  assert.equal(identity.source_commit, plan.source_commit);
  const verify = () => {
    for (const [name, expected] of Object.entries(identity.files)) {
      const path = resolve(source, name);
      assert.ok(path.startsWith(source + '/'));
      assert.equal(sha(readFileSync(path)), expected, name);
    }
  };
  verify();
  const compiler = spawnSync(plan.compiler, ['-dumpfullversion', '-dumpversion'], { encoding: 'utf8' });
  assert.equal(compiler.status, 0); assert.equal(compiler.stdout.trim(), plan.compiler_version);
  save('runtime.json', { node: process.version, compiler_version: compiler.stdout.trim(),
    compiler_sha256: sha(readFileSync(plan.compiler)), compiler_flags: plan.compiler_flags,
    runtime_image: plan.runtime_image, plan_sha256: sha(readFileSync(resolve(bundle, 'EXECUTION-PLAN.json'))),
    mode, timing_evidence: mode === 'run' });
  phase = 'build';
  run('build', 'make', ['-f', 'Makefile.reasoner55-matched', 'reasoner55-matched-build',
    'CC=' + plan.compiler, 'CFLAGS=' + plan.compiler_flags], 180000);
  save('executables.json', Object.fromEntries(['plain', 'fast'].map(kind => [kind,
    sha(readFileSync(resolve(source, 'build/reasoner55_matched_' + kind)))])));
  mkdirSync(resolve(output, 'executables'));
  for (const kind of ['plain', 'fast']) cpSync(resolve(source, 'build/reasoner55_matched_' + kind),
    resolve(output, 'executables/reasoner55_matched_' + kind));
  phase = 'smoke';
  run('smoke', process.execPath, ['scripts/check_reasoner55_matched.mjs'], 180000);
  cpSync(resolve(source, 'build/reasoner55-matched-smoke.json'), resolve(output, 'smoke.json'));
  verify();
  if (mode === 'run') {
    phase = 'study';
    run('study', process.execPath, ['scripts/run_reasoner55_matched.mjs', '--run', resolve(output, 'study')],
      plan.limits.workload_seconds * 1000);
    verify();
  }
  save('terminal.json', { status: 'complete', phase, mode, elapsed_ms: Date.now() - started });
} catch (error) {
  save('terminal.json', { status: 'failed', phase, mode, error: String(error), elapsed_ms: Date.now() - started });
  process.exitCode = 1;
}
