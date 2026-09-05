"""Audit suffix memory's control of the frozen candidate's chosen byte."""

import argparse
from collections import Counter
import csv
import hashlib
import json
from pathlib import Path, PurePosixPath
import struct
import subprocess
import time

from feral_process import run_process

REVISION = "96321943e1da7b67bf6c9b4954ff14e6057ac433"
MODEL = "data/experiments/integer-transformer-proof-v1/candidate-default/candidate.nsrlmt"
MODEL_SHA = "37acae6a4f763182730c76f762c351eda5bb37d6d197358c252733b1f08dca10"
BASE = "benchmarks/integer-transformer-proof-v1/"
ORDERS = (16, 8, 4, 3, 2, 1)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(blob):
    return hashlib.sha256(blob).hexdigest()


def save(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n")


def memory_bytes(model, training):
    require(sha(model) == MODEL_SHA, "candidate digest differs")
    require(model[:8] == b"NSRLMT5\n", "model format differs")
    require(struct.unpack_from("<5I", model, 8) == (256, 128, 8, 256, 64),
            "model geometry differs")
    counts = struct.unpack_from("<10Q", model, 28)
    header = 8 + 5 * 4 + 10 * 8 + 8 * 8
    require(len(model) == header + 2 * sum(counts[:2]) + sum(counts[2:]),
            "model byte roster differs")
    offset = header + 2 * counts[0]
    packed = model[offset:offset + 2 * counts[1]]
    require(packed[:8] == b"NSRLSM1\0", "suffix memory marker differs")
    size = struct.unpack_from("<I", packed, 8)[0]
    require(0 < size <= len(packed) - 16, "suffix memory length differs")
    memory = packed[16:16 + size]
    require(memory == training[:size], "stored memory differs from training prefix")
    return memory


def suffix_answer(memory, context):
    """Count byte continuations independently from the packed Rust reader."""
    require(bool(memory), "suffix memory must contain bytes")
    for order in ORDERS:
        if len(context) < order:
            continue
        suffix = context[-order:]
        counts = Counter(memory[start + order] for start in range(len(memory) - order)
                         if memory[start:start + order] == suffix)
        if counts:
            return min(counts, key=lambda byte: (-counts[byte], byte)), order
    counts = Counter(memory)
    return min(counts, key=lambda byte: (-counts[byte], byte)), 0


def probe_inputs(memory):
    require(255 not in memory and len(memory) > 16, "fixture needs an absent padding byte")
    records = []
    for order in (*ORDERS, 0):
        context = bytes([255]) * (64 - order) + memory[:order]
        predicted, actual_order = suffix_answer(memory, context)
        require(actual_order == order, "fixture suffix order differs")
        # Opposite target bytes test that answer selection reads the context.
        for target in (0, 255):
            records.append({"context": context, "target": target,
                            "expected_prediction": predicted, "suffix_order": order})
    return records


def check_native(tokens, starts, rows, logits_blob, trace, memory):
    require(trace["model"] == {"hash": "0x6ffd37de48a3121b", "seq_len": 64,
                              "d_model": 128, "heads": 8, "hidden_dim": 256,
                              "attention_kind": "linear", "position": "nope"},
            "native model or forward mode differs")
    require(trace["data"]["token_count"] == len(tokens), "native token count differs")
    require(len(rows) == len(starts), "native row count differs")
    require(len(logits_blob) == len(starts) * 256 * 4, "native logits roster differs")
    require(trace["data"]["windows"] == len(starts)
            and trace["evaluation"]["invalid_forward_count"] == 0,
            "native coverage differs")
    checked = []
    for index, (start, row) in enumerate(zip(starts, rows)):
        require(int(row["start"]) == start and int(row["end"]) == start + 64,
                "native window identity differs")
        require(int(row["target"]) == tokens[start + 64], "native target differs")
        expected, order = suffix_answer(memory, tokens[start:start + 64])
        logits = struct.unpack_from("<256i", logits_blob, index * 1024)
        predicted = int(row["predicted"])
        require(predicted == expected, "native answer differs from suffix memory")
        require(logits[predicted] > max(value for byte, value in enumerate(logits)
                                        if byte != predicted), "suffix answer must be unique maximum")
        require(all(-32768 <= value <= 32767 for byte, value in enumerate(logits)
                    if byte != predicted) and -32767 <= logits[predicted] <= 32768,
                "native output exceeds the source's i16 head plus one bound")
        require(int(row["predicted_logit_q8"]) == logits[predicted],
                "native selected logit differs")
        checked.append({"start": start, "target": tokens[start + 64], "predicted": predicted,
                        "suffix_order": order, "logits_sha256": sha(logits_blob[index * 1024:(index + 1) * 1024]),
                        "margin_q8": logits[predicted] - max(value for byte, value in enumerate(logits)
                                                            if byte != predicted)})
    mistakes = sum(row["predicted"] != row["target"] for row in checked)
    require(trace["evaluation"]["mistakes"] == mistakes, "native mistake count differs")
    return checked


def materialize_sources(repo, output):
    def git(*args):
        return subprocess.check_output(["git", "-C", str(repo), *args], stderr=subprocess.PIPE)
    require(git("rev-parse", REVISION + "^{commit}").decode().strip() == REVISION,
            "source revision differs")
    paths = git("ls-tree", "-r", "--name-only", REVISION, "crates").decode().splitlines()
    paths += ["Cargo.toml", "Cargo.lock", "rust-toolchain.toml", MODEL,
              BASE + "train.txt", BASE + "eval.txt", BASE + "component-ablation.json"]
    output.mkdir()
    bindings = {}
    for name in sorted(paths):
        path = PurePosixPath(name)
        require(not path.is_absolute() and ".." not in path.parts and str(path) == name,
                "source path leaves the snapshot")
        blob = git("show", REVISION + ":" + name)
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(blob)
        bindings[name] = {"sha256": sha(blob), "bytes": len(blob)}
    return bindings


def audit(repo, output):
    output.mkdir(parents=True, exist_ok=False)
    terminal = {"schema": "ilxyr.solomon_answer_ownership_attempt.v1", "status": "failed",
                "performance_evidence": False, "source_commit": REVISION, "phase": "source"}
    save(output / "attempt.json", terminal)
    try:
        source = output / "source"
        bindings = materialize_sources(repo, source)
        save(output / "SOURCE-IDENTITY.json", {"source_commit": REVISION, "files": bindings})
        memory = memory_bytes((source / MODEL).read_bytes(), (source / (BASE + "train.txt")).read_bytes())
        terminal["phase"] = "build"
        compiler = run_process(["rustc", "-Vv"], source, output / "compiler-process", time.monotonic() + 15, 2)
        require(compiler["status"] == "complete", "compiler identity failed")
        build = run_process(["cargo", "build", "--release", "--locked", "--offline", "-p", "nsrl-train",
                             "--bin", "nsrl-mini-transformer-eval", "--features", "mini-heads-8,mini-calibrated"],
                            source, output / "build-process", time.monotonic() + 180, 2)
        require(build["status"] == "complete", "native build failed; inspect retained output")
        binary = source / "target/release/nsrl-mini-transformer-eval"
        fixtures = probe_inputs(memory)
        probe_tokens = b"".join(row["context"] + bytes([row["target"]]) for row in fixtures)
        (output / "probe.tokens").write_bytes(probe_tokens)
        cases = [("known", source / (BASE + "eval.txt"), ["--max-windows", "16"]),
                 ("suffix-orders", output / "probe.tokens", ["--stride", "65"])]
        results = {}
        for name, tokens_path, options in cases:
            terminal["phase"] = name
            directory = output / name
            directory.mkdir()
            command = [str(binary), "--model", str(source / MODEL), "--tokens", str(tokens_path),
                       "--attention", "linear", "--position", "nope", "--out", str(directory / "eval.json"),
                       "--details-out", str(directory / "details.tsv"),
                       "--logits-out", str(directory / "logits.bin"), *options]
            process = run_process(command, source, directory / "process", time.monotonic() + 60, 2)
            require(process["status"] == "complete", "native probe failed; inspect retained output")
            tokens = tokens_path.read_bytes()
            starts = ([(index * (len(tokens) - 65) + 7) // 15 for index in range(16)]
                      if name == "known" else list(range(0, len(tokens) - 64, 65)))
            rows = list(csv.DictReader((directory / "details.tsv").read_text().splitlines(), delimiter="\t"))
            logits = (directory / "logits.bin").read_bytes()
            trace = json.loads((directory / "eval.json").read_bytes())
            checked = check_native(tokens, starts, rows, logits, trace, memory)
            if name == "suffix-orders":
                require(len(checked) == len(fixtures), "fixture roster differs")
                for index in range(0, len(checked), 2):
                    left, right = checked[index:index + 2]
                    require(left["logits_sha256"] == right["logits_sha256"], "target byte changed prediction logits")
                    require(left["suffix_order"] == fixtures[index]["suffix_order"], "probe order differs")
            results[name] = {"rows": checked, "prediction_agreement": len(checked),
                             "input_sha256": sha(tokens),
                             "outputs": {name: sha((directory / name).read_bytes())
                                         for name in ("eval.json", "details.tsv", "logits.bin")}}
        result = {"schema": "ilxyr.solomon_answer_ownership.v1", "source_commit": REVISION,
                  "scope": "source_mechanism_audit_and_thirty_window_engineering_smoke",
                  "performance_evidence": False, "promotion_evidence": False,
                  "source_bindings": bindings, "binary_sha256": sha(binary.read_bytes()),
                  "compiler_identity": (output / "compiler-process/stdout.log").read_text().strip(),
                  "memory_bytes": len(memory), "memory_sha256": sha(memory),
                  "valid_forward_claim": {"feature": "mini-calibrated", "position": "nope",
                                          "memory": "valid nonempty NSRLSM1", "chosen_byte_owner": "suffix_memory",
                                          "transformer_role": "confidence_distribution"},
                  "smoke": results}
        save(output / "RESULT.json", result)
        terminal.update(status="complete", phase="complete", result_sha256=sha((output / "RESULT.json").read_bytes()))
        return result
    except BaseException as error:
        terminal["error"] = str(error)
        raise
    finally:
        save(output / "attempt.json", terminal)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--nsrl-repo", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    result = audit(args.nsrl_repo.resolve(), args.out.resolve())
    print(json.dumps({"result": str(args.out / "RESULT.json"),
                      "native_agreements": sum(case["prediction_agreement"] for case in result["smoke"].values())}))


if __name__ == "__main__":
    main()
