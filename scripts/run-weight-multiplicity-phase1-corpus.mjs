#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  createReadStream,
  createWriteStream,
} from "node:fs";
import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { totalmem } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { createGzip, gzipSync } from "node:zlib";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const defaultPlan = resolve(
  root,
  "examples/weight-multiplicity/phase1-corpus-plan-v1.json",
);
const defaultManifest = resolve(
  root,
  "examples/weight-multiplicity/phase06-reduced-corpus-manifest-v1.json",
);
const defaultSystems = resolve(
  root,
  "examples/weight-multiplicity/phase1-root-systems-v1.json",
);

class HoldError extends Error {
  constructor(reason, details = {}) {
    super(reason);
    this.name = "HoldError";
    this.reason = reason;
    this.details = details;
  }
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sleep = (milliseconds) => new Promise((resolvePromise) =>
  setTimeout(resolvePromise, milliseconds));

const hashFile = async (path) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
};

const parseArguments = (values) => {
  const options = {
    plan: defaultPlan,
    manifest: defaultManifest,
    systems: defaultSystems,
    lie: null,
    lieSource: null,
    stdbuf: null,
    zero: null,
    zeroCommit: null,
    out: null,
    smoke: false,
    pilotOnly: false,
    selfTest: false,
  };
  const names = {
    "--plan": "plan",
    "--manifest": "manifest",
    "--systems": "systems",
    "--lie": "lie",
    "--lie-source": "lieSource",
    "--stdbuf": "stdbuf",
    "--zero": "zero",
    "--zero-commit": "zeroCommit",
    "--out": "out",
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--smoke") options.smoke = true;
    else if (value === "--pilot-only") options.pilotOnly = true;
    else if (value === "--self-test") options.selfTest = true;
    else {
      const name = names[value];
      if (!name) throw new Error(`unknown argument: ${value}`);
      const next = values[++index];
      if (!next) throw new Error(`${value} requires a value`);
      options[name] = next;
    }
  }
  return options;
};

