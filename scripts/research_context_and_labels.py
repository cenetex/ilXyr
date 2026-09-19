"""Audit a fixed context-free artifact and replay missing public gold labels."""

import argparse
from collections import Counter
from fractions import Fraction
from functools import lru_cache
import json
from pathlib import Path
import re
import struct

from research_baselines import FERAL, NSRL, ROOT, Sources, require, sha, unique_rows

FINQA_REVISION = "0f16e2867befa6840783e58be38c9efb9229d742"
FINQA_SHA256 = "831dbfb2e785dbc227f895ce3f24046433467aec67b09db2bd6ac7692a8a30dc"
MODEL_SHA256 = "89260e3cae329677e132eef4439d784c6290e8e46b8779c3667da8d157bf7259"


@lru_cache(maxsize=65536)
def log2_q20(value):
    require(isinstance(value, int) and value > 0, "integer logarithm needs a positive count")
    integer = value.bit_length() - 1
    normalized = value << (63 - integer)
    fraction = 0
    for bit in reversed(range(20)):
        normalized = normalized * normalized >> 63
        if normalized >= 1 << 64:
            normalized >>= 1
            fraction |= 1 << bit
    return (integer << 20) | fraction


def score_row(logits, table):
    require(len(logits) == 256 and len(table) == 256, "byte distributions need 256 values")
    maximum = max(logits)
    masses = []
    for logit in logits:
        magnitude = maximum - logit
        shift, fraction = divmod(magnitude, 256)
        masses.append(table[fraction] >> shift if shift < 15 else 0)
    denominator = log2_q20(sum(masses))
    losses = [((denominator - log2_q20(mass)) * 1000 + (1 << 19)) >> 20
              if mass else 32000 for mass in masses]
    return max(range(256), key=lambda x: logits[x]), losses


def constant_model_logits(data):
    require(len(data) >= 172 and data[:8] == b"NSRLMT5\n", "expected a complete NSRLMT5 artifact")
    vocab, width, heads, hidden, context = struct.unpack_from("<5I", data, 8)
    require(vocab == 256 and width > 0 and heads > 0 and hidden > 0 and context > 0,
            "invalid model shape")
    counts = struct.unpack_from("<10Q", data, 28)
    require(counts[0] == vocab * width and counts[1] == context * width and counts[9] == vocab * width,
            "embedding or output shape differs")
    expected_length = 172 + 2 * sum(counts[:2]) + sum(counts[2:])
    require(len(data) == expected_length, "expected the artifact with empty normalization arrays")
    offset = 172
    embeddings = struct.unpack_from(f"<{counts[0]}h", data, offset)
    offset += counts[0] * 2
    require(all(value == (32767 if index % width == 0 else 0)
                for index, value in enumerate(embeddings)), "embeddings contain token-dependent state")
    zero_end = offset + counts[1] * 2 + sum(counts[2:9])
    require(all(value == 0 for value in data[offset:zero_end]), "position or context weights carry signal")
    output = struct.unpack_from(f"<{counts[9]}b", data, zero_end)
    require(all(value == 0 for index, value in enumerate(output) if index % width),
            "output uses another feature")
    logits = [max(-32768, min(32767, (32767 * output[x * width] + 128) >> 8)) for x in range(256)]
    return logits, {"vocabulary": vocab, "width": width, "heads": heads,
                    "hidden": hidden, "context": context,
                    "constant_embeddings_verified": True,
                    "zero_context_weights_verified": True,
                    "context_independent_for_every_input": True}


def count_logits(counts):
    return [(log2_q20(counts[x] + 1) + (1 << 11)) >> 12 for x in range(256)]


def context_scores(train, evaluation, context, table, model_logits):
    require(context > 0 and len(train) > context and len(evaluation) > context, "missing target bytes")
    unigram = Counter(train[context:])
    bigram = [Counter() for _ in range(256)]
    for index in range(context, len(train)):
        bigram[train[index - 1]][train[index]] += 1
    models = {
        "historical_candidate": [score_row(model_logits, table)] * 256,
        "smoothed_unigram": [score_row(count_logits(unigram), table)] * 256,
        "smoothed_bigram": [score_row(count_logits(row), table) for row in bigram],
    }
    targets = evaluation[context:]
    previous = evaluation[context - 1:-1]
    swapped = previous[::-1]
    require(len(previous) == len(targets), "context alignment differs")
    result = {}
    for name, rows in models.items():
        ordinary = [rows[before] for before in previous]
        control = [rows[before] for before in swapped]
        normal_loss = sum(row[1][target] for row, target in zip(ordinary, targets))
        control_loss = sum(row[1][target] for row, target in zip(control, targets))
        result[name] = {
            "targets": len(targets),
            "correct": sum(row[0] == target for row, target in zip(ordinary, targets)),
            "canonical_integer_nll_millibits": normal_loss,
            "reversed_context_nll_millibits": control_loss,
            "reversed_context_correct": sum(row[0] == target for row, target in zip(control, targets)),
            "changed_top_one_predictions": sum(a[0] != b[0] for a, b in zip(ordinary, control)),
            "distinct_context_distributions": len({tuple(row[1]) for row in rows}),
        }
    return result


