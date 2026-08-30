#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const parseArguments = (values) => {
  const options = {
    plan: "examples/weight-multiplicity/phase05-frontier-plan.json",
    oracle: null,
    manifest: null,
    manifestOut: null,
    out: null,
    types: null,
    selectionReason: null,
    limitRepresentations: null,
    resume: false,
    smoke: false,
    selfTest: false,
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--resume") options.resume = true;
    else if (value === "--smoke") options.smoke = true;
    else if (value === "--self-test") options.selfTest = true;
    else if (
      ["--plan", "--oracle", "--manifest", "--manifest-out", "--out", "--types", "--selection-reason", "--limit-representations"].includes(value)
    ) {
      const next = values[++index];
      if (!next) throw new Error(`${value} requires a value`);
      const key = {
        "--plan": "plan",
        "--oracle": "oracle",
        "--manifest": "manifest",
        "--manifest-out": "manifestOut",
        "--out": "out",
        "--types": "types",
        "--selection-reason": "selectionReason",
        "--limit-representations": "limitRepresentations",
      }[value];
      options[key] = value === "--limit-representations" ? Number(next) : next;
    } else {
      throw new Error(`unknown argument: ${value}`);
    }
  }
  if (options.types) options.types = new Set(options.types.split(","));
  return options;
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const assertOracleExecutable = async (path, expectedSha256, context) => {
  const actualSha256 = sha256(await readFile(path));
  if (actualSha256 !== expectedSha256)
    throw new Error(
      `oracle executable drifted ${context}: expected ${expectedSha256}, got ${actualSha256}`,
    );
};
const readJsonBytes = async (path) => {
  const bytes = await readFile(path);
  return { bytes, value: JSON.parse(bytes.toString("utf8")) };
};
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const controllerRevision = () => {
  const bound = process.env.ILXYR_CONTROLLER_REVISION;
  if (bound) {
    if (!/^[0-9a-f]{40}$/u.test(bound))
      throw new Error("ILXYR_CONTROLLER_REVISION must be a full Git commit");
    return bound;
  }
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
};

const fnv1a = (text) => {
  let hash = 2166136261;
  for (const character of text) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const makeRandom = (seed) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};
const randomInteger = (random, maximum) => Math.floor(random() * maximum);

const gcd = (left, right) => {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
};

const integerSqrt = (value) => {
  if (value < 0n) throw new Error("integer square root of negative value");
  if (value < 2n) return value;
  let current = 1n << (BigInt(value.toString(2).length) + 1n) / 2n;
  for (;;) {
    const next = (current + value / current) / 2n;
    if (next >= current) return current;
    current = next;
  }
};

const exactWeylDimension = (highest, description) => {
  let numerator = 1n;
  let denominator = 1n;
  for (const root of description.positive_roots) {
    let rhoPairing = 0n;
    let lambdaPairing = 0n;
    for (let index = 0; index < description.rank; index += 1) {
      const scaledRoot = BigInt(root[index]) * BigInt(description.symmetrizer[index]);
      rhoPairing += scaledRoot;
      lambdaPairing += scaledRoot * BigInt(highest[index]);
    }
    let top = rhoPairing + lambdaPairing;
    let bottom = rhoPairing;
    let divisor = gcd(top, bottom);
    top /= divisor;
    bottom /= divisor;
    divisor = gcd(numerator, bottom);
    numerator /= divisor;
    bottom /= divisor;
    divisor = gcd(top, denominator);
    top /= divisor;
    denominator /= divisor;
    numerator *= top;
    denominator *= bottom;
  }
  if (denominator !== 1n) {
    if (numerator % denominator !== 0n)
      throw new Error(`nonintegral Weyl dimension for ${highest}`);
    numerator /= denominator;
  }
  return numerator;
};

function* weakCompositions(total, parts, prefix = []) {
  if (parts === 1) {
    yield [...prefix, total];
    return;
  }
  for (let value = 0; value <= total; value += 1)
    yield* weakCompositions(total - value, parts - 1, [...prefix, value]);
}

const compareWeights = (left, right) => {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
};

