import { getDatabase } from "../../../db";
import {
  canAddReview,
  canAddressReview,
  canResolveReview,
  proposalReadiness,
} from "./policy.mjs";

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
  independent_reviews: number;
  review_count: number;
  committed_credits: number;
  forecast_count: number;
};

type ReviewRow = {
  id: number;
  proposal_id: string;
  reviewer_id: string;
  reviewer_name: string;
  category: string;
  severity: string;
  comment: string;
  addressed: number;
  response: string | null;
  resolved: number;
  resolved_at: string | null;
  created_at: string;
};

const proposalSelect = `
  SELECT p.*,
    (SELECT COUNT(*) FROM reviews r
      WHERE r.proposal_id = p.id AND r.severity = 'blocking' AND r.resolved = 0
    ) AS blocking_reviews,
    (SELECT COUNT(*) FROM reviews r
      WHERE r.proposal_id = p.id AND r.reviewer_id <> p.owner_id
    ) AS independent_reviews,
    (SELECT COUNT(*) FROM reviews r WHERE r.proposal_id = p.id) AS review_count,
    COALESCE((SELECT SUM(f.compute_credits) FROM funding_commitments f
      WHERE f.proposal_id = p.id), 0) AS committed_credits,
    (SELECT COUNT(*) FROM forecasts fc WHERE fc.proposal_id = p.id) AS forecast_count
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
  return proposalReadiness({
    hypothesis: row.hypothesis,
    baseline: row.baseline,
    datasetCount: parseJsonArray(row.dataset_refs).length,
    primaryMetric: row.primary_metric,
    seedCount: parseJsonArray(row.seeds).length,
    computeCredits: row.compute_credits,
    evidenceLevel: row.evidence_level,
    independentReviews: row.independent_reviews,
    blockingReviews: row.blocking_reviews,
    status: row.status,
  });
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
    independentReviews: row.independent_reviews,
    reviewCount: row.review_count,
    committedCredits: row.committed_credits,
    forecastCount: row.forecast_count,
    readiness: readiness(row),
  };
}

function serializeReview(review: ReviewRow, proposal: ProposalRow, actor: Actor | null) {
  return {
    ...review,
    can_address:
      !review.resolved &&
      !review.addressed &&
      Boolean(actor && canAddressReview(proposal.owner_id, actor.id, proposal.status)),
    can_resolve:
      !review.resolved &&
      Boolean(actor && canResolveReview(review, actor.id, proposal.status)),
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
            comment, addressed, response, resolved, resolved_at, created_at
           FROM reviews WHERE proposal_id = ? ORDER BY created_at DESC, id DESC`,
        )
        .bind(id)
        .all<ReviewRow>();
      const actor = actorFromRequest(request);
      return Response.json({
        proposal: serializeProposal(row),
        reviews: reviews.results.map((review) => serializeReview(review, row, actor)),
      });
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
      if (!canAddReview(row.owner_id, actor.id, row.status)) {
        return Response.json(
          { error: "Proposal owners cannot review their own work, and frozen proposals are locked." },
          { status: 403 },
        );
      }
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
    } else if (action === "address") {
      const reviewId = intValue(payload.reviewId, 1, 2_147_483_647);
      const response =
        stringValue(payload.response, 1200) || "Addressed in the current proposal draft.";
      if (!reviewId || !canAddressReview(row.owner_id, actor.id, row.status)) {
        return Response.json(
          { error: "Only the proposal owner can mark feedback addressed before candidacy." },
          { status: 403 },
        );
      }
      const review = await db
        .prepare(
          `SELECT id, proposal_id, reviewer_id, reviewer_name, category, severity,
            comment, addressed, response, resolved, resolved_at, created_at
           FROM reviews WHERE id = ? AND proposal_id = ?`,
        )
        .bind(reviewId, proposalId)
        .first<ReviewRow>();
      if (!review) return Response.json({ error: "Review not found" }, { status: 404 });
      if (!review.resolved) {
        await db
          .prepare(
            `UPDATE reviews SET addressed = 1, response = ?
             WHERE id = ? AND proposal_id = ? AND resolved = 0`,
          )
          .bind(response, reviewId, proposalId)
          .run();
      }
    } else if (action === "resolve") {
      const reviewId = intValue(payload.reviewId, 1, 2_147_483_647);
      if (!reviewId) return Response.json({ error: "Review not found" }, { status: 404 });
      const review = await db
        .prepare(
          `SELECT id, proposal_id, reviewer_id, reviewer_name, category, severity,
            comment, addressed, response, resolved, resolved_at, created_at
           FROM reviews WHERE id = ? AND proposal_id = ?`,
        )
        .bind(reviewId, proposalId)
        .first<ReviewRow>();
      if (!review) return Response.json({ error: "Review not found" }, { status: 404 });
      if (!canResolveReview(review, actor.id, row.status)) {
        const error =
          review.severity === "blocking" && !review.addressed
            ? "Blocking feedback must be addressed before resolution."
            : "Only the original reviewer can resolve this feedback before candidacy.";
        return Response.json({ error }, { status: 403 });
      }
      await db
        .prepare(
          `UPDATE reviews SET resolved = 1, resolved_at = CURRENT_TIMESTAMP
           WHERE id = ? AND proposal_id = ? AND reviewer_id = ? AND resolved = 0`,
        )
        .bind(reviewId, proposalId, actor.id)
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
      const result = await db
        .prepare(
          `INSERT OR IGNORE INTO forecasts
            (proposal_id, forecaster_id, forecaster_name, success_probability, stake, rationale)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(proposalId, actor.id, actor.name, probability, stake, rationale)
        .run();
      if (result.meta.changes === 0) {
        return Response.json(
          { error: "Your sealed forecast is already recorded and cannot be changed." },
          { status: 409 },
        );
      }
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
