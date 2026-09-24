export const MAX_MANIFEST_BYTES = 1024 * 1024;
export const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 128;
const TX_ID = /^[A-Za-z0-9_-]{43}$/;
const ARTIFACT = /^artifact:\/\/sha256\/[a-f0-9]{64}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MEDIA_TYPE = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*(?:; ?charset=[a-z0-9_-]+)?$/i;

export type PublicationFile = { path: string; bytes: number; media_type: string; sha256: string };
export type PublicationManifest = {
  schema: "ilxyr.publication-manifest.v1" | "lecore.qwen35-publication-manifest.v1";
  experiment_id: string;
  evidence_ref: string;
  files: PublicationFile[];
  run_ref?: string;
  resolved_outcome?: string;
  ledger_verification?: { events_checked: number; objects_checked: number; valid: boolean };
  scientific_result_admitted?: boolean;
};

export type ValidatedIndexEntry = {
  experiment_id: string; bundle_tx: string; evidence_ref: string; outcome: string;
  title?: string; owner?: string; family?: string;
};
export type ValidatedIndex = {
  schema: "ilxyr.index.v1"; sequence: number; previous_index_tx: string | null;
  ledger_head: string; published_by: string; generated_at: string;
  experiments: ValidatedIndexEntry[];
};

export function validateCanonicalIndex(value: unknown): ValidatedIndex {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Canonical index must be an object");
  const item = value as Record<string, unknown>;
  if (item.schema !== "ilxyr.index.v1" || !Number.isSafeInteger(item.sequence) || (item.sequence as number) < 1 ||
      !(item.previous_index_tx === null || validTxId(item.previous_index_tx)) ||
      typeof item.ledger_head !== "string" || !/^(|artifact:\/\/sha256\/[a-f0-9]{64})$/.test(item.ledger_head) ||
      typeof item.published_by !== "string" || !/^arweave:\/\/[A-Za-z0-9_-]{43}$/.test(item.published_by) ||
      typeof item.generated_at !== "string" || !Number.isFinite(Date.parse(item.generated_at)) ||
      !Array.isArray(item.experiments) || item.experiments.length > 10000) {
    throw new Error("Invalid canonical index header");
  }
  const seen = new Set<string>();
  const transactions = new Set<string>();
  for (const entry of item.experiments) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
        typeof entry.experiment_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(entry.experiment_id) ||
        !validTxId(entry.bundle_tx) || typeof entry.evidence_ref !== "string" || !ARTIFACT.test(entry.evidence_ref) ||
        typeof entry.outcome !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(entry.outcome) ||
        (entry.owner !== undefined && !validTxId(entry.owner)) ||
        (entry.title !== undefined && (typeof entry.title !== "string" || entry.title.length > 500)) ||
        (entry.family !== undefined && (typeof entry.family !== "string" || entry.family.length > 100)) ||
        seen.has(entry.experiment_id) || transactions.has(entry.bundle_tx)) throw new Error("Invalid or duplicate canonical index entry");
    seen.add(entry.experiment_id);
    transactions.add(entry.bundle_tx);
  }
  return item as ValidatedIndex;
}

export function validTxId(value: unknown): value is string {
  return typeof value === "string" && TX_ID.test(value);
}

export function validPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512 &&
    value.split("/").every((part) => part.length > 0 && part.length <= 128 &&
      part !== "." && part !== ".." && !part.startsWith(" ") && !part.endsWith(" ") &&
      /^[A-Za-z0-9._ -]+$/.test(part));
}

export function publicationUrl(gateway: string, txId: string, path = "") {
  if (!validTxId(txId) || (path && !validPath(path))) throw new Error("Invalid publication transaction or path");
  const base = new URL(gateway.endsWith("/") ? gateway : gateway + "/");
  const suffix = path ? "/" + path.split("/").map(encodeURIComponent).join("/") : "";
  const url = new URL(txId + suffix, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname + txId) ||
      (url.pathname !== base.pathname + txId && !url.pathname.startsWith(base.pathname + txId + "/"))) {
    throw new Error("Publication URL escaped its transaction");
  }
  return url.toString();
}

