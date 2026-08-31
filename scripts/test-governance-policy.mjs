#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyGovernancePaths } from "./governance-path-policy.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(resolve(root, path), "utf8");

const protectedPaths = [
  ".github/workflows/ci.yml",
  ".github/CODEOWNERS",
  "CODEOWNERS",
  "docs/CODEOWNERS",
  "LICENSE",
  "LICENSE.md",
  "LICENSE-MIT",
  "docs/SECURITY.md",
  "docs/GOVERNANCE.md",
  "docs/governance/2026-08-31-example.md",
  "scripts/governance-path-policy.mjs",
  "scripts/test-governance-policy.mjs",
  "AGENTS.md",
  "nested/AGENTS.md",
];
const ordinaryPaths = [
  ".github/dependabot.yml",
  "README.md",
  "docs/CLOUD-EXECUTION.md",
  "scripts/example.mjs",
  "src/lib.rs",
];

for (const path of protectedPaths) {
  const result = classifyGovernancePaths([path]);
  assert.equal(result.protected, true, `${path} must be protected`);
  assert.equal(result.protected_files[0].path, path);
}
for (const path of ordinaryPaths) {
  assert.equal(classifyGovernancePaths([path]).protected, false, `${path} must be ordinary`);
}

const mixed = classifyGovernancePaths([ordinaryPaths[0], protectedPaths[0], "", "  "]);
assert.deepEqual(mixed.ordinary_files, [ordinaryPaths[0]]);
assert.deepEqual(mixed.protected_files.map(({ path }) => path), [protectedPaths[0]]);

const cli = spawnSync(
  process.execPath,
  [resolve(root, "scripts/governance-path-policy.mjs"), "--stdin"],
  { input: `${ordinaryPaths[0]}\n${protectedPaths[0]}\n`, encoding: "utf8" },
);
assert.equal(cli.status, 0, cli.stderr);
assert.equal(JSON.parse(cli.stdout).protected, true);

const [reviewWorkflow, approvalWorkflow, ciWorkflow, governance, agents] = await Promise.all([
  read(".github/workflows/cenetex-review.yml"),
  read(".github/workflows/cenetex-protected-approval.yml"),
  read(".github/workflows/ci.yml"),
  read("docs/GOVERNANCE.md"),
  read("AGENTS.md"),
]);

assert.match(reviewWorkflow, /pull_request_target:/u);
assert.doesNotMatch(reviewWorkflow, /actions\/checkout/u);
assert.match(reviewWorkflow, /EXPECTED_SHA/u);
assert.match(reviewWorkflow, /commit_id="\$EXPECTED_SHA"/u);
assert.match(reviewWorkflow, /statuses\/\$EXPECTED_SHA/u);
assert.match(reviewWorkflow, /previous_filename/u);
assert.match(reviewWorkflow, /cancel-in-progress: true/u);
assert.match(approvalWorkflow, /issue_comment:/u);
assert.match(approvalWorkflow, /\/approve-protected/u);
assert.match(approvalWorkflow, /permission.*admin/u);
assert.match(approvalWorkflow, /commit_id="\$REQUESTED_SHA"/u);
assert.match(approvalWorkflow, /previous_filename/u);
assert.doesNotMatch(approvalWorkflow, /actions\/checkout/u);
assert.match(ciWorkflow, /push:\s*\n\s*branches: \[main\]/u);
assert.match(ciWorkflow, /npm run test:governance/u);
assert.match(governance, /owner-authorized bot approval/u);
assert.match(governance, /not an independent review/u);
assert.match(governance, /append-only audit records/u);
assert.match(agents, /\/approve-protected <exact-head-sha>/u);

process.stdout.write(
  `Governance policy self-test passed (${protectedPaths.length} protected, ${ordinaryPaths.length} ordinary paths)\n`,
);
