"""Recalculate small diagnostics from fixed public research records."""

import argparse
from collections import Counter
from decimal import Decimal, InvalidOperation
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
ZERO = "9e147326c9cd1e6dcc26591ff5d73e16bff9e17e"
NSRL = "90ba65361efed6ba39019de2302a9e5b0c46f108"
FERAL = "c78d953ab64ba5e295b44bc0e13c9015223a32d2"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


class Sources:
    def __init__(self):
        self.records = {}

    def git(self, repo, name, revision, path, expected=None):
        data = subprocess.check_output(
            ["git", "-C", str(repo), "show", f"{revision}:{path}"]
        )
        digest = sha(data)
        require(expected is None or digest == expected, f"digest mismatch: {path}")
        self.records[(name, revision, path)] = {
            "repository": name, "revision": revision, "path": path,
            "sha256": digest, "bytes": len(data),
        }
        return data

    def local(self, path):
        data = (ROOT / path).read_bytes()
        self.records[("ilxyr", "working-tree", path)] = {
            "repository": "ilxyr", "path": path,
            "sha256": sha(data), "bytes": len(data),
        }
        return json.loads(data)

    def manifest(self):
        return [self.records[key] for key in sorted(self.records)]


def geometric_mean(values):
    require(bool(values) and all(math.isfinite(x) and x > 0 for x in values),
            "ratios must be positive finite numbers")
    return math.exp(math.fsum(math.log(x) for x in values) / len(values))


def unigram_metrics(train, evaluation, context=64, alpha=1):
    require(context >= 0 and len(train) > context and len(evaluation) > context,
            "both splits need targets after the context")
    require(alpha > 0 and math.isfinite(alpha), "smoothing must be positive")
    counts = Counter(train[context:])
    mass = len(train) - context + 256 * alpha
    probabilities = [(counts[x] + alpha) / mass for x in range(256)]
    prediction = max(range(256), key=lambda x: probabilities[x])
    targets = evaluation[context:]
    correct = targets.count(prediction)
    return {
        "training_targets": len(train) - context, "evaluation_targets": len(targets),
        "alpha": alpha, "predicted_byte": prediction,
        "correct": correct, "accuracy": correct / len(targets),
        "float_bits_per_target": math.fsum(-math.log2(probabilities[x]) for x in targets) / len(targets),
        "probability_sum": math.fsum(probabilities),
        "context_dependence": "constant distribution at every position",
    }


def normalize_answer(value):
    # This is the frozen published scorer, including its percent convention.
    text = str(value).strip().lower().replace(",", "").replace("$", "")
    if text.endswith("%"):
        text = text[:-1]
    try:
        return format(Decimal(text).normalize(), "f")
    except InvalidOperation:
        return " ".join(text.split())


def numeric(value):
    try:
        return Decimal(normalize_answer(value)).is_finite()
    except InvalidOperation:
        return False


def unique_rows(rows):
    result = {}
    for row in rows:
        require(isinstance(row.get("id"), str) and row["id"], "row needs an ID")
        require(row["id"] not in result, f"duplicate ID: {row['id']}")
        require("answer" in row, f"missing gold answer: {row['id']}")
        result[row["id"]] = row
    return result


def finqa_diagnostic(inputs, predictions):
    inputs, predictions = unique_rows(inputs), unique_rows(predictions)
    require(inputs and inputs.keys() == predictions.keys(), "input/prediction IDs differ")
    counts, issuer_counts = Counter(), {}
    for key, source in inputs.items():
        row = predictions[key]
        require("prediction" in row, f"missing prediction: {key}")
        require(row["answer"] == source["answer"], f"gold answer drift: {key}")
        gold, predicted = source["answer"], row["prediction"]
        match = normalize_answer(gold) == normalize_answer(predicted)
        counts["frozen_score_correct"] += int(match)
        if gold is None or str(gold).strip() == "":
            category = "empty_gold"
        elif match:
            category = "correct_with_gold"
        elif normalize_answer(gold) in {"yes", "no"}:
            category = "boolean_error"
        elif numeric(gold) and numeric(predicted):
            category = "numeric_disagreement"
        elif numeric(gold):
            category = "numeric_gold_with_non_numeric_output"
        else:
            category = "other_answer_error"
        counts[category] += 1
        issuer = key.split("/", 1)[0]
        issuer_counts.setdefault(issuer, Counter())["examples"] += 1
        issuer_counts[issuer]["correct"] += int(match)
    n = len(inputs)
    valid = n - counts["empty_gold"]
    return {
        "examples": n, "frozen_score_accuracy": counts["frozen_score_correct"] / n,
        "counts": dict(sorted(counts.items())), "valid_gold_examples": valid,
        "valid_gold_accuracy_diagnostic": counts["correct_with_gold"] / valid if valid else None,
        "issuer_groups": len(issuer_counts),
        "largest_issuer_group": max(x["examples"] for x in issuer_counts.values()),
        "grouped_comparison_unit": "issuer; retain all questions within each sampled issuer",
        "confidence_and_citation_support": "additional prediction fields required",
    }


