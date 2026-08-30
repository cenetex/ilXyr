#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { cpus, arch, platform, release, totalmem } from "node:os";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const defaultPlan = resolve(
  root,
  "examples/weight-multiplicity/phase0-frontier-plan.json",
);

const parseArguments = (values) => {
  const options = {
    plan: defaultPlan,
    oracle: null,
    out: null,
    types: null,
    heights: null,
    smoke: false,
    resume: false,
    selfTest: false,
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--smoke") options.smoke = true;
    else if (value === "--resume") options.resume = true;
    else if (value === "--self-test") options.selfTest = true;
    else if (["--plan", "--oracle", "--out", "--types", "--heights"].includes(value)) {
      if (index + 1 >= values.length) throw new Error(`${value} needs a value`);
      options[value.slice(2)] = values[(index += 1)];
    } else {
      throw new Error(`unknown argument: ${value}`);
    }
  }
  return options;
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

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
  const result = Array(length).fill(0);
  if (balanced) {
    for (let index = 0; index < length; index += 1) {
      result[index] = Math.floor(total / length);
    }
    total -= result.reduce((sum, value) => sum + value, 0);
  }
  for (let unit = 0; unit < total; unit += 1) {
    result[randomInteger(random, length)] += 1;
  }
  return result;
};

const subtractRootCombination = (highest, cartan, coefficient) =>
  highest.map(
    (value, row) =>
      value -
      coefficient.reduce(
        (sum, amount, column) => sum + cartan[row][column] * amount,
        0,
      ),
  );

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
  let state = {
    weight: [...highest],
    coefficient: Array(highest.length).fill(0),
  };
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