const fnv1a = (text) => {
  let hash = 0x811c9dc5;
  for (const byte of Buffer.from(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

const makeRandom = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const randomInteger = (random, maximum) =>
  maximum <= 1 ? 0 : Math.floor(random() * maximum);

const weakComposition = (total, length, random, balanced = false) => {
  const output = Array(length).fill(0);
  if (balanced) {
    const base = Math.floor(total / length);
    output.fill(base);
    total -= base * length;
  }
  for (let index = 0; index < total; index += 1)
    output[randomInteger(random, length)] += 1;
  return output;
};

const percentile = (values, probability) => {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(probability * ordered.length) - 1)];
};

const mean = (values) => values.length === 0 ? null
  : values.reduce((sum, value) => sum + value, 0) / values.length;

const groupBy = (values, keyFor) => {
  const groups = {};
  for (const value of values) {
    const key = keyFor(value);
    (groups[key] ??= []).push(value);
  }
  return groups;
};

const wilsonLower = (successes, attempts, z = 1.6448536269514722) => {
  if (attempts === 0 || successes === 0) return 0;
  const observed = successes / attempts;
  const denominator = 1 + (z * z) / attempts;
  const center = observed + (z * z) / (2 * attempts);
  const spread = z * Math.sqrt(
    (observed * (1 - observed) + (z * z) / (4 * attempts)) / attempts,
  );
  return Math.max(0, (center - spread) / denominator);
};

const stratumFor = (multiplicity) => {
  const value = BigInt(multiplicity);
  if (value === 0n) return "0";
  if (value === 1n) return "1";
  if (value <= 7n) return "2-7";
  if (value <= 31n) return "8-31";
  return ">31";
};

const subtractRootCombination = (highest, cartan, coefficient) =>
  highest.map((value, row) => value - coefficient.reduce(
    (sum, amount, column) => sum + cartan[row][column] * amount,
    0,
  ));

const reflect = (weight, coefficient, cartan, simple) => {
  const pairing = weight[simple];
  const reflectedWeight = weight.map(
    (value, row) => value - pairing * cartan[row][simple],
  );
  const reflectedCoefficient = [...coefficient];
  reflectedCoefficient[simple] += pairing;
  return { weight: reflectedWeight, coefficient: reflectedCoefficient };
};

const reflectWeight = (weight, cartan, simple) => {
  const pairing = weight[simple];
  return weight.map((value, row) => value - pairing * cartan[row][simple]);
};

const orientDominant = (weight, coefficient, cartan) => {
  let state = { weight: [...weight], coefficient: [...coefficient] };
  for (let iteration = 0; iteration < 4096; iteration += 1) {
    const simple = state.weight.findIndex((value) => value < 0);
    if (simple < 0) return state;
    state = reflect(state.weight, state.coefficient, cartan, simple);
  }
  return null;
};

const antiDominant = (highest, cartan) => {
  let state = { weight: [...highest], coefficient: Array(highest.length).fill(0) };
  for (let iteration = 0; iteration < 4096; iteration += 1) {
    const simple = state.weight.findIndex((value) => value > 0);
    if (simple < 0) return state;
    state = reflect(state.weight, state.coefficient, cartan, simple);
  }
  return null;
};

const makeNonDominant = (dominant, cartan, random) => {
  let state = { weight: [...dominant.weight], coefficient: [...dominant.coefficient] };
  const steps = 1 + randomInteger(random, 3);
  for (let step = 0; step < steps; step += 1) {
    const choices = state.weight
      .map((value, index) => value > 0 ? index : -1)
      .filter((index) => index >= 0);
    if (choices.length === 0) break;
    state = reflect(
      state.weight,
      state.coefficient,
      cartan,
      choices[randomInteger(random, choices.length)],
    );
  }
  return state.weight.some((value) => value < 0) ? state : null;
};

const queryKey = (type, highest, target) =>
  `${type}\t${highest.join(",")}\t${target.join(",")}`;

const mapWeight = (weight, type, coordinateMapping) => {
  const indices = coordinateMapping[type];
  return indices ? indices.map((index) => weight[index]) : [...weight];
};

const lieCommand = (candidate, coordinateMapping) => {
  const highest = mapWeight(candidate.highest_weight, candidate.canonical_type, coordinateMapping);
  const target = mapWeight(candidate.target_weight, candidate.canonical_type, coordinateMapping);
  return `dom_char([${highest.join(",")}],[${target.join(",")}],${candidate.canonical_type})`;
};

const readRss = async (pid) => {
  try {
    const status = await readFile(`/proc/${pid}/status`, "utf8");
    const match = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
    return match ? Number(match[1]) * 1024 : null;
  } catch {
    return null;
  }
};

class PersistentLie {
  constructor({ id, executable, stdbuf, hardTimeoutMs }) {
    this.id = id;
    this.executable = executable;
    this.stdbuf = stdbuf;
    this.hardTimeoutMs = hardTimeoutMs;
  }

  async start() {
    const program = this.stdbuf ?? this.executable;
    const arguments_ = this.stdbuf ? ["-oL", "-eL", this.executable] : [];
    this.child = spawn(program, arguments_, {
      cwd: dirname(this.executable),
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.stderr = "";
    this.pending = null;
    this.ignoredLineCount = 0;
    this.lastIgnoredLines = [];
    this.child.stderr.on("data", (chunk) => { this.stderr += chunk; });
    this.child.on("exit", (code, signal) => {
      this.exit = { code, signal };
      if (this.pending) this.rejectPending("process_exit", `LiE exited ${code}/${signal}`);
    });
    this.lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    this.lines.on("line", (line) => {
      const trimmed = line.trim();
      if (/^-?\d+$/.test(trimmed) && this.pending) {
        const pending = this.pending;
        this.pending = null;
        pending.resolve(trimmed);
      } else if (trimmed) {
        this.ignoredLineCount += 1;
        this.lastIgnoredLines.push(line);
        if (this.lastIgnoredLines.length > 16) this.lastIgnoredLines.shift();
      }
    });
    const warm = await this.query("dom_char([1],[1],A1)");
    if (warm.status !== "ok" || warm.multiplicity !== "1")
      throw new Error(`LiE warm-up failed for ${this.id}`);
    this.baselineRss = await readRss(this.child.pid);
    return warm;
  }

  rejectPending(status, message) {
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = null;
    pending.reject(Object.assign(new Error(message), { queryStatus: status }));
  }

  async query(command) {
    const started = performance.now();
    try {
      const multiplicity = await new Promise((resolvePromise, reject) => {
        const timer = setTimeout(() => {
          this.rejectPending("hard_timeout", `LiE exceeded ${this.hardTimeoutMs} ms`);
          this.child.kill("SIGKILL");
        }, this.hardTimeoutMs);
        this.pending = {
          resolve: (value) => { clearTimeout(timer); resolvePromise(value); },
          reject: (error) => { clearTimeout(timer); reject(error); },
        };
        this.child.stdin.write(`${command}\n`, (error) => {
          if (error) this.rejectPending("write_error", error.message);
        });
      });
      return { status: "ok", multiplicity, elapsed_ms: performance.now() - started };
    } catch (error) {
      return {
        status: error.queryStatus ?? "query_error",
        multiplicity: null,
        elapsed_ms: performance.now() - started,
        error: error.message,
      };
    }
  }

  async close() {
    if (!this.child || this.exit) return;
    this.child.stdin.end("quit\n");
    await Promise.race([
      new Promise((resolvePromise) => this.child.once("exit", resolvePromise)),
      sleep(2000).then(() => this.child.kill("SIGKILL")),
    ]);
  }
}

class PersistentZero {
  constructor({ id, executable, hardTimeoutMs }) {
    this.id = id;
    this.executable = executable;
    this.hardTimeoutMs = hardTimeoutMs;
  }

  async start() {
    this.child = spawn(this.executable, ["--serve"], {
      cwd: dirname(this.executable),
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.stderr = "";
    this.child.stderr.on("data", (chunk) => { this.stderr += chunk; });
    this.iterator = createInterface({ input: this.child.stdout, crlfDelay: Infinity })[
      Symbol.asyncIterator
    ]();
    const ready = await this.nextLine(5000);
    if (JSON.parse(ready).status !== "ready") throw new Error(`Zero ${this.id} not ready`);
    this.baselineRss = await readRss(this.child.pid);
  }

  async nextLine(timeoutMs = this.hardTimeoutMs) {
    return await Promise.race([
      this.iterator.next().then((entry) => {
        if (entry.done) throw new Error(`Zero closed output: ${this.stderr}`);
        return entry.value;
      }),
      sleep(timeoutMs).then(() => { throw Object.assign(new Error("Zero timeout"), { timeout: true }); }),
    ]);
  }

  async query(candidate) {
    const started = performance.now();
    try {
      this.child.stdin.write(`${queryKey(
        candidate.canonical_type,
        candidate.highest_weight,
        candidate.target_weight,
      )}\n`);
      const value = JSON.parse(await this.nextLine());
      return {
        status: value.multiplicity === undefined ? "error" : "ok",
        multiplicity: value.multiplicity ?? null,
        elapsed_ms: performance.now() - started,
        error: value.error ?? null,
      };
    } catch (error) {
      this.child.kill("SIGKILL");
      return {
        status: error.timeout ? "timeout" : "error",
        multiplicity: null,
        elapsed_ms: performance.now() - started,
        error: error.message,
      };
    }
  }

  async close() {
    if (!this.child || this.child.exitCode !== null) return;
    this.child.stdin.end();
    await Promise.race([
      new Promise((resolvePromise) => this.child.once("exit", resolvePromise)),
      sleep(2000).then(() => this.child.kill("SIGKILL")),
    ]);
  }
}

const startLieWorkers = async (count, options) => {
  const workers = [];
  for (let index = 0; index < count; index += 1) {
    const worker = new PersistentLie({ id: `lie-${index + 1}`, ...options });
    await worker.start();
    workers.push(worker);
  }
  return workers;
};

const startZeroWorkers = async (count, options) => {
  const workers = [];
  for (let index = 0; index < count; index += 1) {
    const worker = new PersistentZero({ id: `zero-${index + 1}`, ...options });
    await worker.start();
    workers.push(worker);
  }
  return workers;
};

const executeWithWorkers = async (workers, items, handler) => {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(workers.map(async (worker, workerIndex) => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await handler(worker, items[index], index, workerIndex);
    }
  }));
  return results;
};

class ResourceMonitor {
  constructor({ lieWorkers, zeroWorkers, plan }) {
    this.lieWorkers = lieWorkers;
    this.zeroWorkers = zeroWorkers;
    this.plan = plan;
    this.samples = 0;
    this.peakAggregateRss = 0;
    this.peaks = Object.fromEntries(lieWorkers.map((worker) => [worker.id, worker.baselineRss]));
    this.zeroPeaks = Object.fromEntries(zeroWorkers.map((worker) => [worker.id, worker.baselineRss]));
    this.failure = null;
    this.sampling = false;
  }

  async sample() {
    if (this.sampling) return;
    this.sampling = true;
    try {
      const all = [...this.lieWorkers, ...this.zeroWorkers];
      const values = await Promise.all(all.map((worker) => readRss(worker.child.pid)));
      this.samples += 1;
      let aggregate = 0;
      values.forEach((value, index) => {
        if (value === null) return;
        aggregate += value;
        const worker = all[index];
        if (index < this.lieWorkers.length)
          this.peaks[worker.id] = Math.max(this.peaks[worker.id] ?? 0, value);
        else this.zeroPeaks[worker.id] = Math.max(this.zeroPeaks[worker.id] ?? 0, value);
      });
      this.peakAggregateRss = Math.max(this.peakAggregateRss, aggregate);
      for (const worker of this.lieWorkers) {
        const peak = this.peaks[worker.id];
        const incremental = peak === null || worker.baselineRss === null
          ? null : Math.max(0, peak - worker.baselineRss);
        if (incremental === null && this.plan.memory.rss_required !== false) {
          this.failure = { reason: "lie_rss_unavailable", worker_id: worker.id };
        } else if (incremental > this.plan.memory.sustained_divergence_stop_bytes_per_worker) {
          this.failure = {
            reason: "sustained_rss_divergence",
            worker_id: worker.id,
            incremental_bytes: incremental,
            limit_bytes: this.plan.memory.sustained_divergence_stop_bytes_per_worker,
          };
        } else if (incremental > this.plan.memory.formal_limit_bytes_per_worker) {
          this.failure = {
            reason: "formal_worker_rss_limit",
            worker_id: worker.id,
            incremental_bytes: incremental,
          };
        }
      }
      if (aggregate > this.plan.memory.aggregate_worker_rss_stop_bytes) {
        this.failure = {
          reason: "aggregate_worker_rss_limit",
          aggregate_bytes: aggregate,
          limit_bytes: this.plan.memory.aggregate_worker_rss_stop_bytes,
        };
      }
    } finally {
      this.sampling = false;
    }
  }

  start() {
    this.timer = setInterval(
      () => this.sample(),
      this.plan.memory.sample_interval_ms,
    );
  }

  assertOkay() {
    if (this.failure) throw new HoldError(this.failure.reason, this.failure);
  }

  async stop() {
    clearInterval(this.timer);
    await this.sample();
    return {
      samples: this.samples,
      sample_interval_ms: this.plan.memory.sample_interval_ms,
      lie_worker_baseline_rss_bytes: Object.fromEntries(
        this.lieWorkers.map((worker) => [worker.id, worker.baselineRss]),
      ),
      lie_worker_peak_rss_bytes: this.peaks,
      lie_worker_peak_incremental_rss_bytes: Object.fromEntries(
        this.lieWorkers.map((worker) => [
          worker.id,
          Math.max(0, (this.peaks[worker.id] ?? 0) - (worker.baselineRss ?? 0)),
        ]),
      ),
      zero_worker_peak_rss_bytes: this.zeroPeaks,
      peak_aggregate_oracle_rss_bytes: this.peakAggregateRss,
      divergence_limit_bytes_per_lie_worker:
        this.plan.memory.sustained_divergence_stop_bytes_per_worker,
      formal_limit_bytes_per_lie_worker:
        this.plan.memory.formal_limit_bytes_per_worker,
      failure: this.failure,
    };
  }
}

class BudgetTracker {
  constructor(plan) {
    this.plan = plan;
    this.started = performance.now();
    this.calls = 0;
    this.queryMs = 0;
    this.latencies = [];
    this.frozen = null;
    this.progressPath = null;
    this.lastProgressWrite = 0;
  }

  setProgressPath(path) {
    this.progressPath = path;
  }

  async checkpoint(force = false, status = "running") {
    if (!this.progressPath || !this.frozen) return;
    const now = performance.now();
    if (!force && now - this.lastProgressWrite < 1000) return;
    this.lastProgressWrite = now;
    const snapshot = this.snapshot();
    const progress = {
      schema: "ilxyr.weight_multiplicity_phase1_generation_progress.v1",
      status,
      oracle_calls: snapshot.oracle_calls,
      total_query_ms: snapshot.total_query_ms,
      elapsed_wall_seconds: snapshot.elapsed_wall_seconds,
      call_budget_fraction: snapshot.oracle_calls /
        this.frozen.binding_call_limit,
      query_ms_budget_fraction: snapshot.total_query_ms /
        this.frozen.binding_query_ms_limit,
      wall_budget_fraction: snapshot.elapsed_wall_seconds /
        this.frozen.binding_wall_seconds,
      binding_limits: {
        oracle_calls: this.frozen.binding_call_limit,
        query_ms: this.frozen.binding_query_ms_limit,
        wall_seconds: this.frozen.binding_wall_seconds,
      },
    };
    const temporary = `${this.progressPath}.tmp`;
    await writeFile(temporary, stableJson(progress));
    await rename(temporary, this.progressPath);
  }

  observe(result) {
    this.calls += 1;
    this.queryMs += result.elapsed_ms;
    this.latencies.push(result.elapsed_ms);
    if (result.status !== "ok")
      throw new HoldError("lie_query_failure", result);
    if (result.elapsed_ms > 1000)
      throw new HoldError("lie_per_query_time_limit", result);
    if (this.frozen) {
      if (this.calls > this.frozen.binding_call_limit)
        throw new HoldError("frozen_oracle_call_budget_reached", this.snapshot());
      if (this.queryMs > this.frozen.binding_query_ms_limit)
        throw new HoldError("frozen_oracle_cpu_budget_reached", this.snapshot());
      if ((performance.now() - this.started) / 1000 > this.frozen.binding_wall_seconds)
        throw new HoldError("frozen_generation_wall_budget_reached", this.snapshot());
    }
  }

  freeze(pilotSlices, fixedCalls, workers) {
    let expectedVariableCalls = 0;
    let upperVariableCalls = 0;
    let expectedVariableQueryMs = 0;
    let upperVariableQueryMs = 0;
    for (const slice of pilotSlices) {
      if (slice.hits === 0)
        throw new HoldError("pilot_zero_yield", { slice: slice.id });
      const observed = slice.hits / slice.attempts;
      const lower = wilsonLower(slice.hits, slice.attempts);
      slice.observed_yield = observed;
      slice.one_sided_wilson_95_lower = lower;
      slice.expected_generation_calls = Math.ceil(slice.required / observed);
      slice.upper_95_generation_calls = Math.ceil(slice.required / lower);
      expectedVariableCalls += slice.expected_generation_calls;
      upperVariableCalls += slice.upper_95_generation_calls;
      expectedVariableQueryMs +=
        slice.expected_generation_calls * slice.query_ms.mean;
      upperVariableQueryMs += slice.upper_95_generation_calls * Math.max(
        this.plan.budget.preflight_p95_query_ms,
        slice.query_ms.p95,
      );
    }
    const expectedCalls = this.calls + fixedCalls + expectedVariableCalls;
    const upper95Calls = this.calls + fixedCalls + upperVariableCalls;
    const bindingCallLimit = Math.ceil(upper95Calls * 1.15);
    const expectedQueryMs = this.queryMs +
      fixedCalls * this.plan.budget.preflight_mean_query_ms +
      expectedVariableQueryMs;
    const upper95QueryMs = this.queryMs +
      fixedCalls * this.plan.budget.preflight_p95_query_ms +
      upperVariableQueryMs;
    const bindingQueryMsLimit = Math.ceil(upper95QueryMs * 1.15);
    const bindingWallSeconds = Math.ceil(Math.max(
      600,
      (bindingQueryMsLimit / 1000 / workers) * 2,
    ));
    if (bindingWallSeconds > this.plan.budget.outer_workload_timeout_seconds)
      throw new HoldError("derived_budget_exceeds_outer_authorization", {
        binding_wall_seconds: bindingWallSeconds,
        outer_workload_timeout_seconds: this.plan.budget.outer_workload_timeout_seconds,
      });
    this.frozen = {
      schema: "ilxyr.weight_multiplicity_phase1_frozen_oracle_budget.v1",
      status: "frozen_before_first_corpus_record",
      pilot_oracle_calls: this.calls,
      pilot_slices: pilotSlices,
      fixed_direct_calls: fixedCalls,
      expected_total_calls: expectedCalls,
      upper_95_total_calls: upper95Calls,
      binding_call_limit: bindingCallLimit,
      expected_query_ms: expectedQueryMs,
      upper_95_query_ms: upper95QueryMs,
      binding_query_ms_limit: bindingQueryMsLimit,
      binding_wall_seconds: bindingWallSeconds,
      workers,
      operational_margin_per_mille: 150,
      latency_basis: {
        mean_ms: this.plan.budget.preflight_mean_query_ms,
        p95_ms: this.plan.budget.preflight_p95_query_ms,
      },
    };
    return this.frozen;
  }

  snapshot() {
    return {
      oracle_calls: this.calls,
      total_query_ms: this.queryMs,
      mean_query_ms: mean(this.latencies),
      p50_query_ms: percentile(this.latencies, 0.5),
      p95_query_ms: percentile(this.latencies, 0.95),
      maximum_query_ms: this.latencies.length ? Math.max(...this.latencies) : null,
      elapsed_wall_seconds: (performance.now() - this.started) / 1000,
      frozen_budget: this.frozen,
    };
  }
}

const prepareRepresentations = (manifest, rootSystems) => manifest.representations.map((entry) => {
  const system = rootSystems.systems[entry.canonical_type];
  if (!system) throw new Error(`missing root system ${entry.canonical_type}`);
  const anti = antiDominant(entry.highest_weight, system.cartan);
  if (!anti) throw new Error(`could not find anti-dominant endpoint for ${entry.canonical_id}`);
  return {
    ...entry,
    system,
    anti_coefficient: anti.coefficient,
    maximum_depth: anti.coefficient.reduce((sum, value) => sum + value, 0),
  };
});

const interiorCoefficient = (representation, desired, random) => {
  const maximum = representation.maximum_depth;
  if (maximum <= 0) return Array(representation.rank).fill(0);
  const range = desired === "8-31" ? [0.32, 0.72]
    : desired === "2-7" ? [0.08, 0.55]
      : [0.0, 0.45];
  const fraction = range[0] + (range[1] - range[0]) * random();
  if (random() < 0.7) {
    return representation.anti_coefficient.map((value) => Math.max(
      0,
      Math.round(value * fraction) + randomInteger(random, 3) - 1,
    ));
  }
  const depth = Math.max(0, Math.min(maximum,
    Math.round(maximum * fraction)));
  return weakComposition(
    depth,
    representation.rank,
    random,
    desired === "8-31",
  );
};

const candidateFor = (representation, desired, status, random, natural = false) => {
  const highest = representation.highest_weight;
  const cartan = representation.system.cartan;
  let coefficient;
  if (natural) {
    const draw = random();
    if (draw < 0.15) {
      coefficient = [...representation.anti_coefficient];
      coefficient[randomInteger(random, representation.rank)] +=
        1 + randomInteger(random, Math.max(2, representation.highest_weight_height + 1));
    } else if (draw < 0.3) {
      coefficient = Array(representation.rank).fill(0);
    } else {
      coefficient = interiorCoefficient(representation, "natural", random);
    }
  } else if (desired === "0") {
    coefficient = [...representation.anti_coefficient];
    coefficient[randomInteger(random, representation.rank)] +=
      1 + randomInteger(random, Math.max(2, representation.highest_weight_height + 1));
  } else if (desired === "1" && random() < 0.2) {
    let orbit = { weight: [...highest], coefficient: Array(representation.rank).fill(0) };
    const steps = 1 + randomInteger(random, representation.rank * 4 + 1);
    for (let step = 0; step < steps; step += 1) {
      const choices = orbit.weight
        .map((value, index) => value !== 0 ? index : -1)
        .filter((index) => index >= 0);
      if (!choices.length) break;
      orbit = reflect(
        orbit.weight,
        orbit.coefficient,
        cartan,
        choices[randomInteger(random, choices.length)],
      );
    }
    coefficient = orbit.coefficient;
  } else {
    coefficient = interiorCoefficient(representation, desired, random);
  }
  const target = subtractRootCombination(highest, cartan, coefficient);
  const dominant = orientDominant(target, coefficient, cartan);
  if (!dominant) return null;
  const oriented = status === "non_dominant"
    ? makeNonDominant(dominant, cartan, random)
    : dominant;
  if (!oriented) return null;
  const targetStatus = oriented.weight.some((value) => value < 0)
    ? "non_dominant" : "dominant";
  if (targetStatus !== status) return null;
  return {
    canonical_type: representation.canonical_type,
    legacy_zero_type: representation.legacy_zero_type,
    canonical_representation_id: representation.canonical_id,
    legacy_zero_representation_id: representation.legacy_zero_id,
    rank: representation.rank,
    representation_dimension: representation.representation_dimension,
    highest_weight_height: representation.highest_weight_height,
    highest_weight: [...highest],
    target_weight: oriented.weight,
    target_status: targetStatus,
    target_depth: oriented.coefficient.reduce((sum, value) => sum + value, 0),
    target_magnitude_l1: oriented.weight.reduce((sum, value) => sum + Math.abs(value), 0),
    dominant_target_key: dominant.weight.join(","),
    desired_stratum: desired,
    query_key: queryKey(representation.canonical_type, highest, oriented.weight),
  };
};

class RepresentationPicker {
  constructor(representations, seed) {
    this.random = makeRandom(seed);
    this.byType = new Map();
    for (const representation of representations) {
      const entries = this.byType.get(representation.canonical_type) ?? [];
      entries.push(representation);
      this.byType.set(representation.canonical_type, entries);
    }
    this.types = [...this.byType.keys()].sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }));
    this.typeCursor = 0;
    this.repCursors = new Map();
  }

  eligible(representation, desired) {
    const dimension = BigInt(representation.representation_dimension);
    if (desired === "8-31") return dimension >= 32n && representation.maximum_depth >= 4;
    if (desired === "2-7") return dimension >= 4n && representation.maximum_depth >= 2;
    return true;
  }

  pick(desired, allowed = null) {
    for (let typeAttempt = 0; typeAttempt < this.types.length; typeAttempt += 1) {
      const type = this.types[this.typeCursor++ % this.types.length];
      const entries = this.byType.get(type).filter((entry) =>
        this.eligible(entry, desired) && (!allowed || allowed(entry)));
      if (!entries.length) continue;
      if (desired === "8-31") entries.sort((left, right) =>
        BigInt(left.representation_dimension) > BigInt(right.representation_dimension) ? -1 : 1);
      const cursor = this.repCursors.get(type) ?? randomInteger(this.random, entries.length);
      this.repCursors.set(type, cursor + 1);
      return entries[cursor % entries.length];
    }
    return null;
  }
}

