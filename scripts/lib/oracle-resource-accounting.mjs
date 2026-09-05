const requireValue = (condition, message) => {
  if (!condition) throw new Error(message);
};

export const PHASE1_RESOURCE_LIMITS = Object.freeze({
  final_p99_ms: 50,
  hard_timeout_ms: 30000,
  oracle_calls: 2430387,
  total_query_ms: 8474852,
  elapsed_wall_seconds: 2119,
});

class Heap {
  constructor(before) {
    this.values = [];
    this.before = before;
  }

  get size() { return this.values.length; }
  get first() { return this.values[0]; }

  push(value) {
    const values = this.values;
    let index = values.length;
    values.push(value);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.before(value, values[parent])) break;
      values[index] = values[parent];
      index = parent;
    }
    values[index] = value;
  }

  pop() {
    const first = this.first;
    const last = this.values.pop();
    if (!this.size) return first;
    let index = 0;
    while (index * 2 + 1 < this.size) {
      let child = index * 2 + 1;
      if (child + 1 < this.size && this.before(this.values[child + 1], this.values[child])) child += 1;
      if (!this.before(this.values[child], last)) break;
      this.values[index] = this.values[child];
      index = child;
    }
    this.values[index] = last;
    return first;
  }
}

export class ExactP99 {
  constructor() {
    this.lower = new Heap((a, b) => a > b);
    this.upper = new Heap((a, b) => a < b);
  }

  get count() { return this.lower.size + this.upper.size; }
  get value() { return this.lower.first ?? null; }

  add(value) {
    requireValue(Number.isFinite(value) && value >= 0, "latency must be finite and nonnegative");
    if (!this.lower.size || value <= this.lower.first) this.lower.push(value);
    else this.upper.push(value);
    const rank = Math.ceil(99 * this.count / 100);
    while (this.lower.size > rank) this.upper.push(this.lower.pop());
    while (this.lower.size < rank) this.lower.push(this.upper.pop());
    return this.value;
  }
}

const depthBand = (value) => value <= 7 ? "0-7" : value <= 15 ? "8-15"
  : value <= 31 ? "16-31" : value <= 63 ? "32-63" : "64+";
const bitBand = (value) => value === null ? "unavailable" : value === 0 ? "0"
  : value <= 5 ? "1-5" : value <= 15 ? "6-15" : value <= 31 ? "16-31"
    : value <= 63 ? "32-63" : "64+";
const slower = (a, b) => b.elapsed_ms - a.elapsed_ms || a.sequence - b.sequence;

const checkedRecord = (input, sequence) => {
  requireValue(input.sequence === sequence, "query sequence must be complete and ordered");
  for (const key of ["slice_id", "canonical_type", "canonical_representation_id", "worker_id", "status", "disposition"])
    requireValue(typeof input[key] === "string" && input[key].length > 0, `${key} is required`);
  requireValue(Number.isFinite(input.elapsed_ms) && input.elapsed_ms >= 0, "elapsed_ms is invalid");
  requireValue(Number.isSafeInteger(input.target_depth) && input.target_depth >= 0, "target_depth is invalid");
  for (const key of ["highest_weight", "target_weight"])
    requireValue(Array.isArray(input[key]) && input[key].length > 0 && input[key].every(Number.isSafeInteger),
      `${key} must be an integer vector`);
  requireValue(input.highest_weight.length === input.target_weight.length, "weight dimensions differ");
  requireValue(input.multiplicity === null || (typeof input.multiplicity === "string" && /^(0|[1-9][0-9]*)$/.test(input.multiplicity)),
    "multiplicity must be a nonnegative integer string or null");
  requireValue(input.status !== "ok" || input.multiplicity !== null, "successful query needs a multiplicity");
  const multiplicity = input.multiplicity === null ? null : BigInt(input.multiplicity);
  return {
    ...structuredClone(input),
    multiplicity_bit_length: multiplicity === null ? null : multiplicity === 0n ? 0 : multiplicity.toString(2).length,
    label_range: multiplicity === null ? "unavailable" : multiplicity <= 31n ? "inside_0_31" : "outside_above_31",
  };
};

