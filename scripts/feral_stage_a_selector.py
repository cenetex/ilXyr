"""Matched deterministic selector and provisional scorer for the FERAL Stage A view."""
import argparse
from collections import Counter
from datetime import date, timedelta
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "experiments/feral-source-selector/stage-a"


def encode(value):
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def fiscal_period(end, period_type):
    if period_type == "instant":
        return {"instant": end}
    terminal = date.fromisoformat(end)
    prior = date(terminal.year - 1, terminal.month, terminal.day) + timedelta(days=1)
    return {"startDate": prior.isoformat(), "endDate": end}


def eligible(family, concept, year, catalogue):
    period_type = catalogue[concept]["structural_metadata"]["period_type"]
    end_date = str(year) + family["fiscal_end"][4:]
    period = fiscal_period(end_date, period_type)
    return [fact for fact in family["facts"]
            if fact["concept"] == concept
            and fact["context"]["period"] == period
            and not fact["context"]["dimensions"]
            and fact["unit"] == "iso4217:USD"]


def pick(family, concept, year, catalogue):
    rows = eligible(family, concept, year, catalogue)
    if not rows:
        return None, "missing_fact"
    precision = lambda fact: 1000 if fact["decimals"] == "INF" else int(fact["decimals"] or -1000)
    best_precision = max(map(precision, rows))
    best = [row for row in rows if precision(row) == best_precision]
    if len({Decimal(row["value"]) for row in best}) != 1:
        return None, "conflicting_values"
    best.sort(key=lambda row: (row["source_file"], row["span"][0]))
    return best[0], None


def interpretation(question, sources):
    text = question.casefold()
    issuers = [family["id"] for family in sources
               if re.search(r"\b" + re.escape(family["issuer"].casefold()) + r"\b", text)]
    if len(issuers) != 1:
        return None, "unresolved_issuer"
    if "s&p" in text or "index" in text:
        return None, "wrong_index_identity"
    if "mars division" in text:
        return None, "missing_dimension"
    if re.search(r"\bwhy\b|\breason\b|\bexplain\b", text):
        return None, "requires_prose"
    if "daily average cash" in text or "average cash balance" in text:
        return None, "missing_daily_series"
    patterns = [
        (r"\bliquid assets\b", None),
        (r"\bcurrent assets\b|\bassets current\b", "AssetsCurrent"),
        (r"\btotal assets\b|\bassets total\b", "Assets"),
        (r"\bcash and cash equivalents\b", "CashAndCashEquivalentsAtCarryingValue"),
        (r"\bcost of revenue\b|\bcost of sales\b", "CostOfRevenue"),
        (r"\bnet inventory\b|\binventory\b|\binventories\b", "InventoryNet"),
        (r"\brevenues?\b", "Revenues"),
    ]
    hits = [concept for pattern, concept in patterns if re.search(pattern, text)]
    if not hits or hits[0] is None:
        return None, "unresolved_concept"
    years = sorted({int(year) for year in re.findall(r"\b(?:fy)?(20\d{2})\b", text)})
    if not 1 <= len(years) <= 2:
        return None, "unresolved_period"
    difference = bool(re.search(r"\bchange\b|\bsubtract\b", text))
    if difference != (len(years) == 2):
        return None, "unresolved_operation"
    return {"issuer": issuers[0], "concept": "us-gaap:" + hits[0],
            "years": years, "operation": "difference" if difference else "lookup"}, None


