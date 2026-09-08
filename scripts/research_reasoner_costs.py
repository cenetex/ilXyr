"""Explain stage costs in the opened, hash-bound Reasoner cloud results."""

import argparse
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path
import statistics

ROOT = Path(__file__).resolve().parents[1]
ARMS = ("target_only", "source_free_jit", "semantic_frequency", "task_guide",
        "raw_lexical_task_guide", "task_without_prior_feature")
STAGES = ("adapter_ns", "jit_ns", "enumerate_ns", "group_ns", "score_ns",
          "sort_ns", "receipt_ns", "search_ns")
TIMERS = (*STAGES, "wall_ns", "cpu_ns")
COUNTERS = ("groups", "verifier_checks", "partial_expansions", "observation_queries",
            "source_artifact_reads")
DECLARED_BYTES = dict(zip(ARMS, (0, 0, 0, 921, 921, 16)))


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def save(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n")


def natural(value):
    return type(value) is int and 0 <= value < 2 ** 53


def summarize(processes, *, families=128, passes=12, views=4, cells=4):
    require(families % cells == 0, "family strata differ")
    expected = list(range(families * views))
    require(len(processes) == len(ARMS) * passes, "process count differs")
    samples = {arm: defaultdict(list) for arm in ARMS}
    totals = {arm: {"process_cpu_ns": 0, "process_wall_ns": 0, "corpus_cpu_ns": 0,
                   "model_load_cpu_ns": 0, "peak_rss_bytes": 0,
                   **{phase: {key: 0 for key in (*TIMERS, *COUNTERS, "unattributed_wall_ns")}
                      for phase in ("warmup", "measured")}} for arm in ARMS}
    identities, orders, seen = {}, {}, set()
    for process in processes:
        arm, pass_id, rows = process["arm"], process["pass"], process["rows"]
        require(arm in ARMS and type(pass_id) is int and 0 <= pass_id < passes,
                "process identity differs")
        require((arm, pass_id) not in seen, "duplicate process")
        seen.add((arm, pass_id))
        meta, tail = rows[0], rows[-1]
        require(meta["kind"] == "metadata" and meta["arm"] == arm
                and meta["pass"] == pass_id, "native identity differs")
        require(tail["kind"] == "process" and tail["failed"] is False
                and tail["completed_episodes"] == 2 * len(expected)
                and len(rows) == 2 * len(expected) + 2, "incomplete process")
        total = totals[arm]
        for key in ("process_cpu_ns", "process_wall_ns", "peak_rss_bytes"):
            require(natural(tail[key]) and tail[key] > 0, "invalid process cost")
            total[key] = (max(total[key], tail[key]) if key == "peak_rss_bytes"
                          else total[key] + tail[key])
        for key in ("corpus_cpu_ns", "model_load_cpu_ns", "corpus_ns", "model_load_ns"):
            require(natural(meta[key]), "invalid setup cost")
            if key in total:
                total[key] += meta[key]
        phase_rows = {}
        for phase in ("warmup", "measured"):
            selected = [r for r in rows[1:-1] if r["phase"] == phase]
            require(sorted(r["episode"] for r in selected) == expected, "episode roster differs")
            sequence = [r["episode"] for r in selected]
            require(sequence == orders.setdefault(pass_id, sequence), "paired order differs")
            for row in selected:
                require(row["kind"] == "row" and row["failed"] is False
                        and all(row[key] is True for key in ("exact", "certificate_valid",
                                                             "injected_invalid_rejected")),
                        "invalid answer or certificate")
                require(all(natural(row[key]) for key in (*TIMERS, *COUNTERS)),
                        "invalid stage cost or counter")
                require(row["wall_ns"] > 0 and row["cpu_ns"] > 0, "zero episode time")
                residual = row["wall_ns"] - sum(row[key] for key in STAGES)
                require(residual >= 0, "stage wall costs exceed episode wall cost")
                require(row["source_artifact_reads"] == DECLARED_BYTES[arm],
                        "declared guide-byte counter differs")
                for key in (*TIMERS, *COUNTERS):
                    total[phase][key] += row[key]
                total[phase]["unattributed_wall_ns"] += residual
                if phase == "measured":
                    samples[arm][row["episode"]].append(row)
            stable = [{k: v for k, v in r.items() if k not in (*TIMERS, "phase")}
                      for r in sorted(selected, key=lambda r: r["episode"])]
            require(stable == identities.setdefault(arm, stable), "repeated behavior differs")
            phase_rows[phase] = selected
        for clock, setup in (("cpu_ns", ("corpus_cpu_ns", "model_load_cpu_ns")),
                             ("wall_ns", ("corpus_ns", "model_load_ns"))):
            used = sum(meta[k] for k in setup) + sum(r[clock] for v in phase_rows.values() for r in v)
            require(tail["process_" + clock] >= used, "process cost excludes completed work")
    for total in totals.values():
        total["unattributed_process_cpu_ns"] = total["process_cpu_ns"] - sum(
            total[k] for k in ("corpus_cpu_ns", "model_load_cpu_ns")) - sum(
            total[phase]["cpu_ns"] for phase in ("warmup", "measured"))
    medians = {}
    for arm, episodes in samples.items():
        medians[arm] = {}
        for episode, rows in episodes.items():
            require(len(rows) == passes, "pass coverage differs")
            medians[arm][episode] = {"cpu": statistics.median(r["cpu_ns"] for r in rows),
                                     "checks_plus_one": rows[0]["verifier_checks"] + 1}

    def pair(candidate, reference):
        metrics = {}
        for metric in ("cpu", "checks_plus_one"):
            family_logs = [math.fsum(math.log(medians[candidate][e][metric] /
                                              medians[reference][e][metric])
                                     for e in range(f * views, (f + 1) * views)) / views
                           for f in range(families)]
            metrics[metric] = {"family_geometric_ratio": math.exp(math.fsum(family_logs) / families),
                               "family_wins": sum(v < 0 for v in family_logs),
                               "family_ties": sum(v == 0 for v in family_logs),
                               "family_losses": sum(v > 0 for v in family_logs),
                               "stratum_ratios": [math.exp(math.fsum(family_logs[c * (families // cells):
                                   (c + 1) * (families // cells)]) / (families // cells))
                                   for c in range(cells)]}
        actual, base = totals[candidate]["measured"], totals[reference]["measured"]
        delta = {k: actual[k] - base[k] for k in (*TIMERS, "unattributed_wall_ns", "verifier_checks")}
        return {"candidate": candidate, "reference": reference, "metrics": metrics,
                "measured_delta": delta,
                "zero_search_accounting_bound": {
                    "candidate_wall_ns": actual["wall_ns"] - actual["search_ns"],
                    "reference_wall_ns": base["wall_ns"],
                    "ratio": (actual["wall_ns"] - actual["search_ns"]) / base["wall_ns"],
                    "scope": "measured aggregate wall time; every other recorded stage held fixed"},
                "score_share_of_wall_delta": delta["score_ns"] / delta["wall_ns"]
                if delta["wall_ns"] != 0 else None}

    pairs = [pair("task_guide", arm) for arm in ARMS if arm != "task_guide"]
    pairs.append(pair("task_without_prior_feature", "semantic_frequency"))
    return {"schema": "ilxyr.reasoner_cost_diagnostic.v1", "status": "opened_data_diagnostic",
            "families": families, "views_per_family": views, "passes": passes,
            "native_processes": len(processes), "native_episode_visits": len(processes) * len(expected) * 2,
            "stage_clock": "monotonic_wall", "process_clock": "process_cpu",
            "source_artifact_reads_meaning": "declared guide and weight bytes per visit; counter in frozen source",
            "isolated_prior_function_time_ns": None, "new_performance_run": False,
            "totals": totals, "comparisons": pairs}


def inspect(results, source, collection):
    indexed = {row["path"]: row for row in collection["objects"]}
    require(len(indexed) == len(collection["objects"]), "duplicate collection path")
    bindings = {}

    def read(name):
        require(name in indexed and ".." not in Path(name).parts, "unbound input path")
        path = (results / name).resolve()
        require(path.is_relative_to(results.resolve()), "input escapes result directory")
        raw = path.read_bytes()
        require(len(raw) == indexed[name]["bytes"] and sha(raw) == indexed[name]["sha256"],
                "input digest differs: " + name)
        bindings[name] = {"bytes": len(raw), "sha256": sha(raw)}
        return raw

    identity = json.loads(read("results/study/identity.json"))
    require(identity["arms"] == list(ARMS) and identity["families_per_cell"] == 32
            and identity["passes"] == 12 and identity["seed"] == "55356d6174636831",
            "frozen study dimensions differ")
    for name, digest in identity["source_bindings"].items():
        path = (source / name).resolve()
        require(path.is_relative_to(source.resolve()) and sha(path.read_bytes()) == digest,
                "source digest differs: " + name)
    processes = []
    for pass_id in range(12):
        for arm in ARMS:
            name = f"results/study/{pass_id:02d}-{arm}"
            raw = read(name + ".jsonl")
            terminal = json.loads(read(name + ".terminal.json"))
            require(terminal["status"] == 0 and terminal["stdout_sha256"] == sha(raw),
                    "native process receipt differs")
            processes.append({"arm": arm, "pass": pass_id,
                              "rows": [json.loads(line) for line in raw.splitlines()]})
    original = json.loads(read("results/study/analysis.json"))
    analysis = summarize(processes)
    for arm in ARMS:
        total = analysis["totals"][arm]
        for key, value in original["totals"][arm].items():
            actual = total[key[:-7]]["cpu_ns"] if key in ("warmup_cpu_ns", "measured_cpu_ns") else total[key]
            require(actual == value, "published process total differs: " + key)
    for prior in original["comparisons"]:
        current = next(p for p in analysis["comparisons"] if p["candidate"] == "task_guide"
                       and p["reference"] == prior["reference"])
        for metric, old in (("cpu", "cpu"), ("checks_plus_one", "checks")):
            require(math.isclose(current["metrics"][metric]["family_geometric_ratio"],
                                 prior["paired"][old]["ratio"], rel_tol=1e-12),
                    "published family ratio differs")
    return analysis, {"inputs": bindings, "source_bindings": identity["source_bindings"],
                      "model_sha256": identity["model_sha256"],
                      "executable_sha256": identity["executable_sha256"],
                      "published_totals_and_point_ratios_reproduced": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--results", required=True, type=Path)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=False)
    attempt = {"status": "failed", "phase": "input_verification", "new_performance_run": False}
    save(args.out / "ATTEMPT.json", attempt)
    try:
        collection_path = ROOT / "experiments/research-step-26/COLLECTION.json"
        analysis, bindings = inspect(args.results, args.source, json.loads(collection_path.read_bytes()))
        bindings["collection_manifest_sha256"] = sha(collection_path.read_bytes())
        bindings["diagnostic_source_sha256"] = sha(Path(__file__).read_bytes())
        save(args.out / "INPUTS.json", bindings)
        save(args.out / "ANALYSIS.json", analysis)
        attempt.update(status="complete", phase="verified", source_files=len(bindings["source_bindings"]),
                       input_files=len(bindings["inputs"]), native_processes=analysis["native_processes"])
    except Exception as error:
        attempt["error"] = str(error)
        raise
    finally:
        save(args.out / "ATTEMPT.json", attempt)
    print(json.dumps(attempt))


if __name__ == "__main__":
    main()
