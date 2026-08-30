import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const proposals = sqliteTable(
  "proposals",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    ownerName: text("owner_name").notNull(),
    status: text("status").notNull().default("review"),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    hypothesis: text("hypothesis").notNull(),
    family: text("family").notNull(),
    baseline: text("baseline").notNull(),
    datasetRefs: text("dataset_refs").notNull(),
    primaryMetric: text("primary_metric").notNull(),
    successThreshold: real("success_threshold").notNull(),
    seeds: text("seeds").notNull(),
    computeCredits: integer("compute_credits").notNull(),
    evidenceLevel: text("evidence_level").notNull(),
    exportPolicy: text("export_policy").notNull(),
    novelty: text("novelty").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_proposals_status_updated").on(table.status, table.updatedAt),
  ],
);

export const reviews = sqliteTable(
  "reviews",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    proposalId: text("proposal_id")
      .notNull()
      .references(() => proposals.id),
    reviewerId: text("reviewer_id").notNull(),
    reviewerName: text("reviewer_name").notNull(),
    category: text("category").notNull(),
    severity: text("severity").notNull(),
    comment: text("comment").notNull(),
    addressed: integer("addressed", { mode: "boolean" }).notNull().default(false),
    response: text("response"),
    resolved: integer("resolved", { mode: "boolean" }).notNull().default(false),
    resolvedAt: text("resolved_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_reviews_proposal_resolved").on(table.proposalId, table.resolved)],
);

export const fundingCommitments = sqliteTable(
  "funding_commitments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    proposalId: text("proposal_id")
      .notNull()
      .references(() => proposals.id),
    funderId: text("funder_id").notNull(),
    funderName: text("funder_name").notNull(),
    computeCredits: integer("compute_credits").notNull(),
    rationale: text("rationale").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_funding_proposal_funder").on(table.proposalId, table.funderId),
  ],
);

export const forecasts = sqliteTable(
  "forecasts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    proposalId: text("proposal_id")
      .notNull()
      .references(() => proposals.id),
    forecasterId: text("forecaster_id").notNull(),
    forecasterName: text("forecaster_name").notNull(),
    successProbability: real("success_probability").notNull(),
    stake: integer("stake").notNull(),
    rationale: text("rationale").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_forecasts_proposal_forecaster").on(
      table.proposalId,
      table.forecasterId,
    ),
  ],
);
