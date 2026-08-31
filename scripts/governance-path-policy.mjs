#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const rules = [
  ["workflow", (path) => path.startsWith(".github/workflows/")],
  ["codeowners", (path) => ["CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS"].includes(path)],
  ["license", (path) => /^LICENSE(?:[.-].*)?$/u.test(path)],
  ["security-policy", (path) => path === "docs/SECURITY.md"],
  ["governance-policy", (path) => path === "docs/GOVERNANCE.md"],
  ["governance-audit", (path) => path.startsWith("docs/governance/")],
  ["governance-policy-code", (path) => [
    "scripts/governance-path-policy.mjs",
    "scripts/test-governance-policy.mjs",
  ].includes(path)],
  ["agent-instructions", (path) => /(?:^|\/)AGENTS\.md$/u.test(path)],
];

export const classifyGovernancePaths = (paths) => {
  const protectedFiles = [];
  const ordinaryFiles = [];

  for (const rawPath of paths) {
    const path = rawPath.trim();
    if (!path) continue;
    const matchedRules = rules.filter(([, matches]) => matches(path)).map(([name]) => name);
    if (matchedRules.length > 0) protectedFiles.push({ path, rules: matchedRules });
    else ordinaryFiles.push(path);
  }

  return {
    protected: protectedFiles.length > 0,
    protected_files: protectedFiles,
    ordinary_files: ordinaryFiles,
  };
};

const main = async () => {
  if (process.argv.slice(2).join(" ") !== "--stdin") {
    throw new Error("usage: governance-path-policy.mjs --stdin");
  }
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  process.stdout.write(`${JSON.stringify(classifyGovernancePaths(input.split(/\r?\n/u)))}\n`);
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