const queryLieBatch = async ({ workers, candidates, coordinateMapping, budget, monitor }) => {
  const results = await executeWithWorkers(workers, candidates, async (worker, candidate) =>
    await worker.query(lieCommand(candidate, coordinateMapping)));
  for (const result of results) budget.observe(result);
  await budget.checkpoint();
  monitor.assertOkay();
  return results;
};

const runPilotSlice = async ({
  id,
  representations,
  desired,
  status,
  attempts,
  required,
  seed,
  workers,
  coordinateMapping,
  budget,
  monitor,
}) => {
  const picker = new RepresentationPicker(representations, seed ^ fnv1a(id));
  const random = makeRandom(seed ^ fnv1a(`${id}:candidate`));
  const candidates = [];
  const keys = new Set();
  while (candidates.length < attempts) {
    const representation = picker.pick(desired);
    if (!representation) throw new HoldError("pilot_no_eligible_representation", { id });
    const resolvedStatus = status === "mixed"
      ? (candidates.length % 4 === 0 ? "non_dominant" : "dominant")
      : status;
    const candidate = candidateFor(representation, desired, resolvedStatus, random);
    if (!candidate || keys.has(candidate.query_key)) continue;
    keys.add(candidate.query_key);
    candidates.push(candidate);
  }
  const results = await queryLieBatch({
    workers,
    candidates,
    coordinateMapping,
    budget,
    monitor,
  });
  const observed = { "0": 0, "1": 0, "2-7": 0, "8-31": 0, ">31": 0 };
  for (const result of results) observed[stratumFor(result.multiplicity)] += 1;
  return {
    id,
    desired_stratum: desired,
    target_status: status,
    attempts,
    hits: observed[desired],
    required,
    observed_strata: observed,
    query_ms: {
      mean: mean(results.map((entry) => entry.elapsed_ms)),
      p95: percentile(results.map((entry) => entry.elapsed_ms), 0.95),
    },
  };
};

