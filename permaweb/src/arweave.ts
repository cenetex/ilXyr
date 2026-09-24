import { arweaveUrl, config } from "./config";
import type { EvidenceFile, RegistryRecord } from "./types";
import { bindManifest, checkFileResponse, MAX_MANIFEST_BYTES, readBounded, validateCanonicalIndex, validateManifest } from "./publication";

type TransactionNode = {
  id: string;
  owner: { address: string };
  tags: { name: string; value: string }[];
  block: { height: number; timestamp: number } | null;
};

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

async function queryTransactions(): Promise<TransactionNode[]> {
  const withOwners = config.publishers.length > 0;
  const query = `
    query IlxyrRecords(${withOwners ? "$owners: [String!]!, " : ""}$first: Int!) {
      transactions(
        ${withOwners ? "owners: $owners," : ""}
        tags: [{ name: "Data-Protocol", values: ["ilxyr"] }],
        first: $first,
        sort: HEIGHT_DESC
      ) {
        edges {
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
  const response = await fetch(`${config.gateway}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query,
      variables: { ...(withOwners ? { owners: config.publishers } : {}), first: 100 },
    }),
  });
  if (!response.ok) throw new Error(`Gateway index returned ${response.status}`);
  const payload = (await response.json()) as {
    data?: { transactions?: { edges: { node: TransactionNode }[] } };
    errors?: { message: string }[];
  };
  if (payload.errors?.length) throw new Error(payload.errors[0].message);
  return payload.data?.transactions?.edges.map((edge) => edge.node) || [];
}

async function hydrateTransaction(node: TransactionNode, source: RegistryRecord["source"]): Promise<RegistryRecord | null> {
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
    publisherListed: config.publishers.includes(node.owner.address),
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
  const payload = (await response.json()) as { data?: { transaction?: TransactionNode } };
  if (!payload.data?.transaction) throw new Error(`Seed transaction ${txId} was not indexed`);
  return payload.data.transaction;
}

async function loadCanonicalIndex(): Promise<RegistryRecord[]> {
  const indexUrl = config.indexTx
    ? arweaveUrl(config.indexTx)
    : new URL("./ilxyr-index-v1.json", document.baseURI).toString();
  const index = validateCanonicalIndex(await fetchJson<unknown>(indexUrl));

  return index.experiments.map((entry) => ({
    txId: entry.bundle_tx,
    owner: entry.owner || index.published_by.replace(/^arweave:\/\//, ""),
    publisherListed: config.publishers.includes(entry.owner || index.published_by.replace(/^arweave:\/\//, "")),
    experimentId: entry.experiment_id,
    evidenceRef: entry.evidence_ref,
    title: entry.title || humanize(entry.experiment_id),
    outcome: entry.outcome,
    family: entry.family,
    files: [],
    source: "canonical-index",
  }));
}

export async function loadRegistry(): Promise<RegistryRecord[]> {
  const records: RegistryRecord[] = [];
  const errors: unknown[] = [];

  try {
    records.push(...(await loadCanonicalIndex()));
  } catch (error) {
    errors.push(error);
  }

  try {
    const nodes = await queryTransactions();
    const hydrated = await Promise.all(nodes.map((node) => hydrateTransaction(node, "gateway")));
    records.push(...hydrated.filter((record): record is RegistryRecord => Boolean(record)));
  } catch (error) {
    errors.push(error);
  }

  for (const txId of config.seedTransactions) {
    const existing = records.find((record) => record.txId === txId);
    if (existing?.files.length) continue;
    try {
      const record = await hydrateTransaction(await seedNode(txId), "seed");
      if (record) records.push(record);
    } catch (error) {
      errors.push(error);
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
      const sameIdentity = existing.txId === record.txId &&
        existing.experimentId === record.experimentId && existing.evidenceRef === record.evidenceRef;
      unique.set(key, {
        ...existing,
        files: sameIdentity && record.files.length ? record.files : existing.files,
        manifestError: !sameIdentity && existing.txId === record.txId
          ? "Gateway identity differs from canonical listing" : record.manifestError,
        blockHeight: existing.blockHeight || record.blockHeight,
        timestamp: existing.timestamp || record.timestamp,
      });
      continue;
    }
    if (existing.files.length === 0 && record.files.length > 0) unique.set(key, record);
  }

  const result = [...unique.values()].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  if (result.length === 0 && errors.length) throw errors[0];
  return result;
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

export async function verifyEvidenceFile(record: RegistryRecord, file: EvidenceFile) {
  const response = await fetch(arweaveUrl(record.txId, file.path));
  return checkFileResponse(response, file);
}
