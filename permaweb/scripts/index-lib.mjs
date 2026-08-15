import { createHash } from "node:crypto";

const TX_ID = /^[A-Za-z0-9_-]{43}$/;
const EVIDENCE_REF = /^artifact:\/\/sha256\/[a-f0-9]{64}$/;
const LEDGER_HEAD = /^(artifact:\/\/sha256\/[a-f0-9]{64}|)$/;

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function validateIndex(index) {
  const errors = [];
  if (!index || typeof index !== "object" || Array.isArray(index)) return ["index must be an object"];
  if (index.schema !== "ilxyr.index.v1") errors.push("schema must be ilxyr.index.v1");
  if (!Number.isInteger(index.sequence) || index.sequence < 1) errors.push("sequence must be a positive integer");
  if (index.previous_index_tx !== null && !TX_ID.test(index.previous_index_tx || "")) errors.push("previous_index_tx must be null or an Arweave transaction ID");
  if (!LEDGER_HEAD.test(index.ledger_head || "")) errors.push("ledger_head must be empty or an artifact SHA-256 reference");
  if (!/^arweave:\/\/[A-Za-z0-9_-]{43}$/.test(index.published_by || "")) errors.push("published_by must be an Arweave wallet handle");
  if (!Number.isFinite(Date.parse(index.generated_at || ""))) errors.push("generated_at must be an ISO timestamp");
  if (!Array.isArray(index.experiments)) errors.push("experiments must be an array");

  const experimentIds = new Set();
  const bundleIds = new Set();
  for (const [position, entry] of (index.experiments || []).entries()) {
    const prefix = `experiments[${position}]`;
    if (!entry || typeof entry !== "object") { errors.push(`${prefix} must be an object`); continue; }
    if (typeof entry.experiment_id !== "string" || !entry.experiment_id) errors.push(`${prefix}.experiment_id is required`);
    if (!TX_ID.test(entry.bundle_tx || "")) errors.push(`${prefix}.bundle_tx must be an Arweave transaction ID`);
    if (!EVIDENCE_REF.test(entry.evidence_ref || "")) errors.push(`${prefix}.evidence_ref must be an artifact SHA-256 reference`);
    if (typeof entry.outcome !== "string" || !entry.outcome) errors.push(`${prefix}.outcome is required`);
    if (experimentIds.has(entry.experiment_id)) errors.push(`duplicate experiment_id: ${entry.experiment_id}`);
    if (bundleIds.has(entry.bundle_tx)) errors.push(`duplicate bundle_tx: ${entry.bundle_tx}`);
    experimentIds.add(entry.experiment_id);
    bundleIds.add(entry.bundle_tx);
  }
  return errors;
}

export function buildIndex({ sequence, previousIndexTx = null, ledgerHead = "", publisher, generatedAt, experiments }) {
  const index = {
    schema: "ilxyr.index.v1",
    sequence: Number(sequence),
    previous_index_tx: previousIndexTx || null,
    ledger_head: ledgerHead,
    published_by: publisher.startsWith("arweave://") ? publisher : `arweave://${publisher}`,
    generated_at: generatedAt,
    experiments: [...experiments].sort((a, b) => a.experiment_id.localeCompare(b.experiment_id)),
  };
  const errors = validateIndex(index);
  if (errors.length) throw new Error(errors.join("\n"));
  const canonical = canonicalJson(index);
  const sha256 = createHash("sha256").update(canonical).digest("hex");
  return { index, canonical, sha256 };
}

export function validateSuccessor(previous, next) {
  const errors = [...validateIndex(previous), ...validateIndex(next)];
  if (errors.length) return errors;
  if (next.sequence !== previous.sequence + 1) errors.push("successor sequence must advance by one");
  if (!TX_ID.test(next.previous_index_tx || "")) errors.push("successor must reference a previous index transaction");
  const prior = new Map(previous.experiments.map((entry) => [entry.experiment_id, entry]));
  const successorIds = new Set(next.experiments.map((entry) => entry.experiment_id));
  for (const experimentId of prior.keys()) {
    if (!successorIds.has(experimentId)) errors.push(`immutable experiment entry removed: ${experimentId}`);
  }
  for (const entry of next.experiments) {
    const old = prior.get(entry.experiment_id);
    if (old && canonicalJson(old) !== canonicalJson(entry)) errors.push(`immutable experiment entry changed: ${entry.experiment_id}`);
  }
  return errors;
}
