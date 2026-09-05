"""Check mechanism controls in existing public Reasoner and ZERO.4 records."""

import argparse
from collections import defaultdict
import json
import math
from pathlib import Path
from statistics import mean, median

from research_baselines import ROOT, ZERO, Sources, geometric_mean, require, sha


def indexed(rows, key):
    result = {}
    for row in rows:
        require(row[key] not in result, "duplicate " + key)
        result[row[key]] = row
    return result


def paired_families(candidate, baseline, costs, family_count):
    candidate, baseline = indexed(candidate, "episode"), indexed(baseline, "episode")
    expected = set(range(4 * family_count))
    require(candidate.keys() == baseline.keys() == expected, "episode coverage differs")
    families = []
    for family in range(family_count):
        ratios = defaultdict(list)
        for episode in range(4 * family, 4 * family + 4):
            a, b = candidate[episode], baseline[episode]
            for row in [a, b]:
                require(all(row[key] is True for key in ["exact", "certificate_valid", "injected_invalid_rejected"]),
                        "exactness record differs")
                require(isinstance(row["verifier_checks"], int) and row["verifier_checks"] >= 0,
                        "verifier count is invalid")
            require(a["accepted_semantic_sha256"] == b["accepted_semantic_sha256"], "accepted behaviors differ")
            ratios["checks"].append((a["verifier_checks"] + 1) / (b["verifier_checks"] + 1))
            for metric in ["cpu_ns", "wall_ns"]:
                left, right = costs[0][episode][metric], costs[1][episode][metric]
                require(math.isfinite(left) and left > 0 and math.isfinite(right) and right > 0,
                        "paired time must be finite and positive")
                ratios[metric.removesuffix("_ns")].append(left / right)
        families.append({"ordinal": family, "cell": family // 32,
                         **{key: geometric_mean(values) for key, values in ratios.items()}})
    return families


def reasoner_controls(sources, repository):
    base = "benchmarks/reasoner55-fixed-transfer-v1/"
    def read(path, expected=None):
        return sources.git(repository, "atimics/zero-grounded-literary-lm", ZERO, path, expected)
    analysis = json.loads(read(base + "ANALYSIS.json"))
    result = json.loads(read(base + "RESULTS.json", analysis["result_sha256"]))
    timing = json.loads(read(base + "TIMING.json", analysis["timing_sha256"]))
    require(timing["result_sha256"] == analysis["result_sha256"], "timing result binding differs")
    require(timing["passes"] == 12, "timing pass count differs")
    require([row["ordinal"] for row in result["families"]] == list(range(128)), "family roster differs")
    arms = indexed(result["arms"], "arm")
    require(len(arms) == 6, "arm roster differs")
    samples = defaultdict(lambda: defaultdict(list))
    processes = set()
    for process in timing["processes"]:
        identity = (process["arm"], process["pass"])
        require(identity not in processes, "duplicate timing process")
        processes.add(identity)
        require(indexed(process["samples"], "episode").keys() == set(range(512)), "timing episode roster differs")
        for sample in process["samples"]:
            samples[process["arm"]][sample["episode"]].append(sample)
    require(processes == {(arm, repeat) for arm in arms for repeat in range(12)}, "timing process roster differs")
    costs = {arm: {episode: {metric: median(row[metric] for row in rows)
                            for metric in ["cpu_ns", "wall_ns"]}
                   for episode, rows in episodes.items()} for arm, episodes in samples.items()}
    published = indexed(analysis["arms"], "arm")
    comparisons = []
    for baseline in arms:
        if baseline == "task_guide":
            continue
        families = paired_families(arms["task_guide"]["rows"], arms[baseline]["rows"],
                                   (costs["task_guide"], costs[baseline]), 128)
        metrics = {metric: geometric_mean([row[metric] for row in families]) for metric in ["checks", "cpu", "wall"]}
        for metric, value in metrics.items():
            reference_ratio = published["task_guide"]["paired"][metric]["ratio"] / published[baseline]["paired"][metric]["ratio"]
            require(math.isclose(value, reference_ratio, rel_tol=1e-10), "published paired ratio differs")
        comparisons.append({
            "candidate": "task_guide", "baseline": baseline, "paired_ratios": metrics,
            "family_check_wins": sum(row["checks"] < 1 - 1e-12 for row in families),
            "family_check_ties": sum(abs(row["checks"] - 1) <= 1e-12 for row in families),
            "family_check_losses": sum(row["checks"] > 1 + 1e-12 for row in families),
            "cells": [{"cell": cell, **{metric: geometric_mean([row[metric] for row in families if row["cell"] == cell])
                                         for metric in metrics}} for cell in range(4)],
            "families": families,
        })
    later = []
    for family in ["reasoner58-compositional-behavior-transfer-v1", "reasoner59a-symbolic-transfer-v1"]:
        record = json.loads(read("benchmarks/" + family + "/DEVELOPMENT.json"))
        read("benchmarks/" + family + "/DEVELOPMENT.md")
        primary = record["registered_analysis"]["primary"]
        later.append({"experiment": family, "decision": record["decision"], "gate": record["gate"],
                      "families": len(primary["units"]),
                      "primary": {key: value for key, value in primary.items() if key not in ["units", "settings"]}})
    return {"evidence_kind": "posthoc_public_cohort_arithmetic",
            "timing_scope": "original_fixed_transfer_pipeline",
            "new_confidence_intervals": None, "comparisons": comparisons, "later_development": later}