const reflect = (weight, coefficient, cartan, simple) => {
  const pairing = weight[simple];
  const reflectedWeight = weight.map(
    (value, row) => value - pairing * cartan[row][simple],
  );
  const reflectedCoefficient = [...coefficient];
  reflectedCoefficient[simple] += pairing;
  return { weight: reflectedWeight, coefficient: reflectedCoefficient };
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

const orientNonDominant = (weight, coefficient, cartan, random) => {
  const dominant = orientDominant(weight, coefficient, cartan);
  if (!dominant) return null;
  const choices = dominant.weight
    .map((value, index) => (value > 0 ? index : -1))
    .filter((index) => index >= 0);
  if (choices.length === 0) return null;
  return reflect(
    dominant.weight,
    dominant.coefficient,
    cartan,
    choices[randomInteger(random, choices.length)],
  );
};

const antiDominant = (highest, cartan, random) => {
  let state = { weight: [...highest], coefficient: Array(highest.length).fill(0) };
  for (let iteration = 0; iteration < 4096; iteration += 1) {
    const choices = state.weight
      .map((value, index) => (value > 0 ? index : -1))
      .filter((index) => index >= 0);
    if (choices.length === 0) return state;
    state = reflect(
      state.weight,
      state.coefficient,
      cartan,
      choices[randomInteger(random, choices.length)],
    );
  }
  return null;
};

const loweringWalk = (highest, cartan, goal, random) => {
  const state = { weight: [...highest], coefficient: Array(highest.length).fill(0) };
  for (let step = 0; step < goal; step += 1) {
    const choices = state.weight
      .map((value, index) => (value > 0 ? index : -1))
      .filter((index) => index >= 0);
    if (choices.length === 0) break;
    const simple = choices[randomInteger(random, choices.length)];
    state.weight = state.weight.map(
      (value, row) => value - cartan[row][simple],
    );
    state.coefficient[simple] += 1;
  }
  return state;
};

const bandFor = (dimension, bands) =>
  bands.find(
    (band) =>
      dimension >= BigInt(band.lower_inclusive) &&
      dimension < BigInt(band.upper_exclusive),
  );

const describeType = (oracle, type) =>
  JSON.parse(execFileSync(oracle, ["describe", type], { encoding: "utf8" }));

const generateManifest = async ({ planPath, oraclePath, typeFilter }) => {
  const planRecord = await readJsonBytes(planPath);
  const plan = planRecord.value;
  const executableBytes = await readFile(oraclePath);
  const representations = [];
  const perType = {};
  for (const type of plan.frontier.types) {
    if (typeFilter && !typeFilter.has(type)) continue;
    const description = describeType(oraclePath, type);
    const candidates = [];
    for (
      let height = plan.generator.candidate_envelope.minimum_highest_weight_height;
      height <= plan.generator.candidate_envelope.maximum_highest_weight_height;
      height += 1
    ) {
      for (const highest of weakCompositions(height, description.rank)) {
        const dimension = exactWeylDimension(highest, description);
        const band = bandFor(dimension, plan.frontier.dimension_bands);
        if (!band)
          throw new Error(`${type} ${highest} dimension ${dimension} is outside frozen bands`);
        candidates.push({ highest, height, dimension, band: band.id });
      }
    }
    const selected = new Map();
    const select = (candidate, reason) => {
      const key = candidate.highest.join(",");
      const existing = selected.get(key) ?? { ...candidate, reasons: new Set(), requiredTargets: [] };
      existing.reasons.add(reason);
      selected.set(key, existing);
    };
    for (let index = 0; index < description.rank; index += 1) {
      const highest = Array(description.rank).fill(0);
      highest[index] = 1;
      select(
        candidates.find((candidate) => compareWeights(candidate.highest, highest) === 0),
        "fundamental_representation",
      );
    }
    for (const band of plan.frontier.dimension_bands) {
      const inBand = candidates
        .filter((candidate) => candidate.band === band.id)
        .sort((left, right) =>
          left.dimension === right.dimension
            ? compareWeights(left.highest, right.highest)
            : left.dimension < right.dimension
              ? -1
              : 1,
        );
      if (inBand.length === 0) continue;
      select(inBand[0], `${band.id}:minimum_dimension`);
      select(inBand[inBand.length - 1], `${band.id}:maximum_dimension`);
      const midpoint = integerSqrt(
        BigInt(band.lower_inclusive) * BigInt(band.upper_exclusive),
      );
      const nearest = [...inBand].sort((left, right) => {
        const leftDistance = left.dimension > midpoint ? left.dimension - midpoint : midpoint - left.dimension;
        const rightDistance = right.dimension > midpoint ? right.dimension - midpoint : midpoint - right.dimension;
        return leftDistance === rightDistance
          ? compareWeights(left.highest, right.highest)
          : leftDistance < rightDistance
            ? -1
            : 1;
      })[0];
      select(nearest, `${band.id}:nearest_geometric_midpoint`);
    }
    const timeoutCase =
      plan.generator.representation_selection.phase0_v2_first_timeout_cases[type];
    if (timeoutCase) {
      const candidate = candidates.find(
        (entry) => compareWeights(entry.highest, timeoutCase.highest_weight) === 0,
      );
      select(candidate, "phase0_v2_first_timeout_highest_weight");
      selected.get(timeoutCase.highest_weight.join(",")).requiredTargets.push({
        target_weight: timeoutCase.target_weight,
        target_depth: timeoutCase.target_depth,
        source: "phase0_v2_first_timeout",
      });
    }
    const typeRepresentations = [...selected.values()]
      .sort((left, right) =>
        left.dimension === right.dimension
          ? compareWeights(left.highest, right.highest)
          : left.dimension < right.dimension
            ? -1
            : 1,
      )
      .map((entry) => ({
        id: `${type}:${entry.highest.join(",")}`,
        type,
        rank: description.rank,
        highest_weight: entry.highest,
        highest_weight_height: entry.height,
        representation_dimension: entry.dimension.toString(),
        dimension_band: entry.band,
        selection_reasons: [...entry.reasons].sort(),
        required_targets: entry.requiredTargets,
      }));
    representations.push(...typeRepresentations);
    perType[type] = typeRepresentations.length;
  }
  return {
    schema_version: 1,
    scope_revision: plan.scope_revision,
    plan_sha256: sha256(planRecord.bytes),
    oracle_implementation: plan.oracle.implementation,
    oracle_algorithm: plan.oracle.algorithm,
    oracle_interface_version: plan.oracle.interface_version,
    oracle_declared_revision: plan.oracle.zero_revision,
    oracle_executable_sha256: sha256(executableBytes),
    candidate_envelope: plan.generator.candidate_envelope,
    selection: plan.generator.representation_selection,
    representations,
    summary: { representations: representations.length, per_type: perType },
  };
};

const dominantKey = (target, rank, cartan) => {
  const dominant = orientDominant(target, Array(rank).fill(0), cartan);
  if (!dominant) throw new Error(`could not orient target ${target}`);
  return dominant.weight.join(",");
};

const generateTargets = (representation, description, plan) => {
  const targets = [];
  const baseSeed = (plan.generator.seed ^ fnv1a(representation.id)) >>> 0;
  const anti = antiDominant(
    representation.highest_weight,
    description.cartan,
    makeRandom(baseSeed ^ 0xa5a5a5a5),
  );
  if (!anti) throw new Error(`anti-dominant walk failed for ${representation.id}`);
  const maximumDepth = anti.coefficient.reduce((sum, value) => sum + value, 0);
  for (const [anchorIndex, anchor] of plan.generator.target_depth_anchors_per_mille.entries()) {
    for (let trajectory = 0; trajectory < plan.generator.targets_per_depth_anchor; trajectory += 1) {
      const random = makeRandom(baseSeed ^ fnv1a(`${anchor}:${trajectory}`));
      const goal = Math.max(1, Math.floor((maximumDepth * anchor) / 1000));
      const walked = loweringWalk(
        representation.highest_weight,
        description.cartan,
        goal,
        random,
      );
      const requestedNonDominant =
        trajectory === plan.generator.non_dominant_target_index_per_anchor;
      const oriented = requestedNonDominant
        ? orientNonDominant(walked.weight, walked.coefficient, description.cartan, random)
        : orientDominant(walked.weight, walked.coefficient, description.cartan);
      const final = oriented ?? orientDominant(walked.weight, walked.coefficient, description.cartan);
      if (!final) throw new Error(`target orientation failed for ${representation.id}`);
      const depth = final.coefficient.reduce((sum, value) => sum + value, 0);
      const status = final.weight.every((value) => value >= 0)
        ? "dominant"
        : "non_dominant";
      targets.push({
        generation_index: targets.length,
        source: "frozen_depth_anchor",
        anchor_index: anchorIndex,
        anchor_per_mille: anchor,
        trajectory,
        target_weight: final.weight,
        target_depth: depth,
        target_status: status,
        dominant_target_key: dominantKey(final.weight, description.rank, description.cartan),
      });
    }
  }
  if (representation.required_targets.length > 0) {
    const required = representation.required_targets[0];
    const replacement = {
      generation_index: targets.length - 1,
      source: required.source,
      anchor_index: null,
      anchor_per_mille: null,
      trajectory: null,
      target_weight: required.target_weight,
      target_depth: required.target_depth,
      target_status: required.target_weight.every((value) => value >= 0)
        ? "dominant"
        : "non_dominant",
      dominant_target_key: dominantKey(
        required.target_weight,
        description.rank,
        description.cartan,
      ),
    };
    targets[targets.length - 1] = replacement;
  }
  return targets;
};

const orderTargets = (targets, order) => {
  if (order === "seeded_generation_order")
    return [...targets].sort((left, right) => left.generation_index - right.generation_index);
  const direction = order.startsWith("ascending") ? 1 : -1;
  return [...targets].sort((left, right) => {
    if (left.target_depth !== right.target_depth)
      return direction * (left.target_depth - right.target_depth);
    if (left.target_status !== right.target_status)
      return left.target_status === "dominant" ? -1 : 1;
    return compareWeights(left.target_weight, right.target_weight);
  });
};

const limitTargets = (targets, limit) => {
  if (!limit || targets.length <= limit) return targets;
  const limited = targets.slice(0, limit);
  const required = targets.find((target) => target.source === "phase0_v2_first_timeout");
  if (required && !limited.includes(required)) limited[limited.length - 1] = required;
  return limited;
};

const percentile = (values, probability) => {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(probability * ordered.length) - 1)];
};
const mean = (values) =>
  values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;

