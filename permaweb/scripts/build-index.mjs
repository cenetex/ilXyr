import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { buildIndex } from "./index-lib.mjs";

const { values } = parseArgs({
  options: {
    entries: { type: "string", short: "e" },
    out: { type: "string", short: "o", default: "ilxyr-index.json" },
    sequence: { type: "string", short: "s" },
    previous: { type: "string", default: "" },
    publisher: { type: "string", short: "p" },
    "ledger-head": { type: "string", default: "" },
    "generated-at": { type: "string", default: new Date().toISOString() },
  },
});

if (!values.entries || !values.sequence || !values.publisher) {
  throw new Error("Usage: build-index --entries entries.json --sequence N --publisher WALLET [--previous TX] [--ledger-head REF] [--out FILE]");
}

const experiments = JSON.parse(await readFile(values.entries, "utf8"));
if (!Array.isArray(experiments)) throw new Error("entries input must be a JSON array");
const result = buildIndex({
  sequence: Number(values.sequence),
  previousIndexTx: values.previous || null,
  ledgerHead: values["ledger-head"],
  publisher: values.publisher,
  generatedAt: values["generated-at"],
  experiments,
});
await writeFile(values.out, `${JSON.stringify(result.index, null, 2)}\n`);
process.stdout.write(`${values.out}\nsha256:${result.sha256}\n`);
