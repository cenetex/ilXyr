import { createHash } from "node:crypto";

const [txId, gatewayArg] = process.argv.slice(2);
if (!/^[A-Za-z0-9_-]{43}$/.test(txId || "")) throw new Error("Usage: verify-bundle ARWEAVE_TX_ID [GATEWAY]");
const gateway = (gatewayArg || "https://arweave.net").replace(/\/$/, "");
const response = await fetch(`${gateway}/${txId}`);
if (!response.ok) throw new Error(`Could not retrieve publication manifest: ${response.status}`);
const manifest = await response.json();
if (!Array.isArray(manifest.files)) throw new Error("Publication manifest does not contain a files array");

let failed = 0;
for (const file of manifest.files) {
  const fileResponse = await fetch(`${gateway}/${txId}/${file.path.split("/").map(encodeURIComponent).join("/")}`);
  if (!fileResponse.ok) {
    failed += 1;
    process.stdout.write(`missing  ${file.path}\n`);
    continue;
  }
  const bytes = Buffer.from(await fileResponse.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  const valid = digest === file.sha256 && bytes.length === file.bytes;
  if (!valid) failed += 1;
  process.stdout.write(`${valid ? "verified" : "mismatch"} ${file.path}\n`);
}
if (failed) {
  process.stderr.write(`${failed} file(s) failed verification\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`verified ${manifest.files.length} files for ${manifest.experiment_id}\n`);
}