def reasoner(sources, repo):
    def read(path):
        return json.loads(sources.git(repo, "atimics/zero-grounded-literary-lm", ZERO, path))
    series = read("benchmarks/reasoner5-first-five-v1/series.json")
    base = "benchmarks/reasoner55-fast-search-v1/"
    analysis = read(base + "ANALYSIS.json")
    results = sources.git(repo, "atimics/zero-grounded-literary-lm", ZERO,
                          base + "RESULTS.json", analysis["result_sha256"])
    sources.git(repo, "atimics/zero-grounded-literary-lm", ZERO,
                base + "TIMING.json", analysis["timing_sha256"])
    comparisons = []
    for row in analysis["comparisons"]:
        families = row["families"]
        require(len(families) == 128 and len({x["ordinal"] for x in families}) == 128,
                "expected 128 unique paired families")
        require(Counter(x["cell"] for x in families) == Counter({0: 32, 1: 32, 2: 32, 3: 32}),
                "family cells differ from the balanced design")
        recalculated = {}
        for metric in ["cpu", "wall", "checks"]:
            ratio = geometric_mean([x[metric] for x in families])
            require(math.isclose(ratio, row["paired"][metric]["ratio"], abs_tol=1e-10),
                    f"paired arithmetic differs: {row['condition']} {metric}")
            recalculated[metric] = ratio
        comparisons.append({"condition": row["condition"], "reference": row["reference"],
                            "recalculated_ratios": recalculated})
    development = read("benchmarks/reasoner56-passive-noise-development-v1/development/assessment.json")
    return {
        "evidence_kind": "external_public_arithmetic_audit",
        "first_five": series["experiments"],
        "fast_search": {"engineering_check": analysis["engineering_check"],
                        "evidence": json.loads(results)["evidence"], "comparisons": comparisons},
        "passive_noise_development": {
            "status": development["status"],
            "search_decision": development["harness_gate"]["decision"],
            "search_failures": development["harness_gate"]["failures"],
            "channel_failures": development["channel_readiness"]["failures"],
            "scientific_decision": development["scientific_decision"],
        },
        "next_step": "Freeze a fresh-family test of the improved guide against equally optimized target-only search and lexical-role controls.",
    }


def solomon(sources, repo):
    evidence = sources.local("docs/experiments/solomon-successor-v2-public-evidence.json")
    source = evidence["source"]
    require(source["commit"] == NSRL, "historical Solomon reference changed")
    objects = {}
    for artifact in source["artifacts"]:
        objects[artifact["path"]] = sources.git(repo, "atimics/nsrl", NSRL,
                                               artifact["path"], artifact["sha256"])
    base = "benchmarks/integer-transformer-proof-v1/"
    train = sources.git(repo, "atimics/nsrl", NSRL, base + "train.txt")
    evaluation = sources.git(repo, "atimics/nsrl", NSRL, base + "eval.txt")
    sources.git(repo, "atimics/nsrl", NSRL, "crates/nsrl-train/src/bin/nsrl-successor-train.rs")
    manifest = objects[base + "successor-v2-manifest.tsv"].decode().splitlines()
    fields = dict(zip(manifest[0].split("\t"), manifest[1].split("\t")))
    baseline = unigram_metrics(train, evaluation, int(fields["context"]))
    require(baseline["evaluation_targets"] == int(fields["targets"]), "target count differs")
    recorded = json.loads(objects[base + "successor-v2-evidence.json"])
    systems = [{"system": x["system"], "targets": x["targets"], "mistakes": x["mistakes"],
                "accuracy": (x["targets"] - x["mistakes"]) / x["targets"],
                "canonical_integer_nll_millibits": x["total_nll_millibits"]}
               for x in recorded["systems"]]
    return {
        "evidence_kind": "posthoc_public_baseline_diagnostic",
        "smoothed_unigram": baseline, "recorded_systems": systems,
        "inspection_finding": "The pinned trainer fits byte counts and installs constant embeddings with zero attention and feed-forward weights.",
        "metric_boundary": "The new baseline uses floating-point log loss; recorded systems retain their original integer objective.",
        "next_step": "Evaluate a context-sensitive learner, the smoothed unigram, and a smoothed bigram through the same objective; include matched-context swaps.",
    }