def execute_gold_program(program):
    """Run only the four arithmetic operations needed by the missing labels."""
    parts = re.findall(r"([a-z_]+)\(([^()]*)\)", program)
    compact = re.sub(r"\s+", "", program)
    parsed = ",".join(op + "(" + re.sub(r"\s+", "", args) + ")" for op, args in parts)
    require(parsed == compact,
            "program contains unsupported syntax")
    require(bool(parts), "program needs an operation")
    results = []
    for op, args in parts:
        require(op in {"add", "subtract", "multiply", "divide"}, "unsupported operation")
        values = []
        for argument in args.split(","):
            argument = argument.strip()
            if re.fullmatch(r"#[0-9]+", argument):
                index = int(argument[1:])
                require(index < len(results), "program references a future result")
                values.append(results[index])
            else:
                argument = argument.removeprefix("const_")
                require(re.fullmatch(r"-?[0-9]+(?:\.[0-9]+)?", argument), "unsupported numeric literal")
                values.append(Fraction(argument))
        require(len(values) == 2, "operation needs two arguments")
        left, right = values
        if op == "add": result = left + right
        elif op == "subtract": result = left - right
        elif op == "multiply": result = left * right
        else:
            require(right != 0, "zero divisor")
            result = left / right
        results.append(result)
    return results[-1]


def missing_labels(inputs, original):
    inputs = unique_rows(inputs)
    by_id = {}
    for row in original:
        require(row["id"] not in by_id, "duplicate original ID")
        by_id[row["id"]] = row
    require(inputs.keys() == by_id.keys(), "original and exported IDs differ")
    result = []
    for key, row in sorted(inputs.items()):
        require(row["answer"] == by_id[key]["qa"]["answer"], "exported answer differs from original")
        if str(row["answer"]).strip():
            continue
        qa = by_id[key]["qa"]
        exact = execute_gold_program(qa["program"])
        expected = Fraction(str(qa["exe_ans"]))
        difference = abs(exact - expected)
        result.append({"id": key, "text_answer": row["answer"],
                       "source_execution_answer": qa["exe_ans"], "gold_program": qa["program"],
                       "replayed_rational": str(exact), "absolute_difference": str(difference),
                       "agrees_at_source_precision": difference <= Fraction(1, 200000),
                       "proposed_target_kind": "numeric_execution_value",
                       "next_version_unit_rule": "use execution units; bind any percent conversion explicitly"})
    return result