class OracleServer {
  constructor(executable, mode, hardTimeoutMs, memoLimitBytes) {
    this.executable = executable;
    this.mode = mode;
    this.hardTimeoutMs = hardTimeoutMs;
    this.memoLimitBytes = memoLimitBytes;
    this.child = null;
    this.iterator = null;
    this.stderr = "";
    this.ready = null;
  }

  async start() {
    this.child = spawn(
      this.executable,
      [this.mode === "grouped" ? "--serve-grouped" : "--serve"],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          ZERO_WEIGHT_MEMO_LIMIT_BYTES: String(this.memoLimitBytes),
          ZERO_WEIGHT_MEMO_PROGRESS: "1",
        },
      },
    );
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });
    this.iterator = createInterface({ input: this.child.stdout })[Symbol.asyncIterator]();
    const ready = JSON.parse(await this.nextLine());
    const expectedVersion = this.mode === "grouped" ? 2 : 1;
    if (ready.status !== "ready" || ready.schema_version !== expectedVersion)
      throw new Error(`oracle returned unexpected ready record: ${JSON.stringify(ready)}`);
    this.ready = ready;
  }

  latestMemoProgress() {
    const lines = this.stderr.trim().split(/\r?\n/u).reverse();
    for (const line of lines) {
      try {
        const value = JSON.parse(line);
        if (value.schema === "zero.weight_memo_progress.v1") return value;
      } catch {
        // Non-JSON diagnostics remain available in the retained stderr text.
      }
    }
    return null;
  }

  async nextLine() {
    const line = await new Promise((resolveLine, rejectLine) => {
      const timer = setTimeout(() => {
        const error = new Error(`oracle exceeded measurement hard timeout ${this.hardTimeoutMs} ms`);
        error.hardTimeout = true;
        rejectLine(error);
      }, this.hardTimeoutMs);
      this.iterator.next().then(
        (value) => {
          clearTimeout(timer);
          resolveLine(value);
        },
        (error) => {
          clearTimeout(timer);
          rejectLine(error);
        },
      );
    });
    if (line.done) throw new Error(`oracle closed output: ${this.stderr.trim()}`);
    return line.value;
  }

  sampleResidentBytes() {
    if (!this.child?.pid) return null;
    try {
      const output = execFileSync(
        "ps",
        ["-o", "rss=", "-p", String(this.child.pid)],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
      return output ? Number(output) * 1024 : null;
    } catch {
      return null;
    }
  }

  async request(line, sampleProcess = true) {
    const started = process.hrtime.bigint();
    let sampledPeakRss = sampleProcess ? this.sampleResidentBytes() : null;
    const sampler = sampleProcess
      ? setInterval(() => {
          const value = this.sampleResidentBytes();
          if (value !== null)
            sampledPeakRss = sampledPeakRss === null
              ? value
              : Math.max(sampledPeakRss, value);
        }, 25)
      : null;
    this.child.stdin.write(`${line}\n`);
    try {
      const raw = await this.nextLine();
      return {
        raw,
        value: JSON.parse(raw),
        elapsed_ms: Number(process.hrtime.bigint() - started) / 1e6,
        sampled_peak_rss_bytes: sampledPeakRss,
      };
    } catch (error) {
      if (error.hardTimeout) {
        error.sampledPeakRssBytes = sampledPeakRss;
        error.memoProgress = this.latestMemoProgress();
        this.child.kill("SIGKILL");
      }
      throw error;
    } finally {
      if (sampler) clearInterval(sampler);
    }
  }

  async metrics() {
    const response = await this.request("@metrics", false);
    if (response.value.status !== "metrics")
      throw new Error(`oracle metrics failed: ${response.raw}`);
    return response.value;
  }

  async close() {
    if (!this.child || this.child.exitCode !== null) return;
    await new Promise((resolveExit) => {
      const timer = setTimeout(() => {
        this.child.kill("SIGKILL");
        resolveExit();
      }, 2000);
      this.child.once("exit", () => {
        clearTimeout(timer);
        resolveExit();
      });
      this.child.stdin.end();
    });
  }
}

