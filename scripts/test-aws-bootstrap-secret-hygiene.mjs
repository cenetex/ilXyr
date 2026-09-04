import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const awsDirectory = new URL("./aws/", import.meta.url);
const scriptNames = (await readdir(awsDirectory))
  .filter((name) => name.endsWith(".sh") || name.endsWith(".sh.in"))
  .sort();

let tracedMetadataScripts = 0;
const xtracePattern = /^\s*set\s+(?:-[A-Za-z]*x[A-Za-z]*|-o\s+xtrace)\s*$/gm;

for (const scriptName of scriptNames) {
  const source = await readFile(new URL(scriptName, awsDirectory), "utf8");
  const traceIndexes = [...source.matchAll(xtracePattern)].map((match) => match.index);
  if (!source.includes("X-aws-ec2-metadata-token:") || traceIndexes.length === 0) {
    continue;
  }

  tracedMetadataScripts += 1;
  const tokenIndex = source.indexOf("TOKEN=$(curl");
  const unsetIndex = source.indexOf("unset TOKEN");

  assert.notEqual(tokenIndex, -1, `${scriptName} must acquire its metadata token explicitly`);
  assert.notEqual(unsetIndex, -1, `${scriptName} must clear its metadata token`);
  assert.ok(unsetIndex > tokenIndex, `${scriptName} must clear its token after metadata access`);
  assert.ok(
    traceIndexes.every((traceIndex) => traceIndex > unsetIndex),
    `${scriptName} must enable tracing only after clearing its token`,
  );
  assert.doesNotMatch(
    source.slice(unsetIndex + "unset TOKEN".length),
    /\$(?:TOKEN|\{TOKEN\})/,
    `${scriptName} must not use its metadata token after clearing it`,
  );
  assert.doesNotMatch(
    source.slice(unsetIndex + "unset TOKEN".length),
    /\$\((?:metadata|tag)\b/,
    `${scriptName} must finish metadata reads before clearing its token`,
  );
}

assert.equal(tracedMetadataScripts, 4, "every traced IMDSv2 bootstrap script must be checked");
process.stdout.write(`checked ${tracedMetadataScripts} traced IMDSv2 bootstrap scripts\n`);
