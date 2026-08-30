import { env } from "cloudflare:workers";

let initialization: Promise<D1Database> | null = null;

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS proposals (
    id TEXT PRIMARY KEY NOT NULL,
    owner_id TEXT NOT NULL,
    owner_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'review',
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    hypothesis TEXT NOT NULL,
    family TEXT NOT NULL,
    baseline TEXT NOT NULL,
    dataset_refs TEXT NOT NULL,
    primary_metric TEXT NOT NULL,
    success_threshold REAL NOT NULL,
    seeds TEXT NOT NULL,
    compute_credits INTEGER NOT NULL,
    evidence_level TEXT NOT NULL,
    export_policy TEXT NOT NULL,
    novelty TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_proposals_status_updated
    ON proposals(status, updated_at)`,
  `CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    proposal_id TEXT NOT NULL,
    reviewer_id TEXT NOT NULL,
    reviewer_name TEXT NOT NULL,
    category TEXT NOT NULL,
    severity TEXT NOT NULL,
    comment TEXT NOT NULL,
    addressed INTEGER NOT NULL DEFAULT 0,
    response TEXT,
    resolved INTEGER NOT NULL DEFAULT 0,
    resolved_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (proposal_id) REFERENCES proposals(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_reviews_proposal_resolved
    ON reviews(proposal_id, resolved)`,
  `CREATE TABLE IF NOT EXISTS funding_commitments (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    proposal_id TEXT NOT NULL,
    funder_id TEXT NOT NULL,
    funder_name TEXT NOT NULL,
    compute_credits INTEGER NOT NULL,
    rationale TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (proposal_id) REFERENCES proposals(id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_funding_proposal_funder
    ON funding_commitments(proposal_id, funder_id)`,
  `CREATE TABLE IF NOT EXISTS forecasts (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    proposal_id TEXT NOT NULL,
    forecaster_id TEXT NOT NULL,
    forecaster_name TEXT NOT NULL,
    success_probability REAL NOT NULL,
    stake INTEGER NOT NULL,
    rationale TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (proposal_id) REFERENCES proposals(id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_forecasts_proposal_forecaster
    ON forecasts(proposal_id, forecaster_id)`,
];

const seedProposals = [
  {
    id: "PROP-Q26-FAMILY",
    ownerId: "service://ilxyr",
    ownerName: "ilXyr program",
    status: "candidate",
    title: "Q2.6 family replication",
    summary:
      "Run seeds 1 and 3 independently under the accepted replay-tangent design and require all declared seeds to pass.",
    hypothesis:
      "Replay-tangent projection preserves the Q2.6 quantity result across the frozen three-seed family contract.",
    family: "zero",
    baseline: "model://ZERO.3",
    datasets: ["dataset://zero/q22r/frozen"],
    metric: "joint quantity/replay gate",
    threshold: 1,
    seeds: [1, 3],
    credits: 240,
    evidence: "deterministic_replay",
    exportPolicy: "artifacts",
    novelty:
      "Turns the diagnostic seed-2 go into an independently risked family decision without opening the promotion set early.",
  },
  {
    id: "PROP-HRR-RECOVERY",
    ownerId: "model://lab/holo",
    ownerName: "Holo research lane",
    status: "review",
    title: "HRR attention recovery at T=1024",
    summary:
      "Test whether the recovered HRR implementation closes its quality gap at a longer sequence horizon under the same public CPU protocol.",
    hypothesis:
      "At T=1024, gated HRR attention improves validation loss per CPU-second relative to its T=512 result without losing replayability.",
    family: "zero",
    baseline: "artifact://EXP-006/softmax",
    datasets: ["dataset://enwik8/public"],
    metric: "validation bits per byte",
    threshold: 1.46,
    seeds: [17, 29, 41],
    credits: 420,
    evidence: "corpus_proxy",
    exportPolicy: "artifacts",
    novelty:
      "Separates the implementation recovery question from the scaling-horizon claim left open by EXP-006.",
  },
  {
    id: "PROP-ZERO-SOLOMON",
    ownerId: "service://ilxyr",
    ownerName: "ilXyr program",
    status: "blocked",
    title: "Zero → Solomon replication bridge",
    summary:
      "Replicate a Zero-proven quantity faculty under deterministic integer training and measure per-input agreement.",
    hypothesis:
      "A promoted Zero capability survives Solomon integer arithmetic within the frozen capability and equivalence tolerances.",
    family: "solomon",
    baseline: "model://ZERO.3",
    datasets: ["dataset://shared/q22r/pending"],
    metric: "capability + equivalence conjunction",
    threshold: 1,
    seeds: [1, 2, 3],
    credits: 640,
    evidence: "exact_check",
    exportPolicy: "metrics_only",
    novelty:
      "First cross-family replication on one shared task contract; blocked until a Zero family result and both verifier bindings exist.",
  },
];

async function initialize(): Promise<D1Database> {
  if (!env.DB) {
    throw new Error("The ilXyr proposal database is unavailable.");
  }

  await env.DB.batch(schemaStatements.map((statement) => env.DB.prepare(statement)));

  for (const proposal of seedProposals) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO proposals (
        id, owner_id, owner_name, status, title, summary, hypothesis, family,
        baseline, dataset_refs, primary_metric, success_threshold, seeds,
        compute_credits, evidence_level, export_policy, novelty
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        proposal.id,
        proposal.ownerId,
        proposal.ownerName,
        proposal.status,
        proposal.title,
        proposal.summary,
        proposal.hypothesis,
        proposal.family,
        proposal.baseline,
        JSON.stringify(proposal.datasets),
        proposal.metric,
        proposal.threshold,
        JSON.stringify(proposal.seeds),
        proposal.credits,
        proposal.evidence,
        proposal.exportPolicy,
        proposal.novelty,
      )
      .run();
  }

  await env.DB.prepare(
    `INSERT OR IGNORE INTO reviews
      (id, proposal_id, reviewer_id, reviewer_name, category, severity, comment, resolved)
     VALUES (1, ?, ?, ?, ?, ?, ?, 0)`,
  )
    .bind(
      "PROP-HRR-RECOVERY",
      "model://reviewer/method",
      "Method reviewer",
      "Methodology",
      "blocking",
      "Freeze the T=1024 wall-clock budget and the rule for selecting the public checkpoint before candidacy.",
    )
    .run();

  await env.DB.prepare("PRAGMA optimize").run();
  return env.DB;
}

export function getDatabase(): Promise<D1Database> {
  initialization ??= initialize();
  return initialization;
}