class PartitionWriter {
  constructor(outDirectory, name) {
    this.name = name;
    this.rawPath = resolve(outDirectory, `${name}.ndjson`);
    this.gzipPath = resolve(outDirectory, `${name}.ndjson.gz`);
    this.stream = createWriteStream(this.rawPath, { flags: "wx" });
    this.hash = createHash("sha256");
    this.records = 0;
    this.bytes = 0;
    this.strata = { "0": 0, "1": 0, "2-7": 0, "8-31": 0, ">31": 0 };
    this.statuses = { dominant: 0, non_dominant: 0 };
    this.types = {};
  }

  async write(record) {
    const line = `${JSON.stringify(record)}\n`;
    this.hash.update(line);
    this.bytes += Buffer.byteLength(line);
    if (!this.stream.write(line))
      await new Promise((resolvePromise) => this.stream.once("drain", resolvePromise));
    this.records += 1;
    this.strata[record.multiplicity_stratum] += 1;
    this.statuses[record.target_status] += 1;
    this.types[record.canonical_type] = (this.types[record.canonical_type] ?? 0) + 1;
  }

  async close() {
    this.stream.end();
    await new Promise((resolvePromise, reject) => {
      this.stream.once("finish", resolvePromise);
      this.stream.once("error", reject);
    });
    await pipeline(
      createReadStream(this.rawPath),
      createGzip({ level: 9, mtime: 0 }),
      createWriteStream(this.gzipPath, { flags: "wx" }),
    );
    const compressed = await stat(this.gzipPath);
    const result = {
      partition: this.name,
      records: this.records,
      uncompressed_bytes: this.bytes,
      uncompressed_sha256: this.hash.digest("hex"),
      gzip_bytes: compressed.size,
      gzip_sha256: await hashFile(this.gzipPath),
      file: basename(this.gzipPath),
      multiplicity_strata: this.strata,
      target_statuses: this.statuses,
      per_type: this.types,
    };
    await unlink(this.rawPath);
    return result;
  }
}

const modelRecord = (candidate, partition, index, multiplicity, source) => ({
  id: `${partition}-${String(index + 1).padStart(6, "0")}`,
  partition,
  source,
  canonical_type: candidate.canonical_type,
  legacy_zero_type: candidate.legacy_zero_type,
  rank: candidate.rank,
  canonical_representation_id: candidate.canonical_representation_id,
  legacy_zero_representation_id: candidate.legacy_zero_representation_id,
  representation_dimension: candidate.representation_dimension,
  highest_weight_height: candidate.highest_weight_height,
  highest_weight: candidate.highest_weight,
  target_weight: candidate.target_weight,
  target_status: candidate.target_status,
  target_depth: candidate.target_depth,
  target_magnitude_l1: candidate.target_magnitude_l1,
  multiplicity: String(multiplicity),
  multiplicity_stratum: stratumFor(multiplicity),
  in_exact_range: BigInt(multiplicity) <= 31n,
});

class ZeroDifferential {
  constructor({ workers, plan, seed }) {
    this.workers = workers;
    this.plan = plan;
    this.seed = seed;
    this.covered = new Set();
    this.selected = 0;
    this.completed = 0;
    this.agreements = 0;
    this.unavailable = 0;
    this.records = [];
    this.nextWorker = 0;
  }

  shouldSelect(record, forceAll = false) {
    if (forceAll) return true;
    const coverageKey = [
      record.partition,
      record.canonical_type,
      record.multiplicity_stratum,
      record.target_status,
    ].join("|");
    if (!this.covered.has(coverageKey)) {
      this.covered.add(coverageKey);
      return true;
    }
    const digest = createHash("sha256").update(`${this.seed}|${record.id}`).digest();
    return digest.readUInt32BE(0) % 1000 < this.plan.zero_sample.hash_sample_per_mille;
  }

  async check(records, forceAll = false) {
    const selected = records.filter((record) => this.shouldSelect(record, forceAll));
    if (!selected.length) return;
    const results = await executeWithWorkers(this.workers, selected, async (worker, record, _index, workerIndex) => {
      let result = await worker.query(record);
      if (result.status !== "ok") {
        await worker.close();
        const replacement = new PersistentZero({
          id: worker.id,
          executable: worker.executable,
          hardTimeoutMs: worker.hardTimeoutMs,
        });
        await replacement.start();
        this.workers[workerIndex] = replacement;
      }
      return result;
    });
    for (let index = 0; index < selected.length; index += 1) {
      const record = selected[index];
      const result = results[index];
      this.selected += 1;
      if (result.status === "ok") {
        this.completed += 1;
        const agreement = result.multiplicity === record.multiplicity;
        if (agreement) this.agreements += 1;
        this.records.push({
          record_id: record.id,
          partition: record.partition,
          canonical_type: record.canonical_type,
          multiplicity_stratum: record.multiplicity_stratum,
          target_status: record.target_status,
          lie_multiplicity: record.multiplicity,
          zero_multiplicity: result.multiplicity,
          status: agreement ? "agreement" : "disagreement",
          elapsed_ms: result.elapsed_ms,
        });
        if (!agreement) throw new HoldError("zero_lie_arithmetic_disagreement", {
          record_id: record.id,
          lie_multiplicity: record.multiplicity,
          zero_multiplicity: result.multiplicity,
        });
      } else {
        this.unavailable += 1;
        this.records.push({
          record_id: record.id,
          partition: record.partition,
          canonical_type: record.canonical_type,
          multiplicity_stratum: record.multiplicity_stratum,
          target_status: record.target_status,
          lie_multiplicity: record.multiplicity,
          zero_multiplicity: null,
          status: "unavailable",
          elapsed_ms: result.elapsed_ms,
          error: result.error,
        });
      }
    }
  }

  finalize() {
    const fraction = this.selected === 0 ? 0 : this.completed / this.selected;
    if (fraction * 1000 < this.plan.zero_sample.minimum_completed_fraction_per_mille)
      throw new HoldError("zero_differential_completion_below_floor", {
        selected: this.selected,
        completed: this.completed,
        completion_fraction: fraction,
      });
    return {
      selected: this.selected,
      completed: this.completed,
      agreements: this.agreements,
      disagreements: this.completed - this.agreements,
      unavailable: this.unavailable,
      completion_fraction: fraction,
      minimum_completion_fraction_per_mille:
        this.plan.zero_sample.minimum_completed_fraction_per_mille,
      records: this.records,
    };
  }
}

const createCandidateBatch = ({
  picker,
  slices,
  sliceStats,
  batchSize,
  random,
  usedQueries,
  trainingOrbits,
  orbitRestricted,
  exceptionalState,
}) => {
  const candidates = [];
  let orderedSlices = slices.filter((slice) => slice.accepted < slice.required);
  if (exceptionalState && orderedSlices.length) {
    const constrainedStratum = orderedSlices[0].desired;
    orderedSlices = orderedSlices.filter(
      (slice) => slice.desired === constrainedStratum,
    );
  }
  let cursor = 0;
  let guard = 0;
  while (candidates.length < batchSize && orderedSlices.length && guard++ < batchSize * 100) {
    const slice = orderedSlices[cursor++ % orderedSlices.length];
    if (slice.accepted >= slice.required) continue;
    const allowed = exceptionalState ? (representation) =>
      exceptionalState.remaining.get(representation.canonical_id) > 0 : null;
    const representation = exceptionalState
      ? exceptionalState.pick(slice.desired, allowed)
      : picker.pick(slice.desired, allowed);
    if (!representation) continue;
    const candidate = candidateFor(
      representation,
      slice.desired,
      slice.status,
      random,
    );
    if (!candidate || usedQueries.has(candidate.query_key)) continue;
    const orbitKey = `${candidate.canonical_type}|${candidate.canonical_representation_id}|${candidate.dominant_target_key}`;
    if (orbitRestricted && trainingOrbits.has(orbitKey)) continue;
    candidate.slice = slice;
    candidate.orbit_key = orbitKey;
    if (exceptionalState) {
      candidate.balance_representation_id = representation.canonical_id;
      exceptionalState.reserve(representation.canonical_id);
    }
    candidates.push(candidate);
    usedQueries.add(candidate.query_key);
    if (orbitRestricted) trainingOrbits.add(orbitKey);
    slice.attempts += 1;
    sliceStats.total_attempts += 1;
  }
  return candidates;
};

