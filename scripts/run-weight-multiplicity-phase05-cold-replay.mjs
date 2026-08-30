#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const parseArguments = (values) => {
  const options = {
    plan: "examples/weight-multiplicity/phase05-cold-replay-plan-v1.json",
    oracle: null,
    out: null,
    selfTest: false,
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--self-test") options.selfTest = true;
    else if (["--plan", "--oracle", "--out"].includes(value)) {
      const next = values[++index];
      if (!next) throw new Error(`${value} requires a value`);
      options[value.slice(2)] = next;
    } else throw new Error(`unknown argument: ${value}`);
  }
  return options;
};

const percentile = (values, probability) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(probability * sorted.length) - 1)];
};

const parseRequest = (request) => {
  const [type, highest, target] = request.split("\t");
  if (!type || !highest || !target) throw new Error(`invalid frozen request: ${request}`);
  return { type, highest_weight: highest.split(",").map(Number), target_weight: target.split(",").map(Number) };
};

const frozenCells = (source) =>
  source.cells.map((cell) => {
    const requests = cell.accepted_records.map((record) => ({
      request: record.request,
      source: "phase0_v2_accepted",
      expected_multiplicity: String(record.multiplicity),
      target_depth: record.target_depth,
    }));
    if (cell.exactness.fatal_request) {
      requests.push({
        request: cell.exactness.fatal_request,
        source: "phase0_v2_former_timeout",
        expected_multiplicity: null,
        target_depth: null,
      });
    }
    return { cell: cell.cell, requests };
  });

class OracleServer {
  constructor(executable, hardTimeoutMs, sampleDelayMs, sampleIntervalMs) {
    this.executable = executable;
    this.hardTimeoutMs = hardTimeoutMs;
    this.sampleDelayMs = sampleDelayMs;
    this.sampleIntervalMs = sampleIntervalMs;
    this.child = null;
    this.iterator = null;
    this.stderr = "";
  }

  async start() {
    this.child = spawn(this.executable, ["--serve"], { stdio: ["pipe", "pipe", "pipe"] });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => { this.stderr += chunk; });
    this.iterator = createInterface({ input: this.child.stdout })[Symbol.asyncIterator]();
    const ready = JSON.parse(await this.nextLine());
    if (ready.status !== "ready" || ready.schema_version !== 1)
      throw new Error(`unexpected oracle ready record: ${JSON.stringify(ready)}`);
  }

  async nextLine() {
    const line = await new Promise((resolveLine, rejectLine) => {
      const timer = setTimeout(() => {
        const error = new Error(`oracle exceeded measurement hard timeout ${this.hardTimeoutMs} ms`);
        error.hardTimeout = true;
        rejectLine(error);
      }, this.hardTimeoutMs);
      this.iterator.next().then(
        (value) => { clearTimeout(timer); resolveLine(value); },
        (error) => { clearTimeout(timer); rejectLine(error); },
      );
    });
    if (line.done) throw new Error(`oracle closed output: ${this.stderr.trim()}`);
    return line.value;
  }

  async request(line, sample = true) {
    let sampledPeakRss = null;
    let sampler = null;
    let sampleInFlight = false;
    const takeSample = () => {
      if (!this.child?.pid || sampleInFlight) return;
      sampleInFlight = true;
      try {
        execFile(
          "ps",
          ["-o", "rss=", "-p", String(this.child.pid)],
          { encoding: "utf8" },
          (error, stdout) => {
            sampleInFlight = false;
            if (error) return;
            const text = stdout.trim();
            if (!text) return;
            const value = Number(text) * 1024;
            sampledPeakRss = sampledPeakRss === null ? value : Math.max(sampledPeakRss, value);
          },
        );
      } catch {
        sampleInFlight = false;
      }
    };
    const sampleDelay = sample
      ? setTimeout(() => {
          takeSample();
          sampler = setInterval(takeSample, this.sampleIntervalMs);
        }, this.sampleDelayMs)
      : null;
    const started = process.hrtime.bigint();
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
        this.child.kill("SIGKILL");
      }
      throw error;
    } finally {
      if (sampleDelay) clearTimeout(sampleDelay);
      if (sampler) clearInterval(sampler);
    }
  }

  async metrics() {
    const response = await this.request("@metrics", false);
    if (response.value.status !== "metrics") throw new Error(`oracle metrics failed: ${response.raw}`);
    return response.value.max_rss_bytes;
  }

  async close() {
    if (!this.child || this.child.exitCode !== null) return;
    await new Promise((resolveExit) => {
      const timer = setTimeout(() => { this.child.kill("SIGKILL"); resolveExit(); }, 2000);
      this.child.once("exit", () => { clearTimeout(timer); resolveExit(); });
      this.child.stdin.end();
    });
  }
}

