const TX_ID = /^[A-Za-z0-9_-]{43}$/;
const MAX_INDEX_BYTES = 1024 * 1024;

export async function fetchPreviousIndex(txId, gateway = "https://arweave.net", fetcher = fetch) {
  if (!TX_ID.test(txId || "")) throw new Error("Expected previous transaction ID must be 43 URL-safe characters");
  const base = new URL(gateway.endsWith("/") ? gateway : gateway + "/");
  const url = new URL(txId, base);
  if (url.origin !== base.origin || url.pathname !== base.pathname + txId) throw new Error("Previous index URL escaped gateway");
  const response = await fetcher(url.toString());
  if (!response.ok) throw new Error(`Previous index transaction returned ${response.status}`);
  const length = response.headers.get("content-length");
  if (length && Number(length) > MAX_INDEX_BYTES) throw new Error("Previous index exceeds byte limit");
  if (!response.body) throw new Error("Previous index body is unavailable");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_INDEX_BYTES) throw new Error("Previous index exceeds byte limit");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  return Buffer.concat(chunks, size);
}

export function bindLocalPrevious(fetched, supplied) {
  if (supplied && !Buffer.from(fetched).equals(Buffer.from(supplied))) {
    throw new Error("Supplied previous index file differs from the bound transaction bytes");
  }
  return JSON.parse(Buffer.from(fetched).toString("utf8"));
}