class ExceptionalPicker extends RepresentationPicker {
  constructor(representations, total, seed) {
    super(representations, seed);
    const ordered = [...representations].sort((left, right) =>
      left.canonical_id.localeCompare(right.canonical_id));
    const base = Math.floor(total / ordered.length);
    let extra = total % ordered.length;
    this.remaining = new Map(ordered.map((entry) => [
      entry.canonical_id,
      base + (extra-- > 0 ? 1 : 0),
    ]));
  }

  pick(desired, allowed = null) {
    const choices = [...this.byType.values()].flat().filter((entry) =>
      this.eligible(entry, desired) &&
      (this.remaining.get(entry.canonical_id) ?? 0) > 0 &&
      (!allowed || allowed(entry)));
    if (!choices.length) return null;
    choices.sort((left, right) => {
      const leftDimension = BigInt(left.representation_dimension);
      const rightDimension = BigInt(right.representation_dimension);
      if (leftDimension !== rightDimension) {
        if (desired === "8-31" || desired === "2-7")
          return leftDimension > rightDimension ? -1 : 1;
        return leftDimension < rightDimension ? -1 : 1;
      }
      const leftRemaining = this.remaining.get(left.canonical_id);
      const rightRemaining = this.remaining.get(right.canonical_id);
      if (leftRemaining !== rightRemaining) return rightRemaining - leftRemaining;
      return left.canonical_id.localeCompare(right.canonical_id);
    });
    return choices[0];
  }

  reserve(representationId) {
    this.remaining.set(representationId, this.remaining.get(representationId) - 1);
  }

  release(representationId) {
    this.remaining.set(representationId, this.remaining.get(representationId) + 1);
  }
}

const generateStratified = async ({
  partition,
  total,
  dominantPerMille,
  representations,
  workers,
  coordinateMapping,
  budget,
  monitor,
  usedQueries,
  trainingOrbits,
  orbitRestricted,
  zeroDifferential,
  outDirectory,
  seed,
  exceptionalType = null,
}) => {
  const writer = new PartitionWriter(outDirectory, partition);
  const picker = new RepresentationPicker(representations, seed ^ fnv1a(partition));
  const random = makeRandom(seed ^ fnv1a(`${partition}:candidate`));
  const perStratum = total / 4;
  if (!Number.isInteger(perStratum)) throw new Error(`${partition} is not divisible by four`);
  const slices = [];
  const stratumOrder = exceptionalType
    ? ["8-31", "2-7", "1", "0"]
    : ["0", "1", "2-7", "8-31"];
  for (const desired of stratumOrder) {
    const dominant = Math.round(perStratum * dominantPerMille / 1000);
    slices.push({ desired, status: "dominant", required: dominant, accepted: 0, attempts: 0 });
    slices.push({ desired, status: "non_dominant", required: perStratum - dominant, accepted: 0, attempts: 0 });
  }
  const exceptionalState = exceptionalType
    ? new ExceptionalPicker(representations, total, seed ^ fnv1a(`${partition}:${exceptionalType}`))
    : null;
  const sliceStats = {
    total_attempts: 0,
    requested_by_observed: Object.fromEntries(slices.map((slice) => [
      `${slice.desired}|${slice.status}`,
      { "0": 0, "1": 0, "2-7": 0, "8-31": 0, ">31": 0 },
    ])),
  };
  const retainedForAcr2 = [];
  let nonDominantCoordinateAbsMax = 0;
  let noProgressBatches = 0;
  while (writer.records < total) {
    monitor.assertOkay();
    const candidates = createCandidateBatch({
      picker,
      slices,
      sliceStats,
      batchSize: Math.min(512, Math.max(64, total - writer.records)),
      random,
      usedQueries,
      trainingOrbits,
      orbitRestricted,
      exceptionalState,
    });
    if (!candidates.length)
      throw new HoldError("candidate_generation_exhausted", { partition });
    const results = await queryLieBatch({
      workers,
      candidates,
      coordinateMapping,
      budget,
      monitor,
    });
    const accepted = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const result = results[index];
      const observed = stratumFor(result.multiplicity);
      sliceStats.requested_by_observed[`${candidate.slice.desired}|${candidate.slice.status}`][observed] += 1;
      if (observed !== candidate.slice.desired ||
          candidate.slice.accepted >= candidate.slice.required) {
        usedQueries.delete(candidate.query_key);
        if (orbitRestricted) trainingOrbits.delete(candidate.orbit_key);
        if (exceptionalState)
          exceptionalState.release(candidate.balance_representation_id);
        continue;
      }
      const record = modelRecord(
        candidate,
        partition,
        writer.records + accepted.length,
        result.multiplicity,
        "stratified_rejection_sample",
      );
      candidate.slice.accepted += 1;
      if (record.target_status === "non_dominant") {
        nonDominantCoordinateAbsMax = Math.max(
          nonDominantCoordinateAbsMax,
          ...record.target_weight.map((value) => Math.abs(value)),
        );
      }
      accepted.push(record);
      if (partition === "cross_rank_stratified" && record.target_status === "dominant")
        retainedForAcr2.push({ record, candidate });
    }
    if (!accepted.length) noProgressBatches += 1;
    else noProgressBatches = 0;
    if (noProgressBatches > 500)
      throw new HoldError("stratum_yield_stalled", { partition, slices });
    await zeroDifferential.check(accepted);
    for (const record of accepted) await writer.write(record);
  }
  const artifact = await writer.close();
  return {
    artifact,
    yield: {
      attempts: sliceStats.total_attempts,
      accepted: total,
      acceptance_fraction: total / sliceStats.total_attempts,
      slices: slices.map((slice) => ({
        desired_stratum: slice.desired,
        target_status: slice.status,
        attempts: slice.attempts,
        accepted: slice.accepted,
        acceptance_fraction: slice.attempts ? slice.accepted / slice.attempts : null,
      })),
      requested_by_observed: sliceStats.requested_by_observed,
    },
    acr2_bases: retainedForAcr2,
    non_dominant_coordinate_abs_max: nonDominantCoordinateAbsMax,
    exceptional_remaining: exceptionalState
      ? Object.fromEntries(exceptionalState.remaining) : null,
  };
};

const generateNatural = async ({
  partition,
  total,
  dominantPerMille,
  representations,
  workers,
  coordinateMapping,
  budget,
  monitor,
  usedQueries,
  zeroDifferential,
  outDirectory,
  seed,
  balancedByRepresentation = false,
}) => {
  const writer = new PartitionWriter(outDirectory, partition);
  const picker = new RepresentationPicker(representations, seed ^ fnv1a(partition));
  const random = makeRandom(seed ^ fnv1a(`${partition}:natural`));
  let attempts = 0;
  const representationRemaining = balancedByRepresentation
    ? new ExceptionalPicker(representations, total, seed ^ fnv1a(`${partition}:balance`))
    : null;
  while (writer.records < total) {
    const candidates = [];
    while (candidates.length < Math.min(512, total - writer.records)) {
      const desired = "natural";
      const representation = representationRemaining
        ? representationRemaining.pick("0")
        : picker.pick("0");
      if (!representation) throw new HoldError("natural_representation_exhausted", { partition });
      const status = random() * 1000 < dominantPerMille ? "dominant" : "non_dominant";
      const candidate = candidateFor(representation, desired, status, random, true);
      if (!candidate || usedQueries.has(candidate.query_key)) continue;
      candidate.balance_representation_id = representation.canonical_id;
      if (representationRemaining)
        representationRemaining.reserve(candidate.balance_representation_id);
      usedQueries.add(candidate.query_key);
      candidates.push(candidate);
      attempts += 1;
    }
    const results = await queryLieBatch({
      workers,
      candidates,
      coordinateMapping,
      budget,
      monitor,
    });
    const records = results.map((result, index) => modelRecord(
      candidates[index],
      partition,
      writer.records + index,
      result.multiplicity,
      "natural_unstratified_sample",
    ));
    await zeroDifferential.check(records);
    for (let index = 0; index < records.length; index += 1) {
      await writer.write(records[index]);
    }
  }
  return {
    artifact: await writer.close(),
    yield: {
      attempts,
      accepted: total,
      acceptance_fraction: total / attempts,
      label_rejection: false,
    },
  };
};

const rootToDynkin = (rootCoefficient, cartan) => cartan.map((row) =>
  row.reduce((sum, value, index) => sum + value * rootCoefficient[index], 0));

const acr1Candidates = (rootSystems) => {
  const candidates = [];
  for (const type of rootSystems.canonical_types.filter((entry) => entry !== "A1")) {
    const system = rootSystems.systems[type];
    const highestRoot = [...system.positive_roots].sort((left, right) =>
      right.reduce((sum, value) => sum + value, 0) -
      left.reduce((sum, value) => sum + value, 0))[0];
    const highest = rootToDynkin(highestRoot, system.cartan);
    for (const rootCoefficient of system.positive_roots) {
      const positive = rootToDynkin(rootCoefficient, system.cartan);
      for (const sign of [1, -1]) {
        const target = positive.map((value) => value * sign);
        candidates.push({ type, highest, target, expected: "1", subtype: "root" });
        candidates.push({
          type,
          highest,
          target: target.map((value) => value * 2),
          expected: "0",
          subtype: "doubled_root",
        });
      }
    }
    candidates.push({
      type,
      highest,
      target: Array(system.rank).fill(0),
      expected: String(system.rank),
      subtype: "zero_weight",
    });
  }
  return candidates;
};

