"""Small context-aware control for the public BRAID source/request fixture.

Selection reads visible sources and questions only. Labels enter the evaluator
through a separate file after all predictions have been written.
"""

import argparse
import hashlib
import json
from pathlib import Path
import re


FACT = re.compile(r"(?m)^(Revenue(?: in thousands)?|Operating income): (USD [0-9]+ (?:million|thousand))\.$")
FILING = re.compile(r"^([A-Za-z]+) .* filing for (20[0-9]{2})\.")


def fields(question):
    text = question.casefold()
    entities = [name for name in ("aster", "birch") if re.search(rf"\b{name}\b", text)]
    years = re.findall(r"\b20[0-9]{2}\b", text)
    if len(entities) != 1 or len(years) != 1:
        return None, "unresolved_request"
    if "s&p 500" in text or "index" in text:
        return None, "wrong_index_identity"
    if "cash flow" in text:
        return None, "missing_fact"
    metrics = [name for name in ("revenue", "operating income") if name in text]
    if len(metrics) != 1:
        return None, "unresolved_request"
    source_kinds = [kind for kind in ("audited", "draft") if kind in text]
    if len(source_kinds) > 1:
        return None, "unresolved_request"
    return {"entity": entities[0], "year": years[0], "metric": metrics[0],
            "source_kind": source_kinds[0] if source_kinds else None,
            "unit": "usd_thousand" if "in thousands" in text else "usd_million",
            "operation": "lookup"}, None


def source_facts(resource):
    content = resource["content"]
    heading = FILING.match(content)
    if heading is None:
        return []
    entity, year = heading.groups()
    result = []
    for match in FACT.finditer(content):
        label, quoted = match.groups()
        start = len(content[:match.start(2)].encode("utf8"))
        end = start + len(quoted.encode("utf8"))
        value, unit = re.fullmatch(r"USD ([0-9]+) (million|thousand)", quoted).groups()
        result.append({"entity": entity.casefold(), "year": year,
                       "metric": label.casefold().removesuffix(" in thousands"),
                       "source_kind": resource["attributes"]["filingKind"],
                       "answer": value, "unit": "usd_" + unit,
                       "resourceId": resource["resourceId"],
                       "span": {"unit": "utf8_byte", "start": start, "end": end},
                       "quotedValue": quoted})
    return result


def select(visible, request):
    wanted, reason = fields(request["text"])
    result = {"requestId": request["requestId"], "kind": "abstain", "answer": None,
              "unit": None, "operation": None if wanted is None else wanted["operation"],
              "support": [], "reason": reason}
    if wanted is None:
        return result
    allowed = set(request["visibleResourceIds"])
    facts = [fact for resource in visible["resources"] if resource["resourceId"] in allowed
             for fact in source_facts(resource)]
    matches = [fact for fact in facts if all(fact[key] == wanted[key]
               for key in ("entity", "year", "metric", "unit"))
               and (wanted["source_kind"] is None or fact["source_kind"] == wanted["source_kind"])]
    if not matches:
        result["reason"] = "missing_fact"
        return result
    values = {(fact["answer"], fact["unit"]) for fact in matches}
    if len(values) != 1:
        result["reason"] = "conflicting_sources"
        result["support"] = [support(fact) for fact in matches]
        return result
    chosen = min(matches, key=lambda fact: (0 if fact["source_kind"] == "audited" else 1,
                                            fact["resourceId"], fact["span"]["start"]))
    result.update(kind="answer", answer=chosen["answer"], unit=chosen["unit"],
                  support=[support(chosen)], reason="answered")
    return result


def support(fact):
    return {key: fact[key] for key in ("resourceId", "span", "quotedValue")}


def run(visible_bytes):
    visible = json.loads(visible_bytes)
    resources = visible["resources"]
    if len({resource["resourceId"] for resource in resources}) != len(resources):
        raise ValueError("duplicate source resource")
    for resource in resources:
        if hashlib.sha256(resource["content"].encode("utf8")).hexdigest() != resource["contentSha256"]:
            raise ValueError("changed source bytes")
    return {"schema": "ilxyr.feral_source_selector_development.v1",
            "visible_sha256": hashlib.sha256(visible_bytes).hexdigest(),
            "method": "context_aware_deterministic_v1",
            "predictions": [select(visible, request) for request in visible["requests"]]}


def evaluate(predictions, labels):
    expected = {row["requestId"]: row for row in labels["labels"]}
    rows = predictions["predictions"]
    if not predictions.get("method") or not isinstance(rows, list):
        raise ValueError("prediction method and rows required")
    if labels["fixtureSha256"] != predictions["visible_sha256"]:
        raise ValueError("labels bind a different visible fixture")
    if len(rows) != len(expected) or len({row["requestId"] for row in rows}) != len(rows) or {row["requestId"] for row in rows} != set(expected):
        raise ValueError("prediction and label rosters differ")
    scored = []
    for row in rows:
        target = expected[row["requestId"]]
        source_correct = row["support"] == target["support"]
        answer_correct = (row["kind"], row["answer"], row["unit"]) == (
            target["kind"], target["answer"], target["unit"])
        scored.append({"requestId": row["requestId"], "source_correct": source_correct,
                       "answer_correct": answer_correct,
                       "operation_correct": row["operation"] == "lookup" if target["kind"] == "answer" else None,
                       "incorrect_assertion": row["kind"] == "answer" and target["kind"] == "abstain"})
    return {"schema": "ilxyr.feral_source_selector_score.v1", "method": predictions["method"],
            "visible_sha256": predictions["visible_sha256"], "rows": scored,
            "source_correct": sum(row["source_correct"] for row in scored),
            "answer_correct": sum(row["answer_correct"] for row in scored),
            "operation_correct_on_answers": sum(row["operation_correct"] is True for row in scored),
            "correct_answer_coverage": sum(row["answer_correct"] and expected[row["requestId"]]["kind"] == "answer" for row in scored),
            "incorrect_assertions": sum(row["incorrect_assertion"] for row in scored),
            "requests": len(scored)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--visible", type=Path, required=True)
    parser.add_argument("--predictions", type=Path, required=True)
    parser.add_argument("--labels", type=Path)
    parser.add_argument("--score", type=Path)
    parser.add_argument("--candidate", type=Path)
    parser.add_argument("--candidate-score", type=Path)
    args = parser.parse_args()
    if bool(args.labels) != bool(args.score):
        parser.error("--labels and --score belong together")
    if bool(args.candidate) != bool(args.candidate_score) or (args.candidate and not args.labels):
        parser.error("candidate scoring requires --candidate, --candidate-score, and --labels")
    prediction = run(args.visible.read_bytes())
    args.predictions.write_text(json.dumps(prediction, indent=2) + "\n")
    if args.labels:
        labels = json.loads(args.labels.read_bytes())
        score = evaluate(prediction, labels)
        args.score.write_text(json.dumps(score, indent=2) + "\n")
        if args.candidate:
            candidate = json.loads(args.candidate.read_bytes())
            args.candidate_score.write_text(json.dumps(evaluate(candidate, labels), indent=2) + "\n")
