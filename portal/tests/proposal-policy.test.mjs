import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  canAddReview,
  canAddressReview,
  canResolveReview,
  proposalReadiness,
} from "../app/api/proposals/policy.mjs";

const readyProposal = {
  hypothesis: "A sufficiently detailed falsifiable hypothesis.",
  baseline: "model://frozen/v1",
  datasetCount: 1,
  primaryMetric: "accuracy",
  seedCount: 2,
  computeCredits: 10,
  evidenceLevel: "deterministic_replay",
  independentReviews: 1,
  blockingReviews: 0,
  status: "review",
};

test("promotion requires an independent review", () => {
  assert.equal(proposalReadiness(readyProposal).promotable, true);
  const withoutIndependentReview = proposalReadiness({
    ...readyProposal,
    independentReviews: 0,
  });
  assert.equal(withoutIndependentReview.promotable, false);
  assert.equal(
    withoutIndependentReview.checks.find((check) => check.label === "Independent review added")
      ?.pass,
    false,
  );
});

test("authors address feedback and original reviewers resolve it", () => {
  assert.equal(canAddReview("human://owner", "human://owner", "review"), false);
  assert.equal(canAddReview("human://owner", "human://reviewer", "review"), true);
  assert.equal(canAddressReview("human://owner", "human://owner", "review"), true);

  const blockingReview = {
    reviewer_id: "human://reviewer",
    severity: "blocking",
    addressed: 0,
  };
  assert.equal(canResolveReview(blockingReview, "human://owner", "review"), false);
  assert.equal(canResolveReview(blockingReview, "human://reviewer", "review"), false);
  assert.equal(
    canResolveReview({ ...blockingReview, addressed: 1 }, "human://reviewer", "review"),
    true,
  );
});

test("open forecast values are never disclosed or updated", async () => {
  const route = await readFile(new URL("../app/api/proposals/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /AVG\(fc\.success_probability\)/);
  assert.doesNotMatch(route, /success_probability\s*=\s*excluded\.success_probability/);
  assert.match(route, /INSERT OR IGNORE INTO forecasts/);
  assert.match(route, /sealed forecast is already recorded and cannot be changed/);
});