const queryLine = (representation, target) =>
  `${representation.type}\t${representation.highest_weight.join(",")}\t${target.target_weight.join(",")}`;

const runOrderedGroup = async ({ oracle, representation, targets, plan, mode, order }) => {
  const ordered = orderTargets(targets, order);
  const server = new OracleServer(
    oracle,
    mode,
    plan.frontier.measurement_hard_timeout_ms,
    plan.frontier.peak_incremental_memory_limit_bytes,
  );
  const records = [];
  let readyMetrics;
  let peakRss = 0;
  let hardTimeout = null;
  let oracleError = null;
  const started = process.hrtime.bigint();
  try {
    await server.start();
    readyMetrics = await server.metrics();
    peakRss = readyMetrics.max_rss_bytes;
    for (const target of ordered) {
      let response;
      try {
        response = await server.request(queryLine(representation, target));
      } catch (error) {
        if (error.hardTimeout) {
          if (error.sampledPeakRssBytes !== null)
            peakRss = Math.max(peakRss, error.sampledPeakRssBytes);
          hardTimeout = {
            request: queryLine(representation, target),
            target_depth: target.target_depth,
            sampled_peak_rss_bytes: error.sampledPeakRssBytes,
            memo_progress: error.memoProgress,
          };
          break;
        }
        throw error;
      }
      if (response.sampled_peak_rss_bytes !== null)
        peakRss = Math.max(peakRss, response.sampled_peak_rss_bytes);
      if (response.value.status === "error") {
        oracleError = {
          request: queryLine(representation, target),
          code: response.value.code,
        };
      }
      let metrics = null;
      if (!oracleError) {
        metrics = await server.metrics();
        peakRss = Math.max(peakRss, metrics.max_rss_bytes);
      }
      records.push({
        generation_index: target.generation_index,
        source: target.source,
        target_weight: target.target_weight,
        target_depth: target.target_depth,
        target_status: target.target_status,
        dominant_target_key: target.dominant_target_key,
        request: queryLine(representation, target),
        response: response.raw,
        multiplicity: response.value.multiplicity ?? null,
        elapsed_ms: response.elapsed_ms,
        sampled_peak_rss_bytes: response.sampled_peak_rss_bytes,
        threshold_exceeded: response.elapsed_ms > plan.frontier.query_timeout_ms,
        process_peak_rss_bytes: metrics?.max_rss_bytes ?? null,
        memo_entries_before: response.value.memo_entries_before ?? null,
        memo_entries: response.value.memo_entries ?? null,
        memo_entries_added: response.value.memo_entries_added ?? null,
        memo_hits: response.value.memo_hits ?? null,
        memo_capacity_bytes: response.value.memo_capacity_bytes ?? null,
        memo_peak_allocated_bytes: response.value.memo_peak_allocated_bytes ?? null,
        recurrence_terms: response.value.recurrence_terms ?? null,
      });
      if (oracleError) break;
    }
  } finally {
    await server.close();
  }
  const latencies = records.map((record) => record.elapsed_ms);
  const incrementalRss = readyMetrics ? Math.max(0, peakRss - readyMetrics.max_rss_bytes) : null;
  const maximumMemoEntries = Math.max(
    0,
    ...records.map((record) => record.memo_entries ?? 0),
    hardTimeout?.memo_progress?.memo_entries ?? 0,
  );
  const memoEntryBytes = server.ready?.memo_entry_bytes ?? null;
  return {
    mode,
    order,
    memo_configuration: server.ready
      ? {
          limit_bytes: server.ready.memo_limit_bytes ?? null,
          initial_capacity: server.ready.memo_initial_capacity ?? null,
          entry_bytes: memoEntryBytes,
          allocation_policy: server.ready.memo_allocation_policy ?? null,
          progress_schema: "zero.weight_memo_progress.v1",
        }
      : null,
    records,
    completed_queries: records.length,
    hard_timeout: hardTimeout,
    oracle_error: oracleError,
    latency_ms: {
      mean: mean(latencies),
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      maximum: latencies.length === 0 ? null : Math.max(...latencies),
      threshold_exceedances: records.filter((record) => record.threshold_exceeded).length,
    },
    memory_bytes: {
      ready_peak_rss: readyMetrics?.max_rss_bytes ?? null,
      group_peak_rss: peakRss || null,
      incremental_from_ready: incrementalRss,
      maximum_memo_entries: maximumMemoEntries,
      maximum_live_entry_bytes:
        memoEntryBytes === null ? null : maximumMemoEntries * memoEntryBytes,
      maximum_memo_capacity: Math.max(0, ...records.map((record) => record.memo_capacity_bytes ?? 0)),
      maximum_memo_peak_allocated: Math.max(0, ...records.map((record) => record.memo_peak_allocated_bytes ?? 0)),
      hard_timeout_rss_sampling: hardTimeout
        ? hardTimeout.sampled_peak_rss_bytes === null
          ? "unavailable"
          : "sampled_every_25ms"
        : "not_needed",
    },
    total_elapsed_ms: Number(process.hrtime.bigint() - started) / 1e6,
  };
};

