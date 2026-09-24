#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const programPath = join(root, "docs/program-registry.html");
const homePath = join(root, "docs/index.html");
const snapshotPath = join(root, "docs/public-snapshot-v1.json");
const startSection = '<section class="slide program-slide" id="program">';
const endSection = '<section class="slide closing-slide" id="start">';

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function label(value) {
  return escapeHtml(value.replaceAll("_", " "));
}

function status(experiment) {
  if (experiment.disclosure_state === "withheld") return "Decision withheld";
  if (experiment.execution_state === "blocked") return "Built · execution blocked";
  if (experiment.scientific_outcome === "unknown") return label(experiment.lifecycle_state);
  return label(experiment.scientific_outcome);
}

export function renderProgramPage(snapshot) {
  const lines = snapshot.model_lines;
  const active = lines.find((line) => line.state === "active_research");
  const promoted = lines.find((line) => line.promotion_state === "promoted");
  const modelCards = lines.map((line) => `
        <article class="card"><span class="tag">${label(line.state)} · ${label(line.promotion_state)}</span>
          <h3>${escapeHtml(line.title)}</h3><p>${escapeHtml(line.summary)}</p></article>`).join("");
  const rows = snapshot.experiments.map((item) => `
            <tr><th scope="row">${escapeHtml(item.title)}</th><td>${status(item)}</td>
              <td>${label(item.execution_state)}</td><td>${label(item.disclosure_state)}</td>
              <td>${label(item.lifecycle_state)}</td><td>${label(item.evidence_maturity)}</td>
              <td>${label(item.local_import_state)}</td></tr>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="The dated ilXyr lab program registry and its source-bound experiment decisions.">
  <title>ilXyr — Lab program registry</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header><nav class="shell" aria-label="Primary navigation"><a class="brand" href="index.html">ilXyr / lab notebook</a>
    <div class="nav-links"><a href="program-registry.html">Program registry</a>
      <a href="experiments/exp-006.html">EXP-006</a><a href="experiments/exp-007.html">EXP-007</a>
      <a href="https://github.com/cenetex/ilXyr/blob/main/docs/PROGRAM.md">Program source</a>
      <a href="https://github.com/cenetex/ilXyr">Repository</a></div></nav></header>
  <main class="shell">
    <div class="hero"><div class="eyebrow">Lab program registry · source date ${escapeHtml(snapshot.source.as_of)}</div>
      <h1>The dated lab program.</h1>
      <p class="lede">This page shows the model lines and decisions in the public registry snapshot.</p>
      <p>Snapshot built ${escapeHtml(snapshot.source.generated_at)} · freshness ${label(snapshot.freshness)}.</p>
      <p><a href="lab-registry.json">Read the source registry →</a> ·
        <a href="public-snapshot-v1.json">Read the public snapshot →</a></p></div>
    <div class="status-row" aria-label="Program status">
      <div class="status"><span class="label">Promoted model</span><strong>${escapeHtml(promoted?.title || "Unknown")}</strong></div>
      <div class="status"><span class="label">Active research</span><strong>${escapeHtml(active?.title || "Unknown")}</strong></div>
      <div class="status"><span class="label">Registry as of</span><strong>${escapeHtml(snapshot.source.as_of)}</strong></div></div>
    <section><div class="eyebrow">Model lines</div><h2>Each line keeps its state.</h2><div class="grid">${modelCards}
      </div></section>
    <section><div class="eyebrow">Experiment decisions</div><h2>Scientific outcomes and work states stay separate.</h2>
      <div class="table-wrap"><table class="metrics"><thead><tr><th>Experiment</th><th>Decision</th>
        <th>Execution</th><th>Disclosure</th><th>Lifecycle</th><th>Evidence</th><th>Local import</th></tr></thead>
        <tbody>${rows}
        </tbody></table></div></section>
    <section><div class="panel"><h2>Checks and source</h2>
      <p>The public snapshot shows publisher, file, and ledger check states for each decision.
        Read each source record for its evidence and limits.</p>
      <p>Source commit <code>${escapeHtml(snapshot.source.registry_commit)}</code> · SHA-256
        <code>${escapeHtml(snapshot.source.registry_sha256)}</code>.</p>
      <p>Historical experiment pages remain available: <a href="experiments/exp-006.html">EXP-006</a>,
        <a href="experiments/exp-007.html">EXP-007</a>, and <a href="experiments/exp-008.html">EXP-008</a>.</p></div></section>
  </main>
  <footer><div class="shell">ilXyr lab registry · source date ${escapeHtml(snapshot.source.as_of)} · built ${escapeHtml(snapshot.source.generated_at)}</div></footer>
</body>
</html>
`;
}

export function renderHomePage(current, snapshot) {
  const start = current.indexOf(startSection);
  const end = current.indexOf(endSection, start);
  if (start < 0 || end < 0 || end <= start) throw new Error("Home page snapshot section markers are missing");
  const modelLinks = snapshot.model_lines.map((line) => `
        <a href="program-registry.html"><span>${label(line.state)}</span><strong>${escapeHtml(line.title)}</strong>
          <em>${label(line.promotion_state)} ↗</em></a>`).join("");
  const recent = snapshot.experiments.slice(-3).map((item) => `
        <a href="program-registry.html"><span>${escapeHtml(item.title)}</span><strong>${status(item)}</strong></a>`).join("");
  const sections = `${startSection}
      <div class="slide-number">06 / 08</div>
      <div class="program-heading"><div><p class="eyebrow">The dated program</p>
        <h2>Build small models<br>with clear claims.</h2></div>
        <p>Registry as of ${escapeHtml(snapshot.source.as_of)}. Snapshot built ${escapeHtml(snapshot.source.generated_at.slice(0, 10))}.</p></div>
      <div class="program-table">${modelLinks}
      </div>
    </section>

    <section class="slide boundary-slide" id="boundary">
      <div class="slide-number">07 / 08</div>
      <p class="eyebrow">Registry decisions · source date ${escapeHtml(snapshot.source.as_of)}</p>
      <h2>See the stage<br>of each listed decision.</h2>
      <div class="boundary-list">${recent}
      </div>
    </section>

    `;
  return `${current.slice(0, start)}${sections}${current.slice(end)}`;
}

async function main() {
  const check = process.argv.includes("--check");
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  if (snapshot.schema !== "ilxyr.public_snapshot.v1") throw new Error("Unsupported public snapshot");
  const home = await readFile(homePath, "utf8");
  const program = renderProgramPage(snapshot);
  const renderedHome = renderHomePage(home, snapshot);
  if (check) {
    if (await readFile(programPath, "utf8") !== program || home !== renderedHome) {
      throw new Error("GitHub Pages claims are stale; render the public snapshot");
    }
    console.log("GitHub Pages claims match the public snapshot.");
  } else {
    await Promise.all([writeFile(programPath, program), writeFile(homePath, renderedHome)]);
    console.log("Rendered GitHub Pages claims from the public snapshot.");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
