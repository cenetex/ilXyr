#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline";
import { gunzipSync } from "node:zlib";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

const isPreflightPlan = (plan) =>
  plan.schema === "ilxyr.weight_multiplicity_phase06_lie_preflight_plan.v1";

const parseArguments = (values) => {
  const options = {
    plan: null,
    manifest: null,
    lie: null,
    lieSource: null,
    stdbuf: null,
    out: null,
    selfTest: false,
  };
  const names = {
    "--plan": "plan",
    "--manifest": "manifest",
    "--lie": "lie",
    "--lie-source": "lieSource",
    "--stdbuf": "stdbuf",
    "--out": "out",
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--self-test") options.selfTest = true;
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

const percentile = (values, fraction) => {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(fraction * ordered.length) - 1)];
};

const mapWeight = (weight, type, coordinateMapping) => {
  const indices = coordinateMapping[type];
  return indices ? indices.map((index) => weight[index]) : [...weight];
};

const commandFor = (request, coordinateMapping) => {
  const highest = mapWeight(
    request.highest_weight,
    request.canonical_type,
    coordinateMapping,
  );
  const target = mapWeight(
    request.target_weight,
    request.canonical_type,
    coordinateMapping,
  );
  return `dom_char([${highest.join(",")}],[${target.join(",")}],${request.canonical_type})`;
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
  constructor({ id, executable, stdbuf, cwd, hardTimeoutMs }) {
    this.id = id;
    this.hardTimeoutMs = hardTimeoutMs;
    this.pending = null;
    this.stderr = "";
    this.ignoredStdout = [];
    this.startedAt = performance.now();
    const program = stdbuf ?? executable;
    const args = stdbuf ? ["-oL", "-eL", executable] : [];
    this.child = spawn(program, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => { this.stderr += chunk; });
    this.child.on("error", (error) => this.rejectPending("spawn_error", error.message));
    this.child.on("exit", (code, signal) => {
      this.exit = { code, signal };
      if (this.pending)
        this.rejectPending("process_exit", `LiE exited with code ${code}, signal ${signal}`);
    });
    this.lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    this.lines.on("line", (line) => {
      const trimmed = line.trim();
      if (/^-?\d+$/.test(trimmed) && this.pending) {
        const pending = this.pending;
        this.pending = null;
        pending.resolve({ raw_line: line, multiplicity: trimmed });
      } else if (trimmed.length > 0) {
        this.ignoredStdout.push(line);
      }
    });
  }

  rejectPending(status, error) {
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = null;
    pending.reject(Object.assign(new Error(error), { queryStatus: status }));
  }

  async query(command) {
    if (this.pending) throw new Error(`worker ${this.id} already has a pending query`);
    if (this.exit) throw new Error(`worker ${this.id} has exited`);
    const rssBefore = await readRss(this.child.pid);
    let peakRss = rssBefore;
    let sampling = false;
    const sample = async () => {
      if (sampling) return;
      sampling = true;
      const rss = await readRss(this.child.pid);
      if (rss !== null) peakRss = Math.max(peakRss ?? 0, rss);
      sampling = false;
    };
    const sampler = setInterval(sample, 5);
    const started = performance.now();
    try {
      const response = await new Promise((resolvePromise, reject) => {
        const timer = setTimeout(() => {
          this.rejectPending(
            "hard_timeout",
            `no complete integer response within ${this.hardTimeoutMs} ms`,
          );
          this.child.kill("SIGKILL");
        }, this.hardTimeoutMs);
        this.pending = {
          resolve: (value) => {
            clearTimeout(timer);
            resolvePromise(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        };
        this.child.stdin.write(`${command}\n`, (error) => {
          if (error) this.rejectPending("write_error", error.message);
        });
      });
      await sample();
      const rssAfter = await readRss(this.child.pid);
      if (rssAfter !== null) peakRss = Math.max(peakRss ?? 0, rssAfter);
      return {
        status: "ok",
        ...response,
        elapsed_ms: performance.now() - started,
        rss_before_bytes: rssBefore,
        peak_rss_bytes: peakRss,
        rss_after_bytes: rssAfter,
      };
    } catch (error) {
      return {
        status: error.queryStatus ?? "query_error",
        error: error.message,
        elapsed_ms: performance.now() - started,
        rss_before_bytes: rssBefore,
        peak_rss_bytes: peakRss,
        stderr: this.stderr,
      };
    } finally {
      clearInterval(sampler);
    }
  }

  async warmup() {
    const response = await this.query("dom_char([1],[1],A1)");
    if (response.status !== "ok" || response.multiplicity !== "1")
      throw new Error(`LiE warm-up failed for worker ${this.id}`);
    this.baselineRss = await readRss(this.child.pid);
    return {
      ...response,
      startup_and_warmup_ms: performance.now() - this.startedAt,
      baseline_rss_bytes: this.baselineRss,
    };
  }

  async close() {
    if (this.exit) return this.exit;
    this.child.stdin.end("quit\n");
    return await new Promise((resolvePromise) => {
      const timer = setTimeout(() => {
        this.child.kill("SIGKILL");
      }, 2000);
      this.child.once("exit", (code, signal) => {
        clearTimeout(timer);
        resolvePromise({ code, signal });
      });
    });
  }
}

const executeRequests = async ({
  workers,
  requestIds,
  requestById,
  representationByRequest,
  coordinateMapping,
  passName,
  restartWorker,
  restartWarmups,
}) => {
  const records = new Array(requestIds.length);
  let next = 0;
  const runWorker = async (initialWorker, workerIndex) => {
    let worker = initialWorker;
    while (true) {
      const index = next++;
      if (index >= requestIds.length) return;
      const request = requestById.get(requestIds[index]);
      const command = commandFor(request, coordinateMapping);
      const response = await worker.query(command);
      const peakIncremental = response.peak_rss_bytes === null ||
          response.peak_rss_bytes === undefined || worker.baselineRss === null ||
          worker.baselineRss === undefined
        ? null
        : Math.max(0, response.peak_rss_bytes - worker.baselineRss);
      records[index] = {
        pass: passName,
        order_index: index,
        worker_id: worker.id,
        request_id: request.id,
        representation_id: representationByRequest.get(request.id).canonical_id,
        canonical_type: request.canonical_type,
        highest_weight: request.highest_weight,
        target_weight: request.target_weight,
        target_depth: request.target_depth,
        command,
        response_status: response.status,
        response_line: response.raw_line ?? null,
        multiplicity: response.multiplicity ?? null,
        elapsed_ms: response.elapsed_ms,
        rss_before_bytes: response.rss_before_bytes ?? null,
        peak_rss_bytes: response.peak_rss_bytes ?? null,
        rss_after_bytes: response.rss_after_bytes ?? null,
        peak_incremental_worker_rss_bytes: peakIncremental,
        error: response.error ?? null,
      };
      if (response.status !== "ok") {
        await worker.close();
        const replacement = await restartWorker(worker.id);
        worker = replacement.worker;
        workers[workerIndex] = worker;
        restartWarmups.push({
          after_request_id: request.id,
          worker_id: worker.id,
          ...replacement.warmup,
        });
      }
    }
  };
  await Promise.all(workers.map(runWorker));
  return records;
};

const summarizeRecords = (records, resourceGate) => {
  const elapsed = records.map((record) => record.elapsed_ms);
  const incrementalRss = records
    .map((record) => record.peak_incremental_worker_rss_bytes)
    .filter((value) => value !== null);
  return {
    requests: records.length,
    total_query_ms: elapsed.reduce((total, value) => total + value, 0),
    mean_query_ms: elapsed.reduce((total, value) => total + value, 0) / elapsed.length,
    p50_query_ms: percentile(elapsed, 0.5),
    p95_query_ms: percentile(elapsed, 0.95),
    maximum_query_ms: Math.max(...elapsed),
    peak_incremental_worker_rss_bytes:
      incrementalRss.length > 0 ? Math.max(...incrementalRss) : null,
    all_queries_within_limit: records.every(
      (record) => record.elapsed_ms <= resourceGate.per_query_limit_ms,
    ),
    global_p95_within_limit:
      percentile(elapsed, 0.95) <= resourceGate.global_p95_limit_ms,
    memory_within_limit: incrementalRss.length === records.length &&
      incrementalRss.every(
        (value) => value <= resourceGate.peak_incremental_worker_rss_limit_bytes,
      ),
  };
};

const classifyRepresentations = ({
  representations,
  records,
  replayByRequest,
  resourceGate,
}) => representations.map((representation) => {
  const own = records.filter(
    (record) => record.representation_id === representation.canonical_id,
  );
  const elapsed = own.map((record) => record.elapsed_ms);
  const memory = own.map(
    (record) => record.peak_incremental_worker_rss_bytes,
  );
  const parseFail = own.some((record) =>
    !["ok", "hard_timeout"].includes(record.response_status));
  const replayFail = representation.request_ids.some(
    (requestId) => replayByRequest.get(requestId) === false,
  );
  const timeFail = own.some((record) => record.response_status === "hard_timeout") || elapsed.some(
    (value) => value > resourceGate.per_query_limit_ms,
  ) || percentile(elapsed, 0.95) > resourceGate.per_representation_p95_limit_ms;
  const memoryFail = memory.some(
    (value) => value === null ||
      value > resourceGate.peak_incremental_worker_rss_limit_bytes,
  );
  const failureFlags = [
    parseFail ? "parse_fail" : null,
    timeFail ? "time_fail" : null,
    memoryFail ? "memory_fail" : null,
    replayFail ? "replay_fail" : null,
  ].filter(Boolean);
  const classification = failureFlags[0] ?? "pass";
  return {
    canonical_id: representation.canonical_id,
    canonical_type: representation.canonical_type,
    highest_weight: representation.highest_weight,
    representation_dimension: representation.representation_dimension,
    unique_requests: representation.unique_requests,
    p95_query_ms: percentile(elapsed, 0.95),
    maximum_query_ms: Math.max(...elapsed),
    total_query_ms: elapsed.reduce((total, value) => total + value, 0),
    peak_incremental_worker_rss_bytes: memory.filter((value) => value !== null).length
      ? Math.max(...memory.filter((value) => value !== null)) : null,
    classification,
    failure_flags: failureFlags,
  };
});

const buildFrontier = (classifications) => {
  const byType = new Map();
  for (const entry of classifications) {
    const entries = byType.get(entry.canonical_type) ?? [];
    entries.push(entry);
    byType.set(entry.canonical_type, entries);
  }
  return Object.fromEntries([...byType].map(([type, entries]) => {
    const ordered = [...entries].sort((left, right) => {
      const leftDimension = BigInt(left.representation_dimension);
      const rightDimension = BigInt(right.representation_dimension);
      if (leftDimension !== rightDimension)
        return leftDimension < rightDimension ? -1 : 1;
      return left.canonical_id.localeCompare(right.canonical_id);
    });
    const passing = ordered.filter((entry) => entry.classification === "pass");
    const ceiling = passing.at(-1) ?? null;
    const holes = ceiling === null ? [] : ordered.filter(
      (entry) => entry.classification !== "pass" &&
        BigInt(entry.representation_dimension) <= BigInt(ceiling.representation_dimension),
    );
    const firstHoleDimension = holes.length === 0 ? null
      : holes.reduce((minimum, entry) =>
        BigInt(entry.representation_dimension) < BigInt(minimum)
          ? entry.representation_dimension : minimum,
      holes[0].representation_dimension);
    const passesAboveHole = firstHoleDimension === null ? [] : passing.filter(
      (entry) => BigInt(entry.representation_dimension) > BigInt(firstHoleDimension),
    );
    const classificationsByName = {};
    for (const entry of ordered)
      classificationsByName[entry.classification] =
        (classificationsByName[entry.classification] ?? 0) + 1;
    return [type, {
      tested_representations: ordered.length,
      tested_passing_ceiling: ceiling === null ? null : {
        canonical_id: ceiling.canonical_id,
        representation_dimension: ceiling.representation_dimension,
      },
      holes_below_or_at_ceiling: holes.map((entry) => ({
        canonical_id: entry.canonical_id,
        representation_dimension: entry.representation_dimension,
        classification: entry.classification,
      })),
      passing_representations_above_a_hole: passesAboveHole.map((entry) => ({
        canonical_id: entry.canonical_id,
        representation_dimension: entry.representation_dimension,
      })),
      classifications: classificationsByName,
      tested_cases: ordered,
    }];
  }));
};

const startWorkers = async ({ count, executable, stdbuf, hardTimeoutMs }) => {
  const workers = Array.from({ length: count }, (_, index) => new PersistentLie({
    id: `w${index + 1}`,
    executable,
    stdbuf,
    cwd: dirname(executable),
    hardTimeoutMs,
  }));
  try {
    const warmups = await Promise.all(workers.map((worker) => worker.warmup()));
    return { workers, warmups };
  } catch (error) {
    await Promise.allSettled(workers.map((worker) => worker.close()));
    throw error;
  }
};

const workerRestarter = ({ executable, stdbuf, hardTimeoutMs }) =>
  async (workerId) => {
    const worker = new PersistentLie({
      id: workerId,
      executable,
      stdbuf,
      cwd: dirname(executable),
      hardTimeoutMs,
    });
    try {
      return { worker, warmup: await worker.warmup() };
    } catch (error) {
      await worker.close();
      throw error;
    }
  };

const runCalibration = async ({
  count,
  requestIds,
  executable,
  stdbuf,
  hardTimeoutMs,
  requestById,
  representationByRequest,
  coordinateMapping,
  resourceGate,
}) => {
  const started = performance.now();
  const { workers, warmups } = await startWorkers({
    count, executable, stdbuf, hardTimeoutMs,
  });
  try {
    const restartWarmups = [];
    const records = await executeRequests({
      workers,
      requestIds,
      requestById,
      representationByRequest,
      coordinateMapping,
      passName: `calibration_${count}_workers`,
      restartWorker: workerRestarter({ executable, stdbuf, hardTimeoutMs }),
      restartWarmups,
    });
    const summary = summarizeRecords(records, resourceGate);
    return {
      workers: count,
      status: summary.all_queries_within_limit &&
          summary.global_p95_within_limit && summary.memory_within_limit
        ? "pass" : "resource_fail",
      wall_ms: performance.now() - started,
      warmups,
      restart_warmups: restartWarmups,
      summary,
      records,
    };
  } finally {
    await Promise.allSettled(workers.map((worker) => worker.close()));
  }
};

const selfTest = () => {
  if (percentile([4, 1, 3, 2], 0.95) !== 4 ||
      percentile([4, 1, 3, 2], 0.5) !== 2)
    throw new Error("percentile self-test failed");
  const mapped = mapWeight([10, 11, 12, 13], "F4", { F4: [3, 2, 1, 0] });
  if (mapped.join(",") !== "13,12,11,10")
    throw new Error("coordinate mapping self-test failed");
  const command = commandFor({
    canonical_type: "A2",
    highest_weight: [1, 1],
    target_weight: [0, 0],
  }, {});
  if (command !== "dom_char([1,1],[0,0],A2)")
    throw new Error("command self-test failed");
  process.stdout.write(`${JSON.stringify({ status: "pass" })}\n`);
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.selfTest) {
    selfTest();
    return;
  }
  for (const name of ["plan", "manifest", "lie", "lieSource", "out"])
    if (!options[name]) throw new Error(`--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} is required`);
  const paths = Object.fromEntries(
    ["plan", "manifest", "lie", "lieSource", "out"]
      .map((name) => [name, resolve(options[name])]),
  );
  const stdbuf = options.stdbuf ? resolve(options.stdbuf) : null;
  const [planBytes, manifestFileBytes, lieBytes, sourceBytes] = await Promise.all([
    readFile(paths.plan),
    readFile(paths.manifest),
    readFile(paths.lie),
    readFile(paths.lieSource),
  ]);
  const manifestBytes = paths.manifest.endsWith(".gz")
    ? gunzipSync(manifestFileBytes)
    : manifestFileBytes;
  const plan = JSON.parse(planBytes.toString("utf8"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.phase06_plan_sha256 !== sha256(planBytes))
    throw new Error("manifest does not bind the Phase 0.6 plan");
  if (sha256(sourceBytes) !== plan.lie.source_sha256)
    throw new Error("LiE source archive does not match the pinned hash");
  if (plan.lie.expected_executable_sha256 &&
      sha256(lieBytes) !== plan.lie.expected_executable_sha256)
    throw new Error("LiE executable does not match the accepted pinned build");
  const expectedRepresentations = plan.source.authorized_representations ??
    plan.source.non_pass_representations;
  if (manifest.summary.representations !== expectedRepresentations ||
      manifest.summary.raw_requests !== plan.source.raw_request_maximum)
    throw new Error("manifest surface does not match the authorized plan");
  if (isPreflightPlan(plan) &&
      (manifest.summary.unique_requests !== plan.source.expected_unique_requests ||
       manifest.summary.historical_zero_available !==
         plan.source.expected_historical_zero_available ||
       manifest.source_bindings.governance_sha256 !== plan.governance.record_sha256))
    throw new Error("preflight manifest counts or governance binding do not match the plan");

  const requestById = new Map(manifest.requests.map((entry) => [entry.id, entry]));
  const representationByRequest = new Map();
  for (const representation of manifest.representations)
    for (const requestId of representation.request_ids)
      representationByRequest.set(requestId, representation);
  const identity = {
    phase06_plan_sha256: sha256(planBytes),
    manifest_sha256: sha256(manifestFileBytes),
    manifest_uncompressed_sha256: sha256(manifestBytes),
    lie_source_sha256: sha256(sourceBytes),
    lie_executable_sha256: sha256(lieBytes),
  };
  const result = {
    schema: isPreflightPlan(plan)
      ? "ilxyr.weight_multiplicity_phase06_lie_preflight_evidence.v1"
      : "ilxyr.weight_multiplicity_phase06_evidence.v1",
    status: "running",
    experiment_mode: isPreflightPlan(plan) ? "retained_surface_preflight" : "failed_surface_bakeoff",
    identity,
    environment: {
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      stdbuf: stdbuf ?? "not_used",
    },
    frozen_surface: manifest.summary,
    closures: plan.closures,
  };
  const persist = async () => writeFile(paths.out, stableJson(result));
  await persist();

  const resourceGate = plan.resource_gate;
  const started = performance.now();
  let primary;
  try {
    primary = await startWorkers({
      count: 1,
      executable: paths.lie,
      stdbuf,
      hardTimeoutMs: resourceGate.query_hard_timeout_ms,
    });
    result.primary_worker_warmup = primary.warmups[0];
    result.primary_worker_restart_warmups = [];
    const restartPrimary = workerRestarter({
      executable: paths.lie,
      stdbuf,
      hardTimeoutMs: resourceGate.query_hard_timeout_ms,
    });
    const binding = await executeRequests({
      workers: primary.workers,
      requestIds: manifest.orders.binding_request_ids,
      requestById,
      representationByRequest,
      coordinateMapping: manifest.mapping.coordinate_mapping,
      passName: "binding",
      restartWorker: restartPrimary,
      restartWarmups: result.primary_worker_restart_warmups,
    });
    result.binding_pass = {
      records: binding,
      summary: summarizeRecords(binding, resourceGate),
      records_sha256: sha256(stableJson(binding)),
    };
    await persist();

    const historicalComparisons = binding
      .filter((record) =>
        requestById.get(record.request_id).historical_zero.status === "available")
      .map((record) => {
        const expected = requestById.get(record.request_id).historical_zero.multiplicity;
        return {
          request_id: record.request_id,
          zero_multiplicity: expected,
          lie_multiplicity: record.multiplicity,
          lie_status: record.response_status,
          agreement: record.response_status === "ok" &&
            expected === record.multiplicity,
        };
      });
    const completedComparisons = historicalComparisons.filter(
      (entry) => entry.lie_status === "ok",
    );
    result.differential = {
      available: historicalComparisons.length,
      unavailable: manifest.summary.historical_zero_unavailable,
      denominator: manifest.summary.unique_requests,
      completed_comparisons: completedComparisons.length,
      coverage_fraction: `${completedComparisons.length}/${manifest.summary.unique_requests}`,
      agreements: completedComparisons.filter((entry) => entry.agreement).length,
      disagreements: completedComparisons.filter((entry) => !entry.agreement),
      lie_unavailable: historicalComparisons.filter(
        (entry) => entry.lie_status !== "ok",
      ),
      comparisons: historicalComparisons,
    };
    if (result.differential.disagreements.length > 0)
      throw Object.assign(new Error("LiE and historical Zero disagree"), {
        evidenceStatus: "hold",
      });

    const replay = await executeRequests({
      workers: primary.workers,
      requestIds: manifest.orders.replay_request_ids,
      requestById,
      representationByRequest,
      coordinateMapping: manifest.mapping.coordinate_mapping,
      passName: "seeded_replay",
      restartWorker: restartPrimary,
      restartWarmups: result.primary_worker_restart_warmups,
    });
    result.replay_pass = {
      records: replay,
      summary: summarizeRecords(replay, resourceGate),
      records_sha256: sha256(stableJson(replay)),
    };
    const bindingByRequest = new Map(
      binding.map((record) => [record.request_id, record]),
    );
    const replayByRequest = new Map(replay.map((record) => [
      record.request_id,
      record.response_status === "ok" &&
        bindingByRequest.get(record.request_id)?.response_status === "ok" &&
        bindingByRequest.get(record.request_id)?.multiplicity === record.multiplicity,
    ]));
    result.replay = {
      compared: replayByRequest.size,
      agreements: [...replayByRequest.values()].filter(Boolean).length,
      incomplete_or_non_deterministic: [...replayByRequest]
        .filter(([, agreement]) => !agreement)
        .map(([requestId]) => requestId),
    };

    const allRecords = [...binding, ...replay];
    result.representations = classifyRepresentations({
      representations: manifest.representations,
      records: allRecords,
      replayByRequest,
      resourceGate,
    });
    result.lie_only_tested_frontier = buildFrontier(result.representations);
    const primarySummary = summarizeRecords(allRecords, resourceGate);
    const perRepresentationP95Pass = result.representations.every(
      (entry) => entry.p95_query_ms <= resourceGate.per_representation_p95_limit_ms,
    );
    result.primary_resource_gate = {
      ...primarySummary,
      per_representation_p95_within_limit: perRepresentationP95Pass,
      passed: primarySummary.all_queries_within_limit &&
        primarySummary.global_p95_within_limit &&
        primarySummary.memory_within_limit && perRepresentationP95Pass,
      wall_ms: performance.now() - started,
      accepted_record_cost_ms:
        primarySummary.total_query_ms / manifest.summary.raw_requests,
    };
  } catch (error) {
    result.status = error.evidenceStatus ?? "hold";
    result.decision = "hold";
    result.decision_reason = error.message;
    if (isPreflightPlan(plan)) {
      result.license_and_maintenance_gate = {
        status: "pass",
        governance_record_sha256: plan.governance.record_sha256,
        accountable_owner: plan.governance.accountable_owner,
        invocation: plan.lie.execution,
      };
    }
    result.error = {
      message: error.message,
      query_record: error.queryRecord ?? null,
    };
    await persist();
    process.exitCode = 2;
    return;
  } finally {
    if (primary) await Promise.allSettled(primary.workers.map((worker) => worker.close()));
  }

  result.calibration = [];
  if (result.primary_resource_gate.passed) {
    for (const count of resourceGate.calibration_workers) {
      if (count === 1) {
        result.calibration.push({
          workers: 1,
          status: "pass",
          source: "two_complete_primary_passes",
          summary: result.primary_resource_gate,
        });
      } else {
        result.calibration.push(await runCalibration({
          count,
          requestIds: manifest.orders.stress_request_ids,
          executable: paths.lie,
          stdbuf,
          hardTimeoutMs: resourceGate.query_hard_timeout_ms,
          requestById,
          representationByRequest,
          coordinateMapping: manifest.mapping.coordinate_mapping,
          resourceGate,
        }));
      }
      await persist();
    }
  }
  const safe = result.calibration
    .filter((entry) => entry.status === "pass")
    .map((entry) => entry.workers);
  result.safe_persistent_worker_count = safe.length ? Math.max(...safe) : null;
  const passingRepresentations = result.representations.filter(
    (entry) => entry.classification === "pass",
  ).length;
  if (isPreflightPlan(plan)) {
    const everyRepresentationPass =
      passingRepresentations === plan.source.authorized_representations;
    const differentialPass =
      result.differential.agreements === plan.source.expected_historical_zero_available &&
      result.differential.disagreements.length === 0 &&
      result.differential.lie_unavailable.length === 0;
    const replayPass =
      result.replay.agreements === plan.source.expected_unique_requests &&
      result.replay.incomplete_or_non_deterministic.length === 0;
    result.technical_resource_outcome = result.primary_resource_gate.passed &&
        everyRepresentationPass
      ? "preflight_surface_cleared"
      : passingRepresentations > 0 ? "preflight_reduced_surface_only" : "resource_fail";
    result.license_and_maintenance_gate = {
      status: "pass",
      governance_record_sha256: plan.governance.record_sha256,
      accountable_owner: plan.governance.accountable_owner,
      invocation: plan.lie.execution,
      active_upstream: plan.governance.active_upstream,
      security_patching: plan.governance.security_patching,
    };
    const passed = result.primary_resource_gate.passed && everyRepresentationPass &&
      differentialPass && replayPass;
    result.decision = passed ? "preflight_pass" : "hold";
    result.decision_reason = passed
      ? "All 572 retained representations passed resource, differential, replay, identity, and governance gates; evidence returns for client review and does not authorize corpus generation."
      : "One or more retained-surface preflight gates failed; corpus generation remains closed.";
  } else {
    result.technical_resource_outcome = result.primary_resource_gate.passed
      ? "full_failed_surface_cleared"
      : passingRepresentations > 0 ? "reduced_surface_only" : "resource_fail";
    result.license_and_maintenance_gate = {
      status: "hold",
      reason: "client counsel acceptance and a named accountable maintenance owner were not supplied to this run",
      invocation: "unmodified_separate_executable",
    };
    result.decision = "hold";
    result.decision_reason = result.primary_resource_gate.passed
      ? "technical bake-off completed; operational adoption remains blocked by the signed license and maintenance gate"
      : "technical resource result is recorded; operational adoption also remains blocked by the signed license and maintenance gate";
  }
  result.status = "complete";
  result.completed_wall_ms = performance.now() - started;
  await persist();
  process.stdout.write(stableJson({
    status: result.status,
    decision: result.decision,
    technical_resource_outcome: result.technical_resource_outcome,
    primary_resource_gate: result.primary_resource_gate,
    differential: {
      coverage_fraction: result.differential.coverage_fraction,
      agreements: result.differential.agreements,
      disagreements: result.differential.disagreements.length,
      lie_unavailable: result.differential.lie_unavailable.length,
    },
    replay: result.replay,
    safe_persistent_worker_count: result.safe_persistent_worker_count,
    identity,
  }));
};

await main();