def check_result(path):
    result = json.loads(path.read_bytes())
    require(result["schema"] == "ilxyr.context_and_label_audit.v1", "unexpected result schema")
    for key, source in [
        ("plan_sha256", ROOT / "experiments/research-step-2/PLAN.md"),
        ("runner_sha256", Path(__file__)),
        ("dependency_sha256", ROOT / "scripts/research_baselines.py"),
    ]:
        require(result[key] == sha(source.read_bytes()), key + " differs")
    for source in result["sources"]:
        require(re.fullmatch(r"[0-9a-f]{40}", source["revision"]), "source revision is incomplete")
        require(re.fullmatch(r"[0-9a-f]{64}", source["sha256"]), "source digest is incomplete")
        require(source["bytes"] > 0, "source bytes are missing")
    scores = result["solomon"]["same_objective_scores"]
    baseline = json.loads((ROOT / "experiments/research-step-1/RESULT.json").read_bytes())
    labels = result["feral"]["missing_labels"]
    require(len({row["id"] for row in labels}) == len(labels), "duplicate repair ID")
    for row in labels:
        exact = execute_gold_program(row["gold_program"])
        difference = abs(exact - Fraction(str(row["source_execution_answer"])))
        require(str(exact) == row["replayed_rational"] and str(difference) == row["absolute_difference"],
                "gold replay differs")
        require(row["agrees_at_source_precision"] == (difference <= Fraction(1, 200000)),
                "gold agreement differs")
    require(result["feral"]["labels_with_program_agreement"] == sum(row["agrees_at_source_precision"] for row in labels),
            "gold agreement count differs")
    require(result["feral"]["original_score_retained"] is True, "historical score marker differs")
    require(len(labels) == baseline["projects"]["feral"]["counts"]["empty_gold"], "repair count differs from step 1")
    for row in scores.values():
        require(row["targets"] == 5896 and 0 <= row["correct"] <= row["targets"], "target counts differ")
    for name in ["historical_candidate", "smoothed_unigram"]:
        row = scores[name]
        require(row["canonical_integer_nll_millibits"] == row["reversed_context_nll_millibits"]
                and row["changed_top_one_predictions"] == 0 and row["distinct_context_distributions"] == 1,
                "constant distribution changed with context")
    require(scores["historical_candidate"]["canonical_integer_nll_millibits"] == 25347655,
            "historical integer likelihood differs")
    print(json.dumps({"verified": str(path), "sha256": sha(path.read_bytes())}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--nsrl-repo", type=Path)
    parser.add_argument("--feral-repo", type=Path)
    parser.add_argument("--finqa-original", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--check-result", type=Path)
    args = parser.parse_args()
    if args.check_result:
        check_result(args.check_result)
        return
    require(all([args.nsrl_repo, args.feral_repo, args.finqa_original, args.output]),
            "generation requires both repositories, the original FinQA file, and an output path")
    sources = Sources()
    def nsrl(path, expected=None):
        return sources.git(args.nsrl_repo, "atimics/nsrl", NSRL, path, expected)
    base = "benchmarks/integer-transformer-proof-v1/"
    model, shape = constant_model_logits(nsrl(base + "successor-v2-candidate.nsrlmt", MODEL_SHA256))
    table_source = nsrl("crates/nsrl-core/src/rsqrt_lut_8bit.rs").decode()
    match = re.search(r"EXP2_NEG_FRAC_LUT_8BIT:.*?=\s*\[([^]]+)\]", table_source, re.S)
    require(match is not None, "exponent table is missing")
    table = [int(x) for x in re.findall(r"\d+", match.group(1))]
    nsrl("crates/nsrl-core/src/attention.rs")
    nsrl("crates/nsrl-core/src/numeric.rs")
    nsrl("crates/nsrl-train/src/mini_transformer/model.rs")
    train, evaluation = nsrl(base + "train.txt"), nsrl(base + "eval.txt")
    require(len(train) - shape["context"] == 9324 and len(evaluation) - shape["context"] == 5896,
            "frozen training or evaluation target count differs")
    scores = context_scores(train, evaluation, shape["context"], table, model)
    original_metrics = json.loads(nsrl(base + "successor-v2-evidence.json"))
    original_candidate = next(row for row in original_metrics["systems"] if row["system"] == "transformer-only")
    require(scores["historical_candidate"]["canonical_integer_nll_millibits"] == original_candidate["total_nll_millibits"],
            "historical likelihood replay differs")
    require(scores["historical_candidate"]["correct"] == original_candidate["targets"] - original_candidate["mistakes"],
            "historical top-one replay differs")
    original_bytes = args.finqa_original.read_bytes()
    require(sha(original_bytes) == FINQA_SHA256, "original FinQA bytes differ")
    inputs = sources.git(args.feral_repo, "atimics/runner-watch", FERAL,
                         "artifacts/feral-7b-sec-v2/evaluation/finqa-retrieved.jsonl",
                         "b295064693c44f81685018f79d59570e81382fc447c188b2cb3438b9f19f45d4")
    labels = missing_labels([json.loads(row) for row in inputs.splitlines()], json.loads(original_bytes))
    result = {"schema": "ilxyr.context_and_label_audit.v1", "date": "2026-09-05",
              "evidence_kind": "posthoc_diagnostic_on_existing_public_data",
              "plan_sha256": sha((ROOT / "experiments/research-step-2/PLAN.md").read_bytes()),
              "runner_sha256": sha(Path(__file__).read_bytes()),
              "dependency_sha256": sha((ROOT / "scripts/research_baselines.py").read_bytes()),
              "solomon": {"artifact_structure": shape, "training_targets": 9324,
                          "context_prefix": shape["context"], "same_objective_scores": scores},
              "feral": {"missing_labels": labels, "labels_with_program_agreement": sum(x["agrees_at_source_precision"] for x in labels),
                        "original_score_retained": True, "gold_program_access": "label audit only"},
              "sources": sources.manifest() + [{"repository": "czyssrs/FinQA", "revision": FINQA_REVISION,
                                               "path": "dataset/test.json", "sha256": FINQA_SHA256,
                                               "bytes": len(original_bytes)}]}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True, allow_nan=False) + "\n")
    print(json.dumps({"output": str(args.output), "sha256": sha(args.output.read_bytes()),
                      "solomon": scores, "label_agreements": result["feral"]["labels_with_program_agreement"]}))


if __name__ == "__main__":
    main()
