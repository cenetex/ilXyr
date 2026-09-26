"""Audit the available real filing evidence against the FERAL v3 Stage A contract.

This is a feasibility audit of opened step 47 data. It never reads predictor
labels while constructing a selector input.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STEP47 = ROOT / "experiments/research-step-47"
RESULT_SCHEMA = "ilxyr.feral_stage_a_source_audit.v1"


def raw_and_json(path):
    raw = path.read_bytes()
    return raw, json.loads(raw)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def audit(source_path=STEP47 / "SOURCES.json",
          family_path=STEP47 / "data/FAMILIES.json",
          roster_path=STEP47 / "data/ROSTER.json",
          predictor_path=STEP47 / "data/predictor/INPUTS.jsonl",
          target_path=STEP47 / "data/grader/TARGETS.jsonl"):
    source_raw, source_doc = raw_and_json(source_path)
    family_raw, families = raw_and_json(family_path)
    roster_raw, roster = raw_and_json(roster_path)
    predictor_raw = predictor_path.read_bytes()
    target_raw = target_path.read_bytes()
    sources = {source["id"]: source for source in source_doc["sources"]}
    specs = {spec["id"]: spec for spec in source_doc["families"]}
    assert len(sources) == len(source_doc["sources"]) == 3
    assert len(specs) == len(source_doc["families"]) == len(families) == 8
    facts = {}
    per_source = Counter()
    labels = set()
    for family in families:
        spec = specs[family["id"]]
        source = sources[family["source_id"]]
        assert family["source_sha256"] == source["sha256"]
        assert family["report_key"] == source["report_key"]
        assert family["company"] == source["company"]
        assert family["table_html_sha256"] == spec["table_html_sha256"]
        assert family["table_index"] == spec["table_index"]
        assert family["header_cells"] == spec["header_cells"]
        assert family["unit_source"] == spec["unit_source"]
        assert family["unit"] == spec["unit"]
        for fact in family["facts"]:
            assert fact["id"] not in facts
            assert fact["unit"] == family["unit"]
            assert 0 <= fact["table_row"] and 0 <= fact["table_column"]
            assert fact["source_cell"]
            assert fact["year"] in spec["years"]
            matching = [item for item in spec["series"]
                        if item["label"] == fact["label"]
                        and item["role"] == fact["role"]
                        and item["row"] == fact["table_row"]]
            assert len(matching) == 1
            assert matching[0]["values"][str(fact["year"])] == fact["value"]
            facts[fact["id"]] = fact
            per_source[family["source_id"]] += 1
            labels.add((fact["label"].casefold(), fact["unit"]))
    assert len(roster) == 228
    inputs = {item["id"]: item for line in predictor_raw.splitlines()
              if line for item in [json.loads(line)]}
    targets = {item["id"]: item for line in target_raw.splitlines()
               if line for item in [json.loads(line)]}
    assert len(inputs) == len(targets) == len(roster)
    assert set(inputs) == set(targets) == {item["id"] for item in roster}
    pairs = defaultdict(list)
    for item in roster:
        assert item["family"] in specs
        for mapping in item["source_mapping"]:
            assert mapping["fact_id"] in facts
        pairs[(item["family"], item["form"], item["mutation"])].append(item)
    # Step 47 forms are opened development material. The pair check is about
    # roster shape; it does not establish independent authorship.
    assert len(pairs) == 114
    assert all({item["style"] for item in pair} == {"canonical", "paraphrase"}
               and len(pair) == 2 for pair in pairs.values())
    target_kinds = Counter(item["kind"] for item in targets.values())
    return {
        "schema": RESULT_SCHEMA,
        "status": "opened_real_source_feasibility",
        "inputs": {
            "sources_sha256": digest(source_raw),
            "families_sha256": digest(family_raw),
            "roster_sha256": digest(roster_raw),
            "predictor_sha256": digest(predictor_raw),
            "targets_sha256": digest(target_raw),
        },
        "real_source_families": len(sources),
        "selected_tables": len(families),
        "fact_occurrences": len(facts),
        "catalogue_label_unit_pairs": len(labels),
        "fact_occurrences_by_source": dict(sorted(per_source.items())),
        "opened_question_families": len(pairs),
        "opened_visible_forms": len(roster),
        "opened_target_kinds": dict(sorted(target_kinds.items())),
        "link_availability": {
            "table_row_column_with_source_digest": len(facts),
            "verified_occurrence_byte_spans": 0,
            "typed_xbrl_concept_context_links": 0,
            "finding_to_fact_links": 0,
        },
        "stage_a_contract": {
            "source_families": 3,
            "catalogue_concepts": 60,
            "answerable_question_families": 12,
            "abstention_question_families": 6,
            "visible_forms": 36,
            "max_aggregate_reviewer_minutes": 240,
        },
        "stage_a_readiness": "requires_frozen_xbrl_release_and_independent_labels",
        "review_minutes_observed": None,
        "learned_selector_runs": 0,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = audit()
    encoded = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(encoded)
    else:
        print(encoded, end="")


if __name__ == "__main__":
    main()
