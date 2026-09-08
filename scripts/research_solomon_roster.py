"""Acquire and freeze the selected Solomon documents before model scoring."""

import argparse
import datetime
import json
from pathlib import Path
import re
import subprocess
import unicodedata
import urllib.request

import research_solomon_answer_ownership as ownership

require, sha, save = ownership.require, ownership.sha, ownership.save
SCHEMA = "ilxyr.solomon_fresh_roster_plan.v1"


def normalize(blob):
    text = unicodedata.normalize("NFKC", blob.decode("utf-8")).casefold()
    return " ".join(text.split()).encode("utf-8")


def body_bytes(raw):
    raw.decode("utf-8")  # Strict decoding leaves the original source bytes intact.
    start = list(re.finditer(rb"(?m)^\*\*\* START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK [^\r\n]*\r?\n", raw))
    end = list(re.finditer(rb"(?m)^\*\*\* END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK [^\r\n]*(?:\r?\n|$)", raw))
    require(len(start) == len(end) == 1 and start[0].end() < end[0].start(),
            "source marker coverage differs")
    offset, stop = start[0].end(), end[0].start()
    return raw[offset:stop], offset, stop


def spans(blob, size):
    return {blob[i:i + size] for i in range(len(blob) - size + 1)}


def windows(body, count=32, max_forward_shift=0):
    require(type(count) is int and count > 0 and len(body) >= count * 130,
            "document is too short for separated windows")
    rows = []
    for i in range(count):
        anchor = (2 * i + 1) * (len(body) - 65) // (2 * count)
        for shift in range(max_forward_shift + 1):
            start = anchor + shift
            context = body[start:start + 64]
            # Byte models may begin in a UTF-8 continuation byte. The overlap view
            # drops only incomplete edge code points, and keeps all interior bytes.
            complete = context.decode("utf-8", errors="ignore").encode("utf-8")
            normal = normalize(complete)
            if len(normal) >= 32 and start + 65 <= len(body):
                break
        else:
            raise ValueError(f"window {i} at {anchor} is too short after normalization within {max_forward_shift} bytes")
        rows.append({"index": i, "body_start": start, "anchor": anchor, "forward_shift": shift, "context_hex": context.hex(),
                     "target": body[start + 64], "context_sha256": sha(context),
                     "context_target_sha256": sha(body[start:start + 65]),
                     "normalized_context_hex": normal.hex(),
                     "utf8_edge_bytes_removed": len(context) - len(complete)})
    require(all(a["body_start"] + 65 <= b["body_start"] for a, b in zip(rows, rows[1:])),
            "selected windows overlap")
    return rows