def projection_audit(attempts, diagnostics):
    require([row["attempt"] for row in attempts] == list(range(1, len(attempts) + 1)), "attempt roster differs")
    trials = []
    for row in attempts:
        require(row["backtrack_trial_count"] == len(row["backtrack_trials"]), "trial count differs")
        require(row["decision"] in ["accept", "reject"], "attempt disposition differs")
        for trial in row["backtrack_trials"]:
            require(math.isfinite(trial["projection_removed_fraction"]) and 0 <= trial["projection_removed_fraction"] <= 1,
                    "projection fraction is invalid")
            trials.append(trial)
    projected = [trial for trial in trials if trial["projection_applied"]]
    accepted = [row for row in attempts if row["decision"] == "accept"]
    counts = {
        "trialEvaluations": len(trials), "projectedTrials": len(projected),
        "unprojectedTrials": len(trials) - len(projected),
        "projectedAccepted": sum(row["projection_applied"] for row in accepted),
        "fullScaleAccepted": sum(row["accepted_scale"] == 1 for row in accepted),
        "backtrackedAccepted": sum(row["accepted_scale"] < 1 for row in accepted),
        "exhausted": len(attempts) - len(accepted),
    }
    for key, count in counts.items():
        require(diagnostics[key] == count, "guard diagnostic differs: " + key)
    fractions = [trial["projection_removed_fraction"] for trial in projected]
    for key, calculated in [("maxProjectionRemovedFraction", max(fractions, default=0)),
                            ("meanProjectionRemovedFraction", mean(fractions) if fractions else 0)]:
        require(math.isclose(diagnostics[key], calculated, rel_tol=1e-12, abs_tol=1e-15), "guard projection summary differs")
    return {"attempts": len(attempts), "accepted": len(accepted), "counts": counts,
            "fraction_of_trials_projected": len(projected) / len(trials) if trials else 0,
            "removed_fraction_among_projected": {"mean": mean(fractions) if fractions else None,
                                                  "median": median(fractions) if fractions else None,
                                                  "maximum": max(fractions) if fractions else None},
            "direct_replay_trial_evaluations": sum(len(trial["ranges"]) for trial in trials),
            "counterfactual_unprojected_trial_loss": "requires_a_separate_control"}


def zero4_controls(sources, repository):
    rows = []
    for seed in [1, 2, 3]:
        base = f"benchmarks/zero4-q26{'r' if seed != 2 else ''}-v1/seed{seed}/"
        result = json.loads(sources.git(repository, "atimics/zero-grounded-literary-lm", ZERO, base + "result.json"))
        trace = sources.git(repository, "atimics/zero-grounded-literary-lm", ZERO, base + "optimizer-attempts.jsonl")
        audit = projection_audit([json.loads(row) for row in trace.splitlines()], result["guardDiagnostics"])
        require(result["attempts"] == audit["attempts"] and result["committed"] == audit["accepted"], "result counts differ")
        rows.append({"seed": seed, "historical_decision": result["decision"], **audit})
    return rows


def check_result(path):
    result = json.loads(path.read_bytes())
    require(result["schema"] == "ilxyr.mechanism_controls_audit.v1", "result schema differs")
    for key, source in [("runner_sha256", Path(__file__)),
                        ("dependency_sha256", ROOT / "scripts/research_baselines.py"),
                        ("plan_sha256", ROOT / "experiments/research-step-4/PLAN.md")]:
        require(result[key] == sha(source.read_bytes()), key + " differs")
    for comparison in result["reasoner"]["comparisons"]:
        families = comparison["families"]
        require([row["ordinal"] for row in families] == list(range(128)), "family identity differs")
        for metric, ratio in comparison["paired_ratios"].items():
            require(math.isclose(ratio, geometric_mean([row[metric] for row in families]), rel_tol=1e-12), "family ratio differs")
        require(sum(comparison[key] for key in ["family_check_wins", "family_check_ties", "family_check_losses"]) == 128,
                "family decision count differs")
    for row in result["zero4"]:
        counts = row["counts"]
        require(counts["projectedTrials"] + counts["unprojectedTrials"] == counts["trialEvaluations"], "projection count differs")
        require(row["accepted"] + counts["exhausted"] == row["attempts"], "attempt count differs")
    print("Mechanism audit bindings and arithmetic passed.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zero-repo", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--check-result", type=Path)
    args = parser.parse_args()
    if args.check_result:
        check_result(args.check_result)
        return
    require(args.zero_repo and args.output, "source repository and output are required")
    sources = Sources()
    result = {"schema": "ilxyr.mechanism_controls_audit.v1", "date": "2026-09-05",
              "runner_sha256": sha(Path(__file__).read_bytes()),
              "dependency_sha256": sha((ROOT / "scripts/research_baselines.py").read_bytes()),
              "plan_sha256": sha((ROOT / "experiments/research-step-4/PLAN.md").read_bytes()),
              "reasoner": reasoner_controls(sources, args.zero_repo),
              "zero4": zero4_controls(sources, args.zero_repo), "sources": sources.manifest()}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True, allow_nan=False) + "\n")
    print(json.dumps({"output": str(args.output), "sha256": sha(args.output.read_bytes()),
                      "reasoner": [{key: value for key, value in row.items() if key not in ["cells", "families"]}
                                   for row in result["reasoner"]["comparisons"]], "zero4": result["zero4"]}))


if __name__ == "__main__":
    main()
