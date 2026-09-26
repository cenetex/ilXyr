"""Build a bounded FERAL study view from exact public iXBRL filing bytes.

This is a study intake adapter. BRAID owns the reusable source-release reader.
Raw filing and taxonomy bytes remain in the private source directory.
"""
import argparse
from collections import Counter
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "experiments/feral-source-selector/stage-a/SOURCE-MANIFEST.json"
XBRLI = "{http://www.xbrl.org/2003/instance}"
XSI = "{http://www.w3.org/2001/XMLSchema-instance}"
XLINK = "{http://www.w3.org/1999/xlink}"
XS = "{http://www.w3.org/2001/XMLSchema}"
LINK = "{http://www.xbrl.org/2003/linkbase}"
CORE = [
    "Assets", "AssetsCurrent", "LiabilitiesCurrent", "LiabilitiesAndStockholdersEquity",
    "CashAndCashEquivalentsAtCarryingValue", "Revenues", "CostOfRevenue",
    "InventoryNet", "Goodwill", "AccountsPayableCurrent",
    "EarningsPerShareBasic", "EarningsPerShareDiluted",
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByUsedInInvestingActivities",
    "NetCashProvidedByUsedInFinancingActivities",
    "OperatingLeaseLiabilityCurrent", "OperatingLeaseLiabilityNoncurrent",
    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    "WeightedAverageNumberOfSharesOutstandingBasic",
    "WeightedAverageNumberOfDilutedSharesOutstanding",
]
OCCURRENCE = re.compile(rb"<ix:nonFraction\b[^>]*>.*?</ix:nonFraction>", re.S)
OPENING = re.compile(rb"^<ix:nonFraction\b[^>]*>")
ATTR = re.compile(rb'([\w:]+)="([^"]*)"')


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def load_exact(source_dir, item):
    path = source_dir / (item["id"] + (".xml" if item["id"] in {"xsd", "labels"} else ".htm"))
    raw = path.read_bytes()
    if len(raw) != item["bytes"] or sha(raw) != item["sha256"]:
        raise ValueError("source bytes differ: " + item["id"])
    return raw


def context_row(node):
    identifier = node.find(XBRLI + "entity/" + XBRLI + "identifier")
    period = node.find(XBRLI + "period")
    dates = {child.tag.removeprefix(XBRLI): child.text for child in period}
    dimensions = []
    for child in node.iter():
        if child.tag.endswith("}explicitMember"):
            dimensions.append({"axis": child.attrib["dimension"], "member": child.text})
        elif child.tag.endswith("}typedMember"):
            dimensions.append({"axis": child.attrib["dimension"],
                               "member": "".join(child.itertext()).strip()})
    return {"cik": identifier.text, "period": dates,
            "dimensions": sorted(dimensions, key=lambda x: (x["axis"], x["member"]))}


def fact_value(node):
    if node.attrib.get(XSI + "nil") == "true":
        return None
    text = "".join(node.itertext()).strip().replace(",", "").replace("$", "")
    text = text.replace("\u00a0", "").replace(" ", "")
    if not text or node.attrib.get("continuedAt") or node.attrib.get("format") not in (None, "ixt:num-dot-decimal"):
        return None
    try:
        value = Decimal(text) * (Decimal(10) ** int(node.attrib.get("scale", "0")))
    except (InvalidOperation, ValueError):
        return None
    if node.attrib.get("sign") == "-":
        value = -value
    return format(value, "f")


