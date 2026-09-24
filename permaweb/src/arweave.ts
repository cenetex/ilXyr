import { arweaveUrl, config } from "./config";
import type { EvidenceFile, RegistryDiscovery, RegistryRecord, RegistrySourceHealth } from "./types";
import { bindManifest, checkFileResponse, MAX_MANIFEST_BYTES, readBounded, validateCanonicalIndex, validateManifest, validTxId } from "./publication";
import { verifyCoreProof } from "./core-proof";

type TransactionNode = {
  id: string;
  owner: { address: string };
  tags: { name: string; value: string }[];
  block: { height: number; timestamp: number } | null;
};

const GATEWAY_PAGE_SIZE = 100;
export const MAX_GATEWAY_PAGES = 20;

function indexedTime(nodes: TransactionNode[]) {
  const latest = Math.max(0, ...nodes.map((node) => node.block?.timestamp || 0));
  return latest > 0 ? new Date(latest * 1000).toISOString() : undefined;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function tagMap(tags: TransactionNode["tags"]) {
  return new Map(tags.map((tag) => [tag.name.toLowerCase(), tag.value]));
}

function humanize(value: string) {
  return value
    .replace(/^ilxyr[-_:]?/i, "")
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Arweave returned ${response.status}`);
  const bytes = await readBounded(response, MAX_MANIFEST_BYTES);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

async function queryTransactions(queriedAt: string): Promise<{ nodes: TransactionNode[]; health: RegistrySourceHealth }> {
  const withOwners = config.publishers.length > 0;
  const query = `
    query IlxyrRecords(${withOwners ? "$owners: [String!]!, " : ""}$first: Int!, $after: String) {
      transactions(
        ${withOwners ? "owners: $owners," : ""}
        tags: [{ name: "Data-Protocol", values: ["ilxyr"] }],
        first: $first,
        after: $after,
        sort: HEIGHT_DESC
      ) {
        pageInfo { hasNextPage }
        edges {
          cursor
          node {
            id
            owner { address }
            tags { name value }
            block { height timestamp }
          }
        }
      }
    }
  `;
  const nodes: TransactionNode[] = [];
  const cursors = new Set<string>();
  let after: string | undefined;
  const health: RegistrySourceHealth = { id: "gateway", required: true, status: "unavailable", records: 0, queriedAt };
  for (let page = 0; page < MAX_GATEWAY_PAGES; page++) {
    try {
      const response = await fetch(`${config.gateway}/graphql`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, variables: {
          ...(withOwners ? { owners: config.publishers } : {}), first: GATEWAY_PAGE_SIZE, after: after || null,
        } }),
      });
      if (!response.ok) throw new Error(`Gateway index returned ${response.status}`);
      const payload = (await response.json()) as {
        data?: { transactions?: { pageInfo?: { hasNextPage?: boolean }; edges?: { cursor?: string; node: TransactionNode }[] } };
        errors?: { message: string }[];
      };
      if (payload.errors?.length) throw new Error(payload.errors[0].message);
      const connection = payload.data?.transactions;
      if (!Array.isArray(connection?.edges) || typeof connection.pageInfo?.hasNextPage !== "boolean") {
        throw new Error("Gateway index omitted edges or pageInfo");
      }
      const cursor = connection.pageInfo.hasNextPage ? connection.edges.at(-1)?.cursor : undefined;
      if (connection.pageInfo.hasNextPage && (!cursor || cursors.has(cursor) || cursor === after)) {
        throw new Error(cursor ? "Gateway index repeated a cursor" : "Gateway index omitted a continuation cursor");
      }
      nodes.push(...connection.edges.map((edge) => edge.node));
      health.scanned = nodes.length;
      health.records = nodes.length;
      health.indexedAt = indexedTime(nodes);
      if (!connection.pageInfo.hasNextPage) {
        health.status = "complete";
        return { nodes, health };
      }
      if (!cursor) throw new Error("Gateway index omitted a continuation cursor");
      cursors.add(cursor);
      after = cursor;
      health.continuation = cursor;
    } catch (error) {
      health.status = nodes.length ? "partial" : "unavailable";
      health.error = message(error);
      return { nodes, health };
    }
  }
  health.status = "partial";
  health.capReached = true;
  health.error = `Gateway query stopped at the ${MAX_GATEWAY_PAGES}-page cap`;
  return { nodes, health };
}

async function hydrateTransaction(node: TransactionNode, source: RegistryRecord["source"]): Promise<RegistryRecord | null> {
  if (!validTxId(node.id) || !validTxId(node.owner?.address)) throw new Error("Gateway transaction identity differs");
  const tags = tagMap(node.tags);
  const experimentId = tags.get("experiment-id");
  if (!experimentId) return null;

  let files: EvidenceFile[] = [];
  let manifestError: string | undefined;
  try {
    const manifest = validateManifest(await fetchJson<unknown>(arweaveUrl(node.id)));
    files = bindManifest(manifest, experimentId, tags.get("evidence-ref") || "");
  } catch (error) {
    manifestError = error instanceof Error ? error.message : "Manifest validation failed";
  }

  return {
    txId: node.id,
    owner: node.owner.address,
    publisherAddress: node.owner.address,
    publisherListed: config.publishers.includes(node.owner.address),
    publisherAuthentication: "pass",
    bundleOwnerAuthentication: "pass",
    experimentId,
    evidenceRef: tags.get("evidence-ref") || "",
    title: tags.get("title") || humanize(tags.get("app-name") || experimentId),
    outcome: tags.get("ilxyr-outcome") || tags.get("outcome") || "unresolved",
    family: tags.get("family"),
    blockHeight: node.block?.height,
    timestamp: node.block?.timestamp,
    files,
    manifestError,
    source,
  };
}

async function seedNode(txId: string): Promise<TransactionNode> {
  const query = `query Seed($id: ID!) {
    transaction(id: $id) {
      id owner { address } tags { name value } block { height timestamp }
    }
  }`;
  const response = await fetch(`${config.gateway}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { id: txId } }),
  });
  if (!response.ok) throw new Error(`Gateway transaction lookup returned ${response.status}`);
  const payload = (await response.json()) as { data?: { transaction?: TransactionNode }; errors?: { message: string }[] };
  if (payload.errors?.length) throw new Error(payload.errors[0].message);
  if (!payload.data?.transaction) throw new Error(`Seed transaction ${txId} was not indexed`);
  if (payload.data.transaction.id !== txId || !/^[A-Za-z0-9_-]{43}$/.test(payload.data.transaction.owner?.address || "")) {
    throw new Error("Gateway transaction identity differs");
  }
  return payload.data.transaction;
}