const stratum = (multiplicity) => {
  if (multiplicity === 0n) return "0";
  if (multiplicity === 1n) return "1";
  if (multiplicity <= 7n) return "2-7";
  if (multiplicity <= 31n) return "8-31";
  return ">31";
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
  constructor(executable, timeoutMs) {
    this.executable = executable;
    this.timeoutMs = timeoutMs;
    this.child = null;
    this.iterator = null;
    this.stderr = "";
  }

  async start() {
    this.child = spawn(this.executable, ["--serve"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });
    this.iterator = createInterface({ input: this.child.stdout })[
      Symbol.asyncIterator
    ]();
    const ready = await this.nextLine();
    const parsed = JSON.parse(ready);
    if (parsed.status !== "ready" || parsed.schema_version !== 1) {
      throw new Error(`oracle did not return a version-1 ready record: ${ready}`);
    }
  }

  async nextLine() {
    const line = await new Promise((resolveLine, rejectLine) => {
      const timer = setTimeout(
        () => rejectLine(new Error(`oracle exceeded ${this.timeoutMs} ms`)),
        this.timeoutMs,
      );
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
    if (line.done) {
      throw new Error(`oracle closed its output: ${this.stderr.trim()}`);
    }
    return line.value;
  }

  async request(line) {
    const started = process.hrtime.bigint();
    this.child.stdin.write(`${line}\n`);
    const raw = await this.nextLine();
    const elapsedNs = Number(process.hrtime.bigint() - started);
    return { raw, value: JSON.parse(raw), elapsedNs };
  }

  async metrics() {
    const response = await this.request("@metrics");
    if (response.value.status !== "metrics") {
      throw new Error(`oracle metrics failed: ${response.raw}`);
    }
    return response.value.max_rss_bytes;
  }

  async close() {
    if (!this.child) return;
    if (this.child.exitCode !== null) return;
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

  kill() {
    if (this.child) this.child.kill("SIGKILL");
  }
}

const chooseMissingSlice = (counts, quotas, random) => {
  const choices = [];
  for (const [label, statuses] of Object.entries(quotas)) {
    for (const status of ["dominant", "non_dominant"]) {
      if (counts[label][status] < statuses[status]) choices.push({ label, status });
    }
  }
  return choices.length === 0 ? null : choices[randomInteger(random, choices.length)];
};

const candidateFor = ({ type, height, description, desiredStratum, desiredStatus, random }) => {
  const rank = description.rank;
  const balanced = desiredStratum === "8-31" || desiredStratum === "2-7";
  const highest = weakComposition(height, rank, random, balanced);
  const anti = antiDominant(highest, description.cartan, random);
  if (!anti) return null;
  const maximumDepth = anti.coefficient.reduce((sum, value) => sum + value, 0);
  let coefficient;
  let target;

  if (desiredStratum === "1") {
    let orbit = {
      weight: [...highest],
      coefficient: Array(rank).fill(0),
    };
    const steps = 1 + randomInteger(random, Math.max(2, rank * 3));
    for (let step = 0; step < steps; step += 1) {
      const choices = orbit.weight
        .map((value, index) => (value !== 0 ? index : -1))
        .filter((index) => index >= 0);
      if (choices.length === 0) break;
      orbit = reflect(
        orbit.weight,
        orbit.coefficient,
        description.cartan,
        choices[randomInteger(random, choices.length)],
      );
    }
    ({ weight: target, coefficient } = orbit);
  } else {
    let depth;
    if (desiredStratum === "0") {
      coefficient = [...anti.coefficient];
      coefficient[randomInteger(random, rank)] +=
        1 + randomInteger(random, Math.max(2, height));
      target = subtractRootCombination(highest, description.cartan, coefficient);
    } else if (desiredStratum === "8-31") {
      const low = Math.floor(maximumDepth * 0.4);
      const width = Math.max(1, Math.ceil(maximumDepth * 0.2));
      depth = low + randomInteger(random, width + 1);
    } else {
      const low = Math.floor(maximumDepth * 0.2);
      const width = Math.max(1, Math.ceil(maximumDepth * 0.6));
      depth = low + randomInteger(random, width + 1);
    }
    if (desiredStratum !== "0") {
      coefficient = weakComposition(depth, rank, random, balanced);
      target = subtractRootCombination(highest, description.cartan, coefficient);
    }
  }

  const oriented =
    desiredStatus === "non_dominant"
      ? orientNonDominant(target, coefficient, description.cartan, random)
      : orientDominant(target, coefficient, description.cartan);
  if (!oriented) return null;
  const depth = oriented.coefficient.reduce((sum, value) => sum + value, 0);
  const depthPerMille =
    maximumDepth === 0
      ? 0
      : Math.min(1000, Math.floor((1000 * Math.abs(depth)) / maximumDepth));
  const targetMagnitude = oriented.weight.reduce(
    (sum, value) => sum + Math.abs(value),
    0,
  );
  return {
    type,
    highest,
    target: oriented.weight,
    depth,
    maximumDepth,
    depthPerMille,
    targetMagnitude,
    status: desiredStatus,
  };
};

const depthBand = (value, bands) =>
  bands.find(
    (band) => value >= band.lower_per_mille && value <= band.upper_per_mille,
  )?.id ?? "outside";

const queryLine = (candidate) =>
  `${candidate.type}\t${candidate.highest.join(",")}\t${candidate.target.join(",")}`;

const replayRecords = async (oracle, timeoutMs, records, repeats) => {
  for (let replay = 0; replay < repeats; replay += 1) {
    const server = new OracleServer(oracle, timeoutMs);
    try {
      await server.start();
      for (const record of records) {
        const response = await server.request(record.request);
        if (response.raw !== record.response) {
          return {
            byte_identical: false,
            replay,
            request: record.request,
            expected_sha256: sha256(record.response),
            observed_sha256: sha256(response.raw),
          };
        }
      }
    } finally {
      await server.close();
    }
  }
  return { byte_identical: true, completed_replays: repeats };
};

const calibrateParallelism = async ({ oracle, plan, records, candidates }) => {
  const stressRecords = [...records]
    .sort((left, right) => right.elapsed_ms - left.elapsed_ms)
    .slice(0, 32);
  if (stressRecords.length === 0) {
    return { status: "not_run", reason: "no accepted frontier records" };
  }
  const levels = [];
  for (const workers of candidates) {
    const servers = [];
    const baselineRss = [];
    const latenciesMs = [];
    let errors = 0;
    let byteIdentical = true;
    let queryStarted;
    try {
      for (let index = 0; index < workers; index += 1) {
        const server = new OracleServer(oracle, plan.frontier.query_timeout_ms);
        servers.push(server);
        await server.start();
        baselineRss.push(await server.metrics());
        const warm = stressRecords[index % stressRecords.length];
        const response = await server.request(warm.request);
        if (response.raw !== warm.response) byteIdentical = false;
      }
      queryStarted = process.hrtime.bigint();
      for (let round = 0; round < 20; round += 1) {
        const responses = await Promise.all(
          servers.map((server, worker) => {
            const record =
              stressRecords[(round * workers + worker) % stressRecords.length];
            return server.request(record.request).then((response) => ({ response, record }));
          }),
        );
        for (const { response, record } of responses) {
          latenciesMs.push(response.elapsedNs / 1e6);
          if (response.value.status === "error") errors += 1;
          if (response.raw !== record.response) byteIdentical = false;
        }
      }
      const finalRss = await Promise.all(servers.map((server) => server.metrics()));
      const elapsedSeconds = Number(process.hrtime.bigint() - queryStarted) / 1e9;
      const incremental = finalRss.map((value, index) =>
        Math.max(0, value - baselineRss[index]),
      );
      const p95Ms = percentile(latenciesMs, 0.95);
      const pass =
        errors === 0 &&
        byteIdentical &&
        p95Ms <= plan.frontier.p95_limit_ms &&
        incremental.every(
          (value) => value <= plan.frontier.peak_incremental_memory_limit_bytes,
        ) &&
        finalRss.reduce((sum, value) => sum + value, 0) <= totalmem() * 0.8;
      levels.push({
        workers,
        status: pass ? "pass" : "fail",
        queries: latenciesMs.length,
        errors,
        byte_identical: byteIdentical,
        elapsed_seconds: elapsedSeconds,
        throughput_queries_per_second: latenciesMs.length / elapsedSeconds,
        latency_ms: {
          mean: mean(latenciesMs),
          p50: percentile(latenciesMs, 0.5),
          p95: p95Ms,
          maximum: Math.max(...latenciesMs),
        },
        worker_peak_rss_bytes: finalRss,
        worker_incremental_bytes: incremental,
      });
    } catch (error) {
      errors += 1;
      for (const server of servers) server.kill();
      levels.push({
        workers,
        status: "fail",
        errors,
        byte_identical: false,
        error: error.message,
      });
    } finally {
      for (const server of servers) {
        if (server.child?.exitCode === null) await server.close();
      }
    }
  }
  const passing = levels.filter((level) => level.status === "pass");
  return {
    status: passing.length > 0 ? "pass" : "fail",
    stress_record_count: stressRecords.length,
    selection_rule:
      "largest tested worker count meeting exactness, latency, per-worker memory, and 80%-host-memory limits",
    safe_parallel_workers:
      passing.length === 0 ? 0 : Math.max(...passing.map((level) => level.workers)),
    levels,
  };
};

const measureCell = async ({
  oracle,
  plan,
  type,
  height,
  quotas,
  statusQuotas,
  acceptedTarget,
  attemptCap,
}) => {
  const seed = (plan.generator.seed ^ fnv1a(`${type}:${height}`)) >>> 0;
  const random = makeRandom(seed);
  const description = JSON.parse(
    execFileSync(oracle, ["describe", type], { encoding: "utf8" }),
  );
  const counts = Object.fromEntries(Object.keys(quotas).map((key) => [key, 0]));
  const sliceCounts = Object.fromEntries(
    Object.keys(quotas).map((key) => [key, { dominant: 0, non_dominant: 0 }]),
  );
  const observed = { "0": 0, "1": 0, "2-7": 0, "8-31": 0, ">31": 0 };
  const requestedObserved = Object.fromEntries(
    Object.keys(quotas).map((requested) => [
      requested,
      { "0": 0, "1": 0, "2-7": 0, "8-31": 0, ">31": 0 },
    ]),
  );
  const statuses = { dominant: 0, non_dominant: 0 };
  const depthCounts = Object.fromEntries(
    plan.frontier.depth_bands.map((band) => [band.id, 0]),
  );
  const latenciesMs = [];
  const accepted = [];
  const stressRecords = [];
  const unique = new Set();
  let attempts = 0;
  let errors = 0;
  let timeout = false;
  let fatalError = null;
  let fatalRequest = null;
  const server = new OracleServer(oracle, plan.frontier.query_timeout_ms);
  let readyRss;
  let warmRss;
  let peakRss;
  try {
    await server.start();
    readyRss = await server.metrics();
    const warmHighest = [height, ...Array(description.rank - 1).fill(0)];
    const warm = {
      type,
      highest: warmHighest,
      target: warmHighest,
    };
    const warmResponse = await server.request(queryLine(warm));
    if (warmResponse.value.multiplicity !== "1") {
      throw new Error(`warm-up failed for ${type} height ${height}`);
    }
    warmRss = await server.metrics();
    while (accepted.length < acceptedTarget && attempts < attemptCap) {
      const desired = chooseMissingSlice(sliceCounts, statusQuotas, random);
      if (!desired) break;
      const desiredStratum = desired.label;
      const desiredStatus = desired.status;
      const candidate = candidateFor({
        type,
        height,
        description,
        desiredStratum,
        desiredStatus,
        random,
      });
      if (!candidate) continue;
      attempts += 1;
      let response;
      try {
        response = await server.request(queryLine(candidate));
      } catch (error) {
        timeout = error.message.includes("exceeded");
        errors += 1;
        fatalError = error.message;
        fatalRequest = queryLine(candidate);
        server.kill();
        break;
      }
      latenciesMs.push(response.elapsedNs / 1e6);
      if (response.value.status === "error" || response.value.multiplicity === undefined) {
        errors += 1;
        break;
      }
      const observedStratum = stratum(BigInt(response.value.multiplicity));
      stressRecords.push({
        request: queryLine(candidate),
        response: response.raw,
        elapsed_ms: response.elapsedNs / 1e6,
      });
      stressRecords.sort((left, right) => right.elapsed_ms - left.elapsed_ms);
      if (stressRecords.length > 32) stressRecords.length = 32;
      observed[observedStratum] += 1;
      requestedObserved[desiredStratum][observedStratum] += 1;
      if (
        observedStratum === ">31" ||
        counts[observedStratum] >= quotas[observedStratum] ||
        sliceCounts[observedStratum][candidate.status] >=
          statusQuotas[observedStratum][candidate.status]
      ) {
        continue;
      }
      const band = depthBand(candidate.depthPerMille, plan.frontier.depth_bands);
      counts[observedStratum] += 1;
      sliceCounts[observedStratum][candidate.status] += 1;
      statuses[candidate.status] += 1;
      if (depthCounts[band] !== undefined) depthCounts[band] += 1;
      const request = queryLine(candidate);
      unique.add(request);
      accepted.push({
        request,
        response: response.raw,
        type,
        height,
        highest_weight: candidate.highest,
        target_weight: candidate.target,
        target_depth: candidate.depth,
        target_depth_per_mille: candidate.depthPerMille,
        target_magnitude_l1: candidate.targetMagnitude,
        target_status: candidate.status,
        multiplicity: response.value.multiplicity,
        multiplicity_stratum: observedStratum,
        elapsed_ms: response.elapsedNs / 1e6,
      });
    }
    peakRss = timeout ? warmRss : await server.metrics();
  } finally {
    if (server.child?.exitCode === null) await server.close();
  }

  const replay =
    errors === 0 && !timeout
      ? await replayRecords(
          oracle,
          plan.frontier.query_timeout_ms,
          accepted,
          plan.frontier.replays,
        )
      : { byte_identical: false, skipped: true };
  const stratumComplete = Object.keys(quotas).every(
    (key) => counts[key] === quotas[key],
  );
  const statusComplete = Object.keys(statusQuotas).every((label) =>
    ["dominant", "non_dominant"].every(
      (status) => sliceCounts[label][status] === statusQuotas[label][status],
    ),
  );
  const depthComplete = Object.values(depthCounts).every(
    (count) => count >= plan.frontier.minimum_per_depth_band,
  );
  const p95Ms = percentile(latenciesMs, 0.95);
  const incrementalBytes = Math.max(0, peakRss - readyRss);
  const resourcePass =
    errors === 0 &&
    !timeout &&
    replay.byte_identical &&
    p95Ms !== null &&
    p95Ms <= plan.frontier.p95_limit_ms &&
    incrementalBytes <= plan.frontier.peak_incremental_memory_limit_bytes;
  return {
    cell: { type, rank: description.rank, highest_weight_height: height },
    seed,
    status:
      resourcePass && stratumComplete && statusComplete && depthComplete
        ? "pass"
        : resourcePass
          ? "incomplete_yield"
          : "resource_fail",
    attempts,
    accepted_queries: accepted.length,
    unique_accepted_queries: unique.size,
    accepted_strata: counts,
    observed_attempt_strata: observed,
    requested_by_observed_strata: requestedObserved,
    accepted_target_status: statuses,
    accepted_target_status_by_stratum: sliceCounts,
    accepted_depth_bands: depthCounts,
    coverage: {
      stratum_complete: stratumComplete,
      target_status_complete: statusComplete,
      depth_complete: depthComplete,
    },
    exactness: {
      errors,
      timeout,
      fatal_error: fatalError,
      fatal_request: fatalRequest,
      replay,
    },
    latency_ms: {
      samples: latenciesMs.length,
      mean: mean(latenciesMs),
      p50: percentile(latenciesMs, 0.5),
      p95: p95Ms,
      maximum: latenciesMs.length === 0 ? null : Math.max(...latenciesMs),
    },
    memory_bytes: {
      ready_peak_rss: readyRss,
      warmed_peak_rss: warmRss,
      final_peak_rss: peakRss,
      incremental_from_ready: incrementalBytes,
      incremental_after_warmup: Math.max(0, peakRss - warmRss),
    },
    accepted_records: accepted,
    stress_records: stressRecords,
  };
};

const selfTest = () => {
  const cartan = [
    [2, -1],
    [-1, 2],
  ];
  const highest = [1, 1];
  const coefficient = [0, 0];
  const reflected = reflect(highest, coefficient, cartan, 0);
  if (
    JSON.stringify(reflected.weight) !== JSON.stringify([-1, 2]) ||
    JSON.stringify(reflected.coefficient) !== JSON.stringify([1, 0]) ||
    JSON.stringify(subtractRootCombination(highest, cartan, [1, 0])) !==
      JSON.stringify(reflected.weight)
  ) {
    throw new Error("Weyl/depth coordinate self-test failed");
  }
  const first = makeRandom(12345);
  const second = makeRandom(12345);
  for (let index = 0; index < 100; index += 1) {
    if (first() !== second()) throw new Error("seed replay self-test failed");
  }
  process.stdout.write(
    JSON.stringify({ status: "pass", coordinate_checks: 1, seed_replays: 100 }) +
      "\n",
  );
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.selfTest) {
    selfTest();
    return;
  }
  if (!options.oracle || !options.out) {
    throw new Error("--oracle and --out are required");
  }
  const oracle = resolve(options.oracle);
  const planBytes = await readFile(resolve(options.plan));
  const plan = JSON.parse(planBytes);
  const selectedTypes = options.types
    ? options.types.split(",")
    : plan.frontier.types;
  const selectedHeights = options.heights
    ? options.heights.split(",").map(Number)
    : plan.frontier.heights;
  for (const type of selectedTypes) {
    if (!plan.frontier.types.includes(type)) throw new Error(`type not in plan: ${type}`);
  }
  for (const height of selectedHeights) {
    if (!plan.frontier.heights.includes(height)) {
      throw new Error(`height not in plan: ${height}`);
    }
  }
  const quotas = options.smoke
    ? Object.fromEntries(Object.keys(plan.frontier.stratum_quota).map((key) => [key, 2]))
    : plan.frontier.stratum_quota;
  const statusQuotas = options.smoke
    ? {
        "0": { dominant: 2, non_dominant: 0 },
        "1": { dominant: 2, non_dominant: 0 },
        "2-7": { dominant: 1, non_dominant: 1 },
        "8-31": { dominant: 1, non_dominant: 1 },
      }
    : plan.frontier.target_status_quota_by_stratum;
  const acceptedTarget = Object.values(quotas).reduce((sum, value) => sum + value, 0);
  const effectivePlan = structuredClone(plan);
  if (options.smoke) {
    effectivePlan.frontier.dominant_quota = 6;
    effectivePlan.frontier.non_dominant_quota = 2;
    effectivePlan.frontier.minimum_per_depth_band = 0;
  }
  const attemptCap = options.smoke
    ? Math.min(500, plan.frontier.attempt_cap_per_cell)
    : plan.frontier.attempt_cap_per_cell;
  const executableBytes = await readFile(oracle);
  const cpuList = cpus();
  let result = {
    schema_version: 1,
    status: "running",
    binding: !options.smoke && !options.types && !options.heights,
    mode: options.smoke ? "smoke" : "frontier",
    contract_revision: plan.contract_revision,
    contract_received_sha256: plan.contract_received_sha256,
    plan_path: resolve(options.plan),
    plan_sha256: sha256(planBytes),
    oracle_path: oracle,
    oracle_executable_sha256: sha256(executableBytes),
    oracle_declared_revision: plan.oracle.zero_revision,
    controller_revision: process.env.ILXYR_REVISION ?? "working-tree",
    started_at: new Date().toISOString(),
    reference_hardware: {
      platform: platform(),
      release: release(),
      architecture: arch(),
      logical_cpus: cpuList.length,
      cpu_model: cpuList[0]?.model ?? "unknown",
      total_memory_bytes: totalmem(),
      node: process.version,
    },
    effective: {
      types: selectedTypes,
      heights: selectedHeights,
      quotas,
      target_status_quota_by_stratum: statusQuotas,
      dominant_quota: effectivePlan.frontier.dominant_quota,
      non_dominant_quota: effectivePlan.frontier.non_dominant_quota,
      attempt_cap_per_cell: attemptCap,
    },
    cells: [],
  };
  const output = resolve(options.out);
  await mkdir(dirname(output), { recursive: true });
  if (options.resume) {
    const prior = JSON.parse(await readFile(output, "utf8"));
    if (
      prior.status !== "running" ||
      prior.plan_sha256 !== result.plan_sha256 ||
      prior.oracle_executable_sha256 !== result.oracle_executable_sha256 ||
      JSON.stringify(prior.effective) !== JSON.stringify(result.effective)
    ) {
      throw new Error("resume evidence does not match the current frozen run");
    }
    result = prior;
    result.resumed_at = new Date().toISOString();
    result.calibration_controller_revision =
      process.env.ILXYR_REVISION ?? "working-tree";
  }
  const save = async () => {
    const temporary = `${output}.tmp`;
    await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`);
    await rename(temporary, output);
  };
  await save();
  for (const type of selectedTypes) {
    for (const height of selectedHeights) {
      if (
        result.cells.some(
          (entry) =>
            entry.cell.type === type &&
            entry.cell.highest_weight_height === height,
        )
      ) {
        continue;
      }
      process.stderr.write(`measuring ${type} height ${height}\n`);
      const cell = await measureCell({
        oracle,
        plan: effectivePlan,
        type,
        height,
        quotas,
        statusQuotas,
        acceptedTarget,
        attemptCap,
      });
      result.cells.push(cell);
      await save();
    }
  }
  result.completed_at = new Date().toISOString();
  const allStressRecords = result.cells.flatMap((cell) => cell.stress_records);
  result.parallelism = await calibrateParallelism({
    oracle,
    plan: effectivePlan,
    records: allStressRecords,
    candidates: options.smoke
      ? plan.frontier.parallelism_candidates.filter((value) => value <= 2)
      : plan.frontier.parallelism_candidates.filter(
          (value) => value <= result.reference_hardware.logical_cpus,
        ),
  });
  result.status = result.cells.every((cell) => cell.status === "pass")
    ? result.parallelism.status === "pass"
      ? "pass"
      : "resource_fail"
    : result.cells.some((cell) => cell.status === "resource_fail")
      ? "resource_fail"
      : "incomplete_yield";
  result.summary = {
    cells: result.cells.length,
    pass: result.cells.filter((cell) => cell.status === "pass").length,
    incomplete_yield: result.cells.filter((cell) => cell.status === "incomplete_yield")
      .length,
    resource_fail: result.cells.filter((cell) => cell.status === "resource_fail").length,
    oracle_attempts: result.cells.reduce((sum, cell) => sum + cell.attempts, 0),
    accepted_queries: result.cells.reduce(
      (sum, cell) => sum + cell.accepted_queries,
      0,
    ),
  };
  await save();
};

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
