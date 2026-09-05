#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appendVerdicts, encode, generateConstraintDiff, verifyLedgerBindings } from "./lib/research-constraints.mjs";

export { generateConstraintDiff } from "./lib/research-constraints.mjs";

export async function main(argv) {
  const args = { append: [] };
  const options = { "--ledger": "ledger", "--experiment-id": "experimentId", "--tags": "tags",
    "--output": "output", "--change": "change", "--append-verdict": "append" };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--self-test") args.selfTest = true;
    else if (name === "--verify") args.verify = true;
    else {
      assert(options[name], `unknown option: ${name}`);
      const value = argv[++index];
      assert(value && !value.startsWith("--"), `${name} needs a value`);
      if (name === "--append-verdict") args.append.push(value);
      else {
        assert(!(options[name] in args), `duplicate option: ${name}`);
        args[options[name]] = value;
      }
    }
  }
  if (args.selfTest) {
    assert.equal(argv.length, 1, "self-test takes no other options");
    await import("./test-research-constraints.mjs");
    return;
  }
  assert(args.ledger, "--ledger is required");
  const ledger = JSON.parse(readFileSync(args.ledger));
  const bindings = verifyLedgerBindings(ledger);
  if (args.verify) {
    assert(!args.output && !args.experimentId && !args.tags && !args.change && !args.append.length, "verify takes only a ledger");
    console.log(encode({ entries: bindings.length, bindings }).trim());
    return;
  }
  if (args.append.length) {
    assert(args.output && !args.experimentId && !args.tags && !args.change, "append needs an output and verdict paths");
    const next = appendVerdicts(ledger, args.append.map((path) => ({ bytes: readFileSync(path) })));
    verifyLedgerBindings(next);
    writeFileSync(args.output, encode(next), { flag: "wx" });
    console.log(`Appended ${args.append.length} verdicts to ${args.output}`);
    return;
  }
  assert(args.experimentId && args.tags, "--experiment-id and --tags are required");
  const report = generateConstraintDiff(ledger, args.experimentId, args.tags.split(","), { proposedChange: args.change });
  if (args.output) writeFileSync(args.output, encode(report), { flag: "wx" });
  else console.log(encode(report).trim());
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