def select(evidence, questions, source_manifest):
    catalogue = {row["concept"]: row for row in evidence["catalogue"]}
    families = {row["id"]: row for row in evidence["families"]}
    sources = [{"id": row["id"], "issuer": row["issuer"], "fiscal_end": row["fiscal_end"]}
               for row in source_manifest["families"]]
    output = []
    for form in questions["forms"]:
        parsed, reason = interpretation(form["text"], sources)
        result = {"id": form["id"], "kind": "abstain", "reason": reason,
                  "selection": parsed, "support": [], "answer": None, "unit": None}
        if parsed is not None:
            if parsed["concept"] not in catalogue:
                result["reason"] = "outside_catalogue"
            else:
                selected = []
                for year in parsed["years"]:
                    row, reason = pick(families[parsed["issuer"]], parsed["concept"], year, catalogue)
                    if reason:
                        result["reason"] = reason
                        break
                    selected.append(row)
                else:
                    values = [Decimal(row["value"]) for row in selected]
                    value = values[0] if parsed["operation"] == "lookup" else values[1] - values[0]
                    result.update(kind="answer", reason="answered",
                                  support=[row["id"] for row in selected],
                                  answer=format(value, "f"), unit="usd")
        output.append(result)
    return {"schema": "ilxyr.feral_stage_a_selector_predictions.v1",
            "method": "context_aware_deterministic_v1",
            "evidence_sha256": sha(encode(evidence)),
            "questions_sha256": sha(encode(questions)),
            "predictions": output}


def draft_labels(evidence, questions, manifest, specs):
    catalogue = {row["concept"]: row for row in evidence["catalogue"]}
    families = {row["id"]: row for row in evidence["families"]}
    spec_map = {row["family"]: row for row in specs["specs"]}
    labels = []
    for form in questions["forms"]:
        spec = spec_map[form["family"]]
        label = {"id": form["id"], "family": form["family"],
                 "kind": spec.get("kind", "answer"),
                 "reason": spec.get("reason"), "selection": None,
                 "support": [], "answer": None, "unit": None}
        if label["kind"] == "answer":
            label["selection"] = {key: spec[key] for key in ("issuer", "concept", "years", "operation")}
            chosen = []
            for year in spec["years"]:
                row, reason = pick(families[spec["issuer"]], spec["concept"], year, catalogue)
                if reason:
                    raise ValueError("draft target fact is missing: " + form["id"])
                chosen.append(row)
            values = [Decimal(row["value"]) for row in chosen]
            label["answer"] = format(values[0] if spec["operation"] == "lookup"
                                     else values[1] - values[0], "f")
            label["unit"] = "usd"
            label["support"] = [row["id"] for row in chosen]
        labels.append(label)
    return {"schema": "ilxyr.feral_stage_a_draft_labels.v1",
            "status": specs["status"],
            "evidence_sha256": sha(encode(evidence)),
            "questions_sha256": sha(encode(questions)),
            "labels": labels}


def lexical_metrics(evidence, questions, labels):
    catalogue = evidence["catalogue"]
    targets = {row["id"]: row for row in labels["labels"] if row["kind"] == "answer"}
    rows = []
    for form in questions["forms"]:
        if form["id"] not in targets:
            continue
        query = set(re.findall(r"[a-z]+", form["text"].casefold()))
        scored = []
        for concept in catalogue:
            title = concept["standard_label"].casefold()
            camel = re.sub(r"([a-z])([A-Z])", r"\1 \2", concept["concept"].split(":")[1]).casefold()
            tokens = set(re.findall(r"[a-z]+", title + " " + camel))
            score = len(query & tokens) / max(1, len(query | tokens))
            scored.append((score, concept["concept"]))
        ranked = [item[1] for item in sorted(scored, key=lambda item: (-item[0], item[1]))]
        target = targets[form["id"]]["selection"]["concept"]
        rows.append({"id": form["id"], "rank": ranked.index(target) + 1})
    return {"denominator": len(rows), "recall_at_5": sum(x["rank"] <= 5 for x in rows),
            "recall_at_20": sum(x["rank"] <= 20 for x in rows), "rows": rows}