def zero4(sources, repo):
    records = []
    for filename in ["exp-004-evidence.json", "exp-005-evidence.json"]:
        evidence = sources.local("docs/experiments/" + filename)
        source = evidence["source"]
        for artifact in source["artifacts"]:
            data = sources.git(repo, "atimics/zero-grounded-literary-lm", source["result_commit"],
                               artifact["path"], artifact["sha256"])
            if artifact["path"].endswith("/result.json"):
                result = json.loads(data)
                records.append({"seed": result["seed"], "decision": result["decision"],
                                "attempts": result["attempts"], "committed": result["committed"],
                                "guard_budget": result["guardBudget"],
                                "guard_diagnostics": result["guardDiagnostics"],
                                "selected": result["selected"], "promotion": result["promotion"]})
    require(sorted(x["seed"] for x in records) == [1, 2, 3], "three unique seeds required")
    return {"evidence_kind": "external_public_artifact_verification",
            "seeds": sorted(records, key=lambda x: x["seed"]),
            "next_step": "Freeze a matched comparison of replay, projection, direct functional checks, and joint optimizer rollback on fresh task families."}


def feral(sources, repo):
    base = "artifacts/feral-7b-sec-v2/evaluation/"
    def read(path, expected=None):
        return sources.git(repo, "atimics/runner-watch", FERAL, base + path, expected)
    record = json.loads(read("finqa-baseline.json"))
    inputs = [json.loads(x) for x in read("finqa-retrieved.jsonl", record["dataset"]["sha256"]).splitlines()]
    predictions = [json.loads(x) for x in read("baseline-finqa-retrieved.jsonl", record["evaluation"]["predictions_sha256"]).splitlines()]
    sources.git(repo, "atimics/runner-watch", FERAL, "ml/sec-qwen/src/sec_qwen/benchmarks.py")
    result = finqa_diagnostic(inputs, predictions)
    require(result["examples"] == record["dataset"]["examples"], "FinQA count differs")
    require(math.isclose(result["frozen_score_accuracy"], record["evaluation"]["metrics"]["finqa_accuracy"], abs_tol=1e-14),
            "frozen FinQA score differs")
    return {"evidence_kind": "posthoc_public_error_diagnostic", **result,
            "next_step": "Review empty gold labels, freeze answer-format and retrieval-plus-calculator controls, and require citation and confidence fields for the next development comparison."}


def weight_multiplicity(sources):
    closeout = sources.local("experiments/weight-multiplicity/phase1/phase1-tail-calibration-run-20260901015649-closeout-v1.json")
    plan = sources.local("examples/weight-multiplicity/phase1-corpus-plan-v1.json")
    require(sha((ROOT / "examples/weight-multiplicity/phase1-corpus-plan-v1.json").read_bytes()) == closeout["source_bindings"]["phase1_corpus_plan_sha256"], "corpus plan binding differs")
    measurement, scale = closeout["measurement"], closeout["scale"]
    limit = math.ceil(measurement["p99_ms"] * 1.25)
    require(limit == measurement["proposed_generation_p99_limit_ms"], "p99 derivation differs")
    require(measurement["calls"] == scale["calibration_calls"], "calibration count differs")
    tail = closeout["tail"]
    require(tail["inside_0_31"]["calls"] + tail["outside_above_31"]["calls"] == measurement["calls"], "tail partition differs")
    ratios = {name: scale[key] / measurement["calls"] for name, key in [
        ("expected", "projected_expected_generation_calls"),
        ("upper_95", "projected_upper_95_generation_calls"),
        ("binding", "projected_binding_call_limit")
    ]}
    return {
        "evidence_kind": "recorded_calibration_arithmetic_audit", "status": closeout["status"],
        "operational_status": closeout["operational_status"],
        "calls": measurement["calls"], "p99_ms": measurement["p99_ms"],
        "derived_generation_p99_limit_ms": limit, "generation_to_calibration_ratios": ratios,
        "above_label_range_fraction": tail["outside_above_31"]["calls"] / measurement["calls"],
        "top_50_all_outside_corpus_label_range": tail["top_50_all_outside_corpus_label_range"],
        "budget": closeout["budget"], "closures": closeout["closures"],
        "plan_status_at_original_authorization": plan["status"],
        "next_step": "Review the measured 50 ms resource clause and prepare a fresh package for the unchanged corpus distribution.",
    }