const generateAcr1 = async ({
  rootSystems,
  workers,
  coordinateMapping,
  budget,
  monitor,
  usedQueries,
  zeroDifferential,
  outDirectory,
}) => {
  const specifications = acr1Candidates(rootSystems);
  if (specifications.length !== 3750)
    throw new Error(`ACR-1 generated ${specifications.length}, expected 3750`);
  const writer = new PartitionWriter(outDirectory, "acr1");
  for (let offset = 0; offset < specifications.length; offset += 512) {
    const batch = specifications.slice(offset, offset + 512).map((entry) => {
      const key = queryKey(entry.type, entry.highest, entry.target);
      if (usedQueries.has(key))
        throw new HoldError("acr1_query_leakage", { query_key: key });
      usedQueries.add(key);
      return {
        canonical_type: entry.type,
        legacy_zero_type: entry.type,
        canonical_representation_id: `${entry.type}:adjoint`,
        legacy_zero_representation_id: `${entry.type}:adjoint`,
        rank: entry.highest.length,
        representation_dimension: null,
        highest_weight_height: entry.highest.reduce((sum, value) => sum + value, 0),
        highest_weight: entry.highest,
        target_weight: entry.target,
        target_status: entry.target.some((value) => value < 0) ? "non_dominant" : "dominant",
        target_depth: null,
        target_magnitude_l1: entry.target.reduce((sum, value) => sum + Math.abs(value), 0),
        query_key: key,
        expected: entry.expected,
        subtype: entry.subtype,
      };
    });
    const results = await queryLieBatch({
      workers,
      candidates: batch,
      coordinateMapping,
      budget,
      monitor,
    });
    const records = results.map((result, index) => {
      const candidate = batch[index];
      if (result.multiplicity !== candidate.expected)
        throw new HoldError("acr1_oracle_integrity_failure", {
          query_key: candidate.query_key,
          expected: candidate.expected,
          observed: result.multiplicity,
        });
      return {
        ...modelRecord(candidate, "acr1", writer.records + index, result.multiplicity, "adjoint_integrity"),
        integrity_subtype: candidate.subtype,
      };
    });
    await zeroDifferential.check(records, true);
    for (const record of records) await writer.write(record);
  }
  return { artifact: await writer.close(), records: specifications.length };
};

const positiveRoot = (coefficient) => coefficient.every((value) => value >= 0);

const reducedWord = (system, length, random) => {
  const rank = system.rank;
  let images = Array.from({ length: rank }, (_, row) =>
    Array.from({ length: rank }, (_value, column) => row === column ? 1 : 0));
  const word = [];
  for (let step = 0; step < length; step += 1) {
    const choices = images
      .map((image, index) => positiveRoot(image) ? index : -1)
      .filter((index) => index >= 0);
    if (!choices.length) return null;
    const simple = choices[randomInteger(random, choices.length)];
    const image = images[simple];
    images = images.map((entry, column) => entry.map(
      (value, row) => value - system.cartan[simple][column] * image[row],
    ));
    word.push(simple);
  }
  return word;
};

const applyReducedWord = (weight, cartan, word) => {
  let output = [...weight];
  for (const simple of [...word].reverse()) output = reflectWeight(output, cartan, simple);
  return output;
};

const acr2Bands = (system) => {
  const rank = system.rank;
  const maximum = system.positive_roots.length;
  return [
    { id: "b1", minimum: 1, maximum: rank },
    { id: "b2", minimum: rank + 1, maximum: Math.min(2 * rank, maximum) },
    { id: "b3", minimum: 2 * rank + 1, maximum: Math.min(4 * rank, maximum) },
    { id: "b4", minimum: 4 * rank + 1, maximum },
  ];
};

const generateAcr2 = async ({
  bases,
  rootSystems,
  coordinateEnvelope,
  workers,
  coordinateMapping,
  budget,
  monitor,
  usedQueries,
  zeroDifferential,
  outDirectory,
  seed,
  targetPerStratum,
}) => {
  const writer = new PartitionWriter(outDirectory, "acr2_transformed");
  const controls = [];
  const random = makeRandom(seed ^ fnv1a("acr2"));
  for (const multiplicityStratum of ["0", "1", "2-7", "8-31"]) {
    const available = bases
      .filter((entry) => entry.record.multiplicity_stratum === multiplicityStratum)
      .sort((left, right) => fnv1a(left.record.id) - fnv1a(right.record.id));
    const perBand = targetPerStratum / 4;
    let baseCursor = 0;
    for (let bandIndex = 0; bandIndex < 4; bandIndex += 1) {
      let accepted = 0;
      while (accepted < perBand && baseCursor < available.length) {
        const base = available[baseCursor++];
        const system = rootSystems.systems[base.record.canonical_type];
        const band = acr2Bands(system)[bandIndex];
        if (band.minimum > band.maximum) continue;
        let transformed = null;
        let word = null;
        for (let attempt = 0; attempt < 64; attempt += 1) {
          const length = band.minimum + randomInteger(random, band.maximum - band.minimum + 1);
          const candidateWord = reducedWord(system, length, random);
          if (!candidateWord) continue;
          const target = applyReducedWord(base.record.target_weight, system.cartan, candidateWord);
          if (target.every((value, index) => value === base.record.target_weight[index])) continue;
          if (target.every((value) => value >= 0)) continue;
          if (target.some((value) => Math.abs(value) > coordinateEnvelope)) continue;
          const key = queryKey(base.record.canonical_type, base.record.highest_weight, target);
          if (usedQueries.has(key)) continue;
          transformed = target;
          word = candidateWord;
          usedQueries.add(key);
          break;
        }
        if (!transformed) continue;
        const candidate = {
          ...base.candidate,
          target_weight: transformed,
          target_status: "non_dominant",
          target_magnitude_l1: transformed.reduce((sum, value) => sum + Math.abs(value), 0),
          query_key: queryKey(base.record.canonical_type, base.record.highest_weight, transformed),
        };
        const [result] = await queryLieBatch({
          workers,
          candidates: [candidate],
          coordinateMapping,
          budget,
          monitor,
        });
        if (result.multiplicity !== base.record.multiplicity)
          throw new HoldError("acr2_orbit_multiplicity_disagreement", {
            base_record_id: base.record.id,
            expected: base.record.multiplicity,
            observed: result.multiplicity,
          });
        const record = modelRecord(
          candidate,
          "acr2_transformed",
          writer.records,
          result.multiplicity,
          "weyl_transformed_blind_record",
        );
        await zeroDifferential.check([record]);
        await writer.write(record);
        controls.push({
          pair_id: `acr2-pair-${String(controls.length + 1).padStart(5, "0")}`,
          base_record_id: base.record.id,
          transformed_record_id: record.id,
          canonical_type: record.canonical_type,
          multiplicity_stratum: record.multiplicity_stratum,
          coxeter_length_band: band.id,
          coxeter_length: word.length,
          weyl_word_zero_based_simple_reflections: word,
        });
        accepted += 1;
      }
      if (accepted !== perBand)
        throw new HoldError("acr2_band_yield_incomplete", {
          multiplicity_stratum: multiplicityStratum,
          band: bandIndex + 1,
          accepted,
          required: perBand,
          available_bases: available.length,
        });
    }
  }
  const artifact = await writer.close();
  const controlPath = resolve(outDirectory, "acr2-control-manifest.json.gz");
  const control = {
    schema: "ilxyr.weight_multiplicity_acr2_control_manifest.v1",
    model_facing_pair_metadata: false,
    coordinate_envelope_maximum_absolute_value: coordinateEnvelope,
    pairs: controls,
  };
  const controlBytes = Buffer.from(stableJson(control));
  await writeFile(controlPath, gzipSync(controlBytes, { level: 9, mtime: 0 }));
  return {
    artifact,
    control: {
      file: basename(controlPath),
      pairs: controls.length,
      uncompressed_sha256: sha256(controlBytes),
      gzip_sha256: await hashFile(controlPath),
      gzip_bytes: (await stat(controlPath)).size,
    },
  };
};

const smokePartitions = (partitions) => ({
  training: { ...partitions.training, records: 80 },
  development: { ...partitions.development, records: 16 },
  blind_in_range_stratified: { ...partitions.blind_in_range_stratified, records: 16 },
  blind_in_range_unstratified: { ...partitions.blind_in_range_unstratified, records: 16 },
  cross_rank_stratified: { ...partitions.cross_rank_stratified, records: 80, dominant_per_mille: 800 },
  cross_rank_unstratified: { ...partitions.cross_rank_unstratified, records: 16 },
  exceptional_stratified: {
    ...partitions.exceptional_stratified,
    records: 200,
    records_per_type: 40,
    records_per_type_stratum: 10,
  },
  exceptional_unstratified: {
    ...partitions.exceptional_unstratified,
    records: 200,
    records_per_type: 40,
  },
  acr1: { ...partitions.acr1, records: 3750 },
  acr2_transformed: {
    ...partitions.acr2_transformed,
    records: 16,
    records_per_stratum: 4,
  },
});

