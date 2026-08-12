import { getDatabase } from "../../../db";

type Actor = { id: string; name: string };

type ProposalRow = {
  id: string;
  owner_id: string;
  owner_name: string;
  status: string;
  title: string;
  summary: string;
  hypothesis: string;
  family: string;
  baseline: string;
  dataset_refs: string;
  primary_metric: string;
  success_threshold: number;
  seeds: string;
  compute_credits: number;
  evidence_level: string;
  export_policy: string;
  novelty: string;
  created_at: string;
  updated_at: string;
  blocking_reviews: number;
  review_count: number;
  committed_credits: number;
  forecast_count: number;
  average_forecast: number | null;
};

const proposalSelect = `
  SELECT p.*,
    (SELECT COUNT(*) FROM reviews r
      WHERE r.proposal_id = p.id AND r.severity = 'blocking' AND r.resolved = 0
    ) AS blocking_reviews,
    (SELECT COUNT(*) FROM reviews r WHERE r.proposal_id = p.id) AS review_count,
    COALESCE((SELECT SUM(f.compute_credits) FROM funding_commitments f
      WHERE f.proposal_id = p.id), 0) AS committed_credits,
    (SELECT COUNT(*) FROM forecasts fc WHERE fc.proposal_id = p.id) AS forecast_count,
    (SELECT AVG(fc.success_probability) FROM forecasts fc
      WHERE fc.proposal_id = p.id) AS average_forecast
  FROM proposals p`;

function actorFromRequest(request: Request): Actor | null {
  const userId = request.headers.get("oai-authenticated-user-id");
  const email = request.headers.get("oai-authenticated-user-email");
  if (userId && email) return { id: `human://${userId}`, name: email };

  const hostname = new URL(request.url).hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return { id: "human://local-researcher", name: "Local researcher" };
  }
  return null;
}

function parseJsonArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readiness(row: ProposalRow) {
  const checks = [
    { label: "Falsifiable hypothesis", pass: row.hypothesis.trim().length >= 24 },
    { label: "Frozen baseline", pass: row.baseline.includes("://") },
    { label: "Dataset binding", pass: parseJsonArray(row.dataset_refs).length > 0 },
    { label: "Decidable outcome", pass: row.primary_metric.trim().length > 0 },
    { label: "Seeds declared", pass: parseJsonArray(row.seeds).length > 0 },
    { label: "Compute ceiling", pass: row.compute_credits > 0 },
    { label: "Evidence authority", pass: row.evidence_level.trim().length > 0 },
    { label: "Blocking feedback resolved", pass: row.blocking_reviews === 0 },
  ];
  const score = Math.round((checks.filter((check) => check.pass).length / checks.length) * 100);
  return { checks, score, promotable: score === 100 && row.status !== "blocked" };
}

function serializeProposal(row: ProposalRow) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    status: row.status,
    title: row.title,
    summary: row.summary,
    hypothesis: row.hypothesis,
    family: row.family,
    baseline: row.baseline,
    datasets: parseJsonArray<string>(row.dataset_refs),
    primaryMetric: row.primary_metric,
    successThreshold: row.success_threshold,
    seeds: parseJsonArray<number>(row.seeds),
    computeCredits: row.compute_credits,
    evidenceLevel: row.evidence_level,
    exportPolicy: row.export_policy,
    novelty: row.novelty,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    blockingReviews: row.blocking_reviews,
    reviewCount: row.review_count,
    committedCredits: row.committed_credits,
    forecastCount: row.forecast_count,
    averageForecast: row.average_forecast,
    readiness: readiness(row),
  };
}

async function getProposal(db: D1Database, id: string) {
  return db.prepare(`${proposalSelect} WHERE p.id = ?`).bind(id).first<ProposalRow>();
}