const outputMap = (run) => {
  const values = new Map();
  for (const record of run.records) {
    const existing = values.get(record.request);
    if (existing !== undefined && existing !== record.multiplicity)
      throw new Error(`nondeterministic duplicate response for ${record.request}`);
    values.set(record.request, record.multiplicity);
  }
  return values;
};

const compareRuns = (left, right) => {
  const leftValues = outputMap(left);
  const rightValues = outputMap(right);
  const mismatches = [];
  for (const [request, value] of leftValues) {
    if (rightValues.has(request) && rightValues.get(request) !== value)
      mismatches.push({ request, left: value, right: rightValues.get(request) });
  }
  return mismatches;
};

const runPassesTime = (run, plan) =>
  !run.hard_timeout &&
  !run.oracle_error &&
  run.latency_ms.p95 !== null &&
  run.latency_ms.p95 <= plan.frontier.p95_limit_ms;
const runPassesMemory = (run, plan) =>
  run.memory_bytes.incremental_from_ready !== null &&
  run.memory_bytes.incremental_from_ready <=
    plan.frontier.peak_incremental_memory_limit_bytes;

const measureRepresentation = async ({ oracle, representation, description, plan, replayCount, targetLimit = null }) => {
  let targets = generateTargets(representation, description, plan);
  targets = limitTargets(targets, targetLimit);
  const cold = await runOrderedGroup({
    oracle,
    representation,
    targets,
    plan,
    mode: "fresh",
    order: "seeded_generation_order",
  });
  const binding = await runOrderedGroup({
    oracle,
    representation,
    targets,
    plan,
    mode: "grouped",
    order: plan.frontier.binding_target_order,
  });
  const sensitivities = [];
  for (const order of plan.frontier.sensitivity_target_orders) {
    sensitivities.push(
      await runOrderedGroup({
        oracle,
        representation,
        targets,
        plan,
        mode: "grouped",
        order,
      }),
    );
  }
  const replays = [];
  if (!binding.hard_timeout && !binding.oracle_error) {
    for (let replay = 0; replay < replayCount; replay += 1) {
      replays.push(
        await runOrderedGroup({
          oracle,
          representation,
          targets,
          plan,
          mode: "grouped",
          order: plan.frontier.binding_target_order,
        }),
      );
    }
  }
  const mismatches = [
    ...compareRuns(cold, binding),
    ...sensitivities.flatMap((run) => compareRuns(binding, run)),
    ...replays.flatMap((run) => compareRuns(binding, run)),
  ];
  const groupedRuns = [binding, ...sensitivities];
  const timePasses = groupedRuns.map((run) => runPassesTime(run, plan));
  const memoryStatuses = groupedRuns.map((run) =>
    run.hard_timeout && run.hard_timeout.sampled_peak_rss_bytes === null
      ? "unresolved"
      : runPassesMemory(run, plan)
        ? "pass"
        : "fail",
  );
  const orderSensitive = timePasses.some((value) => value !== timePasses[0]);
  const replayByteIdentical = replays.every(
    (run) =>
      run.records.length === binding.records.length &&
      run.records.every((record, index) => record.response === binding.records[index].response),
  );
  const exactnessPass = mismatches.length === 0 && replayByteIdentical;
  const timePass = timePasses.every(Boolean);
  const memoryPass = memoryStatuses.every((status) => status === "pass");
  const memoryUnresolved = memoryStatuses.includes("unresolved");
  let classification = "pass";
  if (!exactnessPass) classification = "exactness_fail";
  else if (orderSensitive) classification = "order_sensitive";
  else if (!timePass && memoryUnresolved) classification = "time_fail_memory_unresolved";
  else if (!timePass && !memoryPass) classification = "time_and_memory_fail";
  else if (!timePass) classification = "time_fail";
  else if (!memoryPass) classification = "memory_fail";
  return {
    representation,
    targets: {
      raw: targets.length,
      unique_requests: new Set(targets.map((target) => queryLine(representation, target))).size,
      unique_dominant_targets: new Set(targets.map((target) => target.dominant_target_key)).size,
    },
    classification,
    boundary: { exactness_pass: exactnessPass, time_pass: timePass, memory_pass: memoryPass, memory_statuses: memoryStatuses, order_sensitive: orderSensitive },
    exactness: { mismatches, replay_byte_identical: replayByteIdentical, replay_runs: replays.length },
    cold,
    binding,
    sensitivities,
    replays,
  };
};

