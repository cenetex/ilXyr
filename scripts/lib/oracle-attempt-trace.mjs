import { createHash } from "node:crypto";
import { closeSync, openSync, renameSync, writeFileSync, writeSync } from "node:fs";
import { resolve } from "node:path";
import { OracleResourceAccounting } from "./oracle-resource-accounting.mjs";

// Legacy run gates remain in BudgetTracker. This records every LiE call,
// including setup, and measures the final p99 for the proposed next policy.
export class OracleAttemptTrace {
  constructor({ directory, hardTimeoutMs, clock = () => performance.now() }) {
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
    this.phaseCounts = { setup: 0, workload: 0 };
    this.dispatched = 0;
  }

  elapsed() { return (this.clock() - this.started) / 1000; }
  nextDispatch() { return ++this.dispatched; }

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
    return record;
  }

  hold(reason, record = null) { this.accounting.hold(reason, record); }

  checkpoint(force = false) {
    if (!force && this.clock() - this.lastCheckpoint < 1000) return;
    this.lastCheckpoint = this.clock();
    const snapshot = this.accounting.snapshot();
    const value = {
      accounting_scope: "all_lie_calls_including_warmup",
      selection_scope: "query_disposition_before_corpus_acceptance",
      trace_sha256: this.hash.copy().digest("hex"),
      phase_calls: { ...this.phaseCounts }, ...snapshot,
    };
    writeFileSync(`${this.summaryPath}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(`${this.summaryPath}.tmp`, this.summaryPath);
    return value;
  }

  finish(complete) {
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
