import { copyFileSync, cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scripts = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).scripts;
const base = scripts["verify:schemas:base"];
const baseCommands = base.split(" && ");

// The Phase 1 package script also invokes two checks already in the base chain.
// Run its two new self-tests here so required CI executes each check once.
const additional = [
  {
    script: "test:feral-source-selector",
    command: "npm run test:feral-source-selector",
    evidence: "BRAID source request fixture and selector control",
    binding: "experiments/feral-source-selector/fixture",
  },
  {
    script: "test:weight-multiplicity-frontier",
    command: "npm run test:weight-multiplicity-frontier",
    evidence: "weight phase 0 coordinate and seed replay",
    binding: "experiments/weight-multiplicity/phase0",
  },
  {
    script: "test:weight-multiplicity-phase06",
    command: "npm run test:weight-multiplicity-phase06",
    evidence: "weight phase 0.6 package and oracle controls",
    binding: "experiments/weight-multiplicity/phase05/phase06-lie-preflight-closeout-v1.json",
  },
  {
    script: "test:weight-multiplicity-phase1-corpus",
    command: "node scripts/prepare-weight-multiplicity-phase1-root-systems.mjs --self-test && node scripts/run-weight-multiplicity-phase1-corpus.mjs --self-test",
    evidence: "weight phase 1 root systems and corpus policy",
    binding: "experiments/research-step-12/RESOURCE-POLICY.json",
  },
  {
    script: "test:weight-multiplicity-evidence",
    command: "npm run test:weight-multiplicity-evidence",
    evidence: "sealed weight phase 0 result and erratum",
    binding: "experiments/weight-multiplicity/phase0",
  },
  {
    script: "test:weight-multiplicity-phase05-evidence",
    command: "npm run test:weight-multiplicity-phase05-evidence",
    evidence: "sealed weight phase 0.5 and 0.6 records",
    binding: "experiments/weight-multiplicity/phase05",
  },
];

const separateWorkflows = new Map([
  ["test:pages", ".github/workflows/pages.yml"],
  ["test:aws-bootstrap-secret-hygiene", ".github/workflows/ci.yml"],
]);
const orchestrators = new Set(["test:schemas", "test:evidence:fast"]);
const directTestBindings = new Map([
  ["scripts/test_weight_cloud.py", ".github/workflows/weight-cloud-host.yml"],
  ["scripts/test-research-constraints.mjs", "scripts/constraint-diff.mjs"],
]);

function inventory(scriptMap) {
  const entries = [];
  for (const [name, command] of Object.entries(scriptMap)) {
    if (!name.startsWith("test:") || orchestrators.has(name)) continue;
    const supplemental = additional.find((item) => item.script === name);
    const workflow = separateWorkflows.get(name);
    const inBase =
      baseCommands.some((item) => item === `npm run ${name}`) ||
      command.split(" && ").every((item) => baseCommands.includes(item));
    const classes = [Boolean(supplemental), Boolean(workflow), inBase].filter(Boolean);
    if (classes.length !== 1) {
      throw new Error(`test script ${name} has ${classes.length} coverage classifications`);
    }
    if (workflow && !readFileSync(resolve(root, workflow), "utf8").includes(`npm run ${name}`)) {
      throw new Error(`test script ${name} is absent from ${workflow}`);
    }
    entries.push({
      script: name,
      class: supplemental ? "required_fast_addition" : workflow ? "separate_workflow" : "required_base",
      command,
      evidence: supplemental?.evidence ?? name.slice(5),
      binding: supplemental?.binding ?? "source and result bindings checked by the named command",
      workflow: workflow ?? ".github/workflows/ci.yml",
    });
  }
  return entries;
}

const entries = inventory(scripts);
function testFiles() {
  const found = [];
  function walk(directory) {
    for (const item of readdirSync(resolve(root, directory), { withFileTypes: true })) {
      const path = `${directory}/${item.name}`;
      if (item.isDirectory()) walk(path);
      else if (/^test[-_].*\.(?:mjs|js|py)$/.test(item.name)) found.push(path);
    }
  }
  walk("scripts");
  return found;
}