const summarize = (measurements) => {
  const classifications = {};
  for (const measurement of measurements)
    classifications[measurement.classification] =
      (classifications[measurement.classification] ?? 0) + 1;
  const testedCeilings = {};
  for (const type of new Set(measurements.map((measurement) => measurement.representation.type))) {
    const ordered = measurements
      .filter((measurement) => measurement.representation.type === type)
      .sort((left, right) =>
        BigInt(left.representation.representation_dimension) <
        BigInt(right.representation.representation_dimension)
          ? -1
          : 1,
      );
    let ceiling = null;
    let failed = false;
    const holes = [];
    for (const measurement of ordered) {
      if (!failed && measurement.classification === "pass")
        ceiling = measurement.representation.representation_dimension;
      else if (measurement.classification !== "pass") failed = true;
      else holes.push({
        highest_weight: measurement.representation.highest_weight,
        dimension: measurement.representation.representation_dimension,
      });
    }
    testedCeilings[type] = { dimension: ceiling, pass_after_first_failure: holes };
  }
  return { representations: measurements.length, classifications, tested_ceilings: testedCeilings };
};

const calibrateParallelism = async ({ oracle, measurements, descriptions, plan, smoke }) => {
  const stress = [...measurements]
    .filter((measurement) => measurement.classification === "pass")
    .sort((left, right) =>
      (right.binding.latency_ms.p95 ?? 0) - (left.binding.latency_ms.p95 ?? 0),
    )
    .slice(0, 8);
  const results = [];
  const candidates = smoke
    ? plan.frontier.parallelism_candidates.filter((value) => value <= 2)
    : plan.frontier.parallelism_candidates;
  for (const workers of candidates) {
    if (stress.length === 0) break;
    const started = process.hrtime.bigint();
    const runs = await Promise.all(
      Array.from({ length: workers }, (_, index) => {
        const measurement = stress[index % stress.length];
        const representation = measurement.representation;
        let targets = generateTargets(
          representation,
          descriptions.get(representation.type),
          plan,
        );
        targets = limitTargets(targets, smoke ? 8 : null);
        return runOrderedGroup({
          oracle,
          representation,
          targets,
          plan,
          mode: "grouped",
          order: plan.frontier.binding_target_order,
        });
      }),
    );
    const safe = runs.every(
      (run) => runPassesTime(run, plan) && runPassesMemory(run, plan),
    );
    results.push({
      workers,
      safe,
      wall_clock_ms: Number(process.hrtime.bigint() - started) / 1e6,
      runs: runs.map((run) => ({
        p95_ms: run.latency_ms.p95,
        maximum_ms: run.latency_ms.maximum,
        incremental_memory_bytes: run.memory_bytes.incremental_from_ready,
        hard_timeout: run.hard_timeout,
        oracle_error: run.oracle_error,
      })),
    });
  }
  return {
    candidates: results,
    safe_parallel_workers: results.filter((entry) => entry.safe).at(-1)?.workers ?? 0,
  };
};

