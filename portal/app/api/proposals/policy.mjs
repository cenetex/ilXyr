/**
 * @typedef {object} ReadinessInput
 * @property {string} hypothesis
 * @property {string} baseline
 * @property {number} datasetCount
 * @property {string} primaryMetric
 * @property {number} seedCount
 * @property {number} computeCredits
 * @property {string} evidenceLevel
 * @property {number} independentReviews
 * @property {number} blockingReviews
 * @property {string} status
 */

/** @param {ReadinessInput} input */
export function proposalReadiness(input) {
  const checks = [
    { label: "Falsifiable hypothesis", pass: input.hypothesis.trim().length >= 24 },
    { label: "Frozen baseline", pass: input.baseline.includes("://") },
    { label: "Dataset binding", pass: input.datasetCount > 0 },
    { label: "Decidable outcome", pass: input.primaryMetric.trim().length > 0 },
    { label: "Seeds declared", pass: input.seedCount > 0 },
    { label: "Compute ceiling", pass: input.computeCredits > 0 },
    { label: "Evidence authority", pass: input.evidenceLevel.trim().length > 0 },
    { label: "Independent review added", pass: input.independentReviews > 0 },
    { label: "Blocking feedback resolved", pass: input.blockingReviews === 0 },
  ];
  const score = Math.round((checks.filter((check) => check.pass).length / checks.length) * 100);
  return { checks, score, promotable: score === 100 && input.status !== "blocked" };
}

export function canAddReview(ownerId, actorId, proposalStatus) {
  return proposalStatus === "review" && ownerId !== actorId;
}

export function canAddressReview(ownerId, actorId, proposalStatus) {
  return proposalStatus === "review" && ownerId === actorId;
}

export function canResolveReview(review, actorId, proposalStatus) {
  return (
    proposalStatus === "review" &&
    review.reviewer_id === actorId &&
    (review.severity !== "blocking" || review.addressed === 1)
  );
}