async function loadCanonicalIndexSnapshot(): Promise<{ records: RegistryRecord[]; indexedAt: string }> {
  const indexUrl = config.indexTx
    ? arweaveUrl(config.indexTx)
    : new URL("./ilxyr-index-v1.json", document.baseURI).toString();
  const index = validateCanonicalIndex(await fetchJson<unknown>(indexUrl));
  const claimedPublisher = index.published_by.replace(/^arweave:\/\//, "");
  let publisherAddress = claimedPublisher;
  let publisherAuthentication: RegistryRecord["publisherAuthentication"] = "not_checked";
  let provenanceError: string | undefined = config.indexTx ? undefined : "Bundled local index has no transaction owner proof";
  if (config.indexTx) {
    try {
      const transaction = await seedNode(config.indexTx);
      publisherAddress = transaction.owner.address;
      publisherAuthentication = claimedPublisher === publisherAddress ? "pass" : "fail";
      if (publisherAuthentication === "fail") provenanceError = "Index publisher differs from gateway transaction owner";
    } catch (error) {
      publisherAuthentication = "unknown";
      provenanceError = error instanceof Error ? error.message : "Index owner lookup failed";
    }
  }

  const records = await Promise.all(index.experiments.map(async (entry): Promise<RegistryRecord> => {
    let owner = entry.owner || "unknown";
    let bundleOwnerAuthentication: RegistryRecord["bundleOwnerAuthentication"] = "unknown";
    let bundleError: string | undefined;
    try {
      const transaction = await seedNode(entry.bundle_tx);
      owner = transaction.owner.address;
      bundleOwnerAuthentication = !entry.owner || entry.owner === owner ? "pass" : "fail";
      if (bundleOwnerAuthentication === "fail") bundleError = "Bundle owner differs from index entry";
    } catch (error) {
      bundleError = error instanceof Error ? error.message : "Bundle owner lookup failed";
    }
    return {
      txId: entry.bundle_tx,
      owner,
      publisherAddress,
      publisherListed: publisherAuthentication === "pass" && config.publishers.includes(publisherAddress),
      publisherAuthentication,
      bundleOwnerAuthentication,
      provenanceError: [provenanceError, bundleError].filter(Boolean).join("; ") || undefined,
      experimentId: entry.experiment_id,
      evidenceRef: entry.evidence_ref,
      title: entry.title || humanize(entry.experiment_id),
      outcome: entry.outcome,
      family: entry.family,
      files: [],
      source: "canonical-index",
    };
  }));
  return { records, indexedAt: index.generated_at };
}

export async function loadCanonicalIndex(): Promise<RegistryRecord[]> {
  return (await loadCanonicalIndexSnapshot()).records;
}

export async function loadRegistry(): Promise<RegistryDiscovery> {
  const queriedAt = new Date().toISOString();
  const records: RegistryRecord[] = [];
  const sources: RegistrySourceHealth[] = [];

  try {
    const index = await loadCanonicalIndexSnapshot();
    records.push(...index.records);
    sources.push({ id: "canonical-index", required: true, status: "complete", records: index.records.length,
      queriedAt, indexedAt: index.indexedAt });
  } catch (error) {
    sources.push({ id: "canonical-index", required: true, status: "unavailable", records: 0,
      queriedAt, error: message(error) });
  }

  const gateway = await queryTransactions(queriedAt);
  const hydrated = await Promise.allSettled(gateway.nodes.map((node) => hydrateTransaction(node, "gateway")));
  const gatewayErrors: string[] = [];
  for (const result of hydrated) {
    if (result.status === "fulfilled") {
      if (result.value) records.push(result.value);
    } else gatewayErrors.push(message(result.reason));
  }
  gateway.health.records = hydrated.filter((result) => result.status === "fulfilled" && result.value).length;
  if (gatewayErrors.length) {
    gateway.health.status = "partial";
    gateway.health.error = [gateway.health.error, ...gatewayErrors].filter(Boolean).join("; ");
  }
  sources.push(gateway.health);

  for (const txId of config.seedTransactions) {
    try {
      const node = await seedNode(txId);
      const record = await hydrateTransaction(node, "seed");
      if (record) records.push(record);
      sources.push({ id: `seed:${txId}`, required: true, status: "complete", records: record ? 1 : 0,
        queriedAt, indexedAt: indexedTime([node]) });
    } catch (error) {
      sources.push({ id: `seed:${txId}`, required: true, status: "unavailable", records: 0,
        queriedAt, error: message(error) });
    }
  }

  const unique = new Map<string, RegistryRecord>();
  for (const record of records) {
    const key = record.experimentId;
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, record);
      continue;
    }

    const existingIsCanonical = existing.source === "canonical-index";
    const recordIsCanonical = record.source === "canonical-index";
    if (recordIsCanonical && !existingIsCanonical) {
      unique.set(key, record);
      continue;
    }
    if (existingIsCanonical && !recordIsCanonical) {
      if (existing.publisherAuthentication !== "pass") {
        unique.set(key, { ...record, provenanceError: existing.provenanceError || "Canonical index publisher unverified" });
        continue;
      }
      const sameIdentity = existing.txId === record.txId &&
        existing.experimentId === record.experimentId && existing.evidenceRef === record.evidenceRef;
      unique.set(key, {
        ...existing,
        files: sameIdentity && record.files.length ? record.files : existing.files,
        provenanceError: !sameIdentity
          ? [existing.provenanceError, "Gateway record conflicts with canonical listing"].filter(Boolean).join("; ")
          : existing.provenanceError,
        manifestError: !sameIdentity && existing.txId === record.txId
          ? "Gateway identity differs from canonical listing" : record.manifestError,
        blockHeight: existing.blockHeight || record.blockHeight,
        timestamp: existing.timestamp || record.timestamp,
      });
      continue;
    }
    if (existing.files.length === 0 && record.files.length > 0) unique.set(key, record);
  }

  const byExperiment = new Map<string, RegistryRecord[]>();
  for (const record of records) {
    const group = byExperiment.get(record.experimentId) || [];
    group.push(record);
    byExperiment.set(record.experimentId, group);
  }
  const result = [...unique.values()].map((record) => {
    const observations = byExperiment.get(record.experimentId) || [];
    const observedSources = [...new Set(observations.map((item) => item.source))];
    const identities = new Set(observations.map((item) =>
      `${item.txId}|${item.evidenceRef}|${item.outcome}`));
    const identityConflicts = identities.size > 1 ? ["Sources disagree on bundle, evidence, or reported outcome"] : [];
    return { ...record, observedSources, identityConflicts };
  }).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  const allComplete = sources.every((source) => source.status === "complete");
  const status: RegistryDiscovery["status"] = allComplete
    ? result.length ? "complete" : "empty"
    : result.length || sources.some((source) => source.status !== "unavailable") ? "partial" : "unavailable";
  return { scope: "configured-index-gateway-and-seeds", status, records: result,
    observations: records, sources, queriedAt };
}

