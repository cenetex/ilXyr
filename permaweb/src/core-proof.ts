const DIGEST = /^[a-f0-9]{64}$/;
const ARTIFACT = /^artifact:\/\/sha256\/([a-f0-9]{64})$/;

type Listing = { experimentId: string; evidenceRef: string; outcome: string };
type Check = { chain: "pass"; ledgerBinding: "pass" | "unknown"; ledgerHead: string; eventsChecked: number };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Core proof field must be an object");
  return value as Record<string, unknown>;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const fields = Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return `{${fields.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const result = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readJson(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "string" || value.length > 64 * 1024 * 1024) throw new Error(`Invalid ${label} bytes`);
  try { return object(JSON.parse(value)); }
  catch { throw new Error(`Invalid ${label} JSON`); }
}

// The caller supplies an independently retained head when available. A head
// copied from this proof or its publisher cannot establish ledger binding.
export async function verifyCoreProof(raw: unknown, listing: Listing, trustedHead?: string): Promise<Check> {
  const proof = object(raw);
  if (Object.keys(proof).some((key) => !["schema", "bundle_sha256", "bundle_json", "evidence_json", "run_json",
    "evidence_ref", "evidence_event_hash", "ledger_head", "events"].includes(key))) {
    throw new Error("Unknown core proof field");
  }
  if (proof.schema !== "ilxyr.evidence_ledger_proof.v1" || !DIGEST.test(String(proof.bundle_sha256)) ||
      !DIGEST.test(String(proof.evidence_event_hash)) || !DIGEST.test(String(proof.ledger_head)) ||
      !ARTIFACT.test(String(proof.evidence_ref)) || !Array.isArray(proof.events) || proof.events.length < 1 ||
      proof.events.length > 100000) throw new Error("Invalid core proof header");
  const bundle = readJson(proof.bundle_json, "bundle");
  const evidence = readJson(proof.evidence_json, "evidence");
  const run = readJson(proof.run_json, "run");
  if (await digest(proof.bundle_json as string) !== proof.bundle_sha256 ||
      await digest(proof.evidence_json as string) !== ARTIFACT.exec(proof.evidence_ref as string)?.[1] ||
      await digest(proof.run_json as string) !== ARTIFACT.exec(String(bundle.run_ref))?.[1]) {
    throw new Error("Core bundle or artifact digest differs");
  }
  if (bundle.schema !== "ilxyr.evidence_bundle.v1" ||
      bundle.evidence_ref !== proof.evidence_ref || bundle.evidence_ref !== listing.evidenceRef ||
      bundle.evidence_event_hash !== proof.evidence_event_hash || bundle.ledger_head !== proof.ledger_head ||
      canonical(bundle.evidence) !== canonical(evidence) || canonical(bundle.run) !== canonical(run) ||
      evidence.run_ref !== bundle.run_ref || evidence.experiment_id !== listing.experimentId ||
      run.experiment_id !== listing.experimentId || evidence.resolved_outcome !== listing.outcome) {
    throw new Error("Core proof identity, run, or outcome differs from the listing");
  }
  let previous: string | null = null;
  let included = 0;
  for (const rawEvent of proof.events) {
    const event = object(rawEvent);
    if (Object.keys(event).some((key) => !["schema", "event_type", "aggregate_id", "actor", "artifact_ref",
      "occurred_at_ms", "previous_event", "event_hash"].includes(key))) {
      throw new Error("Unknown core event field");
    }
    if (event.schema !== "ilxyr.event.v1" || !DIGEST.test(String(event.event_hash)) ||
        (event.previous_event ?? null) !== previous || !Number.isSafeInteger(event.occurred_at_ms) ||
        typeof event.event_type !== "string" || typeof event.aggregate_id !== "string") {
      throw new Error("Core event chain structure differs");
    }
    const actor = object(event.actor);
    if (typeof actor.id !== "string" || !["human", "model", "service"].includes(String(actor.kind))) {
      throw new Error("Invalid core event actor");
    }
    const unsigned = { schema: event.schema, event_type: event.event_type, aggregate_id: event.aggregate_id,
      actor, artifact_ref: event.artifact_ref ?? null, occurred_at_ms: event.occurred_at_ms,
      previous_event: event.previous_event ?? null };
    if (await digest(canonical(unsigned)) !== event.event_hash) throw new Error("Core event digest differs");
    if (event.event_type === "EvidenceRecorded" && event.aggregate_id === listing.experimentId &&
        event.artifact_ref === listing.evidenceRef && event.event_hash === proof.evidence_event_hash) included++;
    previous = event.event_hash as string;
  }
  if (included !== 1 || previous !== proof.ledger_head) throw new Error("Evidence event inclusion or ledger head differs");
  if (trustedHead !== undefined && (!DIGEST.test(trustedHead) || trustedHead !== proof.ledger_head)) {
    throw new Error("Independently retained ledger head differs");
  }
  return { chain: "pass", ledgerBinding: trustedHead === undefined ? "unknown" : "pass",
    ledgerHead: proof.ledger_head as string, eventsChecked: proof.events.length };
}
