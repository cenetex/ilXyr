"""Check train-only suffix probabilities beside the frozen native controls."""

import argparse
from collections import Counter
import csv
from fractions import Fraction
import importlib.util
import json
from pathlib import Path
import subprocess
import time

import research_solomon_answer_ownership as ownership
from feral_process import run_process

CHECKER = "scripts/check-probability-controls.py"
CHECKER_SHA = "e191c0687916ff0b4cb0f501363fb5f8cbb9c2f7e5a8cc78c4cac620cc4462e6"
ARMS = ("suffix_empirical", "suffix_unit_prior")
require, sha, save = ownership.require, ownership.sha, ownership.save


def suffix_counts(memory, context):
    """Use training bytes and context only; count overlapping continuations."""
    require(isinstance(memory, bytes) and bool(memory), "training memory must contain bytes")
    require(isinstance(context, bytes), "context must contain bytes")
    for order in ownership.ORDERS:
        if len(context) < order:
            continue
        suffix = context[-order:]
        counts = Counter(memory[start + order] for start in range(len(memory) - order)
                         if memory[start:start + order] == suffix)
        if counts:
            return [counts[byte] for byte in range(256)], order
    counts = Counter(memory)
    return [counts[byte] for byte in range(256)], 0


def masses(counts, arm):
    require(len(counts) == 256 and all(type(n) is int and n >= 0 for n in counts)
            and sum(counts) > 0, "training counts differ")
    require(arm in ARMS, "probability arm differs")
    # The second arm adds one observation of total prior mass, spread uniformly
    # across 256 bytes. Integer numerators keep the probabilities exact.
    return list(counts) if arm == "suffix_empirical" else [256 * n + 1 for n in counts]


def score(vector, target):
    require(len(vector) == 256 and all(type(n) is int and n >= 0 for n in vector),
            "probability masses differ")
    require(type(target) is int and 0 <= target < 256, "target byte differs")
    total = sum(vector)
    require(total > 0, "probability mass is zero")
    predicted = max(range(256), key=lambda byte: (vector[byte], -byte))
    brier = Fraction(sum(n * n for n in vector) + total * total
                     - 2 * total * vector[target], total * total)
    return {"predicted": predicted, "brier": brier,
            "zero_target_probability": int(vector[target] == 0)}


def compare(tokens, rows, memory):
    require(len(tokens) >= 80 and len(rows) == 48, "known-window coverage differs")
    totals = {arm: {"mistakes": 0, "zeros": 0, "brier": Fraction(0)} for arm in ARMS}
    records = []
    for window in range(16):
        start = (window * (len(tokens) - 65) + 7) // 15
        row = rows[3 * window]
        require(row["arm"] == "native" and int(row["start"]) == start
                and int(row["target"]) == tokens[start + 64], "native window differs")
        context, target = tokens[start:start + 64], tokens[start + 64]
        counts, order = suffix_counts(memory, context)
        expected, expected_order = ownership.suffix_answer(memory, context)
        require(order == expected_order and expected == int(row["predicted"]),
                "answer differs from native suffix selection")
        record = {"start": start, "target": target, "predicted": expected,
                  "suffix_order": order, "training_matches": sum(counts),
                  "counts": counts, "arms": {}}
        for arm in ARMS:
            measured = score(masses(counts, arm), target)
            require(measured["predicted"] == expected, "count probabilities changed the answer")
            totals[arm]["mistakes"] += int(expected != target)
            totals[arm]["zeros"] += measured["zero_target_probability"]
            totals[arm]["brier"] += measured["brier"]
            record["arms"][arm] = {"normalized_brier": str(measured["brier"]),
                                   "zero_target_probability": measured["zero_target_probability"]}
        records.append(record)
    for value in totals.values():
        value["normalized_brier_mean"] = str(value.pop("brier") / 16)
    return records, totals