export async function hydrateRecord(record: RegistryRecord): Promise<RegistryRecord> {
  if (record.files.length) return record;
  try {
    const manifest = validateManifest(await fetchJson<unknown>(arweaveUrl(record.txId)));
    return {
      ...record,
      files: bindManifest(manifest, record.experimentId, record.evidenceRef),
      manifestError: undefined,
    };
  } catch (error) {
    return { ...record, manifestError: error instanceof Error ? error.message : "Manifest validation failed" };
  }
}

export async function verifyPublishedCoreProof(record: RegistryRecord) {
  const file = record.files.find((item) => item.path === "core/evidence-ledger-proof.json");
  if (!file) throw new Error("This publication has no core ledger proof file");
  const response = await fetch(arweaveUrl(record.txId, file.path));
  if (!response.ok) throw new Error(`Core proof retrieval returned ${response.status}`);
  const bytes = await readBounded(response, file.bytes);
  const actual = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (bytes.byteLength !== file.bytes || actual !== file.sha256) throw new Error("Core proof file differs from its manifest");
  return verifyCoreProof(JSON.parse(new TextDecoder().decode(bytes)), record);
}

export async function verifyEvidenceFile(record: RegistryRecord, file: EvidenceFile) {
  const response = await fetch(arweaveUrl(record.txId, file.path));
  return checkFileResponse(response, file);
}