const selfTest = () => {
  const a1 = {
    rank: 1,
    symmetrizer: [1],
    positive_roots: [[1]],
  };
  if (exactWeylDimension([4], a1) !== 5n)
    throw new Error("A1 Weyl-dimension self-test failed");
  if (integerSqrt(0n) !== 0n || integerSqrt(2n) !== 1n || integerSqrt(10n ** 40n) !== 10n ** 20n)
    throw new Error("integer-square-root self-test failed");
  const targets = [
    { generation_index: 0, target_depth: 8, target_status: "dominant", target_weight: [1] },
    { generation_index: 1, target_depth: 2, target_status: "non_dominant", target_weight: [-1] },
    { generation_index: 2, target_depth: 2, target_status: "dominant", target_weight: [0] },
  ];
  const ascending = orderTargets(targets, "ascending_depth_dominant_first_lexicographic");
  if (ascending.map((target) => target.generation_index).join(",") !== "2,1,0")
    throw new Error("target-order self-test failed");
  console.log(JSON.stringify({ status: "pass", exact_weyl_dimension: true, target_order: true }));
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.selfTest) {
    selfTest();
    return;
  }
  if (!options.oracle) throw new Error("--oracle is required");
  const planPath = resolve(root, options.plan);
  const oraclePath = resolve(options.oracle);
  if (options.manifestOut) {
    const manifest = await generateManifest({
      planPath,
      oraclePath,
      typeFilter: options.types,
    });
    await writeFile(resolve(root, options.manifestOut), stableJson(manifest));
    console.log(JSON.stringify(manifest.summary));
    return;
  }
  if (!options.manifest || !options.out)
    throw new Error("--manifest and --out are required for a frontier run");
  const planRecord = await readJsonBytes(planPath);
  const manifestRecord = await readJsonBytes(resolve(root, options.manifest));
  const plan = planRecord.value;
  const manifest = manifestRecord.value;
  if (manifest.plan_sha256 !== sha256(planRecord.bytes))
    throw new Error("manifest does not bind the current plan");
  const executableBytes = await readFile(oraclePath);
  if (manifest.oracle_executable_sha256 !== sha256(executableBytes))
    throw new Error("manifest does not bind the supplied oracle executable");
  let representations = manifest.representations.filter(
    (representation) => !options.types || options.types.has(representation.type),
  );
  if (options.selectionReason)
    representations = representations.filter((representation) =>
      representation.selection_reasons.includes(options.selectionReason),
    );
  if (options.limitRepresentations)
    representations = representations.slice(0, options.limitRepresentations);
  if (options.smoke) representations = representations.slice(0, Math.min(3, representations.length));
  const outPath = resolve(root, options.out);
  let result;
  if (options.resume) {
    result = JSON.parse(await readFile(outPath, "utf8"));
    if (
      result.plan_sha256 !== manifest.plan_sha256 ||
      result.manifest_sha256 !== sha256(manifestRecord.bytes) ||
      result.oracle_executable_sha256 !== manifest.oracle_executable_sha256
    )
      throw new Error("resume result does not bind the current plan and manifest");
  } else {
    result = {
      schema_version: 1,
      evidence_status: options.smoke ? "nonbinding_smoke" : "binding_in_progress",
      scope_revision: plan.scope_revision,
      plan_sha256: manifest.plan_sha256,
      manifest_sha256: sha256(manifestRecord.bytes),
      oracle_executable_sha256: manifest.oracle_executable_sha256,
      oracle_declared_revision: plan.oracle.zero_revision,
      controller_revision: controllerRevision(),
      reference_hardware: {
        cpu: cpus()[0]?.model ?? "unknown",
        architecture: arch(),
        logical_cpus: cpus().length,
        memory_bytes: totalmem(),
        operating_system: `${platform()} ${release()}`,
      },
      started_at: new Date().toISOString(),
      measurements: [],
      parallelism: null,
      summary: null,
      phase_1: { authorized: false, corpus_generated: false, models_trained: false },
    };
  }
  const completed = new Set(result.measurements.map((measurement) => measurement.representation.id));
  await assertOracleExecutable(
    oraclePath,
    manifest.oracle_executable_sha256,
    "before type description",
  );
  const descriptions = new Map();
  for (const representation of representations)
    if (!descriptions.has(representation.type))
      descriptions.set(representation.type, describeType(oraclePath, representation.type));
  for (const representation of representations) {
    if (completed.has(representation.id)) continue;
    await assertOracleExecutable(
      oraclePath,
      manifest.oracle_executable_sha256,
      `before ${representation.id}`,
    );
    const measurement = await measureRepresentation({
      oracle: oraclePath,
      representation,
      description: descriptions.get(representation.type),
      plan,
      replayCount: options.smoke ? 1 : plan.frontier.replays,
      targetLimit: options.smoke ? 8 : null,
    });
    await assertOracleExecutable(
      oraclePath,
      manifest.oracle_executable_sha256,
      `after ${representation.id}`,
    );
    result.measurements.push(measurement);
    result.summary = summarize(result.measurements);
    await writeFile(outPath, stableJson(result));
    console.log(JSON.stringify({
      representation: representation.id,
      dimension: representation.representation_dimension,
      classification: measurement.classification,
      binding_p95_ms: measurement.binding.latency_ms.p95,
      binding_incremental_memory_bytes: measurement.binding.memory_bytes.incremental_from_ready,
    }));
  }
  await assertOracleExecutable(
    oraclePath,
    manifest.oracle_executable_sha256,
    "before parallelism calibration",
  );
  result.parallelism = await calibrateParallelism({
    oracle: oraclePath,
    measurements: result.measurements,
    descriptions,
    plan,
    smoke: options.smoke,
  });
  await assertOracleExecutable(
    oraclePath,
    manifest.oracle_executable_sha256,
    "after parallelism calibration",
  );
  result.summary = summarize(result.measurements);
  result.completed_at = new Date().toISOString();
  result.evidence_status = options.smoke ? "nonbinding_smoke" : "binding_frontier_complete_cross_check_pending";
  await writeFile(outPath, stableJson(result));
  console.log(JSON.stringify({ summary: result.summary, parallelism: result.parallelism }));
};

export { describeType, exactWeylDimension, generateTargets, sha256, stableJson };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
