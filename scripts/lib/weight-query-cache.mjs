import { createHash } from 'node:crypto';
import { queryKey } from './weight-candidates-v2.mjs';

export class SelectionHold extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}
const requireValue = (ok, reason) => { if (!ok) throw new SelectionHold(reason); };
const positive = (n, maximum) => Number.isSafeInteger(n) && n > 0 && n <= maximum;

export function canonicalQuery(candidate) {
  const { canonical_type: type, highest_weight: highest, target_weight: target } = candidate;
  requireValue(typeof type === 'string' && /^[A-G][1-8]$/.test(type), 'invalid_query_type');
  for (const values of [highest, target])
    requireValue(Array.isArray(values) && values.length === Number(type[1]) &&
      values.every(Number.isSafeInteger), 'invalid_query_weight');
  requireValue(highest.every(v => v >= 0), 'invalid_highest_weight');
  const key = queryKey(type, highest, target);
  requireValue(candidate.query_key === undefined || candidate.query_key === key, 'query_identity_differs');
  return key;
}

// Persistent storage consists of these fixed buffers. Per-lookup strings are
// bounded by maxKeyBytes and maxValueBytes. Process memory belongs to the host limit.
export class ExactQueryCache {
  constructor({ oracleSha256, maxEntries, maxPayloadBytes, maxKeyBytes = 512, maxValueBytes = 4096 }) {
    requireValue(typeof oracleSha256 === 'string' && /^[a-f0-9]{64}$/.test(oracleSha256), 'invalid_oracle_identity');
    requireValue(positive(maxEntries, 1000000) && positive(maxPayloadBytes, 512 * 1024 * 1024) &&
      positive(maxKeyBytes, 4096) && positive(maxValueBytes, 65536), 'invalid_cache_limits');
    this.oracleSha256 = oracleSha256;
    this.maxEntries = maxEntries; this.maxKeyBytes = maxKeyBytes; this.maxValueBytes = maxValueBytes;
    let slots = 2; while (slots < 2 * maxEntries) slots *= 2;
    this.slots = new Uint32Array(slots);
    this.metadata = new Uint32Array(maxEntries * 4);
    this.payload = Buffer.alloc(maxPayloadBytes);
    this.entries = 0; this.usedBytes = 0;
  }

  locate(candidate, oracleSha256) {
    requireValue(oracleSha256 === this.oracleSha256, 'oracle_identity_differs');
    const key = Buffer.from(canonicalQuery(candidate));
    requireValue(key.length <= this.maxKeyBytes, 'query_key_size_limit');
    let slot = createHash('sha256').update(key).digest().readUInt32LE(0) & (this.slots.length - 1);
    while (this.slots[slot]) {
      const entry = this.slots[slot] - 1; const base = entry * 4;
      const start = this.metadata[base]; const keyLength = this.metadata[base + 1];
      if (keyLength === key.length && this.payload.subarray(start, start + keyLength).equals(key))
        return { slot, entry, key };
      slot = (slot + 1) & (this.slots.length - 1);
    }
    return { slot, entry: null, key };
  }

  get(candidate, oracleSha256) {
    const located = this.locate(candidate, oracleSha256);
    if (located.entry === null) return null;
    const base = located.entry * 4;
    const start = this.metadata[base] + this.metadata[base + 1];
    return { multiplicity: this.payload.toString('utf8', start, start + this.metadata[base + 2]),
      source_query_sequence: this.metadata[base + 3] };
  }

  requireRoom(candidate, oracleSha256) {
    const { entry, key } = this.locate(candidate, oracleSha256);
    if (entry !== null) return;
    requireValue(this.entries < this.maxEntries &&
      this.usedBytes + key.length + this.maxValueBytes <= this.payload.length, 'cache_capacity');
  }

  put(candidate, oracleSha256, multiplicity, sourceQuerySequence) {
    requireValue(typeof multiplicity === 'string' && /^(0|[1-9][0-9]*)$/.test(multiplicity) &&
      multiplicity.length <= this.maxValueBytes, 'invalid_oracle_value');
    requireValue(positive(sourceQuerySequence, 0xffffffff), 'invalid_source_query_sequence');
    const { slot, entry, key } = this.locate(candidate, oracleSha256);
    if (entry !== null) {
      requireValue(this.get(candidate, oracleSha256).multiplicity === multiplicity, 'conflicting_cached_value');
      return;
    }
    // Reserve for the declared maximum value before the oracle call as well.
    this.requireRoom(candidate, oracleSha256);
    const bytes = Buffer.from(multiplicity); const base = this.entries * 4;
    this.metadata.set([this.usedBytes, key.length, bytes.length, sourceQuerySequence], base);
    key.copy(this.payload, this.usedBytes); bytes.copy(this.payload, this.usedBytes + key.length);
    this.usedBytes += key.length + bytes.length;
    this.slots[slot] = ++this.entries;
  }

  snapshot() {
    return { oracle_sha256: this.oracleSha256, entries: this.entries, used_payload_bytes: this.usedBytes,
      allocated_buffer_bytes: this.payload.byteLength + this.metadata.byteLength + this.slots.byteLength,
      max_entries: this.maxEntries, max_payload_bytes: this.payload.length,
      max_key_bytes: this.maxKeyBytes, max_value_bytes: this.maxValueBytes };
  }
}
