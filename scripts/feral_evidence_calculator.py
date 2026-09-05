"""A fixed arithmetic control that reads only questions and supplied evidence."""

import argparse
from decimal import Decimal
from fractions import Fraction
import hashlib
import json
from pathlib import Path
import re

VERSION = "ilxyr.feral_evidence_calculator.v1"
YEAR = re.compile(r"\b(?:19|20)\d{2}\b")
AMOUNT = re.compile(r"\$?\s*\(?[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)\)?(?:\s*%|\s+(?:million|billion|thousand)s?\b)?", re.I)
STOP = set("a an the of for in to from and or what how was were is are there it our "
           "year years ended fiscal total percentage percent change increase decrease "
           "growth ratio difference average mean sum combined many much million millions "
           "billion billions thousand thousands dollar dollars".split())


def digest(data):
    return hashlib.sha256(data).hexdigest()


def words(text):
    tokens = [word[:-1] if len(word) > 4 and word.endswith("s") else word
              for word in re.findall(r"[a-z]+", text.lower())]
    return set(tokens) - STOP - set("abcdefghijklmnopqrstuvwxyz")


def amount(raw, inherited="number"):
    text = raw.strip().lower()
    if len(text) > 100 or not AMOUNT.fullmatch(text):
        raise ValueError("unsupported amount")
    currency, percent = "$" in text, "%" in text
    scales = [unit for unit in ["thousand", "million", "billion"] if unit in text]
    if percent and (currency or scales):
        raise ValueError("conflicting unit markers")
    unit = "percent" if percent else (inherited if not currency or inherited.startswith("usd") else "usd")
    if scales:
        unit = ("usd_" if currency or inherited.startswith("usd") else "number_") + scales[0]
    number = re.sub(r"[$%,]|\b(?:thousand|million|billion)s?\b", "", text).strip()
    if number.startswith("(") and number.endswith(")"):
        number = "-" + number[1:-1]
    elif "(" in number or ")" in number:
        raise ValueError("unpaired accounting sign")
    return Fraction(Decimal(number)), unit