const validateInputs = async (options, plan, bytes) => {
  const required = ["lie", "lieSource", "zero", "zeroCommit", "out"];
  for (const name of required)
    if (!options[name]) throw new Error(`--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`);
  const bindings = plan.source_bindings;
  const checks = [
    ["revision3 contract", sha256(await readFile(resolve(root, "examples/weight-multiplicity/rev3-contract.json"))), bindings.revision3_contract_sha256],
    ["reduced manifest", sha256(bytes.manifest), bindings.reduced_manifest_sha256],
    ["root systems", sha256(bytes.systems), bindings.root_systems_sha256],
    ["preflight closeout", sha256(await readFile(resolve(root, "experiments/weight-multiplicity/phase05/phase06-lie-preflight-closeout-v1.json"))), bindings.preflight_closeout_sha256],
    ["LiE governance", sha256(await readFile(resolve(root, "examples/weight-multiplicity/phase06-lie-governance-v1.json"))), bindings.lie_governance_sha256],
    ["LiE source", sha256(await readFile(resolve(options.lieSource))), plan.oracle.primary.source_sha256],
    ["Zero source commit", options.zeroCommit, plan.oracle.differential.source_commit],
  ];
  for (const [name, observed, expected] of checks)
    if (observed !== expected) throw new Error(`${name} hash/identity mismatch: ${observed} != ${expected}`);
  if (!plan.closures.corpus_generation_authorized ||
      plan.closures.model_training_authorized ||
      plan.closures.model_evaluation_authorized)
    throw new Error("authority boundary is invalid");
};

