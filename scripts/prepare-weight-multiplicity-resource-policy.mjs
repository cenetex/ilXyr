import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createResourcePolicy } from "./lib/weight-multiplicity-resource-policy.mjs";

const [output, ...extra] = process.argv.slice(2);
if (!output || extra.length) throw new Error("usage: node scripts/prepare-weight-multiplicity-resource-policy.mjs NEW_POLICY.json");
const policy = await createResourcePolicy(fileURLToPath(new URL("..", import.meta.url)));
await writeFile(resolve(output), `${JSON.stringify(policy, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ status: policy.status, output: resolve(output), oracle_processes_started: 0 }));
