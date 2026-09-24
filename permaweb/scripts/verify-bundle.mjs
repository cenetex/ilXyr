import { checkFileResponse, MAX_MANIFEST_BYTES, publicationUrl, readBounded, validateManifest, validTxId } from "../src/publication.ts";
import { fileURLToPath } from "node:url";

export async function verifyBundle(txId, gateway = "https://arweave.net", fetcher = fetch) {
  if (!validTxId(txId)) throw new Error("Invalid publication transaction ID");
  const response = await fetcher(publicationUrl(gateway, txId));
  if (!response.ok) throw new Error(`Could not retrieve publication manifest: ${response.status}`);
  const manifest = validateManifest(JSON.parse(new TextDecoder().decode(await readBounded(response, MAX_MANIFEST_BYTES))));
  const files = [];
  for (const file of manifest.files) {
    try {
      const result = await checkFileResponse(await fetcher(publicationUrl(gateway, txId, file.path)), file);
      files.push({ path: file.path, status: result.reason });
    } catch (error) {
      files.push({ path: file.path, status: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { manifest, files, failed: files.filter((file) => file.status !== "verified").length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [txId, gateway] = process.argv.slice(2);
  if (!validTxId(txId)) throw new Error("Usage: verify-bundle ARWEAVE_TX_ID [GATEWAY]");
  const result = await verifyBundle(txId, gateway);
  for (const file of result.files) process.stdout.write(`${file.status} ${file.path}${file.error ? ": " + file.error : ""}\n`);
  if (result.failed) {
    process.stderr.write(`${result.failed} file(s) failed verification\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`verified ${result.files.length} files for ${result.manifest.experiment_id}\n`);
  }
}