def smoke(repo, output):
    output.mkdir(parents=True, exist_ok=False)
    terminal = {"schema": "ilxyr.solomon_suffix_probability_attempt.v1", "status": "failed",
                "phase": "source", "performance_evidence": False}
    save(output / "attempt.json", terminal)
    try:
        source = output / "source"
        bindings = ownership.materialize_sources(repo, source)
        checker = subprocess.check_output(["git", "-C", str(repo), "show", ownership.REVISION + ":" + CHECKER])
        require(sha(checker) == CHECKER_SHA, "frozen probability checker differs")
        path = source / CHECKER
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(checker)
        bindings[CHECKER] = {"sha256": sha(checker), "bytes": len(checker)}
        save(output / "SOURCE-IDENTITY.json", {"source_commit": ownership.REVISION, "files": bindings})
        memory = ownership.memory_bytes((source / ownership.MODEL).read_bytes(),
                                        (source / (ownership.BASE + "train.txt")).read_bytes())
        terminal["phase"] = "build"
        for name, command, seconds in [
            ("compiler", ["rustc", "-Vv"], 15),
            ("build", ["cargo", "build", "--release", "--locked", "--offline", "-p", "nsrl-train",
                       "--bin", "nsrl-mini-transformer-eval", "--features", "mini-heads-8,mini-calibrated"], 180),
        ]:
            receipt = run_process(command, source, output / (name + "-process"), time.monotonic() + seconds, 2)
            require(receipt["status"] == "complete", name + " failed; inspect retained process")
        binary = source / "target/release/nsrl-mini-transformer-eval"
        tokens_path = source / (ownership.BASE + "eval.txt")
        terminal["phase"] = "native"
        command = [str(binary), "--model", str(source / ownership.MODEL), "--tokens", str(tokens_path),
                   "--attention", "linear", "--position", "nope", "--max-windows", "16",
                   "--out", str(output / "eval.json"), "--probability-controls-out", str(output / "controls.tsv")]
        receipt = run_process(command, source, output / "native-process", time.monotonic() + 60, 2)
        require(receipt["status"] == "complete", "native evaluation failed; inspect retained process")
        terminal["phase"] = "score"
        rows = list(csv.DictReader((output / "controls.tsv").read_text().splitlines(), delimiter="\t"))
        tokens = tokens_path.read_bytes()
        spec = importlib.util.spec_from_file_location("frozen_probability_checker", path)
        native_checker = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(native_checker)
        native = native_checker.check_rows(rows, tokens, json.loads((output / "eval.json").read_bytes()))
        records, counts = compare(tokens, rows, memory)
        save(output / "COUNTS.json", records)
        result = {"schema": "ilxyr.solomon_suffix_probabilities.v1",
                  "scope": "sixteen_opened_windows_engineering_smoke", "performance_evidence": False,
                  "promotion_evidence": False, "source_commit": ownership.REVISION,
                  "source_bindings": bindings, "memory_bytes": len(memory), "memory_sha256": sha(memory),
                  "binary_sha256": sha(binary.read_bytes()),
                  "compiler_identity": (output / "compiler-process/stdout.log").read_text().strip(),
                  "definitions": {"suffix_empirical": "count / total_matches",
                                  "suffix_unit_prior": "(256 * count + 1) / (256 * total_matches + 256)",
                                  "prior_total_mass": 1, "vocabulary": 256,
                                  "tie_rule": "lowest byte", "fallback": "all stored training bytes"},
                  "windows": 16, "native_forward_calls": 32, "scores": {**native, **counts},
                  "outputs": {name: sha((output / name).read_bytes())
                              for name in ["eval.json", "controls.tsv", "COUNTS.json", "native-process/process.json"]}}
        save(output / "RESULT.json", result)
        terminal.update(status="complete", phase="complete", result_sha256=sha((output / "RESULT.json").read_bytes()))
        return result
    except BaseException as error:
        terminal["error"] = str(error)
        raise
    finally:
        save(output / "attempt.json", terminal)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--nsrl-repo", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    result = smoke(args.nsrl_repo.resolve(), args.out.resolve())
    print(json.dumps({arm: {"mistakes": value["mistakes"], "zeros": value["zeros"],
                           "brier": float(Fraction(value["normalized_brier_mean"]))}
                      for arm, value in result["scores"].items()}))
