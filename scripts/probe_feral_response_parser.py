"""Probe the pinned legacy parser with synthetic responses; preserve each failure."""

import argparse
import ast
import json
from pathlib import Path
import re
from typing import Any

from feral_responses import parse_response
from feral_targets_v2 import sha

FIXTURES = [
    ("unfinished_prose_with_year", "Evidence is missing for 2020."),
    ("unfinished_object_with_year", '{"reason": "The evidence ends in 2020", "answer":'),
    ("duplicate_answer_fields", '{"answer":1,"answer":2}'),
    ("extra_reason_field", '{"answer":30,"reason":"10+20"}'),
    ("valid_exact_decimal", '{"answer":12.340}'),
    ("valid_abstention", '{"answer":null}'),
]


def probe(source):
    tree = ast.parse(source)
    selected = [node for node in tree.body
                if (isinstance(node, ast.FunctionDef) and node.name == "_finqa_prediction")
                or (isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "NUMBER_RE" for t in node.targets))]
    if len(selected) != 2:
        raise ValueError("legacy parser source shape differs")
    scope = {"re": re, "Any": Any}
    exec(compile(ast.Module(body=selected, type_ignores=[]), "pinned_legacy_parser", "exec"), scope)
    records = []
    for name, raw in FIXTURES:
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = None
        records.append({"id": name, "raw_response": raw,
                        "legacy_prediction": scope["_finqa_prediction"](raw, parsed),
                        "strict": parse_response(raw)})
    return {"schema": "ilxyr.feral_parser_probe.v1", "scope": "synthetic_engineering_fixtures",
            "historical_occurrence_count": None, "legacy_source_sha256": sha(source), "fixtures": records}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--legacy-source", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(probe(args.legacy_source.read_bytes()), indent=2, sort_keys=True))