// The caller writes every attempt to its trace and enforces the worker timer.
// This component accounts for finished attempts and supplies resource decisions.
export class OracleResourceAccounting {
  constructor(limits = PHASE1_RESOURCE_LIMITS) {
    for (const key of Object.keys(PHASE1_RESOURCE_LIMITS))
      requireValue(Number.isFinite(limits[key]) && limits[key] > 0, `${key} limit is invalid`);
    requireValue(Number.isSafeInteger(limits.oracle_calls), "call limit must be an integer");
    this.limits = Object.freeze({ ...limits });
    this.p99 = new ExactP99();
    this.queryMs = 0;
    this.wallSeconds = 0;
    this.top = [];
    this.groups = Object.fromEntries([
      "canonical_type", "canonical_representation_id", "target_depth_band",
      "multiplicity_bit_length_band", "label_range", "status", "disposition",
    ].map((key) => [key, new Map()]));
    this.firstHold = null;
    this.finished = false;
    this.complete = false;
  }

  hold(reason, trigger = null) {
    this.firstHold ??= { reason, triggering_query: trigger ? structuredClone(trigger) : null };
  }

  checkWall(elapsedWallSeconds, trigger = null) {
    requireValue(Number.isFinite(elapsedWallSeconds) && elapsedWallSeconds >= this.wallSeconds,
      "wall time must be finite and monotonic");
    this.wallSeconds = elapsedWallSeconds;
    if (this.wallSeconds > this.limits.elapsed_wall_seconds) this.hold("wall_time_limit", trigger);
  }

  observe(input, elapsedWallSeconds) {
    requireValue(!this.finished, "resource record is already final");
    const record = checkedRecord(input, this.p99.count + 1);
    // Check the caller's clock before changing any accumulated query state.
    this.checkWall(elapsedWallSeconds, record);
    this.p99.add(record.elapsed_ms);
    this.queryMs += record.elapsed_ms;
    if (this.top.length < 50 || slower(record, this.top[this.top.length - 1]) < 0) {
      this.top.push(record);
      this.top.sort(slower);
      this.top.length = Math.min(50, this.top.length);
    }
    const keys = {
      canonical_type: record.canonical_type,
      canonical_representation_id: record.canonical_representation_id,
      target_depth_band: depthBand(record.target_depth),
      multiplicity_bit_length_band: bitBand(record.multiplicity_bit_length),
      label_range: record.label_range,
      status: record.status,
      disposition: record.disposition,
    };
    for (const [dimension, key] of Object.entries(keys)) {
      const group = this.groups[dimension].get(key) ?? { key, calls: 0, total_query_ms: 0, maximum_ms: 0 };
      group.calls += 1;
      group.total_query_ms += record.elapsed_ms;
      group.maximum_ms = Math.max(group.maximum_ms, record.elapsed_ms);
      this.groups[dimension].set(key, group);
    }
    if (record.status === "hard_timeout" || record.elapsed_ms >= this.limits.hard_timeout_ms)
      this.hold("hard_timeout", record);
    else if (record.status !== "ok") this.hold("oracle_query_failure", record);
    if (this.p99.count > this.limits.oracle_calls) this.hold("oracle_call_limit", record);
    if (this.queryMs > this.limits.total_query_ms) this.hold("total_query_time_limit", record);
    return { record: structuredClone(record), hold: structuredClone(this.firstHold) };
  }

  finish({ complete, elapsedWallSeconds }) {
    requireValue(!this.finished, "resource record is already final");
    requireValue(typeof complete === "boolean", "completion status is required");
    this.checkWall(elapsedWallSeconds);
    this.complete = complete;
    if (!complete || this.p99.count === 0) this.hold("incomplete_call_set");
    else if (this.p99.value > this.limits.final_p99_ms) this.hold("final_p99_limit");
    this.finished = true;
    return this.snapshot();
  }

  snapshot() {
    return {
      schema: "ilxyr.oracle_resource_accounting.v1",
      status: this.firstHold ? "hold" : this.finished ? "resource_pass" : "collecting",
      complete_call_set: this.finished && this.complete,
      limits: { ...this.limits },
      calls: this.p99.count,
      total_query_ms: this.queryMs,
      elapsed_wall_seconds: this.wallSeconds,
      cumulative_p99_ms: this.p99.value,
      p99_decision_stage: this.finished && this.complete ? "final" : "progress_only",
      fractions: {
        calls: this.p99.count / this.limits.oracle_calls,
        query_ms: this.queryMs / this.limits.total_query_ms,
        wall_seconds: this.wallSeconds / this.limits.elapsed_wall_seconds,
      },
      hold: structuredClone(this.firstHold),
      top_50: structuredClone(this.top),
      breakdowns: Object.fromEntries(Object.entries(this.groups).map(([dimension, groups]) => [
        dimension, [...groups.values()].map((group) => ({
          ...group, mean_ms: group.total_query_ms / group.calls,
        })).sort((a, b) => a.key.localeCompare(b.key)),
      ])),
    };
  }
}
