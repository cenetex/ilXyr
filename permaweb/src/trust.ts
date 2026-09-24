import type { RegistryRecord } from "./types";

export type CheckState = "pass" | "fail" | "unknown" | "not_checked";
export type FileCheckState = "idle" | "checking" | "verified" | "hash_failed" | "size_failed" | "limit_failed" | "fetch_failed";

export type RecordTrust = {
  listing: CheckState;
  fileRetrieval: CheckState;
  byteIntegrity: CheckState;
  publisherAllowlist: CheckState;
  publisherAuthentication: CheckState;
  bundleOwnerAuthentication: CheckState;
  ledgerBinding: CheckState;
  scientificDisposition: CheckState;
  reportedOutcome: string;
};

// These fields describe checks the current browser actually performs. The
// published outcome remains a publisher report until core evidence is bound.
export function recordTrust(record: RegistryRecord, files: Record<string, FileCheckState>): RecordTrust {
  const states = record.files.map((file) => files[file.path] || "idle");
  const fileRetrieval: CheckState = states.length === 0 ? "unknown"
    : states.includes("fetch_failed") || states.includes("limit_failed") ? "fail"
      : states.every((state) => state === "verified" || state === "hash_failed" || state === "size_failed") ? "pass"
        : "not_checked";
  const byteIntegrity: CheckState = states.length === 0 ? "unknown"
    : states.includes("hash_failed") || states.includes("size_failed") ? "fail"
      : states.every((state) => state === "verified") ? "pass"
        : "not_checked";
  return {
    listing: record.identityConflicts?.length ? "fail" : "pass",
    fileRetrieval,
    byteIntegrity,
    publisherAllowlist: record.publisherAuthentication === "pass"
      ? record.publisherListed ? "pass" : "fail" : "unknown",
    publisherAuthentication: record.publisherAuthentication || "not_checked",
    bundleOwnerAuthentication: record.bundleOwnerAuthentication || "not_checked",
    ledgerBinding: "not_checked",
    scientificDisposition: "not_checked",
    reportedOutcome: record.outcome || "unresolved",
  };
}