function stringValue(value: unknown, max = 2000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function intValue(value: unknown, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}

export async function GET(request: Request) {
  try {
    const db = await getDatabase();
    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (id) {
      const row = await getProposal(db, id);
      if (!row) return Response.json({ error: "Proposal not found" }, { status: 404 });

      const reviews = await db
        .prepare(
          `SELECT id, proposal_id, reviewer_id, reviewer_name, category, severity,
            comment, resolved, created_at
           FROM reviews WHERE proposal_id = ? ORDER BY created_at DESC, id DESC`,
        )
        .bind(id)
        .all();
      return Response.json({ proposal: serializeProposal(row), reviews: reviews.results });
    }

    const rows = await db
      .prepare(
        `${proposalSelect}
         ORDER BY CASE p.status
           WHEN 'candidate' THEN 0 WHEN 'review' THEN 1 WHEN 'blocked' THEN 2 ELSE 3 END,
           p.updated_at DESC`,
      )
      .all<ProposalRow>();

    return Response.json({ proposals: rows.results.map(serializeProposal) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load proposals";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const actor = actorFromRequest(request);
    if (!actor) {
      return Response.json({ error: "Sign in to make changes." }, { status: 401 });
    }

    const payload = (await request.json()) as Record<string, unknown>;
    const action = stringValue(payload.action, 40) || "create";
    const db = await getDatabase();

    if (action === "create") {
      const title = stringValue(payload.title, 120);
      const summary = stringValue(payload.summary, 500);
      const hypothesis = stringValue(payload.hypothesis, 700);
      const family = stringValue(payload.family, 20);
      const baseline = stringValue(payload.baseline, 240);
      const dataset = stringValue(payload.dataset, 240);
      const primaryMetric = stringValue(payload.primaryMetric, 160);
      const successThreshold = Number(payload.successThreshold);
      const computeCredits = intValue(payload.computeCredits, 1, 1_000_000);
      const evidenceLevel = stringValue(payload.evidenceLevel, 40);
      const exportPolicy = stringValue(payload.exportPolicy, 40);
      const novelty = stringValue(payload.novelty, 700);
      const seeds = stringValue(payload.seeds, 200)
        .split(",")
        .map((seed) => Number(seed.trim()))
        .filter((seed) => Number.isInteger(seed) && seed >= 0);

      if (
        !title ||
        !summary ||
        hypothesis.length < 24 ||
        !["zero", "solomon"].includes(family) ||
        !baseline.includes("://") ||
        !dataset.includes("://") ||
        !primaryMetric ||
        !Number.isFinite(successThreshold) ||
        !computeCredits ||
        !evidenceLevel ||
        !exportPolicy ||
        !novelty ||
        seeds.length === 0
      ) {
        return Response.json(
          { error: "Complete every contract field before submitting." },
          { status: 400 },
        );
      }

      const id = `PROP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      await db
        .prepare(
          `INSERT INTO proposals (
            id, owner_id, owner_name, status, title, summary, hypothesis, family,
            baseline, dataset_refs, primary_metric, success_threshold, seeds,
            compute_credits, evidence_level, export_policy, novelty
          ) VALUES (?, ?, ?, 'review', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          actor.id,
          actor.name,
          title,
          summary,
          hypothesis,
          family,
          baseline,
          JSON.stringify([dataset]),
          primaryMetric,
          successThreshold,
          JSON.stringify([...new Set(seeds)]),
          computeCredits,
          evidenceLevel,
          exportPolicy,
          novelty,
        )
        .run();

      const row = await getProposal(db, id);
      return Response.json({ proposal: serializeProposal(row!) }, { status: 201 });
    }

    const proposalId = stringValue(payload.proposalId, 80);
    const row = proposalId ? await getProposal(db, proposalId) : null;
    if (!row) return Response.json({ error: "Proposal not found" }, { status: 404 });

    if (action === "review") {
      const category = stringValue(payload.category, 40);
      const severity = stringValue(payload.severity, 20);
      const comment = stringValue(payload.comment, 1200);
      if (!category || !["advisory", "blocking", "endorsement"].includes(severity) || !comment) {
        return Response.json({ error: "Choose a review type and add feedback." }, { status: 400 });
      }
      await db
        .prepare(
          `INSERT INTO reviews
            (proposal_id, reviewer_id, reviewer_name, category, severity, comment)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(proposalId, actor.id, actor.name, category, severity, comment)
        .run();
    } else if (action === "resolve") {
      const reviewId = intValue(payload.reviewId, 1, 2_147_483_647);
      if (!reviewId || (actor.id !== row.owner_id && actor.id !== "human://local-researcher")) {
        return Response.json({ error: "Only the proposal owner can resolve feedback." }, { status: 403 });
      }
      await db
        .prepare("UPDATE reviews SET resolved = 1 WHERE id = ? AND proposal_id = ?")
        .bind(reviewId, proposalId)
        .run();
    } else if (action === "promote") {
      const current = serializeProposal(row);
      if (actor.id !== row.owner_id && actor.id !== "human://local-researcher") {
        return Response.json({ error: "Only the proposal owner can request candidacy." }, { status: 403 });
      }
      if (!current.readiness.promotable) {
        return Response.json({ error: "Resolve every readiness check first." }, { status: 409 });
      }
      await db
        .prepare("UPDATE proposals SET status = 'candidate', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(proposalId)
        .run();
    } else if (action === "fund") {
      if (row.status !== "candidate") {
        return Response.json({ error: "Only frozen candidates can receive commitments." }, { status: 409 });
      }
      const credits = intValue(payload.computeCredits, 1, 1_000_000);
      const rationale = stringValue(payload.rationale, 500);
      if (!credits || !rationale) {
        return Response.json({ error: "Add a credit amount and rationale." }, { status: 400 });
      }
      await db
        .prepare(
          `INSERT INTO funding_commitments
            (proposal_id, funder_id, funder_name, compute_credits, rationale)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(proposal_id, funder_id) DO UPDATE SET
             compute_credits = excluded.compute_credits,
             rationale = excluded.rationale`,
        )
        .bind(proposalId, actor.id, actor.name, credits, rationale)
        .run();
    } else if (action === "forecast") {
      if (row.status !== "candidate") {
        return Response.json({ error: "Forecasting opens after candidacy." }, { status: 409 });
      }
      const probability = Number(payload.probability);
      const stake = intValue(payload.stake, 1, 10_000);
      const rationale = stringValue(payload.rationale, 700);
      if (!Number.isFinite(probability) || probability < 0 || probability > 1 || !stake || !rationale) {
        return Response.json({ error: "Add a 0–100% probability, stake, and rationale." }, { status: 400 });
      }
      await db
        .prepare(
          `INSERT INTO forecasts
            (proposal_id, forecaster_id, forecaster_name, success_probability, stake, rationale)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(proposal_id, forecaster_id) DO UPDATE SET
             success_probability = excluded.success_probability,
             stake = excluded.stake,
             rationale = excluded.rationale`,
        )
        .bind(proposalId, actor.id, actor.name, probability, stake, rationale)
        .run();
    } else {
      return Response.json({ error: "Unknown proposal action" }, { status: 400 });
    }

    const updated = await getProposal(db, proposalId);
    return Response.json({ proposal: serializeProposal(updated!) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update proposal";
    return Response.json({ error: message }, { status: 500 });
  }
}