def build(source_dir):
    manifest_raw = MANIFEST.read_bytes()
    manifest = json.loads(manifest_raw)
    xsd = ET.fromstring(load_exact(source_dir, manifest["taxonomy"][0]))
    labels = ET.fromstring(load_exact(source_dir, manifest["taxonomy"][1]))
    definitions = {}
    for element in xsd.iter(XS + "element"):
        name = element.attrib.get("name")
        if name:
            definitions[name] = {
                "type": element.attrib.get("type"),
                "period_type": element.attrib.get(XBRLI + "periodType"),
                "balance": element.attrib.get(XBRLI + "balance"),
            }
    standard_labels = {}
    for element in labels.iter(LINK + "label"):
        if element.attrib.get(XLINK + "role") == "http://www.xbrl.org/2003/role/label":
            label_id = element.attrib.get("id", "")
            match = re.fullmatch(r"lab_(.+)_label_en-US", label_id)
            if match:
                standard_labels[match[1]] = "".join(element.itertext()).strip()
    families = []
    candidate_sets = []
    for family in manifest["families"]:
        documents = []
        contexts = {}
        units = {}
        exclusions = Counter()
        us_gaap_occurrences = 0
        for item in family["filing"]:
            raw = load_exact(source_dir, item)
            root = ET.fromstring(raw)
            for node in root.iter(XBRLI + "context"):
                row = context_row(node)
                if row["cik"] != family["cik"]:
                    raise ValueError("context issuer differs")
                previous = contexts.setdefault(node.attrib["id"], row)
                if previous != row:
                    raise ValueError("context identity conflict")
            for unit in root.iter(XBRLI + "unit"):
                simple = unit.find(XBRLI + "measure")
                divide = unit.find(XBRLI + "divide")
                if simple is not None:
                    resolved = simple.text
                elif divide is not None:
                    numerator = divide.find(XBRLI + "unitNumerator/" + XBRLI + "measure")
                    denominator = divide.find(XBRLI + "unitDenominator/" + XBRLI + "measure")
                    resolved = numerator.text + "/" + denominator.text
                else:
                    raise ValueError("unsupported unit structure")
                previous = units.setdefault(unit.attrib["id"], resolved)
                if previous != resolved:
                    raise ValueError("unit identity conflict")
            spans = {}
            for match in OCCURRENCE.finditer(raw):
                opening = OPENING.match(match.group()).group()
                attributes = {k.decode(): v.decode() for k, v in ATTR.findall(opening)}
                identifier = attributes.get("id")
                if identifier in spans:
                    raise ValueError("duplicate occurrence id")
                spans[identifier] = {"span": [match.start(), match.end()], "attributes": attributes}
            documents.append((item, root, spans))
        rows = []
        current = set()
        for item, root, spans in documents:
            for node in root.iter():
                if not node.tag.endswith("}nonFraction"):
                    continue
                name = node.attrib.get("name", "")
                if not name.startswith("us-gaap:"):
                    continue
                us_gaap_occurrences += 1
                identifier = node.attrib.get("id")
                context = contexts.get(node.attrib.get("contextRef"))
                value = fact_value(node)
                reason = None
                if not identifier or identifier not in spans:
                    reason = "unresolved_occurrence"
                elif context is None:
                    reason = "unresolved_context"
                elif node.attrib.get("unitRef") not in units:
                    reason = "unresolved_unit"
                elif value is None:
                    reason = "unsupported_value_or_transform"
                if reason:
                    exclusions[reason] += 1
                    continue
                source_attributes = spans[identifier]["attributes"]
                if any(source_attributes.get(key) != node.attrib.get(key)
                       for key in ("id", "name", "contextRef", "unitRef")):
                    raise ValueError("occurrence source tag differs")
                end = context["period"].get("endDate", context["period"].get("instant"))
                if end == family["fiscal_end"] and not context["dimensions"]:
                    current.add(name.removeprefix("us-gaap:"))
                rows.append({
                    "id": family["id"] + "/" + item["id"] + "/" + identifier,
                    "concept": name, "context": context,
                    "context_id": node.attrib["contextRef"],
                    "unit": units[node.attrib["unitRef"]],
                    "unit_id": node.attrib["unitRef"],
                    "value": value,
                    "source_file": item["id"],
                    "source_sha256": item["sha256"],
                    "span": spans[identifier]["span"],
                    "scale": node.attrib.get("scale", "0"),
                    "decimals": node.attrib.get("decimals"),
                })
        candidate_sets.append(current)
        families.append({"id": family["id"], "fiscal_end": family["fiscal_end"],
                         "facts": rows, "exclusions": dict(exclusions),
                         "us_gaap_occurrences": us_gaap_occurrences})
    common = set.intersection(*candidate_sets)
    if len(common) < 60 or not set(CORE).issubset(common):
        raise ValueError("60-concept catalogue policy has insufficient common concepts")
    chosen = CORE + sorted(common - set(CORE))[:60 - len(CORE)]
    catalogue = [{
        "concept": "us-gaap:" + name,
        "standard_label": standard_labels[name],
        "structural_metadata": definitions[name],
        "semantic_definition_status": "standard_label_only",
        "taxonomy_release": manifest["taxonomy_release"],
    } for name in chosen]
    selected = set("us-gaap:" + name for name in chosen)
    evidence = {
        "schema": "ilxyr.feral_stage_a_evidence.v1",
        "source_manifest_sha256": sha(manifest_raw),
        "taxonomy_release": manifest["taxonomy_release"],
        "selection_policy": "20 fixed common concepts, then lexicographic fill from undimensioned current-period common concepts",
        "catalogue": catalogue,
        "families": [
            {"id": family["id"], "fiscal_end": family["fiscal_end"], "exclusions": family["exclusions"],
             "facts": [row for row in family["facts"] if row["concept"] in selected],
             "intake_counts": {"us_gaap_occurrences": family["us_gaap_occurrences"],
                               "parsed_numeric": len(family["facts"]),
                               "selected_catalogue": sum(row["concept"] in selected for row in family["facts"]),
                               "excluded": sum(family["exclusions"].values())}}
            for family in families
        ],
    }
    return evidence


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    result = build(args.source_dir)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"concepts": len(result["catalogue"]),
                      "facts": sum(len(row["facts"]) for row in result["families"]),
                      "families": len(result["families"])}))


if __name__ == "__main__":
    main()