const memoryStatus = (observation, incremental, limit) => {
  if (observation === "lower_bound_limit_exceeded") return "fail";
  if (observation !== "exact_process_high_water" || incremental === null) return "unknown";
  return incremental <= limit ? "pass" : "fail";
};

const runCell = async ({ oracle, frozen, plan }) => {
  const server = new OracleServer(
    oracle,
    plan.limits.measurement_hard_timeout_ms,
    plan.limits.rss_sampling_starts_after_ms,
    plan.limits.rss_sample_interval_ms,
  );
  const records = [];
  let readyRss = null;
  let exactPeakRss = null;
  let hardTimeout = null;
  let oracleError = null;
  try {
    await server.start();
    readyRss = await server.metrics();
    exactPeakRss = readyRss;
    for (const frozenRequest of frozen.requests) {
      let response;
      try {
        response = await server.request(frozenRequest.request);
      } catch (error) {
        if (!error.hardTimeout) throw error;
        hardTimeout = {
          request: frozenRequest.request,
          source: frozenRequest.source,
          sampled_peak_rss_bytes: error.sampledPeakRssBytes,
        };
        records.push({
          ...frozenRequest,
          ...parseRequest(frozenRequest.request),
          status: "hard_timeout",
          multiplicity: null,
          exact_match: null,
          elapsed_ms: plan.limits.measurement_hard_timeout_ms,
          threshold_exceeded: true,
          exact_process_peak_rss_bytes: null,
        });
        break;
      }
      if (response.value.status === "error" || response.value.multiplicity === undefined) {
        oracleError = { request: frozenRequest.request, response: response.raw };
      }
      const queryPeakRss = oracleError ? null : await server.metrics();
      if (queryPeakRss !== null) exactPeakRss = Math.max(exactPeakRss, queryPeakRss);
      const multiplicity = response.value.multiplicity === undefined
        ? null
        : String(response.value.multiplicity);
      records.push({
        ...frozenRequest,
        ...parseRequest(frozenRequest.request),
        status: oracleError ? "oracle_error" : "completed",
        multiplicity,
        exact_match:
          frozenRequest.expected_multiplicity === null
            ? null
            : multiplicity === frozenRequest.expected_multiplicity,
        elapsed_ms: response.elapsed_ms,
        threshold_exceeded: response.elapsed_ms > plan.limits.query_time_ms,
        exact_process_peak_rss_bytes: queryPeakRss,
        memo_entries: response.value.memo_entries ?? null,
        recurrence_terms: response.value.recurrence_terms ?? null,
        recursive_weyl_folds: response.value.recursive_weyl_folds ?? null,
      });
      if (oracleError) break;
    }
  } finally {
    await server.close();
  }
  const lowerBoundPeak = hardTimeout
    ? Math.max(exactPeakRss ?? 0, hardTimeout.sampled_peak_rss_bytes ?? 0)
    : null;
  const lowerBoundIncremental = hardTimeout && readyRss !== null
    ? Math.max(0, lowerBoundPeak - readyRss)
    : null;
  const observation = hardTimeout
    ? lowerBoundIncremental > plan.limits.peak_incremental_rss_bytes
      ? "lower_bound_limit_exceeded"
      : "unknown_after_hard_timeout"
    : oracleError
      ? "unknown_after_oracle_error"
      : "exact_process_high_water";
  const incremental = observation === "exact_process_high_water" && readyRss !== null
    ? Math.max(0, exactPeakRss - readyRss)
    : null;
  return {
    cell: frozen.cell,
    requests: records,
    completed_requests: records.filter((record) => record.status === "completed").length,
    former_timeouts_recovered: records.filter(
      (record) => record.source === "phase0_v2_former_timeout" && record.status === "completed",
    ).length,
    exactness: {
      expected_labels: records.filter((record) => record.expected_multiplicity !== null).length,
      matches: records.filter((record) => record.exact_match === true).length,
      mismatches: records.filter((record) => record.exact_match === false).length,
      oracle_error: oracleError,
      hard_timeout: hardTimeout,
    },
    latency_ms: {
      samples: records.filter((record) => record.status === "completed").length,
      p95: percentile(records.filter((record) => record.status === "completed").map((record) => record.elapsed_ms), 0.95),
      maximum: records.filter((record) => record.status === "completed").length
        ? Math.max(...records.filter((record) => record.status === "completed").map((record) => record.elapsed_ms))
        : null,
      threshold_exceedances: records.filter((record) => record.threshold_exceeded).length,
    },
    memory_bytes: {
      ready_peak_rss: readyRss,
      exact_peak_rss: observation === "exact_process_high_water" ? exactPeakRss : null,
      exact_incremental_from_ready: incremental,
      completed_prefix_peak_rss: exactPeakRss,
      hard_timeout_peak_rss_lower_bound: lowerBoundPeak,
      hard_timeout_incremental_rss_lower_bound: lowerBoundIncremental,
      observation,
      status: memoryStatus(observation, incremental, plan.limits.peak_incremental_rss_bytes),
    },
  };
};