function checkTestFiles(files) {
  const commands = Object.values(scripts).join(" ");
  for (const path of files) {
    if (commands.includes(path)) continue;
    const binding = directTestBindings.get(path);
    if (!binding || !readFileSync(resolve(root, binding), "utf8").includes(path.split("/").at(-1))) {
      throw new Error(`test file ${path} has no checked command or documented workflow`);
    }
  }
}
const files = testFiles();
checkTestFiles(files);

function selfTest() {
  try {
    inventory({ ...scripts, "test:unclassified-evidence": "node missing-check.mjs" });
    throw new Error("unclassified test script escaped coverage validation");
  } catch (error) {
    if (!String(error.message).includes("0 coverage classifications")) throw error;
  }
  try {
    checkTestFiles([...files, "scripts/test_future_evidence.py"]);
    throw new Error("unclassified test file escaped coverage validation");
  } catch (error) {
    if (!String(error.message).includes("has no checked command")) throw error;
  }

  const fixture = mkdtempSync(resolve(tmpdir(), "ilxyr-evidence-ci-"));
  try {
    const evidence = "experiments/weight-multiplicity/phase0";
    const plans = "examples/weight-multiplicity";
    cpSync(resolve(root, evidence), resolve(fixture, evidence), { recursive: true });
    mkdirSync(resolve(fixture, plans), { recursive: true });
    for (const name of ["phase0-frontier-plan.json", "phase0-frontier-plan-v2.json"]) {
      copyFileSync(resolve(root, plans, name), resolve(fixture, plans, name));
    }
    const checker = resolve(root, "scripts/check-weight-multiplicity-phase0-evidence.mjs");
    const verify = () => spawnSync(process.execPath, [checker, "--root", fixture], {
      cwd: root,
      encoding: "utf8",
    });
    if (verify().status !== 0) throw new Error("intact sealed evidence fixture did not verify");
    const erratum = resolve(fixture, evidence, "phase0-v2-memory-observability-erratum-v1.json");
    writeFileSync(erratum, `${readFileSync(erratum, "utf8")} `);
    const altered = verify();
    if (altered.status === 0 || !altered.stderr.includes("erratum seal mismatch")) {
      throw new Error("altered sealed evidence escaped the verifier");
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
  console.log("Evidence inventory and altered-seal regressions passed.");
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}
if (process.argv.includes("--check")) {
  console.log(JSON.stringify({ inventory: entries, test_files: files }, null, 2));
  process.exit(0);
}

selfTest();

const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
if (head.status !== 0) throw new Error("source commit is unavailable");
const worktree = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], {
  cwd: root,
  encoding: "utf8",
});
if (worktree.status !== 0) throw new Error("source worktree status is unavailable");
const commands = [
  ...baseCommands.map((command) => ({ command, evidence: command, binding: "see command" })),
  ...additional,
];
const results = [];
let failed = false;
for (const item of commands) {
  if (failed) {
    results.push({ evidence: item.evidence, command: item.command, status: "not_checked" });
    continue;
  }
  const child = spawnSync(item.command, { cwd: root, shell: true, stdio: "inherit" });
  const status = child.status === 0 ? "pass" : "fail";
  results.push({ evidence: item.evidence, command: item.command, binding: item.binding, status });
  failed = status === "fail";
}
console.log(JSON.stringify({
  source_head: head.stdout.trim(),
  source_dirty: Boolean(worktree.stdout.trim()),
  checks: results,
  separate_workflow_checks: entries
    .filter((entry) => entry.class === "separate_workflow")
    .map((entry) => ({ script: entry.script, workflow: entry.workflow, status: "not_checked" })),
}));
if (failed) process.exitCode = 1;
