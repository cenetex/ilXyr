#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

const parseArguments = (values) => {
  const options = { manifest: null, zero: null, lie: null, out: null, timeoutMs: 60000 };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!["--manifest", "--zero", "--lie", "--out", "--timeout-ms"].includes(value))
      throw new Error(`unknown argument: ${value}`);
    const next = values[++index];
    if (!next) throw new Error(`${value} requires a value`);
    const key = {
      "--manifest": "manifest",
      "--zero": "zero",
      "--lie": "lie",
      "--out": "out",
      "--timeout-ms": "timeoutMs",
    }[value];
    options[key] = value === "--timeout-ms" ? Number(next) : next;
  }
  if (!options.manifest || !options.zero || !options.lie || !options.out)
    throw new Error("--manifest, --zero, --lie, and --out are required");
  return options;
};

const runProcess = ({ executable, arguments: args, input, timeoutMs, cwd }) =>
  new Promise((resolvePromise) => {
    const started = performance.now();
    const child = spawn(executable, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") stderr += `\nstdin: ${error.message}`;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolvePromise({ status: "spawn_error", error: error.message, stdout, stderr, elapsed_ms: performance.now() - started });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolvePromise({
        status: timedOut ? "timeout" : code === 0 ? "completed" : "process_error",
        code,
        signal,
        stdout,
        stderr,
        elapsed_ms: performance.now() - started,
      });
    });
    child.stdin.end(input);
  });

const mapForLie = (weight, type, mapping) => {
  const indices = mapping[type];
  return indices ? indices.map((index) => weight[index]) : [...weight];
};

const parseZero = (execution) => {
  if (execution.status !== "completed") return { status: execution.status, error: execution.stderr.trim() || execution.error || null };
  try {
    const response = JSON.parse(execution.stdout.trim());
    if (typeof response.multiplicity !== "string")
      return { status: "oracle_error", error: response.error ?? response.status ?? "missing multiplicity" };
    return { status: "ok", multiplicity: String(response.multiplicity) };
  } catch (error) {
    return { status: "parse_error", error: error.message };
  }
};

const parseLie = (execution) => {
  if (execution.status !== "completed") return { status: execution.status, error: execution.stderr.trim() || execution.error || null };
  const integers = execution.stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^-?\d+$/.test(line));
  if (integers.length !== 1)
    return { status: "parse_error", error: `expected one integer line, received ${integers.length}` };
  return { status: "ok", multiplicity: integers[0] };
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  const manifestPath = resolve(root, options.manifest);
  const zeroPath = resolve(options.zero);
  const liePath = resolve(options.lie);
  const [manifestBytes, zeroBytes, lieBytes] = await Promise.all([
    readFile(manifestPath),
    readFile(zeroPath),
    readFile(liePath),
  ]);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.zero_executable_sha256 !== sha256(zeroBytes))
    throw new Error("cross-check manifest does not bind the Zero executable");
  const results = [];
  for (const testCase of manifest.cases) {
    const lieType = manifest.lie_type_mapping[testCase.type] ?? testCase.type;
    const mappedHighest = mapForLie(testCase.highest_weight, testCase.type, manifest.coordinate_mapping);
    const mappedTarget = mapForLie(testCase.target_weight, testCase.type, manifest.coordinate_mapping);
    const [zeroExecution, lieExecution] = await Promise.all([
      runProcess({
        executable: zeroPath,
        arguments: ["query", testCase.type, testCase.highest_weight.join(","), testCase.target_weight.join(",")],
        input: "",
        timeoutMs: options.timeoutMs,
      }),
      runProcess({
        executable: liePath,
        arguments: [],
        input: `dom_char([${mappedHighest.join(",")}],[${mappedTarget.join(",")}],${lieType})\nquit\n`,
        timeoutMs: options.timeoutMs,
        cwd: dirname(liePath),
      }),
    ]);
    const zero = parseZero(zeroExecution);
    const lie = parseLie(lieExecution);
    const agreement = zero.status === "ok" && lie.status === "ok" && zero.multiplicity === lie.multiplicity;
    const result = {
      ...testCase,
      zero: { ...zero, elapsed_ms: zeroExecution.elapsed_ms },
      lie: { ...lie, query_type: lieType, elapsed_ms: lieExecution.elapsed_ms },
      agreement,
    };
    results.push(result);
    console.log(JSON.stringify({ id: testCase.id, type: testCase.type, agreement, zero: zero.multiplicity, lie: lie.multiplicity }));
    if (!agreement) {
      const partial = {
        schema_version: 1,
        evidence_status: "hold_on_unresolved_disagreement",
        manifest_sha256: sha256(manifestBytes),
        zero_executable_sha256: sha256(zeroBytes),
        lie_executable_sha256: sha256(lieBytes),
        timeout_ms: options.timeoutMs,
        results,
        summary: { completed: results.length, agreements: results.filter((entry) => entry.agreement).length, disagreements: 1 },
      };
      await writeFile(resolve(root, options.out), stableJson(partial));
      process.exitCode = 2;
      return;
    }
  }
  const perType = Object.fromEntries(Object.keys(manifest.summary.per_type).map((type) => [
    type,
    results.filter((entry) => entry.type === type && entry.agreement).length,
  ]));
  const multiplicityStrata = Object.fromEntries(Object.keys(perType).map((type) => {
    const values = results.filter((entry) => entry.type === type).map((entry) => BigInt(entry.zero.multiplicity));
    return [type, {
      one: values.filter((value) => value === 1n).length,
      two_to_seven: values.filter((value) => value >= 2n && value <= 7n).length,
      eight_to_thirty_one: values.filter((value) => value >= 8n && value <= 31n).length,
      thirty_two_plus: values.filter((value) => value >= 32n).length,
    }];
  }));
  const result = {
    schema_version: 1,
    evidence_status: "pass",
    manifest_sha256: sha256(manifestBytes),
    zero_executable_sha256: sha256(zeroBytes),
    lie_executable_sha256: sha256(lieBytes),
    timeout_ms: options.timeoutMs,
    coordinate_mapping: manifest.coordinate_mapping,
    results,
    summary: {
      completed: results.length,
      agreements: results.length,
      disagreements: 0,
      per_type: perType,
      observed_multiplicity_strata: multiplicityStrata,
    },
  };
  await writeFile(resolve(root, options.out), stableJson(result));
  console.log(JSON.stringify(result.summary));
};

await main();