export function validateManifest(value: unknown): PublicationManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Publication manifest must be an object");
  const item = value as Record<string, unknown>;
  const legacy = item.schema === "lecore.qwen35-publication-manifest.v1";
  if (item.schema !== "ilxyr.publication-manifest.v1" && !legacy) throw new Error("Unsupported publication manifest schema");
  const fields = legacy ? ["schema", "experiment_id", "evidence_ref", "files", "run_ref", "resolved_outcome", "ledger_verification", "scientific_result_admitted"]
    : ["schema", "experiment_id", "evidence_ref", "files"];
  if (Object.keys(item).some((key) => !fields.includes(key))) {
    throw new Error("Unknown publication manifest field");
  }
  if (legacy) {
    const verification = item.ledger_verification as Record<string, unknown> | undefined;
    if (typeof item.run_ref !== "string" || item.run_ref.length === 0 || item.run_ref.length > 500 ||
        typeof item.resolved_outcome !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(item.resolved_outcome) ||
        !verification || typeof verification !== "object" || Array.isArray(verification) ||
        Object.keys(verification).some((key) => !["events_checked", "objects_checked", "valid"].includes(key)) ||
        !Number.isSafeInteger(verification.events_checked) || (verification.events_checked as number) < 0 ||
        !Number.isSafeInteger(verification.objects_checked) || (verification.objects_checked as number) < 0 ||
        typeof verification.valid !== "boolean" ||
        (item.scientific_result_admitted !== undefined && typeof item.scientific_result_admitted !== "boolean")) {
      throw new Error("Invalid legacy publication metadata");
    }
  }
  if (typeof item.experiment_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(item.experiment_id)) {
    throw new Error("Invalid experiment identity");
  }
  if (typeof item.evidence_ref !== "string" || !ARTIFACT.test(item.evidence_ref)) throw new Error("Invalid evidence reference");
  if (!Array.isArray(item.files) || item.files.length > MAX_FILES) throw new Error("Invalid publication file count");
  const paths = new Set<string>();
  let total = 0;
  for (const raw of item.files) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid publication file");
    const file = raw as Record<string, unknown>;
    if (Object.keys(file).some((key) => !["path", "bytes", "sha256", "media_type"].includes(key))) {
      throw new Error("Unknown publication file field");
    }
    if (!validPath(file.path) || paths.has(file.path)) throw new Error("Invalid or duplicate publication path");
    if (typeof file.bytes !== "number" || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > MAX_FILE_BYTES) {
      throw new Error("Invalid publication byte count");
    }
    if (typeof file.sha256 !== "string" || !SHA256.test(file.sha256)) throw new Error("Invalid publication SHA-256");
    if (typeof file.media_type !== "string" || file.media_type.length > 128 || !MEDIA_TYPE.test(file.media_type)) {
      throw new Error("Invalid publication media type");
    }
    paths.add(file.path);
    total += file.bytes;
  }
  if (total > MAX_FILES * MAX_FILE_BYTES) throw new Error("Publication total exceeds limit");
  return item as PublicationManifest;
}

export function bindManifest(manifest: PublicationManifest, experimentId: string, evidenceRef: string) {
  if (manifest.experiment_id !== experimentId || manifest.evidence_ref !== evidenceRef) {
    throw new Error("Manifest identity differs from registry listing");
  }
  return manifest.files;
}

export async function readBounded(response: Response, limit: number): Promise<Uint8Array> {
  const length = response.headers.get("content-length");
  if (length && Number(length) > limit) throw new Error("Response exceeds byte limit");
  if (!response.body) throw new Error("Response body is unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("Response exceeds byte limit");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function checkFileResponse(response: Response, file: PublicationFile) {
  if (!response.ok) throw new Error(`Could not retrieve ${file.path}: ${response.status}`);
  const bytes = await readBounded(response, MAX_FILE_BYTES);
  if (bytes.byteLength !== file.bytes) return { verified: false, reason: "size", actualBytes: bytes.byteLength };
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer);
  const actual = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  return { verified: actual === file.sha256, reason: actual === file.sha256 ? "verified" : "hash", actualBytes: bytes.byteLength, actual };
}