def score(evidence, questions, predictions, labels):
    evidence_hash, questions_hash = sha(encode(evidence)), sha(encode(questions))
    if (predictions["evidence_sha256"] != evidence_hash
            or labels["evidence_sha256"] != evidence_hash
            or predictions["questions_sha256"] != questions_hash
            or labels["questions_sha256"] != questions_hash):
        raise ValueError("visible evidence or questions differ")
    expected_ids = [form["id"] for form in questions["forms"]]
    predicted_rows = predictions["predictions"]
    label_rows = labels["labels"]
    if (len(expected_ids) != len(set(expected_ids))
            or len(predicted_rows) != len(expected_ids)
            or len(label_rows) != len(expected_ids)
            or [row["id"] for row in predicted_rows] != expected_ids
            or [row["id"] for row in label_rows] != expected_ids):
        raise ValueError("prediction or label roster differs")
    gold = {row["id"]: row for row in label_rows}
    rows = []
    for row in predicted_rows:
        target = gold[row["id"]]
        selection_correct = (row["selection"] == target["selection"]
                             if target["kind"] == "answer" else row["kind"] == "abstain")
        support_correct = row["support"] == target["support"]
        answer_correct = (row["kind"], row["answer"], row["unit"]) == (target["kind"], target["answer"], target["unit"])
        complete = selection_correct and support_correct and answer_correct
        rows.append({
            "id": row["id"],
            "selection_correct": selection_correct,
            "support_correct": support_correct,
            "answer_correct": answer_correct,
            "abstention_reason_correct": row["reason"] == target["reason"] if target["kind"] == "abstain" else None,
            "complete_outcome_correct": complete,
            "incorrect_assertion": row["kind"] == "answer" and not complete,
        })
    gold_links = [(target["id"], support) for target in label_rows
                  if target["kind"] == "answer" for support in target["support"]]
    predicted_links = [(row["id"], support) for row in predicted_rows
                       if row["kind"] == "answer" for support in row["support"]]
    gold_link_set, predicted_link_set = set(gold_links), set(predicted_links)
    links = {
        "gold_required": len(gold_links),
        "predicted": len(predicted_links),
        "true_positive": len(gold_link_set & predicted_link_set),
        "false_positive": len(predicted_link_set - gold_link_set),
        "false_negative": len(gold_link_set - predicted_link_set),
        "complete_answer_link_sets": sum(
            row["support"] == gold[row["id"]]["support"]
            for row in predicted_rows if gold[row["id"]]["kind"] == "answer"),
        "answer_forms": sum(row["kind"] == "answer" for row in label_rows),
    }
    return {"schema": "ilxyr.feral_stage_a_development_score.v1",
            "links": links,
            "label_status": labels["status"], "method": predictions["method"],
            "questions": len(rows),
            "selection_correct": sum(row["selection_correct"] for row in rows),
            "support_correct": sum(row["support_correct"] for row in rows),
            "answer_correct": sum(row["answer_correct"] for row in rows),
            "complete_outcome_correct": sum(row["complete_outcome_correct"] for row in rows),
            "abstention_reason_correct": sum(row["abstention_reason_correct"] is True for row in rows),
            "incorrect_assertions": sum(row["incorrect_assertion"] for row in rows),
            "answered": sum(row["kind"] == "answer" for row in predicted_rows),
            "lexical": lexical_metrics(evidence, questions, labels),
            "rows": rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, default=BASE)
    args = parser.parse_args()
    base = args.base
    evidence = json.loads((base / "EVIDENCE.json").read_bytes())
    questions = json.loads((base / "QUESTIONS.json").read_bytes())
    manifest = json.loads((base / "SOURCE-MANIFEST.json").read_bytes())
    specs = json.loads((base / "DRAFT-LABEL-SPECS.json").read_bytes())
    labels = draft_labels(evidence, questions, manifest, specs)
    predictions = select(evidence, questions, manifest)
    result = score(evidence, questions, predictions, labels)
    for name, value in [("DRAFT-LABELS.json", labels), ("CONTROL-PREDICTIONS.json", predictions),
                        ("CONTROL-SCORE.json", result)]:
        (base / name).write_bytes(encode(value))
    print(json.dumps({key: result[key] for key in ("questions", "selection_correct", "support_correct",
                                                   "answer_correct", "incorrect_assertions", "answered")}))


if __name__ == "__main__":
    main()