def extract_cells(evidence):
    cells = []
    for evidence_id, text in evidence:
        # Spans use Python character offsets in the supplied evidence string.
        def add(label, year, match, inherited="number", offset=0):
            value, unit = amount(match.group(), inherited)
            start, end = offset + match.start(), offset + match.end()
            cells.append({"evidence_id": evidence_id, "label": label.strip(), "year": int(year),
                          "value": str(value), "unit": unit, "span": [start, end],
                          "text": text[start:end]})

        for clause in re.finditer(r"[^;]+", text):
            cell = re.search(r"\bthe (.+) is (.+?)\s*$", clause.group(), re.I)
            if not cell or " of " not in cell[1]:
                continue
            label, period = cell[1].rsplit(" of ", 1)
            years = YEAR.findall(period)
            if len(years) != 1 or YEAR.search(label):
                continue
            match = AMOUNT.fullmatch(cell[2])
            if match:
                inherited = "number_million" if re.search(r"\bin millions\b", text[:clause.end()]) else "number"
                if "$" in match.group() and inherited == "number_million":
                    inherited = "usd_million"
                try:
                    add(label, years[0], match, inherited, clause.start() + cell.start(2))
                    if inherited.endswith("_million") and "million" not in match.group() and "%" not in match.group():
                        cells[-1]["unit"] = inherited
                except (ValueError, ArithmeticError):
                    continue

        narrative = re.fullmatch(
            r"\s*(.+?)\s+(?:was|were|is|are)\s+(.+?)\s+(?:for|in)\s+(?:the\s+)?years\s+"
            r"(?:ended\s+(?:december\s+31\s*,?\s*)?)?(.+?)\s*,?\s*respectively\s*\.?\s*",
            text, re.I)
        if not narrative:
            continue
        label, values, periods = narrative.groups()
        if any("," in token and not re.fullmatch(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?", token)
               for token in re.findall(r"\d[\d,]*\d(?:\.\d+)?", values) if re.search(r"\d,\d", token)):
            continue
        years = YEAR.findall(periods)
        residue = YEAR.sub("", periods)
        if not years or re.sub(r"[\s,]|\band\b", "", residue):
            continue
        matches = list(AMOUNT.finditer(values))
        residue = AMOUNT.sub("", values)
        if len(matches) != len(years) or len(set(years)) != len(years) or re.sub(r"[\s,]|\band\b", "", residue):
            continue
        inherited = "usd" if "$" in values else "number"
        scales = {scale for scale in ["thousand", "million", "billion"] if scale in values}
        if len(scales) == 1:
            inherited += "_" + next(iter(scales))
        start = len(cells)
        try:
            for year, match in zip(years, matches):
                add(label, year, match, inherited, narrative.start(2))
        except (ValueError, ArithmeticError):
            del cells[start:]
    return cells


def operation(question):
    text = question.lower()
    years = [int(year) for year in YEAR.findall(text)]
    if len(years) < 2 or len(set(years)) != len(years):
        return None, years, "question_needs_distinct_years"
    if any(word in words(text) for word in ["without", "excluding", "adjusted"]):
        return None, years, "unsupported_adjustment"
    if re.search(r"\b(?:sum|combined|altogether)\b", text):
        return "sum", years, None
    if re.search(r"\b(?:average|mean)\b", text):
        return "average", years, None
    if len(years) != 2:
        return None, years, "unsupported_question_shape"
    if re.search(r"\bratio\b", text):
        return "ratio", years, None
    direction = re.search(r"\bfrom\s+((?:19|20)\d{2})\s+to\s+((?:19|20)\d{2})\b", text)
    if direction and re.search(r"\b(?:change|increase|decrease|growth|difference)\b", text):
        kind = "percent_change" if re.search(r"\b(?:percentage|percent)\b", text) else "change"
        return kind, [int(direction[1]), int(direction[2])], None
    return None, years, "unsupported_question_shape"


def render(value, unit):
    whole, remainder = divmod(abs(value.numerator) * 100, value.denominator)
    cents = (whole + (2 * remainder >= value.denominator)) * (-1 if value < 0 else 1)
    result = ("-" if cents < 0 else "") + f"{abs(cents) // 100}.{abs(cents) % 100:02d}"
    result = result.rstrip("0").rstrip(".")
    return result + ("%" if unit == "percent" else "")


def predict(question, evidence, arm="calculator"):
    if arm not in {"calculator", "operand_only"}:
        raise ValueError("unknown control arm")
    if not isinstance(question, str) or len(question) > 10000:
        raise ValueError("question must be bounded text")
    if not isinstance(evidence, list) or len(evidence) > 100:
        raise ValueError("evidence must be a bounded list")
    names = set()
    for entry in evidence:
        if not isinstance(entry, (list, tuple)) or len(entry) != 2 or not all(isinstance(x, str) for x in entry):
            raise ValueError("evidence needs identifier and text pairs")
        name, text = entry
        if not name or name in names or len(text) > 100000:
            raise ValueError("evidence identifiers must be unique and text bounded")
        names.add(name)
    result = {"schema": VERSION, "arm": arm, "prediction": None, "reason": None,
              "operation": None, "operands": [], "exact_result": None, "unit": None,
              "work": {"evidence_rows": len(evidence), "parsed_cells": 0,
                       "series_scored": 0, "arithmetic_operations": 0}}

    def abstain(reason):
        result["reason"] = reason
        return result

    kind, years, problem = operation(question)
    result["operation"] = kind
    if problem:
        return abstain(problem)
    cells = extract_cells(evidence)
    result["work"]["parsed_cells"] = len(cells)
    series = {}
    for cell in cells:
        label = " ".join(cell["label"].lower().split())
        series.setdefault(label, []).append(cell)
    ranked = []
    for label, entries in series.items():
        label_words = words(label)
        shared = len(label_words & words(question))
        result["work"]["series_scored"] += 1
        if shared:
            ranked.append(((shared, Fraction(shared, len(label_words))), label, entries))
    if not ranked:
        return abstain("missing_matching_series")
    ranked.sort(key=lambda entry: entry[:2], reverse=True)
    if len(ranked) > 1 and ranked[0][0] == ranked[1][0]:
        return abstain("ambiguous_series")
    result["selected_series"] = ranked[0][1]
    for year in years:
        matches = [cell for cell in ranked[0][2] if cell["year"] == year]
        if not matches:
            return abstain("missing_requested_year")
        if len({(cell["value"], cell["unit"]) for cell in matches}) != 1:
            return abstain("conflicting_values")
        result["operands"].append(min(matches, key=lambda cell: (cell["evidence_id"], cell["span"])))
    units = {cell["unit"] for cell in result["operands"]}
    if len(units) != 1:
        return abstain("incompatible_units")
    unit = next(iter(units))
    values = [Fraction(cell["value"]) for cell in result["operands"]]
    if arm == "operand_only":
        answer = values[-1]
    elif kind in {"ratio", "percent_change"} and values[1 if kind == "ratio" else 0] == 0:
        return abstain("zero_denominator")
    elif kind == "percent_change":
        answer, unit = (values[1] - values[0]) / values[0] * 100, "percent"
        result["work"]["arithmetic_operations"] = 3
    elif kind == "change":
        answer = values[1] - values[0]
        result["work"]["arithmetic_operations"] = 1
    elif kind == "ratio":
        answer, unit = values[0] / values[1], "ratio"
        result["work"]["arithmetic_operations"] = 1
    else:
        answer = sum(values)
        result["work"]["arithmetic_operations"] = len(values) - 1
        if kind == "average":
            answer /= len(values)
            result["work"]["arithmetic_operations"] += 1
    result.update(prediction=render(answer, unit), exact_result=str(answer), unit=unit, reason="answered")
    return result


def predict_row(row, arm):
    if set(row) != {"id", "schema", "task", "messages"} or row["schema"] != "ilxyr.feral_model_input.v2" or row["task"] != "finqa":
        raise ValueError("predictor needs the target-free model input view")
    messages = row["messages"]
    if not isinstance(row["id"], str) or not row["id"] or [m["role"] for m in messages] != ["system", "user"]:
        raise ValueError("invalid input identity or message roles")
    context = json.loads(messages[1]["content"])
    if set(context) != {"question", "retrieved_evidence"}:
        raise ValueError("model context has unexpected fields")
    # The outer ID is attached only after prediction and never enters selection.
    return {"id": row["id"], **predict(context["question"], context["retrieved_evidence"], arm)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inputs", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--arm", choices=["calculator", "operand_only"], required=True)
    parser.add_argument("--limit", type=int, help="read only this input prefix for a smoke check")
    args = parser.parse_args()
    if args.limit is not None and args.limit <= 0:
        parser.error("limit must be positive")
    data = args.inputs.read_bytes()
    selected = data.splitlines()[:args.limit]
    seen = set()
    predictions = []
    for line in selected:
        row = json.loads(line)
        if row["id"] in seen:
            raise ValueError("input IDs must be unique")
        seen.add(row["id"])
        predictions.append(predict_row(row, args.arm))
    if not predictions:
        raise ValueError("input roster is empty")
    with args.output.open("x") as handle:
        for prediction in predictions:
            handle.write(json.dumps(prediction, sort_keys=True, allow_nan=False) + "\n")
    print(json.dumps({"schema": VERSION, "arm": args.arm, "rows": len(predictions),
                      "inputs_sha256": digest(data), "output_sha256": digest(args.output.read_bytes()),
                      "runner_sha256": digest(Path(__file__).read_bytes()), "limit": args.limit}))


if __name__ == "__main__":
    main()
