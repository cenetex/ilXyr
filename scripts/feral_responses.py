"""Read one answer object and retain the raw model response."""

from decimal import Decimal, InvalidOperation
import json

from feral_targets_v2 import UNITS, abstained, numeric_prediction


def decimal_token(text):
    value = Decimal(text)
    if not value.is_finite() or len(text) > 100 or abs(value.adjusted()) > 100:
        raise ValueError("numeric_range")
    return text


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate_json_field")
        result[key] = value
    return result


def reject_constant(_text):
    raise ValueError("non_finite_json_number")


def parse_response(raw):
    result = {"raw_response": raw, "response_status": "invalid"}
    try:
        if not isinstance(raw, str) or len(raw) > 16384:
            raise ValueError("response_size_or_type")
        parsed = json.loads(raw, object_pairs_hook=unique_object,
                            parse_float=decimal_token, parse_int=decimal_token,
                            parse_constant=reject_constant)
        if not isinstance(parsed, dict) or set(parsed) != {"answer"}:
            raise ValueError("one_answer_object_required")
        value = parsed["answer"]
        if abstained(value):
            result.update(response_status="abstained", prediction=None)
            return result
        if isinstance(value, str):
            if not value.strip() or len(value) > 4096:
                raise ValueError("answer_size")
            numeric_text = value.strip().replace(",", "").removeprefix("$").strip().removesuffix("%")
            try:
                Decimal(numeric_text)
            except InvalidOperation:
                pass  # FinQA also has yes/no and prose targets.
            else:
                decimal_token(numeric_text)
        elif isinstance(value, dict):
            if set(value) != {"value", "unit"} or value["unit"] not in UNITS:
                raise ValueError("numeric_unit_object_required")
            decimal_token(str(value["value"]).strip().replace(",", "").removeprefix("$").strip().removesuffix("%"))
            numeric_prediction(value, value["unit"])
        else:
            raise ValueError("answer_value_type")
        result.update(response_status="answered", prediction=value)
    except (ValueError, TypeError, ArithmeticError, RecursionError) as error:
        result.update(prediction={"invalid_response": str(error)}, parse_error=str(error))
    return result
