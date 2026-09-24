import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { validateIndex, validateSuccessor } from "./index-lib.mjs";
import { bindLocalPrevious, fetchPreviousIndex } from "./previous-index.mjs";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { previous: { type: "string" }, "previous-tx": { type: "string" }, gateway: { type: "string" } },
});
if (positionals.length !== 1) throw new Error("Usage: validate-index index.json [--previous-tx TX_ID] [--previous prior-index.json] [--gateway URL]");

const index = JSON.parse(await readFile(positionals[0], "utf8"));
let errors = validateIndex(index);
if (values.previous && !values["previous-tx"]) throw new Error("--previous requires --previous-tx");
if (index.sequence > 1 && !values["previous-tx"]) throw new Error("A successor requires --previous-tx");
if (values["previous-tx"]) {
  const fetched = await fetchPreviousIndex(values["previous-tx"], values.gateway);
  const previous = bindLocalPrevious(fetched, values.previous ? await readFile(values.previous) : undefined);
  errors = [...errors, ...validateSuccessor(previous, index, values["previous-tx"])];
}
if (errors.length) {
  process.stderr.write(`${errors.map((error) => `- ${error}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`valid ${index.schema} sequence ${index.sequence} (${index.experiments.length} experiments)\n`);
}
