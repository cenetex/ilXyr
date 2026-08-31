#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn, execFile, execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const parseArguments = (values) => {
  const options = {
    plan: "examples/weight-multiplicity/phase05-frontier-plan-v2.json",
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
const readJsonBytes = async (path) => {
  const bytes = await readFile(path);
  return { bytes, value: JSON.parse(bytes.toString("utf8")) };
};
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

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
  constructor(
    executable,
    mode,
    hardTimeoutMs,
    memoLimitBytes,
    samplingStartMs,
    samplingIntervalMs,
    oracleEnvironment = {},
  ) {
    this.executable = executable;
    this.mode = mode;
    this.hardTimeoutMs = hardTimeoutMs;
    this.memoLimitBytes = memoLimitBytes;
    this.samplingStartMs = samplingStartMs;
    this.samplingIntervalMs = samplingIntervalMs;
    this.oracleEnvironment = oracleEnvironment;
    this.child = null;
    this.iterator = null;
    this.stderr = "";
    this.ready = null;
  }

  async start() {
    const serverArgument = {
      fresh: "--serve",
      grouped: "--serve-grouped",
      prepared: "--serve-prepared",
      ray: "--serve-ray",
    }[this.mode];
    if (!serverArgument) throw new Error(`unsupported oracle mode: ${this.mode}`);
    this.child = spawn(
      this.executable,
      [serverArgument],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          ZERO_WEIGHT_MEMO_LIMIT_BYTES: String(this.memoLimitBytes),
          ...this.oracleEnvironment,
        },
      },
    );
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });
    this.iterator = createInterface({ input: this.child.stdout })[Symbol.asyncIterator]();
    const ready = JSON.parse(await this.nextLine());
    const expectedVersion = { fresh: 1, grouped: 2, prepared: 3, ray: 4 }[this.mode];
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
        // Keep non-JSON diagnostics in the retained stderr text.
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

  async sampleResidentBytes() {
    if (!this.child?.pid) return null;
    return await new Promise((resolveSample) => {
      try {
        execFile(
          "ps",
          ["-o", "rss=", "-p", String(this.child.pid)],
          { encoding: "utf8" },
          (error, output) => {
            if (error) resolveSample(null);
            else {
              const value = output.trim();
              resolveSample(value ? Number(value) * 1024 : null);
            }
          },
        );
      } catch {
        resolveSample(null);
      }
    });
  }

  async samplePeakResidentBytes() {
    if (!this.child?.pid) return { bytes: null, observation: "unavailable" };
    if (platform() === "linux") {
      try {
        const status = await readFile(`/proc/${this.child.pid}/status`, "utf8");
        const match = status.match(/^VmHWM:\s+(\d+)\s+kB$/mu);
        if (match)
          return {
            bytes: Number(match[1]) * 1024,
            observation: "linux_proc_vmhwm_at_hard_timeout",
          };
      } catch {
        // Fall back to a current-RSS sample when procfs is unavailable.
      }
    }
    return {
      bytes: await this.sampleResidentBytes(),
      observation: "current_rss_sample_at_hard_timeout",
    };
  }

  async request(line, sampleProcess = true) {
    const started = process.hrtime.bigint();
    let sampledPeakRss = null;
    let samplingStopped = false;
    let sampler = null;
    const sample = async () => {
      const value = await this.sampleResidentBytes();
      if (samplingStopped) return;
      if (value !== null)
        sampledPeakRss = sampledPeakRss === null
          ? value
          : Math.max(sampledPeakRss, value);
      sampler = setTimeout(sample, this.samplingIntervalMs);
    };
    if (sampleProcess) sampler = setTimeout(sample, this.samplingStartMs);
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
        const finalPeak = await this.samplePeakResidentBytes();
        error.sampledPeakRssBytes =
          finalPeak.bytes === null
            ? sampledPeakRss
            : sampledPeakRss === null
              ? finalPeak.bytes
              : Math.max(sampledPeakRss, finalPeak.bytes);
        error.peakRssObservation = finalPeak.observation;
        error.memoProgress = this.latestMemoProgress();
        this.child.kill("SIGKILL");
      }
      throw error;
    } finally {
      samplingStopped = true;
      if (sampler) clearTimeout(sampler);
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

const preparedReplayProjection = (value) => ({
  multiplicity: value.multiplicity ?? null,
  engine: value.engine ?? null,
  cache_mode: value.cache_mode ?? null,
  session_generation: value.session_generation ?? null,
  memo_entries_before: value.memo_entries_before ?? null,
  memo_entries: value.memo_entries ?? null,
  memo_entries_added: value.memo_entries_added ?? null,
  memo_hits: value.memo_hits ?? null,
  recurrence_terms: value.recurrence_terms ?? null,
  recursive_weyl_folds: value.recursive_weyl_folds ?? null,
  prepared_nodes_before: value.prepared_nodes_before ?? null,
  prepared_nodes: value.prepared_nodes ?? null,
  prepared_nodes_added: value.prepared_nodes_added ?? null,
  prepared_edges_before: value.prepared_edges_before ?? null,
  prepared_edges: value.prepared_edges ?? null,
  prepared_edges_added: value.prepared_edges_added ?? null,
  prepared_raw_transitions: value.prepared_raw_transitions ?? null,
  prepared_worker_count: value.prepared_worker_count ?? null,
  maximum_level: value.maximum_level ?? null,
});

const rayReplayProjection = (value) => ({
  multiplicity: value.multiplicity ?? null,
  engine: value.engine ?? null,
  cache_mode: value.cache_mode ?? null,
  session_generation: value.session_generation ?? null,
  memo_entries_before: value.memo_entries_before ?? null,
  memo_entries: value.memo_entries ?? null,
  memo_entries_added: value.memo_entries_added ?? null,
  memo_hits: value.memo_hits ?? null,
  recurrence_terms: value.recurrence_terms ?? null,
  recursive_weyl_folds: value.recursive_weyl_folds ?? null,
  ray_states: value.ray_states ?? null,
  ray_state_hits: value.ray_state_hits ?? null,
  ray_transitions: value.ray_transitions ?? null,
  ray_nodes_before: value.ray_nodes_before ?? null,
  ray_nodes: value.ray_nodes ?? null,
  ray_nodes_added: value.ray_nodes_added ?? null,
  ray_worker_count: value.ray_worker_count ?? null,
  ray_parallel_groups: value.ray_parallel_groups ?? null,
  ray_parallel_nodes: value.ray_parallel_nodes ?? null,
  maximum_level: value.maximum_level ?? null,
});

const runOrderedGroup = async ({
  oracle,
  representation,
  targets,
  plan,
  mode,
  order,
  oracleEnvironment = {},
}) => {
  const ordered = orderTargets(targets, order);
  const server = new OracleServer(
    oracle,
    mode,
    plan.frontier.measurement_hard_timeout_ms,
    plan.frontier.peak_incremental_memory_limit_bytes,
    plan.frontier.hard_timeout_rss_sampling_start_ms,
    plan.frontier.hard_timeout_rss_sampling_interval_ms,
    oracleEnvironment,
  );
  const records = [];
  let readyMetrics;
  let exactPeakRss = 0;
  let hardTimeout = null;
  let oracleError = null;
  const started = process.hrtime.bigint();
  try {
    await server.start();
    readyMetrics = await server.metrics();
    exactPeakRss = readyMetrics.max_rss_bytes;
    for (const target of ordered) {
      let response;
      try {
        response = await server.request(queryLine(representation, target));
      } catch (error) {
        if (error.hardTimeout) {
          hardTimeout = {
            request: queryLine(representation, target),
            target_depth: target.target_depth,
            sampled_peak_rss_bytes: error.sampledPeakRssBytes,
            peak_rss_observation: error.peakRssObservation,
            memo_progress: error.memoProgress,
          };
          break;
        }
        throw error;
      }
      if (response.value.status === "error") {
        oracleError = {
          request: queryLine(representation, target),
          code: response.value.code,
        };
      }
      let metrics = null;
      if (!oracleError) {
        metrics = await server.metrics();
        exactPeakRss = Math.max(exactPeakRss, metrics.max_rss_bytes);
      }
      records.push({
        session_query_index: records.length,
        generation_index: target.generation_index,
        source: target.source,
        target_weight: target.target_weight,
        target_depth: target.target_depth,
        target_status: target.target_status,
        dominant_target_key: target.dominant_target_key,
        request: queryLine(representation, target),
        response: response.raw,
        replay_projection:
          mode === "prepared"
            ? preparedReplayProjection(response.value)
            : mode === "ray"
              ? rayReplayProjection(response.value)
              : null,
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
        recursive_weyl_folds: response.value.recursive_weyl_folds ?? null,
        prepared_nodes_before: response.value.prepared_nodes_before ?? null,
        prepared_nodes: response.value.prepared_nodes ?? null,
        prepared_nodes_added: response.value.prepared_nodes_added ?? null,
        prepared_edges_before: response.value.prepared_edges_before ?? null,
        prepared_edges: response.value.prepared_edges ?? null,
        prepared_edges_added: response.value.prepared_edges_added ?? null,
        prepared_raw_transitions: response.value.prepared_raw_transitions ?? null,
        prepared_discovery_nanoseconds:
          response.value.prepared_discovery_nanoseconds ?? null,
        prepared_evaluation_nanoseconds:
          response.value.prepared_evaluation_nanoseconds ?? null,
        prepared_graph_capacity_bytes:
          response.value.prepared_graph_capacity_bytes ?? null,
        prepared_worker_count: response.value.prepared_worker_count ?? null,
        ray_states: response.value.ray_states ?? null,
        ray_state_hits: response.value.ray_state_hits ?? null,
        ray_transitions: response.value.ray_transitions ?? null,
        ray_nodes_before: response.value.ray_nodes_before ?? null,
        ray_nodes: response.value.ray_nodes ?? null,
        ray_nodes_added: response.value.ray_nodes_added ?? null,
        ray_graph_capacity_bytes:
          response.value.ray_graph_capacity_bytes ?? null,
        ray_capacity_bytes: response.value.ray_capacity_bytes ?? null,
        ray_peak_allocated_bytes:
          response.value.ray_peak_allocated_bytes ?? null,
        ray_discovery_nanoseconds:
          response.value.ray_discovery_nanoseconds ?? null,
        ray_evaluation_nanoseconds:
          response.value.ray_evaluation_nanoseconds ?? null,
        ray_worker_count: response.value.ray_worker_count ?? null,
        ray_parallel_groups: response.value.ray_parallel_groups ?? null,
        ray_parallel_nodes: response.value.ray_parallel_nodes ?? null,
        working_set_capacity_bytes:
          response.value.working_set_capacity_bytes ?? null,
        working_set_peak_allocated_bytes:
          response.value.working_set_peak_allocated_bytes ?? null,
        cache_state:
          mode !== "prepared" && mode !== "ray"
            ? null
            : records.length === 0
              ? "cold_session_query"
              : (mode === "prepared"
                  ? response.value.prepared_nodes_added
                  : response.value.ray_nodes_added) === 0
                ? "no_graph_extension"
                : "extended_graph",
      });
      if (oracleError) break;
    }
  } finally {
    await server.close();
  }
  const latencies = records.map((record) => record.elapsed_ms);
  const completedPrefixIncrementalRss = readyMetrics
    ? Math.max(0, exactPeakRss - readyMetrics.max_rss_bytes)
    : null;
  const timeoutPeakRssLowerBound = hardTimeout
    ? Math.max(exactPeakRss, hardTimeout.sampled_peak_rss_bytes ?? 0)
    : null;
  const timeoutIncrementalRssLowerBound =
    readyMetrics && timeoutPeakRssLowerBound !== null
      ? Math.max(0, timeoutPeakRssLowerBound - readyMetrics.max_rss_bytes)
      : null;
  const memoryObservation = hardTimeout
    ? timeoutIncrementalRssLowerBound !== null &&
      timeoutIncrementalRssLowerBound > plan.frontier.peak_incremental_memory_limit_bytes
      ? "lower_bound_limit_exceeded"
      : "unknown_after_hard_timeout"
    : oracleError
      ? "unknown_after_oracle_error"
      : "exact_process_high_water";
  const incrementalRss =
    memoryObservation === "exact_process_high_water"
      ? completedPrefixIncrementalRss
      : null;
  const maximumMemoEntries = Math.max(
    0,
    ...records.map((record) => record.memo_entries ?? 0),
    hardTimeout?.memo_progress?.memo_entries ?? 0,
  );
  return {
    mode,
    optimization_stage:
      mode === "fresh"
        ? plan.frontier.optimization_sequence[0]
        : mode === "grouped"
          ? plan.frontier.optimization_sequence[1]
          : plan.frontier.optimization_sequence.at(-1),
    order,
    memo_configuration: server.ready
      ? {
          limit_bytes: server.ready.memo_limit_bytes ?? null,
          initial_capacity: server.ready.memo_initial_capacity ?? null,
          entry_bytes: server.ready.memo_entry_bytes ?? null,
          allocation_policy: server.ready.memo_allocation_policy ?? null,
          progress_schema:
            oracleEnvironment.ZERO_WEIGHT_MEMO_PROGRESS === "1"
              ? "zero.weight_memo_progress.v1"
              : null,
          cache_mode: server.ready.cache_mode ?? null,
          prepared_workers:
            mode === "prepared"
              ? Number(oracleEnvironment.ZERO_WEIGHT_PREPARED_WORKERS)
              : null,
          ray_workers:
            mode === "ray"
              ? Number(oracleEnvironment.ZERO_WEIGHT_RAY_WORKERS)
              : null,
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
      group_peak_rss:
        memoryObservation === "exact_process_high_water" ? exactPeakRss || null : null,
      incremental_from_ready: incrementalRss,
      completed_prefix_peak_rss: exactPeakRss || null,
      completed_prefix_incremental_from_ready: completedPrefixIncrementalRss,
      hard_timeout_peak_rss_lower_bound: timeoutPeakRssLowerBound,
      hard_timeout_incremental_rss_lower_bound: timeoutIncrementalRssLowerBound,
      observation: memoryObservation,
      maximum_memo_entries: maximumMemoEntries,
      maximum_live_entry_bytes:
        server.ready?.memo_entry_bytes === undefined
          ? null
          : maximumMemoEntries * server.ready.memo_entry_bytes,
      maximum_memo_capacity: Math.max(0, ...records.map((record) => record.memo_capacity_bytes ?? 0)),
      maximum_memo_peak_allocated: Math.max(0, ...records.map((record) => record.memo_peak_allocated_bytes ?? 0)),
      maximum_working_set_capacity: Math.max(
        0,
        ...records.map((record) => record.working_set_capacity_bytes ?? 0),
      ),
      maximum_working_set_peak_allocated: Math.max(
        0,
        ...records.map(
          (record) => record.working_set_peak_allocated_bytes ?? 0,
        ),
      ),
      maximum_prepared_graph_capacity: Math.max(
        0,
        ...records.map(
          (record) => record.prepared_graph_capacity_bytes ?? 0,
        ),
      ),
      maximum_ray_graph_capacity: Math.max(
        0,
        ...records.map(
          (record) => record.ray_graph_capacity_bytes ?? 0,
        ),
      ),
      maximum_ray_capacity: Math.max(
        0,
        ...records.map((record) => record.ray_capacity_bytes ?? 0),
      ),
      hard_timeout_rss_sampling: hardTimeout
        ? hardTimeout.sampled_peak_rss_bytes === null
          ? "unavailable"
          : `sampled_after_${plan.frontier.hard_timeout_rss_sampling_start_ms}ms_every_${plan.frontier.hard_timeout_rss_sampling_interval_ms}ms`
        : "not_needed",
      hard_timeout_peak_observation: hardTimeout?.peak_rss_observation ?? null,
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

const replayIdentity = (record, projection) =>
  projection
    ? JSON.stringify(record.replay_projection)
    : record.response_sha256 ?? record.response;

const compactMeasurementRecords = (measurement) => {
  for (const run of [
    measurement.cold,
    measurement.binding,
    ...measurement.sensitivities,
    ...measurement.replays,
  ]) {
    for (const record of run.records) {
      if (record.response !== undefined) {
        record.response_sha256 = sha256(record.response);
        delete record.response;
      }
      delete record.replay_projection;
    }
  }
  return measurement;
};

const runPassesTime = (run, plan) =>
  !run.hard_timeout &&
  !run.oracle_error &&
  run.latency_ms.p95 !== null &&
  run.latency_ms.p95 <= plan.frontier.p95_limit_ms;
const runComplete = (run, expectedQueries) =>
  !run.hard_timeout &&
  !run.oracle_error &&
  run.completed_queries === expectedQueries;
const assessExactness = ({
  runs,
  binding,
  replays,
  expectedQueries,
  requiredReplays,
  mismatches,
}) => {
  const replayObserved =
    runComplete(binding, expectedQueries) &&
    replays.length === requiredReplays &&
    replays.every((run) => runComplete(run, expectedQueries));
  const replayProjection =
    binding.mode === "prepared" || binding.mode === "ray";
  const replayIdentityObserved = replayObserved
    ? replays.every(
        (run) =>
          run.records.length === binding.records.length &&
          run.records.every(
            (record, index) =>
              replayIdentity(record, replayProjection) ===
              replayIdentity(binding.records[index], replayProjection),
          ),
      )
    : null;
  const replayByteIdentical = replayProjection ? null : replayIdentityObserved;
  const replayProjectionIdentical = replayProjection
    ? replayIdentityObserved
    : null;
  const allRunsComplete =
    replays.length === requiredReplays &&
    runs.every((run) => runComplete(run, expectedQueries));
  const status =
    mismatches.length > 0 || replayIdentityObserved === false
      ? "fail"
      : replayObserved &&
          (requiredReplays === 0 || replayIdentityObserved === true)
        ? "pass"
        : "unknown_after_hard_timeout_or_oracle_error";
  return {
    status,
    all_runs_complete: allRunsComplete,
    replay_observed: replayObserved,
    replay_byte_identical: replayByteIdentical,
    replay_projection_identical: replayProjectionIdentical,
  };
};
const runMemoryStatus = (run, plan) => {
  if (run.memory_bytes.observation === "lower_bound_limit_exceeded") return "fail";
  if (run.memory_bytes.observation !== "exact_process_high_water") return "unknown";
  if (run.memory_bytes.incremental_from_ready === null) return "unknown";
  return run.memory_bytes.incremental_from_ready <=
    plan.frontier.peak_incremental_memory_limit_bytes
    ? "pass"
    : "fail";
};
const runPassesMemory = (run, plan) => runMemoryStatus(run, plan) === "pass";

const sessionOracleEnvironment = (plan) => {
  if (plan.frontier.session_mode === "prepared")
    return {
      ZERO_WEIGHT_PREPARED_WORKERS: String(
        plan.frontier.prepared_workers_per_process,
      ),
    };
  if (plan.frontier.session_mode === "ray")
    return {
      ZERO_WEIGHT_RAY_WORKERS: String(
        plan.frontier.ray_workers_per_process,
      ),
    };
  return {};
};

const measureRepresentation = async ({ oracle, representation, description, plan, replayCount, targetLimit = null }) => {
  const sessionMode = plan.frontier.session_mode ?? "grouped";
  const oracleEnvironment = sessionOracleEnvironment(plan);
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
    mode: sessionMode,
    order: plan.frontier.binding_target_order,
    oracleEnvironment,
  });
  const sensitivities = [];
  for (const order of plan.frontier.sensitivity_target_orders) {
    sensitivities.push(
      await runOrderedGroup({
        oracle,
        representation,
        targets,
        plan,
        mode: sessionMode,
        order,
        oracleEnvironment,
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
          mode: sessionMode,
          order: plan.frontier.binding_target_order,
          oracleEnvironment,
        }),
      );
    }
  }
  const mismatches = [
    ...compareRuns(cold, binding),
    ...sensitivities.flatMap((run) => compareRuns(binding, run)),
    ...replays.flatMap((run) => compareRuns(binding, run)),
  ];
  const orderRuns = [binding, ...sensitivities];
  const requiredGroupedRuns = [...orderRuns, ...replays];
  const orderTimePasses = orderRuns.map((run) => runPassesTime(run, plan));
  const memoryStatuses = requiredGroupedRuns.map((run) => runMemoryStatus(run, plan));
  const orderSensitive = orderTimePasses.some((value) => value !== orderTimePasses[0]);
  const exactness = assessExactness({
    runs: [cold, ...requiredGroupedRuns],
    binding,
    replays,
    expectedQueries: targets.length,
    requiredReplays: replayCount,
    mismatches,
  });
  const exactnessPass = exactness.status === "pass";
  const timePass =
    replays.length === replayCount &&
    requiredGroupedRuns.every((run) => runPassesTime(run, plan));
  const memoryPass = memoryStatuses.every((status) => status === "pass");
  const memoryUnknown = memoryStatuses.includes("unknown");
  const memoryFail = memoryStatuses.includes("fail");
  let classification = "pass";
  if (exactness.status === "fail") classification = "exactness_fail";
  else if (orderSensitive) classification = "order_sensitive";
  else if (!timePass && memoryFail) classification = "time_and_memory_fail";
  else if (!timePass && memoryUnknown) classification = "time_fail_memory_unknown";
  else if (!timePass) classification = "time_fail";
  else if (memoryFail) classification = "memory_fail";
  else if (memoryUnknown) classification = "memory_unknown";
  return {
    representation,
    targets: {
      raw: targets.length,
      unique_requests: new Set(targets.map((target) => queryLine(representation, target))).size,
      unique_dominant_targets: new Set(targets.map((target) => target.dominant_target_key)).size,
    },
    classification,
    boundary: { exactness_pass: exactnessPass, exactness_known: exactness.status !== "unknown_after_hard_timeout_or_oracle_error", exactness_status: exactness.status, time_pass: timePass, memory_pass: memoryPass, memory_known: !memoryUnknown, memory_statuses: memoryStatuses, order_sensitive: orderSensitive },
    exactness: {
      mismatches,
      all_runs_complete: exactness.all_runs_complete,
      replay_observed: exactness.replay_observed,
      replay_byte_identical: exactness.replay_byte_identical,
      replay_projection_identical: exactness.replay_projection_identical,
      replay_runs: replays.length,
      required_replay_runs: replayCount,
    },
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
          mode: plan.frontier.session_mode ?? "grouped",
          order: plan.frontier.binding_target_order,
          oracleEnvironment: sessionOracleEnvironment(plan),
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
  const memoryPlan = { frontier: { peak_incremental_memory_limit_bytes: 100 } };
  const memoryRun = (observation, incremental) => ({
    memory_bytes: { observation, incremental_from_ready: incremental },
  });
  if (
    runMemoryStatus(memoryRun("exact_process_high_water", 100), memoryPlan) !== "pass" ||
    runMemoryStatus(memoryRun("exact_process_high_water", 101), memoryPlan) !== "fail" ||
    runMemoryStatus(memoryRun("unknown_after_hard_timeout", null), memoryPlan) !== "unknown" ||
    runMemoryStatus(memoryRun("lower_bound_limit_exceeded", null), memoryPlan) !== "fail"
  )
    throw new Error("memory-observation self-test failed");
  const completeRun = (responses) => ({
    hard_timeout: null,
    oracle_error: null,
    completed_queries: responses.length,
    records: responses.map((response) => ({ response })),
  });
  const binding = completeRun(["one", "two"]);
  const incompleteReplay = {
    hard_timeout: { request: "second" },
    oracle_error: null,
    completed_queries: 1,
    records: [{ response: "one" }],
  };
  const incompleteExactness = assessExactness({
    runs: [binding, incompleteReplay],
    binding,
    replays: [incompleteReplay],
    expectedQueries: 2,
    requiredReplays: 1,
    mismatches: [],
  });
  const disagreementExactness = assessExactness({
    runs: [binding, completeRun(["one", "different"])],
    binding,
    replays: [completeRun(["one", "different"])],
    expectedQueries: 2,
    requiredReplays: 1,
    mismatches: [],
  });
  const preparedBinding = {
    ...completeRun(["timing-one", "timing-two"]),
    mode: "prepared",
  };
  preparedBinding.records[0].replay_projection = { multiplicity: "1" };
  preparedBinding.records[1].replay_projection = { multiplicity: "2" };
  const preparedReplay = {
    ...completeRun(["different-timing-one", "different-timing-two"]),
    mode: "prepared",
  };
  preparedReplay.records[0].replay_projection = { multiplicity: "1" };
  preparedReplay.records[1].replay_projection = { multiplicity: "2" };
  const preparedExactness = assessExactness({
    runs: [preparedBinding, preparedReplay],
    binding: preparedBinding,
    replays: [preparedReplay],
    expectedQueries: 2,
    requiredReplays: 1,
    mismatches: [],
  });
  const capacityOnlyDifferenceIgnored =
    JSON.stringify(
      preparedReplayProjection({
        multiplicity: "1",
        recurrence_terms: 7,
        prepared_graph_capacity_bytes: 1024,
      }),
    ) ===
    JSON.stringify(
      preparedReplayProjection({
        multiplicity: "1",
        recurrence_terms: 7,
        prepared_graph_capacity_bytes: 2048,
      }),
    );
  const structuralDifferenceDetected =
    JSON.stringify(
      preparedReplayProjection({ multiplicity: "1", recurrence_terms: 7 }),
    ) !==
    JSON.stringify(
      preparedReplayProjection({ multiplicity: "1", recurrence_terms: 8 }),
    );
  const rayCapacityOnlyDifferenceIgnored =
    JSON.stringify(
      rayReplayProjection({
        multiplicity: "1",
        ray_transitions: 7,
        ray_graph_capacity_bytes: 1024,
      }),
    ) ===
    JSON.stringify(
      rayReplayProjection({
        multiplicity: "1",
        ray_transitions: 7,
        ray_graph_capacity_bytes: 2048,
      }),
    );
  const rayStructuralDifferenceDetected =
    JSON.stringify(
      rayReplayProjection({ multiplicity: "1", ray_transitions: 7 }),
    ) !==
    JSON.stringify(
      rayReplayProjection({ multiplicity: "1", ray_transitions: 8 }),
    );
  const compactedMeasurement = {
    cold: completeRun(["cold-response"]),
    binding: completeRun(["binding-response"]),
    sensitivities: [],
    replays: [],
  };
  compactedMeasurement.binding.records[0].replay_projection = {
    multiplicity: "1",
  };
  compactMeasurementRecords(compactedMeasurement);
  const compactCapturePasses =
    compactedMeasurement.binding.records[0].response === undefined &&
    compactedMeasurement.binding.records[0].replay_projection === undefined &&
    /^[0-9a-f]{64}$/u.test(
      compactedMeasurement.binding.records[0].response_sha256,
    );
  if (
    incompleteExactness.status !== "unknown_after_hard_timeout_or_oracle_error" ||
    incompleteExactness.replay_byte_identical !== null ||
    disagreementExactness.status !== "fail" ||
    disagreementExactness.replay_byte_identical !== false ||
    preparedExactness.status !== "pass" ||
    preparedExactness.replay_byte_identical !== null ||
    preparedExactness.replay_projection_identical !== true ||
    !capacityOnlyDifferenceIgnored ||
    !structuralDifferenceDetected ||
    !rayCapacityOnlyDifferenceIgnored ||
    !rayStructuralDifferenceDetected ||
    !compactCapturePasses
  )
    throw new Error("exactness-observation self-test failed");
  console.log(JSON.stringify({ status: "pass", exact_weyl_dimension: true, target_order: true, hard_timeout_memory_unknown: true, incomplete_replay_exactness_unknown: true, prepared_projection_replay: true, prepared_capacity_is_resource_only: true, prepared_structural_counter_differential: true, ray_capacity_is_resource_only: true, ray_structural_counter_differential: true, compact_capture_response_hashes: true }));
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
    if (result.plan_sha256 !== manifest.plan_sha256 || result.manifest_sha256 !== sha256(manifestRecord.bytes))
      throw new Error("resume result does not bind the current plan and manifest");
    result.measurements = result.measurements.map(compactMeasurementRecords);
    result.checkpoint_writer_revision = execFileSync(
      "git",
      ["rev-parse", "HEAD"],
      { cwd: root, encoding: "utf8" },
    ).trim();
  } else {
    result = {
      schema_version: 1,
      evidence_status: options.smoke ? "nonbinding_smoke" : "binding_in_progress",
      evidence_stage:
        plan.frontier.session_mode === "prepared"
          ? "parallel_prepared_dependency_dag_and_order_sensitivity"
          : plan.frontier.session_mode === "ray"
            ? "parallel_root_ray_dag_and_order_sensitivity"
            : "bounded_session_memo_and_order_sensitivity",
      scope_revision: plan.scope_revision,
      plan_sha256: manifest.plan_sha256,
      manifest_sha256: sha256(manifestRecord.bytes),
      oracle_executable_sha256: manifest.oracle_executable_sha256,
      oracle_declared_revision: plan.oracle.zero_revision,
      optimization_sequence: plan.frontier.optimization_sequence,
      predecessor_cold_replay: {
        plan_sha256: plan.predecessor.phase05_cold_replay_v1_plan_sha256,
        compressed_result_sha256:
          plan.predecessor.phase05_cold_replay_v1_compressed_result_sha256,
        summary_sha256: plan.predecessor.phase05_cold_replay_v1_summary_sha256,
        decision: plan.predecessor.phase05_cold_replay_v1_decision,
        relationship: plan.predecessor.session_stage_relationship,
      },
      cold_reference_role:
        "fresh_answers_for_same-session-target_exactness_not_combined_resource_evidence",
      controller_revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
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
  const descriptions = new Map();
  for (const representation of representations)
    if (!descriptions.has(representation.type))
      descriptions.set(representation.type, describeType(oraclePath, representation.type));
  for (const representation of representations) {
    if (completed.has(representation.id)) continue;
    const measurement = compactMeasurementRecords(await measureRepresentation({
      oracle: oraclePath,
      representation,
      description: descriptions.get(representation.type),
      plan,
      replayCount: options.smoke ? 1 : plan.frontier.replays,
      targetLimit: options.smoke ? 8 : null,
    }));
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
  result.parallelism = await calibrateParallelism({
    oracle: oraclePath,
    measurements: result.measurements,
    descriptions,
    plan,
    smoke: options.smoke,
  });
  result.summary = summarize(result.measurements);
  result.completed_at = new Date().toISOString();
  result.evidence_status = options.smoke ? "nonbinding_smoke" : "binding_frontier_complete_cross_check_pending";
  await writeFile(outPath, stableJson(result));
  console.log(JSON.stringify({ summary: result.summary, parallelism: result.parallelism }));
};

export {
  assessExactness,
  compareRuns,
  describeType,
  exactWeylDimension,
  generateTargets,
  orderTargets,
  runOrderedGroup,
  summarize,
  sha256,
  stableJson,
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