const selfTest = () => {
  if (
    memoryStatus("exact_process_high_water", 100, 100) !== "pass" ||
    memoryStatus("exact_process_high_water", 101, 100) !== "fail" ||
    memoryStatus("unknown_after_hard_timeout", null, 100) !== "unknown" ||
    memoryStatus("lower_bound_limit_exceeded", null, 100) !== "fail"
  ) throw new Error("memory policy self-test failed");
  const parsed = parseRequest("A2\t1,1\t0,0");
  if (parsed.type !== "A2" || parsed.highest_weight[1] !== 1 || parsed.target_weight[0] !== 0)
    throw new Error("request parser self-test failed");
  console.log(JSON.stringify({ status: "pass", memory_policy: true, request_parser: true }));
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.selfTest) return selfTest();
  if (!options.oracle || !options.out) throw new Error("--oracle and --out are required");
  const planPath = resolve(root, options.plan);
  const oraclePath = resolve(options.oracle);
  const [planBytes, oracleBytes] = await Promise.all([readFile(planPath), readFile(oraclePath)]);
  const plan = JSON.parse(planBytes.toString("utf8"));
  if (sha256(oracleBytes) !== plan.oracle.executable_sha256)
    throw new Error("plan does not bind the supplied Zero executable");
  const sourcePath = resolve(root, plan.source.path);
  const compressedSource = await readFile(sourcePath);
  if (sha256(compressedSource) !== plan.source.compressed_sha256)
    throw new Error("plan does not bind the compressed Phase 0 source");
  const sourceBytes = gunzipSync(compressedSource);
  if (sha256(sourceBytes) !== plan.source.uncompressed_sha256)
    throw new Error("plan does not bind the uncompressed Phase 0 source");
  const cells = frozenCells(JSON.parse(sourceBytes.toString("utf8")));
  const requestCount = cells.reduce((sum, cell) => sum + cell.requests.length, 0);
  const acceptedCount = cells.reduce(
    (sum, cell) => sum + cell.requests.filter((request) => request.expected_multiplicity !== null).length,
    0,
  );
  if (
    cells.length !== plan.source.cells ||
    requestCount !== plan.source.total_recoverable_requests ||
    acceptedCount !== plan.source.accepted_requests
  ) throw new Error("frozen source counts do not match the plan");
  const result = {
    schema_version: 1,
    evidence_status: "running",
    stage: plan.stage,
    plan_sha256: sha256(planBytes),
    source_compressed_sha256: sha256(compressedSource),
    source_uncompressed_sha256: sha256(sourceBytes),
    oracle_revision: plan.oracle.revision,
    oracle_executable_sha256: sha256(oracleBytes),
    controller_revision: process.env.ILXYR_REVISION ?? "working-tree",
    started_at: new Date().toISOString(),
    reference_hardware: {
      cpu: cpus()[0]?.model ?? "unknown",
      architecture: arch(),
      logical_cpus: cpus().length,
      memory_bytes: totalmem(),
      operating_system: `${platform()} ${release()}`,
    },
    limits: plan.limits,
    cells: [],
    phase_1: { authorized: false, corpus_generated: false, models_trained: false },
  };
  const outputPath = resolve(root, options.out);
  await mkdir(dirname(outputPath), { recursive: true });
  for (const frozen of cells) {
    const cell = await runCell({ oracle: oraclePath, frozen, plan });
    result.cells.push(cell);
    await writeFile(outputPath, stableJson(result));
    console.log(JSON.stringify({
      cell: cell.cell,
      completed: cell.completed_requests,
      recovered: cell.former_timeouts_recovered,
      p95_ms: cell.latency_ms.p95,
      memory_status: cell.memory_bytes.status,
    }));
  }
  const requests = result.cells.flatMap((cell) => cell.requests);
  const exactness = result.cells.reduce(
    (summary, cell) => ({
      expected_labels: summary.expected_labels + cell.exactness.expected_labels,
      matches: summary.matches + cell.exactness.matches,
      mismatches: summary.mismatches + cell.exactness.mismatches,
    }),
    { expected_labels: 0, matches: 0, mismatches: 0 },
  );
  const memoryStatuses = result.cells.map((cell) => cell.memory_bytes.status);
  result.completed_at = new Date().toISOString();
  result.summary = {
    cells: result.cells.length,
    requests: requests.length,
    completed_requests: requests.filter((record) => record.status === "completed").length,
    former_timeouts_recovered: result.cells.reduce((sum, cell) => sum + cell.former_timeouts_recovered, 0),
    hard_timeouts: result.cells.filter((cell) => cell.exactness.hard_timeout).length,
    oracle_errors: result.cells.filter((cell) => cell.exactness.oracle_error).length,
    exactness,
    time_threshold_exceedances: requests.filter((record) => record.threshold_exceeded).length,
    memory: {
      pass: memoryStatuses.filter((status) => status === "pass").length,
      fail: memoryStatuses.filter((status) => status === "fail").length,
      unknown: memoryStatuses.filter((status) => status === "unknown").length,
      maximum_measured_incremental_bytes: Math.max(
        0,
        ...result.cells.map((cell) => cell.memory_bytes.exact_incremental_from_ready ?? 0),
      ),
    },
    maximum_latency_ms: Math.max(0, ...requests.filter((record) => record.status === "completed").map((record) => record.elapsed_ms)),
  };
  result.evidence_status =
    result.summary.completed_requests === plan.source.total_recoverable_requests &&
    result.summary.former_timeouts_recovered === plan.source.former_timeout_requests &&
    result.summary.exactness.matches === plan.source.accepted_requests &&
    result.summary.exactness.mismatches === 0 &&
    result.summary.hard_timeouts === 0 &&
    result.summary.oracle_errors === 0 &&
    result.summary.time_threshold_exceedances === 0 &&
    result.summary.memory.fail === 0 &&
    result.summary.memory.unknown === 0
      ? "pass"
      : "hold";
  await writeFile(outputPath, stableJson(result));
  console.log(JSON.stringify({ evidence_status: result.evidence_status, summary: result.summary }));
};

await main();