const selfTest = () => {
  const cartan = [[2, -1], [-1, 2]];
  const dominant = orientDominant([-1, 2], [1, 0], cartan);
  if (!dominant || dominant.weight.some((value) => value < 0))
    throw new Error("dominant orientation failed");
  if (stratumFor("31") !== "8-31" || stratumFor("32") !== ">31")
    throw new Error("stratum classification failed");
  if (!(wilsonLower(50, 100) < 0.5 && wilsonLower(50, 100) > 0))
    throw new Error("Wilson bound failed");
  const system = {
    rank: 2,
    cartan,
    positive_roots: [[1, 0], [0, 1], [1, 1]],
  };
  const word = reducedWord(system, 3, makeRandom(1));
  if (!word || word.length !== 3) throw new Error("reduced word failed");
  const acr = acr1Candidates({
    canonical_types: ["A2"],
    systems: { A2: system },
  });
  if (acr.length !== 13) throw new Error("ACR-1 construction failed");
  process.stdout.write(`${JSON.stringify({ status: "pass" })}\n`);
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.selfTest) return selfTest();
  const bytes = {
    plan: await readFile(resolve(options.plan)),
    manifest: await readFile(resolve(options.manifest)),
    systems: await readFile(resolve(options.systems)),
  };
  const plan = JSON.parse(bytes.plan.toString("utf8"));
  const manifest = JSON.parse(bytes.manifest.toString("utf8"));
  const rootSystems = JSON.parse(bytes.systems.toString("utf8"));
  await validateInputs(options, plan, bytes);
  const outDirectory = resolve(options.out);
  await mkdir(outDirectory, { recursive: false });
  const corpusDirectory = resolve(outDirectory, "corpus");
  const evidenceDirectory = resolve(outDirectory, "evidence");
  await mkdir(evidenceDirectory);

  const effectivePlan = structuredClone(plan);
  if (options.smoke) {
    effectivePlan.partitions = smokePartitions(plan.partitions);
    effectivePlan.oracle.primary.workers = 2;
    effectivePlan.oracle.differential.workers = 1;
    effectivePlan.budget.pilot_attempts_per_training_or_classical_slice = 128;
    effectivePlan.budget.pilot_attempts_per_exceptional_type_stratum = 128;
    effectivePlan.memory.rss_required = false;
    effectivePlan.zero_sample.minimum_completed_fraction_per_mille = 0;
  }
  const representations = prepareRepresentations(manifest, rootSystems);
  const byRole = groupBy(representations, (entry) => entry.revision3_role);
  const seed = effectivePlan.generator.seed;
  const lieWorkers = await startLieWorkers(effectivePlan.oracle.primary.workers, {
    executable: resolve(options.lie),
    stdbuf: options.stdbuf ? resolve(options.stdbuf) : null,
    hardTimeoutMs: 10000,
  });
  const zeroWorkers = await startZeroWorkers(effectivePlan.oracle.differential.workers, {
    executable: resolve(options.zero),
    hardTimeoutMs: effectivePlan.oracle.differential.hard_timeout_ms,
  });
  const monitor = new ResourceMonitor({ lieWorkers, zeroWorkers, plan: effectivePlan });
  monitor.start();
  const budget = new BudgetTracker(effectivePlan);
  const coordinateMapping = effectivePlan.oracle.primary.coordinate_mapping;
  const pilotSlices = [];
  let finalStatus = "hold";
  let hold = null;
  let memoryEvidence = null;
  try {
    const trainingRequiredPerStratum = (
      effectivePlan.partitions.training.records +
      effectivePlan.partitions.development.records +
      effectivePlan.partitions.blind_in_range_stratified.records
    ) / 4;
    const classicalRequiredPerStratum =
      effectivePlan.partitions.cross_rank_stratified.records / 4;
    for (const desired of effectivePlan.generator.strata) {
      for (const status of ["dominant", "non_dominant"]) {
        const trainingRequired = status === "dominant"
          ? Math.round(trainingRequiredPerStratum * 0.75)
          : trainingRequiredPerStratum - Math.round(trainingRequiredPerStratum * 0.75);
        pilotSlices.push(await runPilotSlice({
          id: `training|${desired}|${status}`,
          representations: byRole.training_or_development,
          desired,
          status,
          attempts: effectivePlan.budget.pilot_attempts_per_training_or_classical_slice,
          required: trainingRequired,
          seed,
          workers: lieWorkers,
          coordinateMapping,
          budget,
          monitor,
        }));
        const classicalDominant = Math.round(
          classicalRequiredPerStratum *
          effectivePlan.partitions.cross_rank_stratified.dominant_per_mille / 1000,
        );
        pilotSlices.push(await runPilotSlice({
          id: `classical|${desired}|${status}`,
          representations: byRole.held_out_classical,
          desired,
          status,
          attempts: effectivePlan.budget.pilot_attempts_per_training_or_classical_slice,
          required: status === "dominant"
            ? classicalDominant : classicalRequiredPerStratum - classicalDominant,
          seed,
          workers: lieWorkers,
          coordinateMapping,
          budget,
          monitor,
        }));
      }
      for (const type of ["G2", "F4", "E6", "E7", "E8"]) {
        pilotSlices.push(await runPilotSlice({
          id: `exceptional|${type}|${desired}`,
          representations: byRole.held_out_exceptional.filter((entry) => entry.canonical_type === type),
          desired,
          status: "mixed",
          attempts: effectivePlan.budget.pilot_attempts_per_exceptional_type_stratum,
          required: effectivePlan.partitions.exceptional_stratified.records_per_type_stratum,
          seed,
          workers: lieWorkers,
          coordinateMapping,
          budget,
          monitor,
        }));
      }
    }
    const fixedCalls =
      effectivePlan.partitions.blind_in_range_unstratified.records +
      effectivePlan.partitions.cross_rank_unstratified.records +
      effectivePlan.partitions.exceptional_unstratified.records +
      effectivePlan.partitions.acr1.records +
      effectivePlan.partitions.acr2_transformed.records;
    const frozenBudget = budget.freeze(
      pilotSlices,
      fixedCalls,
      effectivePlan.oracle.primary.workers,
    );
    const frozenBudgetPath = resolve(evidenceDirectory, "frozen-budget.json");
    await writeFile(frozenBudgetPath, stableJson(frozenBudget));
    const frozenBudgetSha256 = await hashFile(frozenBudgetPath);
    budget.setProgressPath(resolve(evidenceDirectory, "generation-progress.json"));
    await budget.checkpoint(true);
    if (options.pilotOnly) {
      finalStatus = "pilot_complete";
      await budget.checkpoint(true, finalStatus);
      await writeFile(resolve(outDirectory, "runner-summary.json"), stableJson({
        status: finalStatus,
        frozen_budget_sha256: frozenBudgetSha256,
        frozen_budget: frozenBudget,
        closures: effectivePlan.closures,
      }));
      return;
    }

    await mkdir(corpusDirectory);
    const reservedAcr1 = new Set(acr1Candidates(rootSystems).map((entry) =>
      queryKey(entry.type, entry.highest, entry.target)));
    const usedQueries = new Set(reservedAcr1);
    const trainingOrbits = new Set();
    const zeroDifferential = new ZeroDifferential({
      workers: zeroWorkers,
      plan: effectivePlan,
      seed,
    });
    const artifacts = [];
    const yields = {};
    let acr2Bases = [];
    const trainingCoordinateEnvelopes = [];

    for (const name of ["training", "development", "blind_in_range_stratified"]) {
      const specification = effectivePlan.partitions[name];
      const result = await generateStratified({
        partition: name,
        total: specification.records,
        dominantPerMille: specification.dominant_per_mille,
        representations: byRole.training_or_development,
        workers: lieWorkers,
        coordinateMapping,
        budget,
        monitor,
        usedQueries,
        trainingOrbits,
        orbitRestricted: name !== "blind_in_range_stratified",
        zeroDifferential,
        outDirectory: corpusDirectory,
        seed,
      });
      artifacts.push(result.artifact);
      yields[name] = result.yield;
      if (name === "training" || name === "development")
        trainingCoordinateEnvelopes.push(result.non_dominant_coordinate_abs_max);
    }
    const coordinateEnvelope = Math.max(0, ...trainingCoordinateEnvelopes);
    if (coordinateEnvelope === 0)
      throw new HoldError("training_non_dominant_coordinate_envelope_empty");

    const blindNatural = await generateNatural({
      partition: "blind_in_range_unstratified",
      total: effectivePlan.partitions.blind_in_range_unstratified.records,
      dominantPerMille:
        effectivePlan.partitions.blind_in_range_unstratified.dominant_per_mille,
      representations: byRole.training_or_development,
      workers: lieWorkers,
      coordinateMapping,
      budget,
      monitor,
      usedQueries,
      zeroDifferential,
      outDirectory: corpusDirectory,
      seed,
    });
    artifacts.push(blindNatural.artifact);
    yields.blind_in_range_unstratified = blindNatural.yield;

    const cross = await generateStratified({
      partition: "cross_rank_stratified",
      total: effectivePlan.partitions.cross_rank_stratified.records,
      dominantPerMille: effectivePlan.partitions.cross_rank_stratified.dominant_per_mille,
      representations: byRole.held_out_classical,
      workers: lieWorkers,
      coordinateMapping,
      budget,
      monitor,
      usedQueries,
      trainingOrbits,
      orbitRestricted: false,
      zeroDifferential,
      outDirectory: corpusDirectory,
      seed,
    });
    artifacts.push(cross.artifact);
    yields.cross_rank_stratified = cross.yield;
    acr2Bases = cross.acr2_bases;

    const crossNatural = await generateNatural({
      partition: "cross_rank_unstratified",
      total: effectivePlan.partitions.cross_rank_unstratified.records,
      dominantPerMille:
        effectivePlan.partitions.cross_rank_unstratified.dominant_per_mille,
      representations: byRole.held_out_classical,
      workers: lieWorkers,
      coordinateMapping,
      budget,
      monitor,
      usedQueries,
      zeroDifferential,
      outDirectory: corpusDirectory,
      seed,
    });
    artifacts.push(crossNatural.artifact);
    yields.cross_rank_unstratified = crossNatural.yield;

    for (const type of ["G2", "F4", "E6", "E7", "E8"]) {
      const typeRepresentations = byRole.held_out_exceptional.filter(
        (entry) => entry.canonical_type === type,
      );
      const stratified = await generateStratified({
        partition: `exceptional_stratified_${type}`,
        total: effectivePlan.partitions.exceptional_stratified.records_per_type,
        dominantPerMille: 752,
        representations: typeRepresentations,
        workers: lieWorkers,
        coordinateMapping,
        budget,
        monitor,
        usedQueries,
        trainingOrbits,
        orbitRestricted: false,
        zeroDifferential,
        outDirectory: corpusDirectory,
        seed,
        exceptionalType: type,
      });
      if (Object.values(stratified.exceptional_remaining).some((value) => value !== 0))
        throw new HoldError("exceptional_representation_balance_incomplete", {
          type,
          remaining: stratified.exceptional_remaining,
        });
      artifacts.push(stratified.artifact);
      yields[`exceptional_stratified_${type}`] = stratified.yield;

      const natural = await generateNatural({
        partition: `exceptional_unstratified_${type}`,
        total: effectivePlan.partitions.exceptional_unstratified.records_per_type,
        dominantPerMille:
          effectivePlan.partitions.exceptional_unstratified.dominant_per_mille,
        representations: typeRepresentations,
        workers: lieWorkers,
        coordinateMapping,
        budget,
        monitor,
        usedQueries,
        zeroDifferential,
        outDirectory: corpusDirectory,
        seed,
        balancedByRepresentation: true,
      });
      artifacts.push(natural.artifact);
      yields[`exceptional_unstratified_${type}`] = natural.yield;
    }

    for (const key of reservedAcr1) {
      if (!usedQueries.has(key))
        throw new HoldError("acr1_query_reservation_lost", { query_key: key });
      usedQueries.delete(key);
    }
    const acr1 = await generateAcr1({
      rootSystems,
      workers: lieWorkers,
      coordinateMapping,
      budget,
      monitor,
      usedQueries,
      zeroDifferential,
      outDirectory: corpusDirectory,
    });
    artifacts.push(acr1.artifact);

    const acr2 = await generateAcr2({
      bases: acr2Bases,
      rootSystems,
      coordinateEnvelope,
      workers: lieWorkers,
      coordinateMapping,
      budget,
      monitor,
      usedQueries,
      zeroDifferential,
      outDirectory: corpusDirectory,
      seed,
      targetPerStratum: effectivePlan.partitions.acr2_transformed.records_per_stratum,
    });
    artifacts.push(acr2.artifact);

    const differential = zeroDifferential.finalize();
    const differentialPath = resolve(evidenceDirectory, "zero-differential.json.gz");
    const differentialBytes = Buffer.from(stableJson({
      schema: "ilxyr.weight_multiplicity_phase1_zero_differential.v1",
      ...differential,
    }));
    await writeFile(differentialPath, gzipSync(differentialBytes, { level: 9, mtime: 0 }));
    const totalRecords = artifacts.reduce((sum, entry) => sum + entry.records, 0);
    const expectedTotal = Object.values(effectivePlan.partitions)
      .reduce((sum, entry) => sum + entry.records, 0);
    if (totalRecords !== expectedTotal)
      throw new HoldError("corpus_record_count_mismatch", { totalRecords, expectedTotal });
    const corpusManifest = {
      schema: "ilxyr.weight_multiplicity_phase1_corpus_manifest.v1",
      status: "sealed",
      smoke: options.smoke,
      source_bindings: {
        plan_sha256: sha256(bytes.plan),
        reduced_manifest_sha256: sha256(bytes.manifest),
        root_systems_sha256: sha256(bytes.systems),
        frozen_budget_sha256: frozenBudgetSha256,
      },
      oracle_identity: {
        lie_source_sha256: effectivePlan.oracle.primary.source_sha256,
        zero_source_commit: effectivePlan.oracle.differential.source_commit,
      },
      total_records: totalRecords,
      unique_query_keys: usedQueries.size,
      training_non_dominant_coordinate_abs_envelope: coordinateEnvelope,
      partitions: artifacts,
      stratum_yields: yields,
      acr2_control: acr2.control,
      zero_differential: {
        selected: differential.selected,
        completed: differential.completed,
        agreements: differential.agreements,
        disagreements: differential.disagreements,
        unavailable: differential.unavailable,
        completion_fraction: differential.completion_fraction,
        gzip_file: basename(differentialPath),
        uncompressed_sha256: sha256(differentialBytes),
        gzip_sha256: await hashFile(differentialPath),
      },
      closures: {
        model_training_authorized: false,
        model_evaluation_authorized: false,
        oracle_promotion_authorized: false,
      },
    };
    const manifestPath = resolve(outDirectory, "corpus-manifest.json");
    await writeFile(manifestPath, stableJson(corpusManifest));
    finalStatus = "corpus_complete";
    await budget.checkpoint(true, finalStatus);
    memoryEvidence = await monitor.stop();
    monitor.assertOkay();
    const evidence = {
      schema: "ilxyr.weight_multiplicity_phase1_corpus_generation_evidence.v1",
      status: finalStatus,
      smoke: options.smoke,
      corpus_manifest_sha256: await hashFile(manifestPath),
      budget: budget.snapshot(),
      memory: memoryEvidence,
      zero_differential: {
        selected: differential.selected,
        completed: differential.completed,
        agreements: differential.agreements,
        disagreements: differential.disagreements,
        unavailable: differential.unavailable,
      },
      closures: corpusManifest.closures,
    };
    const evidencePath = resolve(evidenceDirectory, "generation-evidence.json");
    await writeFile(evidencePath, stableJson(evidence));
    const summary = {
      status: finalStatus,
      total_records: totalRecords,
      corpus_manifest_sha256: await hashFile(manifestPath),
      frozen_budget_sha256: frozenBudgetSha256,
      oracle_calls: budget.calls,
      oracle_query_ms: budget.queryMs,
      peak_incremental_lie_worker_rss_bytes: Math.max(
        ...Object.values(memoryEvidence.lie_worker_peak_incremental_rss_bytes),
      ),
      zero_differential: evidence.zero_differential,
      model_training_authorized: false,
    };
    await writeFile(resolve(outDirectory, "runner-summary.json"), stableJson(summary));
    const sealTargets = [
      manifestPath,
      evidencePath,
      frozenBudgetPath,
      resolve(evidenceDirectory, "generation-progress.json"),
      differentialPath,
      resolve(outDirectory, "runner-summary.json"),
      resolve(corpusDirectory, acr2.control.file),
      ...artifacts.map((entry) => resolve(corpusDirectory, entry.file)),
    ];
    const checksumLines = [];
    for (const path of sealTargets)
      checksumLines.push(`${await hashFile(path)}  ${path.slice(outDirectory.length + 1)}`);
    await writeFile(resolve(outDirectory, "sha256sums.txt"), `${checksumLines.join("\n")}\n`);
  } catch (error) {
    await budget.checkpoint(true, "hold");
    hold = {
      schema: "ilxyr.weight_multiplicity_phase1_corpus_hold.v1",
      status: "hold",
      reason: error instanceof HoldError ? error.reason : "unexpected_error",
      details: error instanceof HoldError ? error.details : { message: error.message, stack: error.stack },
      budget: budget.snapshot(),
      closures: {
        corpus_sealed: false,
        model_training_authorized: false,
        model_evaluation_authorized: false,
      },
    };
    await writeFile(resolve(outDirectory, "hold.json"), stableJson(hold));
    await writeFile(resolve(outDirectory, "runner-summary.json"), stableJson(hold));
    throw error;
  } finally {
    if (!memoryEvidence) memoryEvidence = await monitor.stop();
    await Promise.allSettled([
      ...lieWorkers.map((worker) => worker.close()),
      ...zeroWorkers.map((worker) => worker.close()),
    ]);
  }
  process.stdout.write(`${JSON.stringify({ status: finalStatus, hold })}\n`);
};

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = error instanceof HoldError ? 2 : 1;
});
