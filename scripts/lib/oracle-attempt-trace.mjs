import { createHash } from "node:crypto";
import { closeSync, openSync, renameSync, writeFileSync, writeSync } from "node:fs";
import { resolve } from "node:path";
import { OracleResourceAccounting } from "./oracle-resource-accounting.mjs";

// The full trace includes setup. The optional policy follows the calibration's
// workload query set and clock; both accounting records remain visible.
export class OracleAttemptTrace {
  constructor({ directory, hardTimeoutMs, workloadLimits = null, clock = () => performance.now() }) {
    this.clock = clock;
    this.started = clock();
    this.lastCheckpoint = this.started;
    this.tracePath = resolve(directory, "oracle-attempts.jsonl");
    this.summaryPath = resolve(directory, "oracle-accounting.json");
    this.fd = openSync(this.tracePath, "wx");
    this.hash = createHash("sha256");
    this.accounting = new OracleResourceAccounting({ final_p99_ms: null,
      hard_timeout_ms: hardTimeoutMs, oracle_calls: null, total_query_ms: null,
      elapsed_wall_seconds: null });
    this.workloadAccounting = workloadLimits ? new OracleResourceAccounting(workloadLimits) : null;
    this.workloadStarted = null;
    this.phaseCounts = { setup: 0, workload: 0 };
    this.dispatched = 0;
  }

  elapsed() { return (this.clock() - this.started) / 1000; }
  nextDispatch() { return ++this.dispatched; }

  startWorkload() {
    if (this.workloadStarted !== null) throw new Error("workload clock already started");
    this.workloadStarted = this.clock();
  }

  workloadElapsed() {
    return this.workloadStarted === null ? 0 : (this.clock() - this.workloadStarted) / 1000;
  }

  beforeDispatch(inFlight) {
    const policy = this.workloadAccounting;
    if (policy) {
      if (this.workloadStarted === null) throw new Error("workload clock is required");
      policy.checkWall(this.workloadElapsed());
      if (policy.p99.count + inFlight >= policy.limits.oracle_calls)
        policy.hold("oracle_call_limit");
      if (policy.firstHold) this.hold(policy.firstHold.reason, policy.firstHold.triggering_query);
    }
    return this.accounting.firstHold;
  }

  record(candidate, result, { sliceId, dispatchSequence, phase = "workload" }) {
    const disposition = result.status !== "ok" ? "oracle_failure"
      : phase === "setup" ? "warmup"
        : sliceId.startsWith("pilot:") ? "pilot_observation"
          : candidate.desired_stratum && candidate.desired_stratum !== "natural"
            && stratum(result.multiplicity) !== candidate.desired_stratum
            ? "stratum_mismatch" : "candidate_for_selection";
    const { record } = this.accounting.observe({
      ...result, sequence: this.accounting.p99.count + 1,
      dispatch_sequence: dispatchSequence, phase, slice_id: sliceId,
      canonical_type: candidate.canonical_type,
      canonical_representation_id: candidate.canonical_representation_id,
      highest_weight: candidate.highest_weight, target_weight: candidate.target_weight,
      target_status: candidate.target_status, target_depth: candidate.target_depth,
      desired_stratum: candidate.desired_stratum ?? null,
      query_key: candidate.query_key, disposition,
    }, this.elapsed());
    const bytes = Buffer.from(`${JSON.stringify(record)}\n`);
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(this.fd, bytes, offset, bytes.length - offset);
      if (written === 0) throw new Error("oracle trace write made no progress");
      offset += written;
    }
    this.hash.update(bytes);
    this.phaseCounts[phase] += 1;
    if (phase === "workload" && this.workloadAccounting) {
      if (this.workloadStarted === null) throw new Error("workload clock is required");
      const policy = this.workloadAccounting;
      policy.observe({ ...record, trace_sequence: record.sequence,
        sequence: policy.p99.count + 1 }, this.workloadElapsed());
      if (policy.firstHold) this.hold(policy.firstHold.reason, policy.firstHold.triggering_query);
    }
    return record;
  }

  hold(reason, record = null) {
    this.accounting.hold(reason, record);
    this.workloadAccounting?.hold(reason, record);
  }

  checkpoint(force = false) {
    if (!force && this.clock() - this.lastCheckpoint < 1000) return;
    this.lastCheckpoint = this.clock();
    const snapshot = this.accounting.snapshot();
    const value = {
      accounting_scope: "all_lie_calls_including_warmup",
      selection_scope: "query_disposition_before_corpus_acceptance",
      trace_sha256: this.hash.copy().digest("hex"),
      phase_calls: { ...this.phaseCounts }, ...snapshot,
      ...(this.workloadAccounting ? {
        policy_scope: "all_workload_attempts_including_pilot",
        workload_accounting: this.workloadAccounting.snapshot(),
      } : {}),
    };
    writeFileSync(`${this.summaryPath}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(`${this.summaryPath}.tmp`, this.summaryPath);
    return value;
  }

  finish(complete) {
    const policy = this.workloadAccounting;
    if (policy && !policy.finished) {
      policy.finish({ complete, elapsedWallSeconds: this.workloadElapsed() });
      if (policy.firstHold) this.hold(policy.firstHold.reason, policy.firstHold.triggering_query);
    }
    if (!this.accounting.finished) this.accounting.finish({ complete, elapsedWallSeconds: this.elapsed() });
    if (this.fd !== null) { closeSync(this.fd); this.fd = null; }
    return this.checkpoint(true);
  }
}

const stratum = (value) => {
  const number = BigInt(value);
  return number === 0n ? "0" : number === 1n ? "1" : number <= 7n ? "2-7"
    : number <= 31n ? "8-31" : ">31";
};
