import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const docsRoot = path.join(root, "docs");
const errors = [];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function report(file, message) {
  errors.push(`${relative(file)}: ${message}`);
}

function validateDigests(value, file, trail = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateDigests(item, file, [...trail, index]));
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value)) {
    const childTrail = [...trail, key];
    if ((key === "sha256" || key.endsWith("_sha256")) &&
        (typeof child !== "string" || !/^[a-f0-9]{64}$/.test(child))) {
      report(file, `${childTrail.join(".")} must be a lowercase 64-character SHA-256 digest`);
    }
    validateDigests(child, file, childTrail);
  }
}

if (!fs.existsSync(docsRoot)) {
  throw new Error("docs directory does not exist");
}

const files = walk(docsRoot);
const textFiles = files.filter((file) => /\.(?:css|html|json|md|svg|txt)$/i.test(file));
const htmlFiles = files.filter((file) => file.endsWith(".html"));
const jsonFiles = files.filter((file) => file.endsWith(".json"));
let localLinkCount = 0;

const privatePathPatterns = [
  { pattern: /\/Users\//, label: "macOS user-directory path" },
  { pattern: /\/private\/(?:tmp|var)\//, label: "private runtime path" },
  { pattern: /[A-Za-z]:\\Users\\/, label: "Windows user-directory path" },
  { pattern: /shared-raw\//, label: "private raw-data path" }
];

for (const file of textFiles) {
  const contents = fs.readFileSync(file, "utf8");
  for (const { pattern, label } of privatePathPatterns) {
    if (pattern.test(contents)) report(file, `contains a ${label}`);
  }
}

for (const file of jsonFiles) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    report(file, `invalid JSON (${error.message})`);
    continue;
  }
  if (!parsed || typeof parsed.schema !== "string" || parsed.schema.length === 0) {
    report(file, "must declare a non-empty schema string");
  }
  validateDigests(parsed, file);
}

for (const file of htmlFiles) {
  const contents = fs.readFileSync(file, "utf8");
  if (!/<html\s+lang="[^"]+"/i.test(contents)) report(file, "is missing an html lang attribute");
  if (!/<title>[^<]+<\/title>/i.test(contents)) report(file, "is missing a non-empty title");
  if (!/<meta\s+name="description"\s+content="[^"]+">/i.test(contents)) {
    report(file, "is missing a non-empty meta description");
  }

  for (const match of contents.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const href = match[1];
    if (!href || href.startsWith("#") || /^(?:[a-z]+:)?\/\//i.test(href) || href.startsWith("mailto:")) {
      continue;
    }

    const cleanHref = href.split(/[?#]/, 1)[0];
    if (!cleanHref) continue;
    let target = path.resolve(path.dirname(file), cleanHref);
    if (cleanHref.endsWith(path.posix.sep)) target = path.join(target, "index.html");
    localLinkCount += 1;

    if (!target.startsWith(`${docsRoot}${path.sep}`) && target !== docsRoot) {
      report(file, `local link escapes docs: ${href}`);
    } else if (!fs.existsSync(target)) {
      report(file, `local link target does not exist: ${href}`);
    }
  }
}

const exp006Page = path.join(docsRoot, "experiments", "exp-006.html");
const exp006Evidence = path.join(docsRoot, "experiments", "exp-006-evidence.json");
if (!fs.existsSync(exp006Page)) report(exp006Page, "publication page is missing");
if (!fs.existsSync(exp006Evidence)) report(exp006Evidence, "public evidence summary is missing");
if (fs.existsSync(exp006Page) &&
    !fs.readFileSync(exp006Page, "utf8").includes('href="exp-006-evidence.json"')) {
  report(exp006Page, "must link its public evidence summary");
}

const exp007Page = path.join(docsRoot, "experiments", "exp-007.html");
const exp007Evidence = path.join(docsRoot, "experiments", "exp-007-evidence.json");
if (!fs.existsSync(exp007Page)) report(exp007Page, "publication page is missing");
if (!fs.existsSync(exp007Evidence)) report(exp007Evidence, "public evidence summary is missing");
if (fs.existsSync(exp007Page) &&
    !fs.readFileSync(exp007Page, "utf8").includes('href="exp-007-evidence.json"')) {
  report(exp007Page, "must link its public evidence summary");
}

const programPage = path.join(docsRoot, "program-registry.html");
const labRegistry = path.join(docsRoot, "lab-registry.json");
const indexPage = path.join(docsRoot, "index.html");
if (!fs.existsSync(programPage)) report(programPage, "program registry page is missing");
if (!fs.existsSync(labRegistry)) report(labRegistry, "machine-readable lab registry is missing");
if (fs.existsSync(programPage) &&
    !fs.readFileSync(programPage, "utf8").includes('href="lab-registry.json"')) {
  report(programPage, "must link the machine-readable lab registry");
}
if (fs.existsSync(indexPage)) {
  const indexContents = fs.readFileSync(indexPage, "utf8");
  for (const required of ["program-registry.html", "ZERO5 C5.1", "ZERO5 C5.2",
    "ZERO5 C6.1"]) {
    if (!indexContents.includes(required)) report(indexPage, `must surface ${required}`);
  }
}

if (errors.length > 0) {
  console.error(`GitHub Pages publication validation failed with ${errors.length} error(s):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`Validated ${htmlFiles.length} HTML pages, ${jsonFiles.length} JSON documents, and ${localLinkCount} local links for GitHub Pages.`);