def overlap(documents, references):
    """Return every literal-overlap failure, without changing the chosen roster."""
    normalized = {key: normalize(value["body"]) for key, value in documents.items()}
    ref_normal = {key: normalize(value) for key, value in references.items()}
    failures, checks = [], []
    for key, doc in documents.items():
        raw = doc["body"]
        normal = normalized[key]
        other_docs = {name: value for name, value in normalized.items() if name != key}
        for other, value in other_docs.items():
            if raw == documents[other]["body"] or normal in value or value in normal:
                failures.append({"document": key, "reference": other, "kind": "document_duplicate_or_containment"})
            probes = [normal[i * (len(normal) - 32) // 255: i * (len(normal) - 32) // 255 + 32]
                      for i in range(256)]
            hits = sum(probe in value for probe in probes)
            checks.append({"document": key, "reference": other, "kind": "document_sample_32", "hits": hits, "total": 256})
            if hits >= 128:
                failures.append({"document": key, "reference": other, "kind": "sampled_document_overlap", "hits": hits})
        for row in doc["windows"]:
            context = bytes.fromhex(row["context_hex"])
            example = context + bytes([row["target"]])
            query = bytes.fromhex(row["normalized_context_hex"])
            for name, value in {**ref_normal, **other_docs}.items():
                hits32 = sum(piece in value for piece in spans(query, 32))
                hits16 = sum(piece in value for piece in spans(query, 16)) if name in references else None
                checks.append({"document": key, "window": row["index"], "reference": name,
                               "kind": "selected_context", "normalized_32_hits": hits32,
                               "normalized_16_hits": hits16})
                if hits32:
                    failures.append({"document": key, "window": row["index"], "reference": name,
                                     "kind": "selected_context_overlap", "hits": hits32})
            for name, value in references.items():
                if example in value:
                    failures.append({"document": key, "window": row["index"], "reference": name,
                                     "kind": "exact_context_target_overlap"})
    return {"status": "passed" if not failures else "failed", "checks": checks, "failures": failures}


def read_plan(path):
    plan = json.loads(path.read_bytes())
    require(plan["schema"] in (SCHEMA, "ilxyr.solomon_fresh_roster_plan.v2"), "roster schema differs")
    if plan["schema"].endswith(".v2"):
        require(plan["windows"]["max_forward_shift"] == 1024, "forward shift limit differs")
    require(plan["candidate_source_commit"] == ownership.REVISION
            and plan["candidate_model_sha256"] == ownership.MODEL_SHA, "candidate identity differs")
    docs = plan["documents"]
    require(len(docs) == 12 and len({d["id"] for d in docs}) == 12
            and len({d["author"] for d in docs}) == 12, "document or author coverage differs")
    require([d["stratum"] for d in docs].count("fiction") == 6
            and [d["stratum"] for d in docs].count("nonfiction") == 6, "stratum coverage differs")
    require(plan["windows"]["per_document"] == 32 and plan["windows"]["context_bytes"] == 64
            and plan["windows"]["target_bytes"] == 1, "window geometry differs")
    for doc in docs:
        number = doc["gutenberg_id"]
        require(type(number) is int and number > 0 and doc["id"] == f"pg-{number}", "document identity differs")
        require(doc["catalog_url"] == f"https://www.gutenberg.org/ebooks/{number}"
                and doc["text_url"] == f"https://www.gutenberg.org/ebooks/{number}.txt.utf-8", "source URL differs")
    return plan


def acquire(plan_path, output):
    output.mkdir(parents=True, exist_ok=False)
    terminal = {"status": "failed", "plan_sha256": sha(plan_path.read_bytes()), "documents": [], "model_calls": 0}
    save(output / "ATTEMPT.json", terminal)
    try:
        plan = read_plan(plan_path)
        for doc in plan["documents"]:
            directory = output / doc["id"]
            directory.mkdir()
            record = {"id": doc["id"], "status": "failed", "files": {}}
            terminal["documents"].append(record)
            try:
                for name, url in [("catalog.html", doc["catalog_url"]), ("source.txt", doc["text_url"])]:
                    request = urllib.request.Request(url, headers={"User-Agent": "ilXyr research source intake; https://github.com/cenetex/ilXyr"})
                    with urllib.request.urlopen(request, timeout=30) as response:
                        data = response.read(plan["source_rule"]["maximum_raw_bytes_per_document"] + 1)
                        (directory / name).write_bytes(data)
                        require(len(data) <= plan["source_rule"]["maximum_raw_bytes_per_document"], "source size limit")
                        require(response.status == 200, "source HTTP status differs")
                        record["files"][name] = {"url": url, "resolved_url": response.url,
                            "bytes": len(data), "sha256": sha(data), "status": response.status,
                            "content_type": response.headers.get("Content-Type"),
                            "retrieved_at": datetime.datetime.now(datetime.timezone.utc).isoformat()}
                catalog = (directory / "catalog.html").read_text()
                require("Public domain in the USA." in catalog, "catalog rights statement differs")
                body_bytes((directory / "source.txt").read_bytes())
                record["status"] = "complete"
            except Exception as error:
                record["error"] = str(error)
            save(directory / "RECEIPT.json", record)
            save(output / "ATTEMPT.json", terminal)
        require(all(row["status"] == "complete" for row in terminal["documents"]), "source acquisition incomplete")
        terminal["status"] = "complete"
    except BaseException as error:
        terminal["error"] = str(error)
        raise
    finally:
        save(output / "ATTEMPT.json", terminal)


def freeze(plan_path, acquired, repo, output):
    output.mkdir(parents=True, exist_ok=False)
    terminal = {"status": "failed", "phase": "inputs", "plan_sha256": sha(plan_path.read_bytes()), "model_calls": 0}
    save(output / "ATTEMPT.json", terminal)
    try:
        plan = read_plan(plan_path)
        intake = json.loads((acquired / "ATTEMPT.json").read_bytes())
        require(intake["status"] == "complete" and intake["plan_sha256"] == plan.get("acquisition_plan_sha256", terminal["plan_sha256"]), "intake identity differs")
        def git_file(name):
            return subprocess.check_output(["git", "-C", str(repo), "show", ownership.REVISION + ":" + name])
        model = git_file(ownership.MODEL)
        training = git_file(ownership.BASE + "train.txt")
        references = {"candidate_train": training, "opened_eval": git_file(ownership.BASE + "eval.txt"),
                      "stored_memory": ownership.memory_bytes(model, training)}
        docs, roster = {}, []
        for doc in plan["documents"]:
            directory = acquired / doc["id"]
            receipt = json.loads((directory / "RECEIPT.json").read_bytes())
            require(receipt["status"] == "complete" and receipt["id"] == doc["id"], "document receipt differs")
            for name, info in receipt["files"].items():
                require(name in ("catalog.html", "source.txt"), "source file roster differs")
                blob = (directory / name).read_bytes()
                require(sha(blob) == info["sha256"] and len(blob) == info["bytes"], "source bytes differ")
            require(set(receipt["files"]) == {"catalog.html", "source.txt"}, "source file coverage differs")
            raw = (directory / "source.txt").read_bytes()
            body, start, stop = body_bytes(raw)
            try:
                selected = windows(body, max_forward_shift=plan["windows"].get("max_forward_shift", 0))
            except ValueError as error:
                raise ValueError(f"{doc['id']}: {error}") from error
            docs[doc["id"]] = {"body": body, "windows": selected}
            roster.append({**doc, "source_sha256": sha(raw), "source_bytes": len(raw),
                "catalog_sha256": receipt["files"]["catalog.html"]["sha256"],
                "body_sha256": sha(body), "body_bytes": len(body), "raw_body_start": start,
                "raw_body_stop": stop, "normalized_body_sha256": sha(normalize(body)), "windows": selected})
        save(output / "ROSTER.json", {"schema": "ilxyr.solomon_fresh_roster.v1", "plan_sha256": terminal["plan_sha256"],
             "source_commit": ownership.REVISION, "model_sha256": sha(model), "documents": roster,
             "references": {name: {"bytes": len(blob), "sha256": sha(blob)} for name, blob in references.items()},
             "model_calls": 0})
        terminal["phase"] = "overlap"
        checked = overlap(docs, references)
        save(output / "OVERLAP.json", checked)
        require(checked["status"] == "passed", "selected roster failed overlap checks; retain the fixed selection")
        terminal.update(status="complete", phase="complete", roster_sha256=sha((output / "ROSTER.json").read_bytes()),
                        overlap_sha256=sha((output / "OVERLAP.json").read_bytes()))
    except BaseException as error:
        terminal["error"] = str(error)
        raise
    finally:
        save(output / "ATTEMPT.json", terminal)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["acquire", "freeze"])
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--acquired", type=Path)
    parser.add_argument("--nsrl-repo", type=Path)
    args = parser.parse_args()
    if args.mode == "acquire":
        acquire(args.plan, args.out)
    else:
        if args.acquired is None or args.nsrl_repo is None:
            parser.error("freeze requires --acquired and --nsrl-repo")
        freeze(args.plan, args.acquired, args.nsrl_repo, args.out)