def check_result(result):
    require(result["plan_sha256"] == sha((ROOT / "experiments/research-step-1/PLAN.md").read_bytes()),
            "audit plan changed")
    require(result["runner_sha256"] == sha(Path(__file__).read_bytes()), "audit runner changed")
    require(set(result["projects"]) == {"reasoner", "solomon", "zero4", "feral", "weight_multiplicity"},
            "audit project set differs")
    keys = []
    for source in result["sources"]:
        require(re.fullmatch(r"[0-9a-f]{64}", source["sha256"]), "invalid source digest")
        keys.append((source["repository"], source.get("revision"), source["path"]))
        if source["repository"] == "ilxyr":
            require(sha((ROOT / source["path"]).read_bytes()) == source["sha256"],
                    f"local source changed: {source['path']}")
        else:
            require(re.fullmatch(r"[0-9a-f]{40}", source["revision"]), "source needs a full revision")
    require(len(keys) == len(set(keys)), "duplicate source object")
    projects = result["projects"]
    feral_result = projects["feral"]
    counts = feral_result["counts"]
    categories = ["empty_gold", "correct_with_gold", "boolean_error", "numeric_disagreement",
                  "numeric_gold_with_non_numeric_output", "other_answer_error"]
    require(sum(counts.get(key, 0) for key in categories) == feral_result["examples"],
            "FinQA error partition differs")
    require(feral_result["valid_gold_examples"] == feral_result["examples"] - counts["empty_gold"],
            "FinQA denominator differs")
    require(feral_result["frozen_score_accuracy"] == counts["frozen_score_correct"] / feral_result["examples"],
            "FinQA score arithmetic differs")
    require(sorted(x["seed"] for x in projects["zero4"]["seeds"]) == [1, 2, 3], "seed set differs")
    weight = projects["weight_multiplicity"]
    require(weight["derived_generation_p99_limit_ms"] == math.ceil(weight["p99_ms"] * 1.25),
            "resource threshold differs")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["zero", "nsrl", "feral"]:
        parser.add_argument(f"--{name}-repo", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--check-result", type=Path)
    args = parser.parse_args()
    if args.check_result:
        check_result(json.loads(args.check_result.read_bytes()))
        print("Research result bindings and arithmetic passed.")
        return
    require(all([args.zero_repo, args.nsrl_repo, args.feral_repo, args.output]),
            "provide all three source repositories and an output path")
    sources = Sources()
    result = {"schema": "ilxyr.research_baseline_audit.v1", "date": "2026-09-05",
              "plan_sha256": sha((ROOT / "experiments/research-step-1/PLAN.md").read_bytes()),
              "runner_sha256": sha(Path(__file__).read_bytes()),
              "scope": "arithmetic and diagnostics on existing public records",
              "projects": {
                  "reasoner": reasoner(sources, args.zero_repo),
                  "solomon": solomon(sources, args.nsrl_repo),
                  "zero4": zero4(sources, args.zero_repo),
                  "feral": feral(sources, args.feral_repo),
                  "weight_multiplicity": weight_multiplicity(sources),
              }, "sources": sources.manifest()}
    check_result(result)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True, allow_nan=False) + "\n")
    print(json.dumps({"output": str(args.output), "sha256": sha(args.output.read_bytes()),
                      "projects": list(result["projects"]), "source_objects": len(result["sources"])}))


if __name__ == "__main__":
    main()
