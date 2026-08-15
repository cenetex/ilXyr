import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { validateIndex, validateSuccessor } from "./index-lib.mjs";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { previous: { type: "string" } },
});
if (positionals.length !== 1) throw new Error("Usage: validate-index index.json [--previous prior-index.json]");

const index = JSON.parse(await readFile(positionals[0], "utf8"));
let errors = validateIndex(index);
if (values.previous) {
  const previous = JSON.parse(await readFile(values.previous, "utf8"));
  errors = [...errors, ...validateSuccessor(previous, index)];
}
if (errors.length) {
  process.stderr.write(`${errors.map((error) => `- ${error}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`valid ${index.schema} sequence ${index.sequence} (${index.experiments.length} experiments)\n`);
}
