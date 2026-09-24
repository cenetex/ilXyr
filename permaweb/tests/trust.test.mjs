import assert from "node:assert/strict";
import test from "node:test";
import { recordTrust } from "../src/trust.ts";

const record = {
  publisherListed: true,
  outcome: "no_go",
  files: [{ path: "result.json" }, { path: "receipt.json" }],
};

test("publisher and outcome claims stay separate from ledger verification", () => {
  const trust = recordTrust(record, {});
  assert.equal(trust.publisherAllowlist, "pass");
  assert.equal(trust.publisherAuthentication, "not_checked");
  assert.equal(trust.ledgerBinding, "not_checked");
  assert.equal(trust.scientificDisposition, "not_checked");
  assert.equal(trust.reportedOutcome, "no_go");
  assert.equal(trust.byteIntegrity, "not_checked");
});

test("a changed file and a failed fetch retain distinct states", () => {
  const changed = recordTrust(record, { "result.json": "verified", "receipt.json": "hash_failed" });
  assert.equal(changed.fileRetrieval, "pass");
  assert.equal(changed.byteIntegrity, "fail");

  const unavailable = recordTrust(record, { "result.json": "verified", "receipt.json": "fetch_failed" });
  assert.equal(unavailable.fileRetrieval, "fail");
  assert.equal(unavailable.byteIntegrity, "not_checked");
  const wrongSize = recordTrust(record, { "result.json": "verified", "receipt.json": "size_failed" });
  assert.equal(wrongSize.fileRetrieval, "pass");
  assert.equal(wrongSize.byteIntegrity, "fail");
  const tooLarge = recordTrust(record, { "result.json": "verified", "receipt.json": "limit_failed" });
  assert.equal(tooLarge.fileRetrieval, "fail");
  assert.equal(tooLarge.byteIntegrity, "not_checked");
});

test("complete hash checks pass while absent files and unlisted addresses stay explicit", () => {
  const checked = recordTrust(record, { "result.json": "verified", "receipt.json": "verified" });
  assert.equal(checked.byteIntegrity, "pass");
  const absent = recordTrust({ ...record, publisherListed: false, files: [] }, {});
  assert.equal(absent.fileRetrieval, "unknown");
  assert.equal(absent.byteIntegrity, "unknown");
  assert.equal(absent.publisherAllowlist, "fail");
});
